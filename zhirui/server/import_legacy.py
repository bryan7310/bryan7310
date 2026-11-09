"""把舊版（進銷存 + 作業平台）共用資料夾裡的 JSON 匯進新平台的 SQLite。

用法：
  python import_legacy.py --src "Z:\\志瑞平台資料" [--pricing ../../data] [--data ../data] [--reset]

  --src      舊版共用資料夾（裡面有 erp-*.json、erp-packs-*.json、receivables.v1.json …）
  --pricing  查價系統各供應商牌價 JSON 所在資料夾（repo 的 data/，預設自動尋找）
  --data     新平台資料夾（zhirui.db 所在，預設 ../data）
  --reset    匯入前先清空新平台的所有資料（第一次匯入、或要重來時用）

可以重複執行：同一個 id 會被覆蓋。歷史單據每次整批重建。
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import DB  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def docs_of(path):
    """進銷存的 erp-<col>.json：{col, docs:{id:{...,_t,_del}}}"""
    if not os.path.isfile(path):
        return {}
    try:
        return load(path).get('docs') or {}
    except Exception as e:
        print(f'警告：{os.path.basename(path)} 無法讀取（{e}），略過')
        return {}


def pack_items(src, kind):
    out = []
    for f in sorted(glob.glob(os.path.join(src, f'erp-packs-{kind}-*.json'))):
        for pid, p in docs_of(f).items():
            if p.get('_del'):
                continue
            out.extend(p.get('items') or [])
    return out


def merged(src, col, pack_kinds):
    """packs 的基底資料 + erp-<col>.json 的修改／刪除 → {id: doc}"""
    m = {}
    for k in pack_kinds:
        for it in pack_items(src, k):
            if it.get('id'):
                m[it['id']] = dict(it)
    for id, v in docs_of(os.path.join(src, f'erp-{col}.json')).items():
        if v.get('_del') or v.get('deleted'):
            m.pop(id, None)
        else:
            m[id] = dict(v, id=id)
    for v in m.values():
        v.pop('_t', None)
    return m


SUFFIX_RE = re.compile(r'(股份有限公司|有限公司|企業社|工業社|實業社|商行|工廠|企業|實業|工業|五金行|公司|社|行)')


def norm_name(s):
    s = str(s or '').strip()
    s = re.sub(r'[\s　]+', '', s)
    s = re.sub(r'-\d+$', '', s)            # 「崧泉企業股份有限公司-203」
    s = re.sub(r'[（(].*?[)）]', '', s)
    return s


def stem(s):
    return SUFFIX_RE.sub('', norm_name(s))


class Matcher:
    """用簡稱／名稱把作業平台的名字對到進銷存的客戶、供應商。"""

    def __init__(self, contacts):
        self.contacts = contacts
        self.by_exact = {}
        self.by_stem = {}
        for c in contacts.values():
            for key in filter(None, [norm_name(c.get('name')), norm_name(c.get('short'))] + [norm_name(a) for a in c.get('aliases', [])]):
                self.by_exact.setdefault(key, []).append(c)
            st = stem(c.get('name'))
            if st:
                self.by_stem.setdefault(st, []).append(c)

    def find(self, name, kind=None):
        n = norm_name(name)
        if not n:
            return None
        cands = [c for c in self.by_exact.get(n, []) if not kind or c.get('kind') == kind]
        if len(cands) == 1:
            return cands[0]
        if cands:
            return cands[0]
        st = stem(name)
        cands = [c for c in self.by_stem.get(st, []) if not kind or c.get('kind') == kind]
        if len(cands) == 1:
            return cands[0]
        # 簡稱是名稱的開頭
        if len(n) >= 2:
            cands = [c for c in self.contacts.values() if (not kind or c.get('kind') == kind) and stem(c.get('name')).startswith(n)]
            if len(cands) == 1:
                return cands[0]
        return None


def to_pcs(it):
    """牌價一律換成每 1 支／個：100支、100個、籮(144支) 除以包裝數；kg 且有每公斤個數則除以個數。原價保留在 origPrice/origUnit。"""
    if it.get('pcs'):
        return it
    u = str(it.get('unit') or '')
    f = 1
    m = re.match(r'^(\d+)\s*(支|個|PCS|pcs)$', u) or re.search(r'\((\d+)\s*支\)', u)
    if m:
        f = int(m.group(1))
    elif u == 'kg' and float(it.get('perKg') or 0) > 0:
        f = float(it['perKg'])
    if f != 1:
        it['origPrice'] = it.get('price')
        it['origUnit'] = u
        it['price'] = round(float(it.get('price') or 0) / f, 6)
        it['unit'] = '個' if re.search(r'個|kg', u) else '支'
    it['pcs'] = True
    return it


def add_alias(c, name):
    n = str(name or '').strip()
    if not n or n == c.get('name') or n == c.get('short'):
        return
    c.setdefault('aliases', [])
    if n not in c['aliases']:
        c['aliases'].append(n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--pricing', default=None)
    ap.add_argument('--data', default=os.path.join(HERE, '..', 'data'))
    ap.add_argument('--reset', action='store_true')
    a = ap.parse_args()
    src = a.src
    pricing_dir = a.pricing or next((p for p in [os.path.join(HERE, '..', '..', 'data'), os.path.join(HERE, '..', 'pricing')] if os.path.isdir(p)), None)
    os.makedirs(a.data, exist_ok=True)
    db = DB(os.path.join(a.data, 'zhirui.db'))
    t0 = time.time()
    rep = []

    if a.reset:
        with db.lock:
            db.conn.execute('DELETE FROM docs')
        rep.append('已清空舊資料')

    ops = []

    def put(col, id, data):
        d = dict(data)
        d.pop('id', None)
        ops.append({'col': col, 'id': id, 'data': d})

    # ---------- 倉庫、帳戶、設定 ----------
    for col in ('warehouses', 'accounts'):
        m = merged(src, col, [])
        for id, v in m.items():
            put(col, id, v)
        rep.append(f'{col}: {len(m)}')
    settings = merged(src, 'settings', [])
    for id, v in settings.items():
        put('settings', id, v)

    # ---------- 客戶、供應商 ----------
    contacts = merged(src, 'contacts', ['contacts', 'mdbcontacts'])
    for c in contacts.values():
        c['aliases'] = []
        if c.get('short'):
            add_alias(c, c['short'])
    matcher = Matcher(contacts)
    unmatched = {'receivables': [], 'payables': [], 'orders': [], 'checks_in': [], 'checks_out': []}

    def link(name, kind, where):
        c = matcher.find(name, kind) or matcher.find(name)
        if c:
            add_alias(c, name)
            return c['id']
        if name not in unmatched[where]:
            unmatched[where].append(name)
        return None

    # ---------- 商品 ----------
    goods = merged(src, 'goods', ['goods', 'mdbgoods'])
    for id, v in goods.items():
        put('goods', id, v)
    rep.append(f'商品: {len(goods)}')

    # ---------- 單據：現行 vs 歷史 ----------
    bills = merged(src, 'bills', ['bills', 'mdbbills', 'mdbpo', 'mdbquotes'])
    live, hist = 0, []
    for id, b in bills.items():
        b['id'] = id
        if b.get('hist'):
            hist.append(b)
        else:
            put('bills', id, b)
            live += 1
    rep.append(f'現行單據: {live}；歷史單據: {len(hist)}')

    # ---------- 查價牌價 ----------
    n_items = 0
    if pricing_dir:
        for f in sorted(glob.glob(os.path.join(pricing_dir, '*.json'))):
            try:
                d = load(f)
            except Exception:
                continue
            if not isinstance(d, dict) or d.get('app') != 'screw-pricing':
                continue
            sup = None
            for c in d.get('categories', []):
                put('pricing_cats', c['id'], dict(c, source=d.get('source', '')))
            for it in d.get('items', []):
                sup = sup or it.get('sup')
                put('pricing', it['id'], to_pcs(dict(it)))
                n_items += 1
        rep.append(f'查價牌價: {n_items} 筆（{pricing_dir}）')
    else:
        rep.append('找不到查價牌價資料夾，略過（可用 --pricing 指定）')
    # 作業平台「折數管理」改過的折數
    ro = os.path.join(src, 'screwPricing.v1.readonly.json')
    if os.path.isfile(ro):
        q = load(ro)
        for key, disc in (q.get('discs') or {}).items():
            cat, name, base = (key.split('|') + ['', ''])[:3]
            put('discounts', hashlib.md5(key.encode('utf-8')).hexdigest()[:12], {'key': key, 'cat': cat, 'name': name, 'base': base, 'disc': disc})
        for i, l in enumerate(q.get('discLog') or []):
            put('logs', f'disc{i}', {'action': '折數', 'at': l.get('at'), 'what': f"{l.get('sup','')} {l.get('cat','')} {l.get('name','')}：{l.get('from','')} → {l.get('to','')}"})
        rep.append(f"折數修改: {len(q.get('discs') or {})}")

    # ---------- 作業平台：應收 ----------
    p = os.path.join(src, 'receivables.v1.json')
    if os.path.isfile(p):
        r = load(p)
        for cust, method in (r.get('methods') or {}).items():
            cid = link(cust, 'C', 'receivables')
            if cid:
                contacts[cid]['payMethod'] = method
        for row in r.get('rows') or []:
            cid = link(row.get('cust'), 'C', 'receivables')
            d = dict(row, cid=cid, src='platform')
            put('receivables', 'ar' + str(row['id']), d)
        put('settings', 'ar_store', {'months': r.get('store') or {}})
        rep.append(f"應收帳款: {len(r.get('rows') or [])} 列")

    # ---------- 作業平台：應付 ----------
    p = os.path.join(src, 'payables.v1.json')
    if os.path.isfile(p):
        r = load(p)
        for row in r.get('rows') or []:
            cid = link(row.get('vendor'), 'S', 'payables')
            put('payables', 'ap' + str(row['id']), dict(row, cid=cid, src='platform'))
        rep.append(f"應付帳款: {len(r.get('rows') or [])} 列")

    # ---------- 作業平台：發票 ----------
    p = os.path.join(src, 'invoice-app-v1.json')
    if os.path.isfile(p):
        r = load(p)
        newc = 0
        for cu in r.get('customers') or []:
            c = matcher.find(cu.get('name'), 'C') or matcher.find(cu.get('name'))
            if c:
                if not c.get('taxId'):
                    c['taxId'] = cu.get('id')
                add_alias(c, cu.get('name'))
                if cu.get('addr') and not c.get('addr'):
                    c['addr'] = cu['addr']
            else:
                cid = 'ci' + str(cu.get('id'))
                contacts[cid] = {'id': cid, 'kind': 'C', 'code': '', 'name': cu.get('name', ''), 'taxId': cu.get('id', ''),
                                 'phone': cu.get('tel', ''), 'addr': cu.get('addr', ''), 'note': '由發票作業匯入', 'aliases': [], 'init': 0}
                newc += 1
        matcher = Matcher(contacts)
        for inv in r.get('invoices') or []:
            c = next((x for x in contacts.values() if x.get('taxId') and x['taxId'] == inv.get('buyer')), None)
            put('invoices', inv['no'], dict(inv, cid=c['id'] if c else None))
        for pu in r.get('purch') or []:
            cid = link(pu.get('name'), 'S', 'payables') if pu.get('name') else None
            put('purch_invoices', pu['id'], dict(pu, cid=cid))
        if r.get('print'):
            put('settings', 'invoice_print', r['print'])
        rep.append(f"發票: 銷項 {len(r.get('invoices') or [])}、進項 {len(r.get('purch') or [])}；發票客戶新增為客戶 {newc} 家")

    # ---------- 作業平台：支票開立 ----------
    p = os.path.join(src, 'checkApp.v1.json')
    if os.path.isfile(p):
        r = load(p)
        for ck in r.get('checks') or []:
            cid = link(ck.get('payee'), 'S', 'checks_out') if ck.get('payee') else None
            put('checks_out', 'co' + str(ck['id']), dict(ck, cid=cid))
        for name in r.get('companies') or []:
            link(name, 'S', 'checks_out')
        put('settings', 'check_print', {'layout': r.get('layout'), 'fmt': r.get('fmt'), 'lastNo': r.get('lastNo'), 'seq': r.get('seq')})
        rep.append(f"支票開立: {len(r.get('checks') or [])} 張")

    # ---------- 作業平台：支票登記 ----------
    p = os.path.join(src, 'checkbook.v1.json')
    if os.path.isfile(p):
        r = load(p)
        cache = {}
        for ck in r.get('checks') or []:
            nm = ck.get('name') or ''
            if nm not in cache:
                cache[nm] = link(nm, 'C', 'checks_in') if nm else None
            put('checks_in', str(ck['id']), dict(ck, cid=cache[nm]))
        put('settings', 'bank_accounts', {'list': r.get('accounts') or []})
        rep.append(f"支票登記: {len(r.get('checks') or [])} 張")

    # ---------- 作業平台：訂貨排程 ----------
    p = os.path.join(src, 'orders.v1.json')
    if os.path.isfile(p):
        r = load(p)
        for row in r.get('rows') or []:
            cid = link(row.get('vendor'), 'S', 'orders') if row.get('vendor') else None
            put('orders', str(row['id']), dict(row, cid=cid))
        rep.append(f"訂貨排程: {len(r.get('rows') or [])} 筆")

    # ---------- 操作日誌 ----------
    for id, v in docs_of(os.path.join(src, 'erp-logs.json')).items():
        if not v.get('_del'):
            v.pop('_t', None)
            put('logs', id, v)

    # 客戶／供應商最後寫入（別名、統編在前面會變動）
    for id, c in contacts.items():
        put('contacts', id, c)
    rep.append(f'客戶／供應商: {len(contacts)}')

    # 名稱對不上的清單，留給介面上人工對應
    put('settings', 'unmatched_names', unmatched)

    # ---------- 寫入 ----------
    for i in range(0, len(ops), 2000):
        db.batch(ops[i:i + 2000])
    db.hist_replace(hist)
    put_log = {'action': '匯入', 'at': int(time.time() * 1000), 'what': '從舊版共用資料夾匯入：' + '；'.join(rep)}
    db.put('logs', 'import' + str(int(time.time())), put_log)

    print('匯入完成（%.1f 秒）' % (time.time() - t0))
    for line in rep:
        print(' -', line)
    for k, v in unmatched.items():
        if v:
            print(f' - {k} 對不上客戶／供應商的名稱 {len(v)} 個：', '、'.join(v[:20]), '…' if len(v) > 20 else '')


if __name__ == '__main__':
    main()
