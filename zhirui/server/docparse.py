"""自有辨識：把本地 OCR 讀出的一行一行文字，整理成單據欄位（單頭＋明細）

不連網、不花錢。輸入是 vision.ocr() 的 lines（每行 cells＋每格左右 x），輸出跟雲端 AI 一樣的 DOC_SCHEMA：
{party, doc_no, date, doubts, lines:[{code, name, spec, qty, unit, price, disc, amount}]}
另外回傳 ok（讀得夠完整、可以直接用）和 why（不完整的原因；本地優先時就改送雲端 AI）。
"""
import datetime
import re

# OCR 常把繁體讀成簡體或異體；只換表頭、標籤常用的字（品名內容不動）
_T2 = str.maketrans('货规数额单价号称户编产订购总计别类贷际质项码条备注', '貨規數額單價號稱戶編產訂購總計別類貸際質項碼條備註')
_FW = {ord(c): ord(c) - 0xFEE0 for c in '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ／－．，＊（）：'}
_FW[0x3000] = 0x20


def norm(t):
    """全形轉半形、常見簡體字轉繁體（只用在比對標籤，不改原文）"""
    return str(t or '').translate(_FW).translate(_T2)


ME = ('志瑞', '志端', '志璃', '志瑞螺絲')   # 自己公司（OCR 常讀錯成志端）
COMPANY = re.compile(r'([一-鿿A-Za-z0-9（）()·・\-]{2,30}?(?:股份有限公司|有限公司|企業社|工業社|實業社|公司|工廠|商行|五金行|螺絲行))')

# 表頭關鍵字 → 欄位（長的先比）
HEAD = [
    ('品名規格', 'name'), ('品名/規格', 'name'), ('品名及規格', 'name'), ('品項名稱', 'name'), ('產品名稱', 'name'), ('貨品名稱', 'name'),
    ('品名', 'name'), ('名稱', 'name'), ('規格', 'spec'), ('說明', 'name'),
    ('產品編號', 'code'), ('零件編號', 'code'), ('產品代號', 'code'), ('貨品編號', 'code'), ('商品編號', 'code'), ('料號', 'code'),
    ('品號', 'code'), ('貨號', 'code'), ('代號', 'code'), ('編號', 'code'),
    ('訂購數量', 'qty'), ('出貨數量', 'qty'), ('訂購數', 'qty'), ('數量', 'qty'),
    ('單位', 'unit'), ('牌價', 'list'), ('定價', 'list'), ('折數', 'disc'), ('折扣', 'disc'),
    ('單價', 'price'), ('價格', 'price'), ('金額', 'amount'), ('小計', 'amount'),
    # 不要的欄（日期、庫別、備註…）：落在這些欄的字丟掉，不要混進品名
    ('原編號', 'skip'), ('預進貨日', 'skip'), ('交貨日期', 'skip'), ('交期', 'skip'), ('庫別', 'skip'), ('備註', 'skip'), ('備注', 'skip'),
    ('附註', 'skip'), ('圖面版次', 'skip'), ('版次', 'skip'), ('包裝數', 'skip'), ('序號', 'skip'), ('項次', 'skip'), ('稅別', 'skip'),
    # 表頭字分散成一個字一格時（名　規　格　數　單位　價　金　額）
    ('名', 'name'), ('數', 'qty'), ('量', 'qty'), ('價', 'price'), ('額', 'amount'), ('項', 'skip'),
]
FIELDS = {'name', 'spec', 'qty', 'price', 'amount', 'unit', 'code', 'list'}
FOOT = re.compile(r'(合計|課稅|課税|現收|未收款|簽收|備注|總計|總金額|以下空白|稅額|税額|稅金|税金|營業稅|數量合計|小計：|未稅|含稅|备註：|備註：|附註)')
NOISE = re.compile(r'存根|第[一二三四]聯|第一瞬|簽收|簽章|\d+時\d+分|頁次|製單|業務')   # 品名裡出現這些＝版面讀亂了
UNITS = r'(PCS|pcs|Pcs|SET|KG|kg|Kg|K|M|H|千支|支|只|個|顆|組|包|箱|件|盒|片|條|套|粒|公斤|台斤|斤)'
NUM = r'\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?'
DATE_KEYS = ('出貨日期', '出货日期', '送貨日期', '採購日期', '訂購日期', '報價日期', '單據日期', '銷貨日期', '進貨日期', '開單日期', '訂單日期', '日期')
DATE_SKIP = ('列印日期', '有效日期', '交期', '預進貨日', '交貨日期', '製表日期', '到期', '有效期')
NO_KEYS = ('出貨單號', '採購單號', '報價單號', '報價編號', '訂單號碼', '訂單編號', '訂購單號', '單據號碼', '銷貨單號', '送貨單號', '單據編號', '憑單號碼', '單號', 'NO.', 'No.', 'NO:', 'No:')


def num(t):
    t = str(t or '').replace(',', '').strip()
    try:
        return float(t)
    except ValueError:
        return None


def _date(t):
    """2026/11/09、115/11/09、2026-11-9、115年11月9日、20261112 → YYYY-MM-DD"""
    t = norm(t)
    m = re.search(r'(?<!\d)(20\d\d|1[01]\d)\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})', t)
    if not m:
        m = re.search(r'(?<!\d)(20\d\d)(\d\d)(\d\d)(?!\d)', t)
    if not m:
        return ''
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 1000:
        y += 1911
    try:
        return datetime.date(y, mo, d).isoformat()
    except ValueError:
        return ''


def _header_fields(lines, H, hy):
    """單頭：對方公司、單號、日期（沒有標籤的日期只看表頭 y＝hy 以上）"""
    party = doc_no = date = ''
    texts = [norm(' '.join(l['cells'])) for l in lines]
    # 日期：有「xx日期」標籤的優先，跳過列印日期、交期
    for t in texts:
        for k in DATE_KEYS:
            i = t.find(k)
            if i < 0 or any(s in t[max(0, i - 2):i + len(k)] for s in DATE_SKIP):
                continue
            d = _date(t[i + len(k):i + len(k) + 20])
            if d:
                date = d
                break
        if date:
            break
    if not date:
        for l, t in zip(lines, texts):
            if l['y'] >= hy:
                break
            if any(s in t for s in DATE_SKIP):
                continue
            d = _date(t)
            if d:
                date = d
                break
    # 單號
    for t in texts:
        for k in NO_KEYS:
            i = t.find(k)
            if i < 0:
                continue
            m = re.match(r'\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{3,24}(?:\s\d{4}(?![\d年/]))?)', t[i + len(k):])
            if m:
                doc_no = re.sub(r'\s+', '', m.group(1))
                break
        if doc_no:
            break
    # 對方公司：上半張第一個不是志瑞的公司名（跳過「客戶名稱：志瑞」「指送」那種行）；上半張沒有再看整張
    for l, t in sorted(zip(lines, texts), key=lambda p: (p[0]['y'] > H * 0.6, p[0]['y'])):
        if re.search(r'指送|送貨地|收貨|地址', t):
            continue
        for c in l['cells']:
            c = norm(c)
            for m in COMPANY.finditer(c):
                nm = re.sub(r'^(客戶名稱|廠商名稱|公司名稱|客戶|廠商|供應商|TO|To|FROM|From)[:：\s]*', '', m.group(1))
                if len(nm) >= 4 and not any(x in nm for x in ME):
                    party = nm
                    break
            if party:
                break
        if party:
            break
    return party, doc_no, date


def _find_header(lines):
    """找表頭那一行：同一行出現最多種表頭關鍵字（品名、數量、單價…）。回傳 (行號, [(欄位, x 中心)])
    把整行的字依位置排成一串再比對，表頭字黏成一格（數量單位單價金額）或分散成一字一格都找得到"""
    best = (0, -1, [])
    for i, l in enumerate(lines):
        chars = []
        for c, (x0, x1) in zip(l['cells'], l['xs']):
            t = norm(c).replace(' ', '')
            if not t or len(t) > 24 or re.search(r'\d', t):
                chars.append(('\0', x0))
                continue
            for k, ch in enumerate(t):
                chars.append((ch, x0 + (x1 - x0) * (k + 0.5) / len(t)))
            chars.append(('\0', x1))
        t = ''.join(ch for ch, _ in chars)
        cols, seen, k = [], set(), 0
        while k < len(t):
            for key, f in HEAD:
                if t.startswith(key, k):
                    cx = sum(x for _, x in chars[k:k + len(key)]) / len(key)
                    if f == 'skip' or f not in seen:
                        cols.append((f, cx)); seen.add(f)
                    k += len(key)
                    break
            else:
                k += 1
        got = {f for f, _ in cols}
        score = len(got & FIELDS)
        if score > best[0] and {'name', 'spec', 'code'} & got and {'qty', 'price', 'amount'} & got:
            best = (score, i, cols)
    if best[0] < 3:
        return -1, []
    return best[1], sorted(best[2], key=lambda c: c[1])


def _split_qty_unit(t):
    m = re.fullmatch(r'\s*(' + NUM + r')\s*' + UNITS + r'?\s*', t)
    return (num(m.group(1)), m.group(2) or '') if m else (None, '')


def _rows(lines, hi, cols):
    """表頭以下、合計以上的每一行 → 明細"""
    xs = [x for _, x in cols]
    out = []
    for l in lines[hi + 1:]:
        txt = norm(''.join(l['cells']))
        if FOOT.search(txt):
            break
        rec = {}
        for c, (x0, x1) in zip(l['cells'], l['xs']):
            c = c.strip()
            if not c:
                continue
            # 一格裡有好幾個數字（OCR 黏在一起），拆開依位置分欄
            parts = [c]
            if re.fullmatch(r'(?:(?:' + NUM + r')\s*' + UNITS + r'?\s+)+(?:' + NUM + r')\s*' + UNITS + r'?', norm(c)):
                parts = re.findall(r'(?:' + NUM + r')\s*' + UNITS + r'?', norm(c))
            for k, p in enumerate(parts):
                cx = x0 + (x1 - x0) * (k + 0.5) / len(parts)
                j = min(range(len(xs)), key=lambda j: abs(xs[j] - cx))
                f = cols[j][0]
                if f == 'skip':
                    continue
                # 文字掉進數字欄、或數字掉進品名欄時修正
                isnum = _split_qty_unit(norm(p))[0] is not None
                if f in ('qty', 'price', 'amount', 'list', 'disc') and not isnum:
                    f = 'unit' if re.fullmatch(UNITS, norm(p).strip()) else ('name' if f != 'unit' else f)
                rec.setdefault(f, []).append(p)
        has_num = any(k in rec for k in ('qty', 'price', 'amount'))
        if not has_num and not rec.get('code'):
            # 續行（品名太長換行）：接到上一筆
            if (out and rec.get('name') and set(rec) <= {'name', 'spec'} and l['y'] - out[-1]['_y'] < 1.8 * max(12, l.get('h', 20))
                    and not re.search(r'\d{2,}[-/.:]\d|TEL|FAX|電話|傳真|地址', norm(' '.join(rec['name'])))):
                out[-1]['name'] += ' ' + ' '.join(rec['name'])
                out[-1]['_y'] = l['y']
            continue
        r = {'code': ' '.join(rec.get('code', [])), 'name': ' '.join(rec.get('name', [])), 'spec': ' '.join(rec.get('spec', [])),
             'qty': 0, 'unit': '', 'price': 0, 'disc': 0, 'amount': 0, '_y': l['y']}
        for f in ('qty', 'price', 'amount', 'list', 'disc'):
            for p in rec.get(f, []):
                v, u = _split_qty_unit(norm(p))
                if v is not None and not r.get(f):   # 同一欄讀到好幾個數字時用第一個
                    r[f] = v
                    if u and not r['unit']:
                        r['unit'] = u
        if rec.get('unit'):
            u = norm(' '.join(rec['unit'])).strip()
            v, uu = _split_qty_unit(u)
            if v is not None and not r['qty']:
                r['qty'] = v
            r['unit'] = uu or re.sub(r'[\d,.\s]', '', u)[:4] or r['unit']
        if r.pop('list', 0) and 'disc' in rec:
            r['price'] = _split_qty_unit(norm(rec['list'][0]))[0] or r['price']
        out.append(r)
    return out


def _fix_line(r):
    """數量×單價＝金額：缺一個就用另外兩個推回去；品名後面黏到數量時拆開"""
    q, p, a = r['qty'], r['price'], r['amount']
    if not q and p and a:
        qq = a / p
        if abs(qq - round(qq)) < 0.02 * max(1, qq):
            r['qty'] = q = float(round(qq))
            for f in ('name', 'spec'):
                m = re.search(r'(?<![\d.,])' + re.escape(str(int(q))) + r'(?![\d.,])', r[f])
                if m:
                    r[f] = (r[f][:m.start()].rstrip() + ' ' + r[f][m.end():].lstrip()).strip()
                    break
    elif q and a and not p:
        r['price'] = round(a / q, 4)
    elif q and p and not a:
        r['amount'] = round(q * p * ((r['disc'] / 100 if r['disc'] > 10 else r['disc'] / 10) if r['disc'] else 1), 2)
    return r


def _consistent(r):
    q, p, a = r['qty'], r['price'], r['amount']
    if not (q and p and a):
        return True
    f = (r['disc'] / 100 if r['disc'] > 10 else r['disc'] / 10) if r['disc'] else 1
    return abs(q * p * f - a) <= max(1.0, a * 0.01) or abs(q * p - a) <= max(1.0, a * 0.01)


def parse(ocr, kind):
    """ocr：vision.ocr() 的結果；kind：pur 進貨單、quote 報價、order 客戶訂單"""
    lines = [l for l in ocr.get('lines') or [] if l.get('cells')]
    H = ocr.get('uh') or ocr.get('h') or 1
    hi, cols = _find_header(lines)
    party, doc_no, date = _header_fields(lines, H, lines[hi]['y'] if hi >= 0 else H * 0.4)
    raw = _rows(lines, hi, cols) if hi >= 0 else []
    has_amt = any(f == 'amount' for f, _ in cols)
    read_amt = [bool(r['amount']) for r in raw]
    rows = [_fix_line(r) for r in raw]
    why = []
    if hi < 0:
        why.append('找不到明細表頭（品名、數量、單價）')
    if not party:
        why.append('讀不到對方公司名稱')
    if hi >= 0 and not rows:
        why.append('讀不到明細')
    bad = []
    for n, r in enumerate(rows, 1):
        miss = []
        if not (r['name'] or r['spec'] or r['code']):
            miss.append('品名')
        elif NOISE.search(r['name'] + r['spec']):
            miss.append('正確品名（混到表單上的字）')
        if not r['qty'] and kind != 'quote':
            miss.append('數量')
        if not r['price'] and kind != 'order':
            miss.append('單價')
        if has_amt and not read_amt[n - 1]:
            miss.append('金額')
        if not _consistent(r):
            miss.append('數量×單價≠金額')
        if miss:
            bad.append('第 %d 行缺%s' % (n, '、'.join(miss)))
    why += bad
    for r in rows:
        r.pop('_y', None)
        for f in ('code', 'name', 'spec'):
            r[f] = re.sub(r'\s+', ' ', r[f]).strip()
    doubts = '本機辨識（沒有用 AI），請逐行核對數量、單價。' + ('；'.join(why) if why else '')
    return {'party': party, 'doc_no': doc_no, 'date': date, 'doubts': doubts, 'lines': rows,
            'ok': not why, 'why': why, '_engine': 'local'}
