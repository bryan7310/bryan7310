"""SQLite 資料層：文件式儲存（col / id / JSON），加上版本號供即時同步。

只用 Python 標準函式庫。所有寫入都走 put()/delete()，每次寫入遞增全域版本號 ver，
用戶端以 ver 拉取「自某版本之後的變更」。
"""
import json
import os
import re
import sqlite3
import threading
import time
import hashlib
import secrets

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs(
  col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  ver INTEGER NOT NULL, ts INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(col, id));
CREATE INDEX IF NOT EXISTS docs_ver ON docs(ver);
CREATE INDEX IF NOT EXISTS docs_col ON docs(col, deleted);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
  created INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER NOT NULL, last INTEGER NOT NULL, agent TEXT);
-- 舊系統歷史單據（唯讀、量大，另表存放，不進同步）
CREATE TABLE IF NOT EXISTS hist_bills(
  id TEXT PRIMARY KEY, type TEXT, no TEXT, date TEXT, cid TEXT, cn TEXT, amt REAL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS hist_cid ON hist_bills(cid, date);
CREATE INDEX IF NOT EXISTS hist_date ON hist_bills(date);
CREATE INDEX IF NOT EXISTS hist_no ON hist_bills(no);
CREATE TABLE IF NOT EXISTS hist_lines(
  bill_id TEXT NOT NULL, gid TEXT, type TEXT, date TEXT, cid TEXT, qty REAL, price REAL, u TEXT, memo TEXT);
CREATE INDEX IF NOT EXISTS hist_lines_gid ON hist_lines(gid, date);
"""


class DB:
    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.execute('PRAGMA journal_mode=WAL')
        self.conn.execute('PRAGMA synchronous=NORMAL')
        self.conn.executescript(SCHEMA)
        row = self.conn.execute("SELECT value FROM meta WHERE key='ver'").fetchone()
        self.ver = int(row[0]) if row else 0

    # ---------- 版本 ----------
    def _bump(self):
        self.ver += 1
        self.conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('ver',?)", (str(self.ver),))
        return self.ver

    def wait_for_change(self, since, timeout):
        """等到版本大於 since（或逾時），回傳目前版本。"""
        with self.cond:
            end = time.time() + timeout
            while self.ver <= since:
                rem = end - time.time()
                if rem <= 0:
                    break
                self.cond.wait(rem)
            return self.ver

    # ---------- 文件 ----------
    def get(self, col, id):
        with self.lock:
            row = self.conn.execute('SELECT data FROM docs WHERE col=? AND id=? AND deleted=0', (col, id)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, col):
        with self.lock:
            rows = self.conn.execute('SELECT id, data FROM docs WHERE col=? AND deleted=0', (col,)).fetchall()
        return [dict(json.loads(d), id=i) for i, d in rows]

    def count(self, col):
        with self.lock:
            return self.conn.execute('SELECT COUNT(*) FROM docs WHERE col=? AND deleted=0', (col,)).fetchone()[0]

    def put(self, col, id, data, uid=None):
        return self.batch([{'col': col, 'id': id, 'data': data}], uid)[0]

    def delete(self, col, id, uid=None):
        return self.batch([{'col': col, 'id': id, 'delete': True}], uid)[0]

    def batch(self, ops, uid=None, extra=None):
        """一次寫入多筆；全部成功才提交。回傳每筆的 {col,id,ver}。extra(conn)：同一個交易裡要多做的 SQL"""
        out = []
        with self.cond:
            self.conn.execute('BEGIN')
            try:
                ts = int(time.time() * 1000)
                for op in ops:
                    col, id = op['col'], op['id']
                    ver = self._bump()
                    if op.get('delete'):
                        self.conn.execute(
                            'INSERT INTO docs(col,id,data,ver,ts,deleted) VALUES(?,?,?,?,?,1) '
                            'ON CONFLICT(col,id) DO UPDATE SET ver=excluded.ver, ts=excluded.ts, deleted=1',
                            (col, id, '{}', ver, ts))
                    else:
                        data = dict(op['data'])
                        data.pop('id', None)
                        if uid:
                            data['_by'] = uid
                        self.conn.execute(
                            'INSERT INTO docs(col,id,data,ver,ts,deleted) VALUES(?,?,?,?,?,0) '
                            'ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, ver=excluded.ver, ts=excluded.ts, deleted=0',
                            (col, id, json.dumps(data, ensure_ascii=False, separators=(',', ':')), ver, ts))
                    out.append({'col': col, 'id': id, 'ver': ver})
                if extra:
                    extra(self.conn)
                self.conn.execute('COMMIT')
            except Exception:
                self.conn.execute('ROLLBACK')
                raise
            self.cond.notify_all()
        return out

    def changes_since(self, since, limit=20000):
        with self.lock:
            rows = self.conn.execute(
                'SELECT col, id, data, ver, deleted FROM docs WHERE ver>? ORDER BY ver LIMIT ?', (since, limit)).fetchall()
        out = []
        for col, id, data, ver, deleted in rows:
            if deleted:
                out.append({'col': col, 'id': id, 'ver': ver, 'data': None})
            else:
                out.append({'col': col, 'id': id, 'ver': ver, 'data': dict(json.loads(data), id=id)})
        return out

    # ---------- 客戶／供應商：重複檢查與合併 ----------
    REF_COLS = ('bills', 'receivables', 'payables', 'checks_in', 'checks_out', 'invoices', 'purch_invoices', 'orders', 'mail', 'labels')

    @staticmethod
    def _cname_strict(s):
        s = str(s or '').replace('臺', '台')
        s = re.sub(r'[(（]股[)）]', '', s)
        s = re.sub(r'[-－]\s*\d+$', '', s)
        s = re.sub(r'[\s()（）\-－_.,，、]', '', s)
        return re.sub(r'(股份有限公司|有限公司|股份公司|公司)$', '', s)

    @staticmethod
    def _cname_loose(s):
        s = str(s or '').replace('臺', '台')
        s = re.sub(r'[(（]股[)）]', '', s)
        s = re.sub(r'[-－]\s*\d+$', '', s)
        s = re.sub(r'[(（][^)）]*[)）]', '', s)
        return re.sub(r'[\s\-－_.,，、]|股份|有限|公司|企業|工業|實業|商行|行號|社$|廠$|行$', '', s)

    def contact_dups(self, kind):
        """同類（C／S）名稱重複的群組；每群依「舊系統 > Access > 新平台」、交易筆數排序，第一筆是建議保留的"""
        ct = {c['id']: c for c in self.list('contacts') if c.get('kind') == kind}
        refs = {}
        for col in self.REF_COLS:
            for i, d in self.conn.execute('SELECT id, data FROM docs WHERE col=? AND deleted=0', (col,)):
                cid = json.loads(d).get('cid')
                if cid in ct:
                    refs[cid] = refs.get(cid, 0) + 1
        hist = {c: n for c, n in self.conn.execute('SELECT cid, COUNT(*) FROM hist_bills GROUP BY cid') if c in ct}
        tier = lambda k: 0 if (k.startswith('oc') and ct[k].get('old')) else 1 if ct[k].get('mdb') else 2
        groups, seen = [], set()
        for fn, strong in ((self._cname_strict, True), (self._cname_loose, False)):
            g = {}
            for k, v in ct.items():
                n = fn(v.get('name'))
                if n:
                    g.setdefault(n, []).append(k)
            for n, ks in sorted(g.items()):
                key = tuple(sorted(ks))
                if len(ks) < 2 or key in seen or any(set(ks) <= set(x['ids']) for x in groups):
                    continue
                seen.add(key)
                ks.sort(key=lambda k: (tier(k), -(refs.get(k, 0) + hist.get(k, 0)), not ct[k].get('short'), str(ct[k].get('code') or '~')))
                taxes = {re.sub(r'\D', '', str(ct[k].get('taxId') or '')) for k in ks} - {''}
                # 名稱只差「(1)」「(2)」「(弟)」這種短括號的，多半是不同的人／單位，預設不勾
                short_paren = any(re.search(r'[(（](\d+|[^)）\d])[)）]', re.sub(r'[(（]股[)）]', '', str(ct[k].get('name') or ''))) for k in ks)
                groups.append({'ids': ks, 'strong': strong, 'conflict': len(taxes) > 1, 'suggest': strong or not short_paren,
                               'items': [{'id': k, 'tier': ['舊系統', 'Access', '新平台'][tier(k)], 'code': ct[k].get('code', ''), 'name': ct[k].get('name', ''),
                                          'short': ct[k].get('short', ''), 'taxId': ct[k].get('taxId', ''), 'phone': ct[k].get('phone', ''),
                                          'inactive': bool(ct[k].get('inactive')), 'refs': refs.get(k, 0), 'hist': hist.get(k, 0)} for k in ks]})
        for x in groups:
            if x['conflict']:
                x['suggest'] = False
        return groups

    def merge_contacts(self, keep, others, uid=None):
        """把 others 併入 keep：資料補空欄、名稱放別名、所有單據（含舊系統歷史單據）改掛 keep，others 刪除。一個交易完成。"""
        others = [o for o in dict.fromkeys(others) if o and o != keep]
        K = self.get('contacts', keep)
        if not K or not others:
            raise ValueError('找不到要保留的資料，或沒有要合併的對象')
        Os = []
        for o in others:
            d = self.get('contacts', o)
            if not d:
                raise ValueError('找不到 %s（可能已經合併過了）' % o)
            if d.get('kind') != K.get('kind'):
                raise ValueError('客戶和供應商不能互相合併')
            Os.append((o, d))
        K = dict(K)
        for o, d in Os:
            for f in ('short', 'taxId', 'person', 'phone', 'fax', 'zip', 'addr', 'payMethod'):
                if not str(K.get(f) or '').strip() and str(d.get(f) or '').strip():
                    K[f] = d[f]
            on = str(d.get('note') or '').strip()
            if on and on not in str(K.get('note') or ''):
                K['note'] = (str(K.get('note') or '').strip() + '；' + on).strip('；')
            # 保留那筆的簡稱若不是名稱開頭（像「拉釘(全鋼)」這種備註），而被併入的那筆有正常簡稱，就換過來
            ks, os_ = str(K.get('short') or '').strip(), str(d.get('short') or '').strip()
            nm = str(K.get('name') or '')
            extra_al = []
            if os_ and ks and not nm.startswith(ks) and nm.startswith(os_):
                K['short'], extra_al = os_, [ks]
            al = [*(K.get('aliases') or []), *(d.get('aliases') or []), d.get('name', ''), d.get('short', ''), *extra_al]
            K['aliases'] = [a for a in dict.fromkeys(str(x).strip() for x in al) if a and a != K.get('name') and a != K.get('short')]
            try:
                K['init'] = round(float(K.get('init') or 0) + float(d.get('init') or 0), 2)
            except (TypeError, ValueError):
                pass
            if not d.get('inactive'):
                K.pop('inactive', None)
            K.setdefault('merged', []).append({'id': o, 'code': d.get('code', ''), 'name': d.get('name', ''), 'at': int(time.time() * 1000)})
        ops = [{'col': 'contacts', 'id': keep, 'data': K}]
        moved = {}
        oset = set(others)
        for col in self.REF_COLS:
            for i, d in self.conn.execute('SELECT id, data FROM docs WHERE col=? AND deleted=0', (col,)).fetchall():
                x = json.loads(d)
                if x.get('cid') in oset:
                    x['cid'] = keep
                    ops.append({'col': col, 'id': i, 'data': x, 'keep_by': True})
                    moved[col] = moved.get(col, 0) + 1
        for o in others:
            ops.append({'col': 'contacts', 'id': o, 'delete': True})
        hist_n = [0]
        def extra(conn):
            ph = ','.join('?' * len(others))
            for bid, data in conn.execute('SELECT id, data FROM hist_bills WHERE cid IN (%s)' % ph, others).fetchall():
                b = json.loads(data)
                b['cid'] = keep
                conn.execute('UPDATE hist_bills SET cid=?, data=? WHERE id=?', (keep, json.dumps(b, ensure_ascii=False, separators=(',', ':')), bid))
                hist_n[0] += 1
            conn.execute('UPDATE hist_lines SET cid=? WHERE cid IN (%s)' % ph, [keep, *others])
            if hist_n[0]:
                conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('hist_ver',?)", (str(int(time.time() * 1000)),))
        # 改掛的單據不要蓋掉原本的建立者（_by）
        by_ops = [op for op in ops if op.pop('keep_by', False)]
        self.batch(ops, None, extra)
        return {'keep': keep, 'merged': others, 'moved': moved, 'hist': hist_n[0], 'docs': len(by_ops)}

    GOODS_FILL = ('spec', 'spec2', 'custName', 'vcode', 'cat', 'unit', 'salePrice', 'purPrice', 'cost', 'safety', 'wt', 'aunit', 'arate', 'sp', 'bom', 'labor', 'cwid', 'wireOf')

    def merge_goods(self, groups, uid=None):
        """商品合併：groups=[{keep, merge:[...]}]。被併入的商品資料補到保留那筆的空欄、記在 merged，
        所有文件裡指到它的 id（單據明細、配方、設定裡的對應…，值或鍵）與舊系統歷史單據都改成保留那筆，然後刪除。一個交易完成。"""
        M = {}
        keeps = {}
        for g in groups or []:
            keep = str(g.get('keep') or '')
            K = self.get('goods', keep)
            if not K:
                raise ValueError('找不到要保留的商品 %s（可能已經合併過了）' % keep)
            for o in dict.fromkeys(str(x) for x in (g.get('merge') or [])):
                if not o or o == keep:
                    continue
                if o in M:
                    raise ValueError('商品 %s 同時出現在兩組' % o)
                if not self.get('goods', o):
                    raise ValueError('找不到要併入的商品 %s（可能已經合併過了）' % o)
                M[o] = keep
            keeps.setdefault(keep, dict(K))
        if not M:
            raise ValueError('沒有要合併的商品')
        if set(M) & set(keeps):
            raise ValueError('保留的商品不能同時被併入別的商品')
        empty = lambda v: v is None or v == [] or v == {} or str(v).strip() in ('', '0')
        now = int(time.time() * 1000)
        for o, keep in M.items():
            K, d = keeps[keep], self.get('goods', o)
            for f in self.GOODS_FILL:
                if empty(K.get(f)) and not empty(d.get(f)):
                    K[f] = d[f]
            ks, os_ = str(K.get('spec') or '').strip(), str(d.get('spec') or '').strip()
            if ks and os_ and ks != os_:
                if not str(K.get('spec2') or '').strip():
                    K['spec2'] = os_
                elif os_ not in str(K.get('note') or ''):
                    K['note'] = (str(K.get('note') or '').strip() + '；另一客料號 ' + os_).strip('；')
            if d.get('dwg'):
                have = {json.dumps(x, sort_keys=True) for x in (K.get('dwg') or [])}
                K['dwg'] = [*(K.get('dwg') or []), *[x for x in d['dwg'] if json.dumps(x, sort_keys=True) not in have]]
            on = str(d.get('note') or '').strip()
            if on and on not in str(K.get('note') or ''):
                K['note'] = (str(K.get('note') or '').strip() + '；' + on).strip('；')
            K.setdefault('merged', []).append({'id': o, 'code': d.get('code', ''), 'name': d.get('name', ''), 'at': now})

        def fix(x):
            """把 x 裡指到被併入商品的 id 換掉；回傳 (新值, 有沒有改)"""
            if isinstance(x, str):
                return (M[x], True) if x in M else (x, False)
            if isinstance(x, list):
                ch = False
                out = []
                for v in x:
                    nv, c = fix(v)
                    out.append(nv)
                    ch = ch or c
                return out, ch
            if isinstance(x, dict):
                ch = False
                out = {}
                for k, v in x.items():
                    nv, c = fix(v)
                    ch = ch or c
                    if k in M:
                        ch = True
                        if M[k] in x or M[k] in out:
                            continue   # 保留那筆已經有自己的設定，以它為主
                        k = M[k]
                    out[k] = nv
                return out, ch
            return x, False

        ops = []
        for k, v in keeps.items():
            if uid:
                v['_by'] = uid
            ops.append({'col': 'goods', 'id': k, 'data': v})
        moved = {}
        skip = set(M) | set(keeps)
        for col, i, d in self.conn.execute('SELECT col, id, data FROM docs WHERE deleted=0').fetchall():
            if col == 'goods' and i in skip:
                continue
            if not any(o in d for o in M):
                continue
            nx, ch = fix(json.loads(d))
            if ch:
                ops.append({'col': col, 'id': i, 'data': nx})
                moved[col] = moved.get(col, 0) + 1
        for o in M:
            ops.append({'col': 'goods', 'id': o, 'delete': True})
        hist_n = [0]

        def extra(conn):
            olds = list(M)
            for j in range(0, len(olds), 400):
                part = olds[j:j + 400]
                ph = ','.join('?' * len(part))
                bids = [r[0] for r in conn.execute('SELECT DISTINCT bill_id FROM hist_lines WHERE gid IN (%s)' % ph, part)]
                for bid in bids:
                    row = conn.execute('SELECT data FROM hist_bills WHERE id=?', (bid,)).fetchone()
                    if row:
                        nb, ch = fix(json.loads(row[0]))
                        if ch:
                            conn.execute('UPDATE hist_bills SET data=? WHERE id=?', (json.dumps(nb, ensure_ascii=False, separators=(',', ':')), bid))
                            hist_n[0] += 1
                for o in part:
                    conn.execute('UPDATE hist_lines SET gid=? WHERE gid=?', (M[o], o))
            if hist_n[0]:
                conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('hist_ver',?)", (str(int(time.time() * 1000)),))
        # uid=None：改掛的單據保留原本的 _by（建立者）
        self.batch(ops, None, extra)
        return {'merged': len(M), 'keeps': len(keeps), 'moved': moved, 'hist': hist_n[0]}

    # ---------- 歷史單據 ----------
    def hist_replace(self, bills):
        """整批重建歷史單據（匯入用）。bills 為 dict 列表，需含 id。"""
        with self.lock:
            self.conn.execute('BEGIN')
            try:
                self.conn.execute('DELETE FROM hist_bills')
                self.conn.execute('DELETE FROM hist_lines')
                for b in bills:
                    self.conn.execute(
                        'INSERT INTO hist_bills(id,type,no,date,cid,cn,amt,data) VALUES(?,?,?,?,?,?,?,?)',
                        (b['id'], b.get('type'), str(b.get('no') or ''), b.get('date') or '', b.get('cid') or '',
                         b.get('cn') or '', float(b.get('oamt') or 0), json.dumps(b, ensure_ascii=False, separators=(',', ':'))))
                    for l in b.get('lines') or []:
                        self.conn.execute(
                            'INSERT INTO hist_lines(bill_id,gid,type,date,cid,qty,price,u,memo) VALUES(?,?,?,?,?,?,?,?,?)',
                            (b['id'], l.get('gid'), b.get('type'), b.get('date') or '', b.get('cid') or '',
                             float(l.get('qty') or 0), float(l.get('price') or 0), l.get('u') or '', l.get('memo') or ''))
                self.conn.execute('COMMIT')
            except Exception:
                self.conn.execute('ROLLBACK')
                raise
            # 歷史單據版本：瀏覽器用它判斷本機快取還能不能用
            self.conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('hist_ver',?)", (str(int(time.time() * 1000)),))

    def hist_update(self, b):
        """修改一張已存在的歷史單據（含明細索引），回傳新的 hist_ver。不會變成一般單據、不計庫存帳款。"""
        bid = str(b.get('id') or '')
        with self.lock:
            if not self.conn.execute('SELECT 1 FROM hist_bills WHERE id=?', (bid,)).fetchone():
                raise ValueError('找不到這張歷史單據')
            b = dict(b, id=bid, hist=True)
            stamp = str(int(time.time() * 1000))
            self.conn.execute('BEGIN')
            try:
                self.conn.execute('UPDATE hist_bills SET type=?, no=?, date=?, cid=?, cn=?, amt=?, data=? WHERE id=?',
                                  (b.get('type'), str(b.get('no') or ''), b.get('date') or '', b.get('cid') or '', b.get('cn') or '',
                                   float(b.get('oamt') or 0), json.dumps(b, ensure_ascii=False, separators=(',', ':')), bid))
                self.conn.execute('DELETE FROM hist_lines WHERE bill_id=?', (bid,))
                for l in b.get('lines') or []:
                    if 'txt' in l:
                        continue
                    self.conn.execute(
                        'INSERT INTO hist_lines(bill_id,gid,type,date,cid,qty,price,u,memo) VALUES(?,?,?,?,?,?,?,?,?)',
                        (bid, l.get('gid'), b.get('type'), b.get('date') or '', b.get('cid') or '',
                         float(l.get('qty') or 0), float(l.get('price') or 0), l.get('u') or '', l.get('memo') or ''))
                self.conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('hist_ver',?)", (stamp,))
                self.conn.execute('COMMIT')
            except Exception:
                self.conn.execute('ROLLBACK')
                raise
            return stamp

    def hist_stamp(self):
        row = self.conn.execute("SELECT value FROM meta WHERE key='hist_ver'").fetchone()
        return row[0] if row else 'c%d' % self.hist_count()

    def hist_raw(self, type=None, limit=10000, offset=0):
        """整批取歷史單據：直接回傳資料庫裡的 JSON 字串，不解開重包（給清單整批載入用）。"""
        with self.lock:
            where, args = ('WHERE b.type=?', [type]) if type else ('', [])
            rows = self.conn.execute(f'SELECT b.data FROM hist_bills b {where} ORDER BY b.date DESC, b.no DESC LIMIT ? OFFSET ?', args + [int(limit), int(offset)]).fetchall()
            total = self.conn.execute(f'SELECT COUNT(*) FROM hist_bills b {where}', args).fetchone()[0]
            return total, [r[0] for r in rows]

    def hist_query(self, cid=None, gid=None, type=None, q=None, frm=None, to=None, limit=200, offset=0):
        with self.lock:
            return self._hist_query(cid, gid, type, q, frm, to, limit, offset)

    def _hist_query(self, cid, gid, type, q, frm, to, limit, offset):
        where, args = [], []
        if cid:
            where.append('b.cid=?'); args.append(cid)
        if type:
            where.append('b.type=?'); args.append(type)
        if frm:
            where.append('b.date>=?'); args.append(frm)
        if to:
            where.append('b.date<=?'); args.append(to)
        if gid:
            where.append('b.id IN (SELECT bill_id FROM hist_lines WHERE gid=?)'); args.append(gid)
        if q:
            where.append('(b.no LIKE ? OR b.cn LIKE ? OR b.data LIKE ?)'); args += [f'%{q}%'] * 3
        sql = 'SELECT b.data FROM hist_bills b' + (' WHERE ' + ' AND '.join(where) if where else '') + \
              ' ORDER BY b.date DESC, b.no DESC LIMIT ? OFFSET ?'
        args += [int(limit), int(offset)]
        rows = self.conn.execute(sql, args).fetchall()
        total = self.conn.execute('SELECT COUNT(*) FROM hist_bills b' + (' WHERE ' + ' AND '.join(where) if where else ''), args[:-2]).fetchone()[0]
        return {'total': total, 'rows': [json.loads(r[0]) for r in rows]}

    def hist_prices(self, gid, limit=50, cid=''):
        """某商品的歷史單價；cid 有給就只看那個客戶／廠商"""
        sql = 'SELECT l.type, l.date, l.cid, l.qty, l.price, l.u, b.no FROM hist_lines l JOIN hist_bills b ON b.id=l.bill_id WHERE l.gid=? AND l.price>0'
        args = [gid]
        if cid:
            sql += ' AND l.cid=?'
            args.append(cid)
        rows = self.conn.execute(sql + ' ORDER BY l.date DESC LIMIT ?', args + [int(limit)]).fetchall()
        return [{'type': t, 'date': d, 'cid': c, 'qty': q, 'price': p, 'u': u, 'no': n} for t, d, c, q, p, u, n in rows]

    def hist_count(self):
        return self.conn.execute('SELECT COUNT(*) FROM hist_bills').fetchone()[0]

    # ---------- 使用者與登入 ----------
    @staticmethod
    def _hash(pw, salt):
        return hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), bytes.fromhex(salt), 120000).hex()

    def user_count(self):
        with self.lock:
            return self.conn.execute('SELECT COUNT(*) FROM users WHERE disabled=0').fetchone()[0]

    def users(self):
        with self.lock:
            rows = self.conn.execute('SELECT id, name, login, role, created, disabled FROM users ORDER BY created').fetchall()
        return [{'id': r[0], 'name': r[1], 'login': r[2], 'role': r[3], 'created': r[4], 'disabled': bool(r[5])} for r in rows]

    def add_user(self, name, login, pw, role='admin'):
        salt = secrets.token_hex(16)
        uid = 'u' + secrets.token_hex(6)
        with self.lock:
            self.conn.execute('INSERT INTO users(id,name,login,salt,hash,role,created) VALUES(?,?,?,?,?,?,?)',
                              (uid, name, login.strip().lower(), salt, self._hash(pw, salt), role, int(time.time() * 1000)))
        return uid

    def set_password(self, uid, pw):
        salt = secrets.token_hex(16)
        with self.lock:
            self.conn.execute('UPDATE users SET salt=?, hash=? WHERE id=?', (salt, self._hash(pw, salt), uid))

    def update_user(self, uid, name=None, login=None, disabled=None, role=None):
        with self.lock:
            if role in ('admin', 'staff'):
                self.conn.execute('UPDATE users SET role=? WHERE id=?', (role, uid))
            if name is not None:
                self.conn.execute('UPDATE users SET name=? WHERE id=?', (name, uid))
            if login is not None:
                self.conn.execute('UPDATE users SET login=? WHERE id=?', (login.strip().lower(), uid))
            if disabled is not None:
                self.conn.execute('UPDATE users SET disabled=? WHERE id=?', (1 if disabled else 0, uid))
                if disabled:
                    self.conn.execute('DELETE FROM sessions WHERE uid=?', (uid,))

    def login(self, login, pw, agent=''):
        row = self.conn.execute('SELECT id, salt, hash FROM users WHERE login=? AND disabled=0', (login.strip().lower(),)).fetchone()
        if not row or not secrets.compare_digest(self._hash(pw, row[1]), row[2]):
            return None
        token = secrets.token_urlsafe(32)
        now = int(time.time() * 1000)
        with self.lock:
            self.conn.execute('INSERT INTO sessions(token,uid,created,last,agent) VALUES(?,?,?,?,?)', (token, row[0], now, now, agent[:200]))
        return token

    def session_user(self, token):
        if not token:
            return None
        with self.lock:
            row = self.conn.execute(
                'SELECT u.id, u.name, u.login, u.role FROM sessions s JOIN users u ON u.id=s.uid WHERE s.token=? AND u.disabled=0', (token,)).fetchone()
            if not row:
                return None
            self.conn.execute('UPDATE sessions SET last=? WHERE token=?', (int(time.time() * 1000), token))
        return {'id': row[0], 'name': row[1], 'login': row[2], 'role': row[3]}

    def logout(self, token):
        with self.lock:
            self.conn.execute('DELETE FROM sessions WHERE token=?', (token,))

    # ---------- 資料庫優化 ----------
    def _size(self):
        n = 0
        for suf in ('', '-wal'):
            try:
                n += os.path.getsize(self.path + suf)
            except OSError:
                pass
        return n

    def optimize(self):
        """一鍵優化：檢查 → 寫回暫存（WAL）→ 更新查詢統計 → 重整檔案（VACUUM）。資料有損壞就不動。"""
        t0 = time.time()
        with self.lock:
            before = self._size()
            free = self.conn.execute('PRAGMA freelist_count').fetchone()[0]
            check = self.conn.execute('PRAGMA quick_check').fetchone()[0]
            if check != 'ok':
                return {'ok': False, 'check': check, 'before': before, 'after': before, 'ms': int((time.time() - t0) * 1000)}
            self.conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            self.conn.execute('ANALYZE')
            self.conn.execute('VACUUM')
            self.conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            self.conn.execute('PRAGMA optimize')
            after = self._size()
        return {'ok': True, 'check': check, 'before': before, 'after': after, 'free': free, 'ms': int((time.time() - t0) * 1000)}

    # ---------- 備份 ----------
    def backup_to(self, path):
        with self.lock:
            dest = sqlite3.connect(path)
            try:
                self.conn.backup(dest)
            finally:
                dest.close()
