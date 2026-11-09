"""SQLite 資料層：文件式儲存（col / id / JSON），加上版本號供即時同步。

只用 Python 標準函式庫。所有寫入都走 put()/delete()，每次寫入遞增全域版本號 ver，
用戶端以 ver 拉取「自某版本之後的變更」。
"""
import json
import os
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
        row = self.conn.execute('SELECT data FROM docs WHERE col=? AND id=? AND deleted=0', (col, id)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, col):
        rows = self.conn.execute('SELECT id, data FROM docs WHERE col=? AND deleted=0', (col,)).fetchall()
        return [dict(json.loads(d), id=i) for i, d in rows]

    def count(self, col):
        return self.conn.execute('SELECT COUNT(*) FROM docs WHERE col=? AND deleted=0', (col,)).fetchone()[0]

    def put(self, col, id, data, uid=None):
        return self.batch([{'col': col, 'id': id, 'data': data}], uid)[0]

    def delete(self, col, id, uid=None):
        return self.batch([{'col': col, 'id': id, 'delete': True}], uid)[0]

    def batch(self, ops, uid=None):
        """一次寫入多筆；全部成功才提交。回傳每筆的 {col,id,ver}。"""
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
                self.conn.execute('COMMIT')
            except Exception:
                self.conn.execute('ROLLBACK')
                raise
            self.cond.notify_all()
        return out

    def changes_since(self, since, limit=20000):
        rows = self.conn.execute(
            'SELECT col, id, data, ver, deleted FROM docs WHERE ver>? ORDER BY ver LIMIT ?', (since, limit)).fetchall()
        out = []
        for col, id, data, ver, deleted in rows:
            if deleted:
                out.append({'col': col, 'id': id, 'ver': ver, 'data': None})
            else:
                out.append({'col': col, 'id': id, 'ver': ver, 'data': dict(json.loads(data), id=id)})
        return out

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

    def hist_prices(self, gid, limit=50):
        rows = self.conn.execute(
            'SELECT l.type, l.date, l.cid, l.qty, l.price, l.u, b.no FROM hist_lines l JOIN hist_bills b ON b.id=l.bill_id '
            'WHERE l.gid=? AND l.price>0 ORDER BY l.date DESC LIMIT ?', (gid, int(limit))).fetchall()
        return [{'type': t, 'date': d, 'cid': c, 'qty': q, 'price': p, 'u': u, 'no': n} for t, d, c, q, p, u, n in rows]

    def hist_count(self):
        return self.conn.execute('SELECT COUNT(*) FROM hist_bills').fetchone()[0]

    # ---------- 使用者與登入 ----------
    @staticmethod
    def _hash(pw, salt):
        return hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), bytes.fromhex(salt), 120000).hex()

    def user_count(self):
        return self.conn.execute('SELECT COUNT(*) FROM users WHERE disabled=0').fetchone()[0]

    def users(self):
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

    def update_user(self, uid, name=None, login=None, disabled=None):
        with self.lock:
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
        row = self.conn.execute(
            'SELECT u.id, u.name, u.login, u.role FROM sessions s JOIN users u ON u.id=s.uid WHERE s.token=? AND u.disabled=0', (token,)).fetchone()
        if not row:
            return None
        with self.lock:
            self.conn.execute('UPDATE sessions SET last=? WHERE token=?', (int(time.time() * 1000), token))
        return {'id': row[0], 'name': row[1], 'login': row[2], 'role': row[3]}

    def logout(self, token):
        with self.lock:
            self.conn.execute('DELETE FROM sessions WHERE token=?', (token,))

    # ---------- 備份 ----------
    def backup_to(self, path):
        with self.lock:
            dest = sqlite3.connect(path)
            try:
                self.conn.backup(dest)
            finally:
                dest.close()
