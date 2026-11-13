"""嘉里大榮網路託運（webedi.kerrytj.com）：伺服器代為登入、上傳一筆託運資料、送出，回傳託運單號。

流程跟網頁「託運登錄 → 多筆匯入」一樣：
  1. login.aspx（帳號密碼，ASP.NET 表單）
  2. AjaxData/ImportExcelData.ashx ask=uploadShippingData（上傳 Excel，嘉里檢查格式、回傳解析後的資料）
     ResultStatus 2＝錯誤；4＝當日同收貨人重複（要使用者確認）
  3. shipping/Add.aspx/VerifyDeliveryJoint（聯運區域、特服碼檢核；ResultStatus 3＝要使用者確認）
  4. AjaxData/ImportExcelData.ashx ask=insertShippingDetail（正式新增）
  5. 讀 shipping/uploadadd.aspx 的託運明細，找回這筆的託運單號
上傳格式要先在嘉里「設定上傳格式」建好（志瑞平台 ZR01），欄位順序＝COLS。
帳號密碼存在 data/kerry.json（使用者自己在設定裡填；不會傳回網頁）。
測試：環境變數 ZR_KERRY_MOCK＝資料夾 → 不連嘉里，把要上傳的 xlsx 存到那裡，回傳假的託運單號。
"""
import datetime
import html
import http.cookiejar
import io
import json
import os
import re
import secrets
import ssl
import threading
import time
import urllib.parse
import urllib.request
import zipfile

BASE = 'https://webedi.kerrytj.com/'
COLS = ['出貨日期', '收貨人', '收貨人地址', '收貨人電話1', '收貨人電話2', '件數', '重量', '出貨單號', '代收貨款', '貨品內容', '備註']
DEFAULT_CFG = {'account': '', 'password': '', 'shipper_type': '1', 'customer_no': '', 'fields': 'ZR01'}
LOCK = threading.Lock()


class KerryError(Exception):
    def __init__(self, msg, status=502):
        super().__init__(msg)
        self.status = status


def _fp(data_dir):
    return os.path.join(data_dir, 'kerry.json')


def cfg_load(data_dir):
    try:
        with open(_fp(data_dir), encoding='utf-8') as f:
            return {**DEFAULT_CFG, **json.load(f)}
    except Exception:
        return dict(DEFAULT_CFG)


def cfg_public(data_dir):
    c = cfg_load(data_dir)
    return {k: v for k, v in c.items() if k != 'password'} | {'password_set': bool(c.get('password')), 'mock': bool(os.environ.get('ZR_KERRY_MOCK'))}


def cfg_save(data_dir, body):
    c = cfg_load(data_dir)
    for k in ('account', 'shipper_type', 'customer_no', 'fields'):
        if k in body:
            c[k] = str(body[k] or '').strip()
    if body.get('password'):
        c['password'] = str(body['password'])
    tmp = _fp(data_dir) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(c, f, ensure_ascii=False)
    os.replace(tmp, _fp(data_dir))
    return cfg_public(data_dir)


# ---------- 最小的 xlsx（只用標準函式庫）：第一列表頭，其餘每格都存成文字 ----------
def _xlsx(rows):
    def cell(ref, v):
        v = '' if v is None else str(v)
        return '<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, html.escape(v, quote=False))
    def col(i):
        s = ''
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s
    sheet = ''.join('<row r="%d">%s</row>' % (ri + 1, ''.join(cell('%s%d' % (col(ci), ri + 1), v) for ci, v in enumerate(r))) for ri, r in enumerate(rows))
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="託運" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>%s</sheetData></worksheet>' % sheet,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def _row(d):
    """d：瀏覽器送來的一筆（ship_date, name, addr, tel, tel2, n, kg, no, cod, what, note）"""
    n = int(float(d.get('n') or 0))
    if not (1 <= n <= 999):
        raise KerryError('件數要在 1～999', 400)
    cod = str(d.get('cod') or '').strip()
    if cod and not (1 <= float(cod) <= 50000):
        raise KerryError('代收貨款要在 1～50,000（不代收就留空）', 400)
    for k, label in (('name', '收貨人'), ('addr', '收貨人地址'), ('tel', '收貨人電話1')):
        if not str(d.get(k) or '').strip():
            raise KerryError('請填%s' % label, 400)
    kg = str(d.get('kg') or '').strip()
    return [str(d.get('ship_date') or datetime.date.today().isoformat()).replace('-', '/'), str(d['name']).strip()[:40], str(d['addr']).strip(),
            str(d['tel']).strip(), str(d.get('tel2') or '').strip(), str(n), kg, str(d.get('no') or '')[:24], cod, str(d.get('what') or '')[:20], str(d.get('note') or '')]


class _Session:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        # 嘉里的憑證缺「Subject Key Identifier」，Python 3.13 起預設的嚴格檢查會擋；照樣驗證憑證，只關掉這條嚴格規則
        ctx = ssl.create_default_context()
        ctx.verify_flags &= ~getattr(ssl, 'VERIFY_X509_STRICT', 0)
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), urllib.request.HTTPSHandler(context=ctx))
        self.op.addheaders = [('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0 Safari/537.36'), ('Accept-Language', 'zh-TW,zh;q=0.9')]

    def get(self, path):
        with self.op.open(urllib.parse.urljoin(BASE, path), timeout=60) as r:
            return r.geturl(), r.read().decode('utf-8', 'replace')

    def post(self, path, data, headers=None, referer=None):
        req = urllib.request.Request(urllib.parse.urljoin(BASE, path), data=data, method='POST', headers=headers or {})
        if referer:
            req.add_header('Referer', urllib.parse.urljoin(BASE, referer))
        with self.op.open(req, timeout=120) as r:
            return r.geturl(), r.read().decode('utf-8', 'replace')


def _hidden(page):
    return {m.group(1): html.unescape(m.group(2)) for m in re.finditer(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]*value="([^"]*)"', page)}


def _json(text, step):
    try:
        return json.loads(text)
    except Exception:
        if 'login.aspx' in text.lower() or 'txtPassword' in text:
            raise KerryError('嘉里登入失效，請再試一次')
        raise KerryError('嘉里回應看不懂（%s）：%s' % (step, re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', text))[:200]))


def _login(s, c):
    if not c.get('account') or not c.get('password'):
        raise KerryError('還沒設定嘉里帳號密碼：請到「嘉里託運 → 帳號設定」填寫', 409)
    url, page = s.get('login.aspx')
    h = _hidden(page)
    form = {k: h[k] for k in ('__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION') if k in h}
    form.update({'txtAccount': c['account'], 'txtPassword': c['password'], 'btnLogin': 'Login'})
    url, page = s.post('login.aspx', urllib.parse.urlencode(form).encode('utf-8'), {'Content-Type': 'application/x-www-form-urlencoded'}, 'login.aspx')
    if 'txtPassword' in page and 'login.aspx' in url.lower():
        msg = re.search(r"alert\('([^']{2,80})'\)", page)
        raise KerryError('嘉里登入失敗：%s' % (msg.group(1) if msg else '帳號或密碼不對'), 401)


def _multipart(fields, fname, data):
    b = '----zr' + secrets.token_hex(12)
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (b, k, v)).encode('utf-8'))
    out.write(('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n' % (b, fname)).encode('utf-8'))
    out.write(data)
    out.write(('\r\n--%s--\r\n' % b).encode('utf-8'))
    return out.getvalue(), 'multipart/form-data; boundary=' + b


def _find_no(page, name, day):
    """託運明細表裡，託運日期＝day、收貨人＝name 的最後一筆託運單號"""
    best = ''
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        tds = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', td))).strip() for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(tds) < 8:
            continue
        if name[:10] in ' '.join(tds) and (day in ' '.join(tds) or day.replace('-', '/') in ' '.join(tds)):
            for t in tds:
                if re.fullmatch(r'\d{9,12}', t):
                    best = t
    return best


def send(data_dir, d, confirm=False):
    """送一筆。回傳 {ok, no, msg} 或 {need_confirm: 訊息}"""
    row = _row(d)
    c = cfg_load(data_dir)
    xlsx = _xlsx([COLS, row])
    fname = 'zr_%s.xlsx' % (str(d.get('no') or 'ship')).replace('/', '_')
    mock = os.environ.get('ZR_KERRY_MOCK')
    if mock:
        os.makedirs(mock, exist_ok=True)
        with open(os.path.join(mock, '%d_%s' % (int(time.time() * 1000), fname)), 'wb') as f:
            f.write(xlsx)
        if not confirm and str(d.get('note') or '').startswith('測試確認'):
            return {'need_confirm': '（測試）當日收貨人託運資料已重複，請確認是否存檔?'}
        return {'ok': True, 'no': '9' + str(int(time.time()))[-9:], 'msg': '（測試模式）沒有真的送到嘉里'}
    with LOCK:
        s = _Session()
        _login(s, c)
        url, page = s.get('shipping/uploadadd.aspx')
        cust = c.get('customer_no')
        if not cust:   # 託運人編號下拉選單的值（例如 11251），沒設定就取第一個
            m = re.search(r'name="[^"]*ddlCustomerNo"[^>]*>(.*?)</select>', page, re.S)
            opts = re.findall(r'<option[^>]*value="([^"]+)"', m.group(1)) if m else []
            opts = [o for o in opts if o not in ('0', '*')]
            if not opts:
                raise KerryError('嘉里頁面上找不到託運人編號')
            cust = opts[0]
        body, ctype = _multipart({'ddlShipperType': c.get('shipper_type') or '1', 'ddlCustomerNo': cust, 'ddlFieldsName': c.get('fields') or 'ZR01', 'ask': 'uploadShippingData'}, fname, xlsx)
        _, t = s.post('AjaxData/ImportExcelData.ashx', body, {'Content-Type': ctype, 'X-Requested-With': 'XMLHttpRequest'}, 'shipping/uploadadd.aspx')
        r1 = _json(t, '上傳')
        st = str(r1.get('ResultStatus'))
        if st == '2':
            raise KerryError('嘉里不接受：%s' % (r1.get('Message') or '格式錯誤'), 422)
        if st == '4' and not confirm:
            return {'need_confirm': r1.get('Message') or '當日收貨人託運資料已重複'}
        lst = json.loads(r1.get('Data') or '[]')
        _, t = s.post('shipping/Add.aspx/VerifyDeliveryJoint', json.dumps({'listData': lst}, ensure_ascii=False).encode('utf-8'),
                      {'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest'}, 'shipping/uploadadd.aspx')
        r2 = (_json(t, '檢核') or {}).get('d') or {}
        if str(r2.get('ResultStatus')) == '3' and not confirm:
            return {'need_confirm': r2.get('Message') or '聯運區域需要確認'}
        final = json.loads(r2.get('Data') or '[]') if r2.get('Data') else lst
        _, t = s.post('AjaxData/ImportExcelData.ashx', urllib.parse.urlencode({'ask': 'insertShippingDetail', 'shippingDetailList': json.dumps(final, ensure_ascii=False), 'FileName': fname}).encode('utf-8'),
                      {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'}, 'shipping/uploadadd.aspx')
        r3 = _json(t, '新增')
        if str(r3.get('ResultStatus')) != '1':
            raise KerryError('嘉里新增失敗：%s' % (r3.get('Message') or ''), 422)
        no = ''
        try:
            _, page = s.get('shipping/uploadadd.aspx')
            no = _find_no(page, row[1], row[0].replace('/', '-'))
        except Exception:
            pass
        return {'ok': True, 'no': no, 'msg': r3.get('Message') or '已新增'}


def test(data_dir, body=None):
    c = {**cfg_load(data_dir), **{k: v for k, v in (body or {}).items() if k in DEFAULT_CFG and (k != 'password' or v)}}
    if os.environ.get('ZR_KERRY_MOCK'):
        return '（測試模式）登入成功'
    s = _Session()
    _login(s, c)
    _, page = s.get('shipping/uploadadd.aspx')
    has = 'value="%s"' % (c.get('fields') or 'ZR01') in page
    return '登入成功' + ('，找到上傳格式「%s」' % (c.get('fields') or 'ZR01') if has else '，但沒找到上傳格式「%s」，請確認嘉里「設定上傳格式」' % (c.get('fields') or 'ZR01'))
