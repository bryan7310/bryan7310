"""志瑞崧泉小幫手：在主機的 Windows 桌面執行，把崧泉企業的「鼎新 B2B 協作平台」和志瑞 ERP 接起來。

做兩件事：
1. 定期抓崧泉平台「採購單回覆」裡還沒回覆的採購單 → 整理成待確認檔 web/pending/b2b_songquan.json，
   老闆在 ERP「客戶訂單」頁按連結看過，按「確認寫入」才會變成客戶訂單。
2. ERP 裡由這些客戶訂單轉出的銷貨單 → 自動到崧泉平台「出貨單建立」選採購單、填出貨數量、按完成。
   第一張會停在最後一步，請老闆自己按「完成」，確認流程沒問題之後才全自動。
   出貨單建好後，把崧泉平台產生的出貨標籤 PDF 抓回 web/pending/b2b_labels/，ERP「客戶訂單」頁有連結可以開來列印。

登入：崧泉平台有圖形驗證碼，程式不能自己登入。這支程式會開一個專用的 Edge 視窗，老闆在裡面登入一次；
之後每隔幾分鐘抓一次，順便維持連線。連線斷了會把視窗叫到最前面，並在 ERP「客戶訂單」頁提醒。
帳號密碼只打在那個 Edge 視窗裡，這支程式不讀、不存。

只用 Python 標準函式庫：用 Chrome DevTools Protocol 控制 Edge。ERP 資料用唯讀方式直接讀 data/zhirui.db。
用法：pythonw server/b2b_helper.py   （--once 跑一輪就結束；--dry 演練：不碰出貨單建立；--no-ship 不做出貨單）
設定：data/b2b_helper.json（第一次執行會自動建立）。紀錄：%LOCALAPPDATA%\\zhirui\\b2b_helper.log
"""
import base64
import hashlib
import json
import os
import re
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def _arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else default


DATA = os.path.abspath(_arg('--data', os.path.join(HERE, '..', 'data')))
WEB = os.path.abspath(_arg('--web', os.path.join(HERE, '..', 'web')))
PENDING = os.path.join(WEB, 'pending')
LOGDIR = os.path.join(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir(), 'zhirui')
os.makedirs(LOGDIR, exist_ok=True)
LOG = os.path.join(LOGDIR, 'b2b_helper.log')
PROFILE = os.path.join(LOGDIR, 'b2b_profile')
CFG_FILE = os.path.join(DATA, 'b2b_helper.json')
STATE_FILE = os.path.join(DATA, 'b2b_state.json')
PEND_NAME = 'b2b_songquan'            # ERP 的確認頁：#apply?f=b2b_songquan
STATUS_NAME = 'b2b_status.json'       # ERP「客戶訂單」頁讀這個檔顯示狀態
BROWSERS = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
            r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']
DRY = '--dry' in sys.argv
ONCE = '--once' in sys.argv
NO_SHIP = '--no-ship' in sys.argv

DEFAULT_CFG = {
    'base': 'http://211.20.149.149/DSCB2B',   # 崧泉的鼎新 B2B 協作平台
    'customer': '崧泉',                        # ERP 客戶名稱裡要有這兩個字（只能對到一家）
    'interval_min': 10,                        # 每幾分鐘抓一次（也靠這個維持連線，不要超過 15）
    'port': 9333,                              # 控制 Edge 用的本機埠
    'reply': True,                             # 在 ERP 確認寫入後，自動到崧泉平台回覆交期（照崧泉給的交期、數量接受）
    'reply_auto_submit': True,                 # False＝每次都只勾好，等人按「送出」
    'ship': True,                              # 銷貨單自動建崧泉出貨單
    'ship_wait_min': 10,                       # 銷貨單存檔後等幾分鐘才送（留時間改單）
    'ship_auto_submit': True,                  # False＝每一張都停在最後一步等人按「完成」
    'ship_merge': True,                        # 同一個出貨日的銷貨單合成一張崧泉出貨單
    'label': True,                             # 出貨單建好後，把崧泉平台產生的出貨標籤 PDF 抓回來
    'label_kind': '4',                         # 條碼類別：1 內箱、3 外箱、4 全部
    'label_size': '77',                        # 77＝7cm×7cm 標籤紙、A4＝A4 紙
}


def log(*a):
    line = time.strftime('%m-%d %H:%M:%S ') + ' '.join(str(x) for x in a)
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass
    if sys.stdout:
        try:
            print(line, flush=True)
        except Exception:
            pass


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_cfg():
    c = read_json(CFG_FILE, None)
    if c is None:
        write_json(CFG_FILE, DEFAULT_CFG)
        c = {}
    return {**DEFAULT_CFG, **c}


# ---------- 最小的 WebSocket 客戶端（只給本機 DevTools 用） ----------
class WS:
    def __init__(self, url):
        m = re.match(r'ws://([^:/]+):(\d+)(/.*)', url)
        self.s = socket.create_connection((m.group(1), int(m.group(2))), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f'GET {m.group(3)} HTTP/1.1\r\nHost: {m.group(1)}:{m.group(2)}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            d = self.s.recv(4096)
            if not d:
                raise ConnectionError('DevTools 連線被關閉')
            buf += d
        head, self.buf = buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise ConnectionError('DevTools 拒絕連線：' + head.split(b'\r\n')[0].decode('latin1'))

    def _read(self, n):
        while len(self.buf) < n:
            d = self.s.recv(65536)
            if not d:
                raise ConnectionError('DevTools 連線中斷')
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        p = text.encode('utf-8')
        n = len(p)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack('>H', n) if n < 65536 else bytes([0x80 | 127]) + struct.pack('>Q', n))
        mask = os.urandom(4)
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(p)))

    def recv(self, timeout):
        """回一則文字訊息；逾時回 None"""
        self.s.settimeout(timeout)
        parts = []
        try:
            while True:
                b1, b2 = self._read(2)
                op, n = b1 & 0x0F, b2 & 0x7F
                if n == 126:
                    n = struct.unpack('>H', self._read(2))[0]
                elif n == 127:
                    n = struct.unpack('>Q', self._read(8))[0]
                mask = self._read(4) if b2 & 0x80 else None
                p = self._read(n)
                if mask:
                    p = bytes(b ^ mask[i % 4] for i, b in enumerate(p))
                if op == 0x8:
                    raise ConnectionError('DevTools 連線已關閉')
                if op == 0x9:      # ping → pong
                    self.s.sendall(bytes([0x8A, 0x80 | len(p)]) + b'\0\0\0\0' + p)
                    continue
                if op == 0xA:
                    continue
                parts.append(p)
                if b1 & 0x80:
                    return b''.join(parts).decode('utf-8', 'replace')
        except socket.timeout:
            if parts:
                raise ConnectionError('DevTools 訊息收到一半逾時')
            return None

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass


# ---------- 控制 Edge ----------
class Browser:
    def __init__(self, cfg):
        self.cfg = cfg
        self.port = int(cfg['port'])
        self.ws = None
        self.seq = 0
        self.dialogs = []          # 頁面跳出的 alert／confirm 文字
        self.accept_confirm = False

    def _http(self, path, method='GET'):
        r = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}', method=method)
        with urllib.request.urlopen(r, timeout=5) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def start(self):
        try:
            self._http('/json/version')
        except Exception:
            exe = next((p for p in BROWSERS if os.path.exists(p)), None)
            if not exe:
                raise RuntimeError('找不到 Edge 或 Chrome')
            os.makedirs(PROFILE, exist_ok=True)
            subprocess.Popen([exe, f'--remote-debugging-port={self.port}', '--remote-allow-origins=*', f'--user-data-dir={PROFILE}',
                              '--no-first-run', '--no-default-browser-check', '--new-window', self.cfg['base'] + '/Login.aspx'])
            for _ in range(40):
                time.sleep(0.5)
                try:
                    self._http('/json/version')
                    break
                except Exception:
                    pass
            else:
                raise RuntimeError('Edge 沒有啟動成功')
        self.attach()

    def attach(self):
        if self.ws:
            self.ws.close()
            self.ws = None
        host = re.sub(r'^https?://', '', self.cfg['base']).split('/')[0]
        pages = [t for t in self._http('/json/list') if t.get('type') == 'page']
        mine = [t for t in pages if host in (t.get('url') or '')]
        if not mine:
            mine = [self._http('/json/new?' + self.cfg['base'] + '/Login.aspx', 'PUT')]
            time.sleep(2)
        self.ws = WS(mine[0]['webSocketDebuggerUrl'])
        self.call('Page.enable')
        self.call('Runtime.enable')

    def call(self, method, params=None, timeout=30):
        self.seq += 1
        mid = self.seq
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            raw = self.ws.recv(min(2.0, max(0.1, end - time.time())))
            if raw is None:
                continue
            m = json.loads(raw)
            if m.get('method') == 'Page.javascriptDialogOpening':
                p = m['params']
                self.dialogs.append({'type': p.get('type'), 'text': p.get('message', '')})
                ok = p.get('type') == 'alert' or self.accept_confirm     # 提示訊息按確定；要選「是／否」的，只有送出階段才按「是」
                log('頁面訊息', p.get('type'), p.get('message', '')[:200], '→', '確定' if ok else '取消')
                self.seq += 1
                self.ws.send(json.dumps({'id': self.seq, 'method': 'Page.handleJavaScriptDialog', 'params': {'accept': ok}}))
                continue
            if m.get('id') == mid:
                if 'error' in m:
                    raise RuntimeError(f"{method}: {m['error'].get('message')}")
                return m.get('result') or {}
        raise TimeoutError(f'{method} 逾時')

    def js(self, body, arg=None, timeout=60):
        """在頁面裡執行一段 async 函式本體（可用 await、ARG），回傳它 return 的值"""
        expr = f'(async (ARG) => {{ {body} }})({json.dumps(arg, ensure_ascii=False)})'
        r = self.call('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True, 'userGesture': True}, timeout=timeout)
        if r.get('exceptionDetails'):
            ex = r['exceptionDetails']
            raise RuntimeError('頁面程式錯誤：' + str((ex.get('exception') or {}).get('description') or ex.get('text'))[:300])
        return (r.get('result') or {}).get('value')

    def goto(self, url, timeout=40):
        self.call('Page.navigate', {'url': url})
        end = time.time() + timeout
        while time.time() < end:
            time.sleep(0.6)
            try:
                if self.js('return document.readyState') == 'complete':
                    return
            except Exception:
                pass
        raise TimeoutError('頁面載入逾時：' + url)

    def front(self):
        try:
            self.call('Page.bringToFront')
        except Exception:
            pass


# ---------- 崧泉平台：讀資料 ----------
FETCH_JS = """
const r = await fetch(ARG, {credentials: 'include', cache: 'no-store'});
return {status: r.status, url: r.url, text: await r.text()};
"""


def grid_rows(html):
    """頁面原始碼裡的 var UCjqGrid_mydata = [ {...}, ... ] → list；找不到回 None"""
    m = re.search(r'var\s+\w+_mydata\s*=\s*(?=\[)', html)
    if not m:
        return None
    try:
        rows, _ = json.JSONDecoder().raw_decode(html, m.end())
    except ValueError:
        return None
    return rows if isinstance(rows, list) else None


class NeedLogin(Exception):
    pass


def ensure_site(br):
    """頁面要停在崧泉平台的網域、而且載入完成，頁面裡的 fetch 才帶得到登入狀態"""
    origin = re.match(r'https?://[^/]+', br.cfg['base']).group(0)
    try:
        ok = br.js('return location.origin === ARG && document.readyState === "complete"', origin)
    except Exception:
        ok = False
    if not ok:
        br.goto(br.cfg['base'] + '/Login.aspx')


def fetch_grid(br, path):
    ensure_site(br)
    r = br.js(FETCH_JS, br.cfg['base'] + path, timeout=60)
    if 'login.aspx' in (r.get('url') or '').lower() or r.get('status') in (401, 403):
        raise NeedLogin()
    rows = grid_rows(r.get('text') or '')
    if rows is None:
        if 'UCjqGrid' not in (r.get('text') or ''):
            raise NeedLogin()
        return []          # 有表格但沒有資料
    return rows


def S(v):
    return str(v if v is not None else '').strip()


def num(v):
    try:
        return float(S(v).replace(',', '') or 0)
    except ValueError:
        return 0.0


def iso(v):
    m = re.match(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', S(v))
    return f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}' if m else ''


def po_line(r):
    """採購單回覆／採購單查詢的一列 → 統一格式"""
    q = num(r.get('TAB007'))
    return {'po': S(r.get('TAA079')), 'seq': S(r.get('TAB001')), 'part': S(r.get('TAB002')), 'name': S(r.get('TAB003')), 'spec': S(r.get('TAB004')),
            'qty': int(q) if q == int(q) else q, 'unit': S(r.get('TAB005')), 'price': round(num(r.get('TAB006')), 4), 'due': iso(r.get('TAB008')),
            'date': iso(r.get('TAA004')), 'ver': S(r.get('TAA003')), 'memo': S(r.get('TAB026')), 'chg': ' '.join(x for x in (S(r.get('TAA080')), S(r.get('TAB042'))) if x),
            'replied': S(r.get('TAB049')) not in ('', '0'), 'closed': S(r.get('TAB025')).upper() == 'Y'}


# ---------- ERP 資料（唯讀） ----------
class Erp:
    def __init__(self):
        db = os.path.join(DATA, 'zhirui.db')
        conn = sqlite3.connect('file:' + db.replace('\\', '/') + '?mode=ro', uri=True, timeout=10)
        try:
            def col(c):
                return [dict(json.loads(d), id=i) for i, d in conn.execute('SELECT id, data FROM docs WHERE col=? AND deleted=0', (c,))]
            self.contacts = col('contacts')
            self.goods = col('goods')
            self.bills = [b for b in col('bills') if b.get('type') in ('SO', 'SALE')]
        finally:
            conn.close()
        self.g = {x['id']: x for x in self.goods}
        self.spec = {}
        for x in self.goods:
            for k in ('spec', 'spec2'):
                n = norm(x.get(k))
                if n:
                    self.spec.setdefault(n, []).append(x)

    def customer(self, word):
        hit = [c for c in self.contacts if word in (S(c.get('name')) + ' ' + S(c.get('short'))) and c.get('kind', 'C') != 'S']
        return hit


def norm(v):
    return re.sub(r'\s+', '', S(v)).upper()


# ---------- 1. 未回覆採購單 → 待確認檔 ----------
def build_pending(cfg, erp, cus, unreplied, opened, state):
    """回 (待確認檔內容 或 None, 摘要)"""
    cid = cus['id']
    seen = state.setdefault('seen', {})
    by_po = {}
    for r in opened:
        if not r['closed']:
            by_po.setdefault(r['po'], {})[r['seq']] = r
    for r in unreplied:                      # 未回覆的那一列是最新的，蓋過查詢頁
        by_po.setdefault(r['po'], {})[r['seq']] = r
        seen.setdefault(r['po'], time.strftime('%Y-%m-%d'))
    so_by_po = {}
    for b in erp.bills:
        if b.get('type') == 'SO' and b.get('cid') == cid and S(b.get('cpo')):
            so_by_po.setdefault(S(b['cpo']), b)
    shipped = {b.get('fromSO') for b in erp.bills if b.get('type') == 'SALE' and b.get('fromSO')}
    docs, updates, skipped, miss = [], [], [], 0
    now = int(time.time() * 1000)
    for po in sorted(p for p in by_po if p in seen):
        rows = sorted(by_po[po].values(), key=lambda r: (int(r['seq']) if r['seq'].isdigit() else 9999, r['seq']))
        items = [{'seq': r['seq'], 'part': r['part'], 'qty': r['qty'], 'due': r['due']} for r in rows]
        src = {'b2b': 'songquan', 'po': po, 'ver': max((r['ver'] for r in rows), default=''), 'items': items}
        dues = sorted(r['due'] for r in rows if r['due'])
        so = so_by_po.get(po)
        old_gid = {}
        if so and isinstance(so.get('src'), dict):       # 沿用訂單上已經選好的商品（依項次對回去）
            old_lines = [l for l in so.get('lines') or [] if 'txt' not in l]
            for it, l in zip(so['src'].get('items') or [], old_lines):
                if l.get('gid'):
                    old_gid[it.get('seq')] = l['gid']
        lines = []
        for r in rows:
            cand = erp.spec.get(norm(r['part'])) or []
            gid = old_gid.get(r['seq']) or (cand[0]['id'] if len(cand) == 1 else '')
            memo = ' '.join(x for x in (f"項次{r['seq']}", f"交期 {r['due'].replace('-', '/')}" if r['due'] else '', r['memo']) if x)
            l = {'gid': gid, 'qty': r['qty'], 'price': r['price']}
            if not gid:
                l['n'] = ' '.join(x for x in (r['part'], r['name'], r['spec']) if x)
                miss += 1
            l['memo'] = memo
            lines.append(l)
        if not so:
            docs.append({'col': 'bills', 'id': 'b2b' + hashlib.sha1(po.encode()).hexdigest()[:12], 'autoNo': 'SO',
                         'label': f"客戶訂單｜{S(cus.get('short')) or S(cus.get('name'))}｜{po}（{len(lines)} 項）",
                         'data': {'type': 'SO', 'no': '', 'date': rows[0]['date'] or time.strftime('%Y-%m-%d'), 'cid': cid, 'cpo': po, 'deliv': dues[0] if dues else '',
                                  'lines': lines, 'disc': 0, 'tax': False, 'note': '崧泉平台匯入' + (f"（{rows[0]['chg']}）" if rows[0]['chg'] else ''), 'src': src,
                                  'createdAt': now, 'updatedAt': now}})
            continue
        # 已經有這張訂單：崧泉那邊改過數量、交期、品項才列出來
        if not isinstance(so.get('src'), dict) or so['src'].get('b2b') != 'songquan':
            continue                                     # 手動建的訂單，不去動它
        if so['src'].get('items') == items:
            continue
        label = f"客戶訂單 {so.get('no')}｜{po}"
        if so['id'] in shipped or so.get('closed'):
            skipped.append(f"{label}：崧泉改過內容（版本 {src['ver']}），但這張訂單已經出過貨或結案，沒有自動改，請自己核對")
            continue
        frm = {'lines': so.get('lines'), 'deliv': so.get('deliv', ''), 'src': so.get('src')}
        updates.append({'col': 'bills', 'id': so['id'], 'label': label, 'from': frm, 'set': {'lines': lines, 'deliv': dues[0] if dues else '', 'src': src},
                        'why': '崧泉平台變更：' + ('；'.join(sorted({r['chg'] for r in rows if r['chg']})) or f"版本 {src['ver']}")})
    for po in [p for p in seen if p in so_by_po and p not in by_po]:
        del seen[po]                                     # 已經進 ERP、崧泉那邊也結掉了，不用再記
    summary = {'new': len(docs), 'upd': len(updates), 'miss': miss, 'unreplied': len({r['po'] for r in unreplied})}
    if not docs and not updates:
        return None, summary
    P = {'title': f"崧泉平台採購單 → 客戶訂單（新增 {len(docs)} 張" + (f"、變更 {len(updates)} 張" if updates else '') + '）',
         'note': '來源：崧泉企業鼎新 B2B 協作平台「採購單回覆」。' + (f'有 {miss} 項沒有對到商品（客料號對不到），先用文字存在訂單上，出貨前要補選。' if miss else '品項都用客料號對到商品了。')
                 + '崧泉平台上的「回覆交期」要另外到崧泉平台回覆，回覆後才建得了出貨單。',
         'docs': docs}
    if updates:
        P['updates'] = updates
        P['updatesNote'] = '崧泉改過數量、交期或品項，這幾張訂單還沒出貨，會照崧泉最新的內容更新。'
    if skipped:
        P['skipped'] = skipped
    return P, summary


def sync_pending(P):
    """待確認檔有變才重寫；沒有東西要確認就拿掉"""
    path = os.path.join(PENDING, PEND_NAME + '.json')
    if P is None:
        if os.path.exists(path):
            os.remove(path)
            log('待確認檔已清掉（都進 ERP 了）')
        return
    old = read_json(path, None)

    def core(x):
        x = json.loads(json.dumps(x))
        for d in x.get('docs', []):
            d['data'].pop('createdAt', None)
            d['data'].pop('updatedAt', None)
        return x
    if old is not None and core(old) == core(P):
        return
    write_json(path, P)
    log('待確認檔已更新：', P['title'])


# ---------- 2. 銷貨單 → 崧泉出貨單 ----------
def ship_jobs(cfg, erp, cus, state):
    """要送到崧泉的銷貨單：由崧泉平台匯入的客戶訂單轉出來的、這支程式啟用之後才建的、存檔超過等待時間的"""
    so = {b['id']: b for b in erp.bills if b.get('type') == 'SO' and isinstance(b.get('src'), dict) and b['src'].get('b2b') == 'songquan'}
    done = state.setdefault('ships', {})
    since = state.setdefault('since', int(time.time() * 1000))
    jobs, waiting = [], 0
    for b in sorted((x for x in erp.bills if x.get('type') == 'SALE' and x.get('fromSO') in so), key=lambda x: x.get('createdAt') or 0):
        if b['id'] in done or (b.get('createdAt') or 0) < since:
            continue
        if time.time() * 1000 - (b.get('updatedAt') or b.get('createdAt') or 0) < cfg['ship_wait_min'] * 60000:
            waiting += 1
            continue
        o = so[b['fromSO']]
        items = o['src'].get('items') or []
        so_lines = [l for l in o.get('lines') or [] if 'txt' not in l]
        want, err = {}, ''
        for l in b.get('lines') or []:
            if 'txt' in l or not l.get('gid') or not (l.get('qty') or 0) > 0:
                continue
            if l.get('u') or l.get('rate'):
                err = '銷貨單有換算單位的行，請自己到崧泉平台建出貨單'
                break
            # 依商品找回崧泉的項次：先看訂單同一位置的行，再看客料號
            seqs = [it['seq'] for it, sl in zip(items, so_lines) if sl.get('gid') == l['gid']]
            if not seqs:
                g = erp.g.get(l['gid']) or {}
                seqs = [it['seq'] for it in items if norm(it.get('part')) and norm(it.get('part')) in (norm(g.get('spec')), norm(g.get('spec2')))]
            if len(seqs) != 1:
                err = f"銷貨單第 {(b.get('lines') or []).index(l) + 1} 行對不到崧泉採購單的項次" + ('（同一商品有好幾個項次）' if seqs else '')
                break
            want[seqs[0]] = want.get(seqs[0], 0) + l['qty']
        if not err and not want:
            err = '銷貨單沒有可出貨的明細'
        jobs.append({'id': b['id'], 'no': b.get('no'), 'date': b.get('date'), 'po': o['src']['po'], 'so': o.get('no'),
                     'lines': [{'seq': k, 'qty': v} for k, v in want.items()], 'err': err})
    return jobs, waiting


WIZARD_JS = r"""
// 出貨單建立精靈：1 選採購單 → 2 修改出貨數量 → 3 確認。ARG = {page, lines:[{po, seq, qty}], note}（可以跨好幾張採購單）
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await wait(300); } throw new Error('等不到：' + what); };
const f = document.getElementById('WorkSpace');
if (!f || typeof clickMenuItem !== 'function') throw new Error('不在崧泉平台主畫面');
await new Promise(r => { const h = () => { f.removeEventListener('load', h); r(); }; f.addEventListener('load', h); setTimeout(r, 15000); clickMenuItem(ARG.page); });
const w = await until(() => f.contentWindow.document.getElementById('UCjqGrid1_JQGridData') && f.contentWindow.jQuery && f.contentWindow, 20000, '出貨單建立頁');
const d = w.document, $ = w.jQuery;
const vis = id => { const e = d.getElementById(id); return !!(e && (e.offsetWidth || e.offsetHeight)); };
const n = v => +String(v).replace(/<[^>]+>/g, '').replace(/,/g, '') || 0;
const t = v => String(v == null ? '' : v).replace(/<[^>]+>/g, '').trim();
const setField = (id, val) => { const e = d.getElementById(id); if (!e) throw new Error('找不到欄位 ' + id); e.focus(); e.value = val; e.dispatchEvent(new Event('change', {bubbles: true})); e.dispatchEvent(new Event('blur', {bubbles: true})); };
// 第 1 步：交貨日期放寬，查出所有可以出貨的採購單
setField('S_sdtfTAB008from', '2000/01/01'); setField('S_sdtfTAB008to', '2099/12/31'); await wait(800);
w.GlassButton_Click('QuickSearchPhase1');
const G1 = d.getElementById('UCjqGrid1_JQGridData'), g1 = $(G1);
await wait(1500);
try { await until(() => g1.jqGrid('getDataIDs').length > 0, 15000, '可出貨的採購單'); } catch (e) { return {ok: false, err: '崧泉平台查不到可以出貨的採購單（採購單要先回覆交期）'}; }
const picked = [];
for (const L of ARG.lines) {
  const ids = g1.jqGrid('getDataIDs').filter(id => { const r = g1.jqGrid('getRowData', id); return t(r.TAA079) === L.po && t(r.TAB001) === String(L.seq); });
  if (ids.length !== 1) return {ok: false, err: `崧泉平台找不到採購單 ${L.po} 項次 ${L.seq}（要先回覆交期，或已經交完）`};
  const r = g1.jqGrid('getRowData', ids[0]);
  if (L.qty > n(r.DELIVERYQTY) + 1e-6) return {ok: false, err: `採購單 ${L.po} 項次 ${L.seq} 未交數量只剩 ${n(r.DELIVERYQTY)}，銷貨單出 ${L.qty}`};
  g1.jqGrid('setSelection', ids[0]); picked.push(ids[0]);
}
await wait(500);
if ((g1.jqGrid('getGridParam', 'selarrrow') || []).length !== ARG.lines.length) return {ok: false, err: '勾選的列數不對'};
w.GlassButton_Click('NextStepP1');
await until(() => vis('step2'), 20000, '第 2 步');
// 第 2 步：改出貨數量
const G2 = d.getElementById('UCjqGrid2_JQGridData'), g2 = $(G2);
await until(() => g2.jqGrid('getDataIDs').length === ARG.lines.length, 15000, '第 2 步的明細');
for (const L of ARG.lines) {
  const id = g2.jqGrid('getDataIDs').find(i => { const r = g2.jqGrid('getRowData', i); return t(r.TAA079) === L.po && t(r.TAB001) === String(L.seq); });
  if (id == null) return {ok: false, err: `第 2 步找不到項次 ${L.seq}`};
  if (Math.abs(n(g2.jqGrid('getRowData', id).DELIVERYQTY) - L.qty) > 1e-6) {
    const tr = G2.querySelector('tr[id="' + id + '"]');
    tr.querySelector('.ui-inline-edit').click();
    const q = await until(() => tr.querySelector('input[name="DELIVERYQTY"]'), 5000, '數量輸入框');
    q.value = String(L.qty); q.dispatchEvent(new Event('change', {bubbles: true}));
    tr.querySelector('.ui-inline-save').click();
    await until(() => !tr.querySelector('input[name="DELIVERYQTY"]') && Math.abs(n(g2.jqGrid('getRowData', id).DELIVERYQTY) - L.qty) < 1e-6, 10000, '數量存入');
  }
}
await wait(800);
const src2 = JSON.parse(d.getElementById('S_UCjqGrid2_hf_JQGridDataSource').value || '[]');
for (const L of ARG.lines) { const r = src2.find(x => t(x.TAA079) === L.po && t(x.TAB001) === String(L.seq)); if (!r || Math.abs(n(r.DELIVERYQTY) - L.qty) > 1e-6) return {ok: false, err: `項次 ${L.seq} 的出貨數量沒有改成功`}; }
if (ARG.note && d.getElementById('S_sfTAE014edit')) setField('S_sfTAE014edit', ARG.note);
await wait(500);
w.GlassButton_Click('NextStepP2');
await until(() => vis('step3'), 20000, '第 3 步');
// 第 3 步：核對畫面上的內容
const g3 = $(d.getElementById('UCjqGrid3_JQGridData'));
await until(() => g3.jqGrid('getDataIDs').length > 0, 15000, '第 3 步的明細');
const rows3 = g3.jqGrid('getRowData').map(r => ({po: t(r.TAA079), seq: t(r.TAB001), qty: n(r.DELIVERYQTY)}));
const same = rows3.length === ARG.lines.length && ARG.lines.every(L => rows3.some(r => r.po === L.po && r.seq === String(L.seq) && Math.abs(r.qty - L.qty) < 1e-6));
if (!same) return {ok: false, err: '第 3 步顯示的內容和銷貨單不一樣，沒有送出', rows3};
return {ok: true, rows3};
"""

SUBMIT_JS = r"""
const w = document.getElementById('WorkSpace').contentWindow, d = w.document;
const e = d.getElementById('step3'); if (!e || !(e.offsetWidth || e.offsetHeight)) throw new Error('不在第 3 步');
try { w.WaitingMaskShow('', ''); } catch (x) {}
w.GlassButton_Click('NextStepP3');
await new Promise(r => setTimeout(r, 6000));
const s3 = d.getElementById('step3');
return {text: (w.document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400), step3: !!(s3 && (s3.offsetWidth || s3.offsetHeight))};
"""

STEP3_JS = "const f = document.getElementById('WorkSpace'); const e = f && f.contentWindow.document.getElementById('step3'); return !!(e && (e.offsetWidth || e.offsetHeight));"

SHIPQ_JS = r"""
// 出貨單查詢：找剛剛建好的那張。ARG = {page, pos:[採購單號]}
const wait = ms => new Promise(r => setTimeout(r, ms));
const f = document.getElementById('WorkSpace');
await new Promise(r => { const h = () => { f.removeEventListener('load', h); r(); }; f.addEventListener('load', h); setTimeout(r, 15000); clickMenuItem(ARG.page); });
await wait(2500);
const w = f.contentWindow, d = w.document, $ = w.jQuery;
const btn = [...d.querySelectorAll('[onclick]')].find(e => /GlassButton_Click\('QuickSearch/.test(e.getAttribute('onclick')));
if (btn) btn.click();
await wait(5000);
const t = v => String(v == null ? '' : v).replace(/<[^>]+>/g, '').trim();
const tb = d.querySelector('table.ui-jqgrid-btable'); if (!tb) return [];
const p = $(tb).jqGrid('getGridParam'); const by = {}; p.colModel.forEach((c, i) => by[String(p.colNames[i]).replace(/<[^>]+>/g, '')] = c.name);
return $(tb).jqGrid('getRowData').map(r => ({no: t(r[by['出貨單號']]), date: t(r[by['出貨日期']]), po: t(r[by['採購單號']]), seq: t(r[by['採購項次']]), qty: +t(r[by['出貨數量']]).replace(/,/g, '') || 0, st: t(r[by['狀態']])})).filter(r => ARG.pos.includes(r.po));
"""


LABEL_JS = r"""
// 出貨標籤：崧泉平台把標籤做成 PDF（開新視窗）。這裡攔下那個網址，直接把 PDF 抓回來。ARG = {page, no, kind, size}
const wait = ms => new Promise(r => setTimeout(r, ms));
const f = document.getElementById('WorkSpace');
await new Promise(r => { const h = () => { f.removeEventListener('load', h); r(); }; f.addEventListener('load', h); setTimeout(r, 15000); clickMenuItem(ARG.page); });
await wait(2500);
const w = f.contentWindow, d = w.document;
const e = d.getElementById('iacTAE002_txtSearch'); if (!e) throw new Error('找不到出貨單號欄位');
e.focus(); e.value = ARG.no; for (const t of ['input', 'change', 'blur']) e.dispatchEvent(new Event(t, {bubbles: true}));
const sel = d.getElementById('S_sddlTAW023'); if (sel && ARG.kind) { sel.value = ARG.kind; for (const t of ['change', 'blur']) sel.dispatchEvent(new Event(t, {bubbles: true})); }
const rb = d.getElementById(ARG.size === 'A4' ? 'S_rbA4' : 'S_rb77'); if (rb && !rb.checked) rb.click();
await wait(1200);
let url = null; const oo = w.open; w.open = function (u) { url = u; return null; };
try { w.GlassButton_Click('QuickSearch'); for (let i = 0; i < 60 && !url; i++) await wait(300); } finally { w.open = oo; }
if (!url) return {err: '崧泉平台沒有產生標籤'};
const r = await fetch(url, {credentials: 'include'}); const buf = new Uint8Array(await r.arrayBuffer());
if (String.fromCharCode(...buf.slice(0, 4)) !== '%PDF') return {err: '標籤不是 PDF 檔'};
let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
return {b64: btoa(s), size: buf.length};
"""


def fetch_label(br, cfg, ship_no):
    """把崧泉平台的出貨標籤 PDF 存到 web/pending/b2b_labels/（要登入 ERP 才看得到），回相對路徑"""
    if not re.fullmatch(r'[\w-]+', ship_no or ''):
        raise RuntimeError('出貨單號格式不對')
    br.goto(cfg['base'] + '/FrameEnterprise/MainFrame_M.aspx')
    r = br.js(LABEL_JS, {'page': 'EC/Report/PQM/PQMSR19WF/PQMSR19WF_M.aspx', 'no': ship_no, 'kind': str(cfg['label_kind']), 'size': str(cfg['label_size'])}, timeout=120) or {}
    if r.get('err') or not r.get('b64'):
        raise RuntimeError(r.get('err') or '標籤抓不到')
    rel = f'b2b_labels/{ship_no}.pdf'
    path = os.path.join(PENDING, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.tmp', 'wb') as f:
        f.write(base64.b64decode(r['b64']))
    os.replace(path + '.tmp', path)
    log('出貨標籤已存：', rel, r.get('size'), 'bytes')
    return rel


def merge_jobs(cfg, jobs, waiting):
    """同一個出貨日的銷貨單合成一張崧泉出貨單（一車一張）。還有銷貨單在等待時間內就整批先不送，免得被拆成兩張。"""
    if not jobs:
        return []
    if not cfg.get('ship_merge', True):
        return [{**j, 'sales': [(j['id'], j['no'])], 'lines': [{**L, 'po': j['po']} for L in j['lines']], 'pos': [j['po']]} for j in jobs]
    if waiting:
        log(f'有 {waiting} 張崧泉銷貨單剛存檔，等它一起合併出貨，這一輪先不送')
        return []
    by_date = {}
    for j in jobs:
        by_date.setdefault(j.get('date') or '', []).append(j)
    out = []
    for date, js in by_date.items():
        qty = {}
        for j in js:
            for L in j['lines']:
                qty[(j['po'], L['seq'])] = qty.get((j['po'], L['seq']), 0) + L['qty']
        pos = list(dict.fromkeys(j['po'] for j in js))
        out.append({'date': date, 'sales': [(j['id'], j['no']) for j in js], 'no': '、'.join(str(j['no']) for j in js), 'po': '、'.join(pos), 'pos': pos,
                    'lines': [{'po': p, 'seq': s, 'qty': q} for (p, s), q in qty.items()]})
    return out


def find_shipment(br, job, before=None):
    rows = br.js(SHIPQ_JS, {'page': 'EC/Maintain/PQM/PQMSI02Q/PQMSI02Q_M.aspx', 'pos': job['pos']}, timeout=60) or []
    nos = {}
    for r in rows:
        nos.setdefault(r['no'], []).append(r)
    for no, rs in nos.items():
        if before is not None and no in before:
            continue
        if len(rs) == len(job['lines']) and all(any(r['po'] == L['po'] and r['seq'] == str(L['seq']) and abs(r['qty'] - L['qty']) < 1e-6 for r in rs) for L in job['lines']):
            return no, set(nos)
    return None, set(nos)


def do_ship(br, cfg, job, state):
    """回 (狀態, 訊息)。狀態：done 已建立｜fail 沒送出（可以重試）｜unknown 送出了但確認不到（不重試，要人看）｜wait 等人按完成"""
    main = cfg['base'] + '/FrameEnterprise/MainFrame_M.aspx'
    br.goto(main)
    _, before = find_shipment(br, job)
    br.goto(main)
    br.dialogs.clear()
    r = br.js(WIZARD_JS, {'page': 'EC/Maintain/PQM/PQMSI02/PQMSI02_M.aspx', 'lines': job['lines'], 'note': f"志瑞銷貨單 {job['no']}"}, timeout=150)
    if not r or not r.get('ok'):
        return 'fail', (r or {}).get('err') or '出貨單建立沒有走完'
    manual = not cfg['ship_auto_submit'] or not state.get('ship_verified')
    if manual:
        br.front()
        log('出貨單已填好，等人按「完成」：', job['no'], job['po'])
        write_status(state, msg=f"崧泉出貨單已填好（銷貨單 {job['no']}），請到主機的崧泉視窗核對後按「完成」", attn=True)
        end = time.time() + 30 * 60
        while time.time() < end:
            time.sleep(5)
            try:
                if not br.js(STEP3_JS):
                    break
            except Exception:
                break
        else:
            return 'wait', '30 分鐘內沒有人按「完成」，下一輪會重新填一次'
        time.sleep(3)
    else:
        br.accept_confirm = True
        try:
            s = br.js(SUBMIT_JS, timeout=60)
        finally:
            br.accept_confirm = False
        log('按了完成：', job['no'], json.dumps(s, ensure_ascii=False)[:300], [x['text'][:80] for x in br.dialogs])
    br.goto(main)
    no, _ = find_shipment(br, job, before)
    if no:
        state['ship_verified'] = True
        return 'done', no
    said = '；'.join(x['text'][:80] for x in br.dialogs)
    return ('wait', '視窗離開了第 3 步，但崧泉平台查不到新的出貨單，下一輪會重新填') if manual else ('unknown', '按了完成，但出貨單查詢裡找不到這張' + (f'（平台訊息：{said}）' if said else '') + '，請到崧泉平台確認，不會自動重送')


# ---------- 狀態（給 ERP「客戶訂單」頁顯示） ----------
def write_status(state, **kw):
    st = {'at': int(time.time() * 1000), 'ok': True, 'needLogin': False, 'msg': '', 'attn': False, 'dry': DRY,
          'ships': sorted(({'no': v.get('no'), 'po': v.get('po'), 'st': v.get('st'), 'ship': v.get('ship', ''), 'label': v.get('label', ''), 'msg': v.get('msg', ''), 'at': v.get('at')} for v in state.get('ships', {}).values()),
                          key=lambda x: -(x.get('at') or 0))[:15],
          **state.get('last', {}), **kw}
    try:
        write_json(os.path.join(PENDING, STATUS_NAME), st)
    except Exception as e:
        log('狀態檔寫不進去', e)


REPLY_JS = r"""
// 採購單回覆：勾選要回覆的列（回覆交期、數量預設就是崧泉給的），ARG.submit 才按「送出」。ARG = {page, keys:[{po, seq}], submit}
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await wait(300); } throw new Error('等不到：' + what); };
const f = document.getElementById('WorkSpace');
if (!f || typeof clickMenuItem !== 'function') throw new Error('不在崧泉平台主畫面');
await new Promise(r => { const h = () => { f.removeEventListener('load', h); r(); }; f.addEventListener('load', h); setTimeout(r, 15000); clickMenuItem(ARG.page); });
const w = await until(() => f.contentWindow.document.getElementById('UCjqGrid_JQGridData') && f.contentWindow.jQuery && f.contentWindow.jQuery('#UCjqGrid_JQGridData').jqGrid && f.contentWindow, 20000, '採購單回覆頁');
const d = w.document, $ = w.jQuery, g = $('#UCjqGrid_JQGridData');
const t = v => String(v == null ? '' : v).replace(/<[^>]+>/g, '').trim();
await wait(1500);
const picked = [];
for (const K of ARG.keys) {
  const ids = g.jqGrid('getDataIDs').filter(id => { const r = g.jqGrid('getRowData', id); return t(r.TAA079) === K.po && t(r.TAB001) === String(K.seq); });
  if (ids.length !== 1) return {ok: false, err: `採購單回覆頁找不到 ${K.po} 項次 ${K.seq}`};
  const r = g.jqGrid('getRowData', ids[0]);
  if (t(r.TAB015) !== t(r.TAB008) || Math.abs((+t(r.TAB014).replace(/,/g, '') || 0) - (+t(r.TAB007).replace(/,/g, '') || 0)) > 1e-6) return {ok: false, err: `${K.po} 項次 ${K.seq} 的回覆交期或回覆數量已經被改過，跟崧泉給的不一樣，沒有自動回覆`};
  picked.push(ids[0]);
}
for (const id of picked) g.jqGrid('setSelection', id);
await wait(700);
const sel = (g.jqGrid('getGridParam', 'selarrrow') || []).slice().sort().join('$');
if (sel !== picked.slice().sort().join('$') || d.getElementById('UCjqGrid_UCjqGridselectID').value.split('$').sort().join('$') !== sel) return {ok: false, err: '勾選的列不對，沒有送出'};
if (!ARG.submit) return {ok: true, selected: picked.length};
try { w.WaitingMaskShow('', ''); } catch (x) {}
w.GlassButton_Click('UCjqGrid_UCjqGridgbtnJQGridReply');
await wait(6000);
return {ok: true, selected: picked.length, text: (d.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300)};
"""


def reply_targets(erp, cus, unreplied, state):
    """要回覆的列：採購單已經變成 ERP 的客戶訂單（由崧泉平台匯入、沒結案），而且訂單記的數量、交期和崧泉現在的一樣"""
    so = {}
    for b in erp.bills:
        if b.get('type') == 'SO' and b.get('cid') == cus['id'] and isinstance(b.get('src'), dict) and b['src'].get('b2b') == 'songquan' and not b.get('closed'):
            so.setdefault(b['src'].get('po'), b)
    tries = state.get('replyTry', {})
    out = []
    for r in unreplied:
        o = so.get(r['po'])
        if not o or tries.get(r['po'], 0) >= 3:
            continue
        it = next((x for x in o['src'].get('items') or [] if x.get('seq') == r['seq']), None)
        if it and it.get('qty') == r['qty'] and it.get('due') == r['due'] and it.get('part') == r['part']:
            out.append({'po': r['po'], 'seq': r['seq']})
    return out


def do_reply(br, cfg, keys, state):
    """回 (狀態, 訊息)。done 已回覆｜fail 沒送出或送出後還在未回覆清單｜wait 等人按送出"""
    page = 'EC/Maintain/PQM/PQMSI01/PQMSI01_M.aspx'
    main = cfg['base'] + '/FrameEnterprise/MainFrame_M.aspx'
    manual = not cfg.get('reply_auto_submit', True) or not state.get('reply_verified')
    br.goto(main)
    br.dialogs.clear()
    br.accept_confirm = not manual
    try:
        r = br.js(REPLY_JS, {'page': page, 'keys': keys, 'submit': not manual}, timeout=90)
    finally:
        br.accept_confirm = False
    if not r or not r.get('ok'):
        return 'fail', (r or {}).get('err') or '回覆沒有走完'

    def left():
        now = {(x['po'], x['seq']) for x in (po_line(y) for y in fetch_grid(br, '/' + page))}
        return [k for k in keys if (k['po'], k['seq']) in now]
    label = '、'.join(sorted({k['po'] for k in keys}))
    if manual:
        br.front()
        log('採購單已勾好，等人按「送出」：', label)
        write_status(state, msg=f"崧泉採購單 {label} 已勾好要回覆的 {len(keys)} 項，請到主機的崧泉視窗核對回覆交期後按左上角的「送出」", attn=True)
        end = time.time() + 30 * 60
        while time.time() < end:
            time.sleep(15)
            if not left():
                state['reply_verified'] = True
                return 'done', f'{label}（{len(keys)} 項）'
        return 'wait', '30 分鐘內沒有人按「送出」，下一輪會重新勾一次'
    log('按了送出：', label, (r.get('text') or '')[:200], [x['text'][:80] for x in br.dialogs])
    time.sleep(3)
    rest = left()
    if not rest:
        return 'done', f'{label}（{len(keys)} 項）'
    said = '；'.join(x['text'][:80] for x in br.dialogs)
    return 'fail', f'按了送出，但還有 {len(rest)} 項留在未回覆' + (f'（平台訊息：{said}）' if said else '') + '，試 3 次都不行就不再自動回覆這張'


def cycle(br, cfg, state):
    erp = Erp()
    hit = erp.customer(cfg['customer'])
    if len(hit) != 1:
        raise RuntimeError(f"ERP 客戶裡名稱有「{cfg['customer']}」的有 {len(hit)} 家，要剛好一家（改 data/b2b_helper.json 的 customer）")
    cus = hit[0]
    unreplied = [po_line(r) for r in fetch_grid(br, '/EC/Maintain/PQM/PQMSI01/PQMSI01_M.aspx')]
    opened = [po_line(r) for r in fetch_grid(br, '/EC/Maintain/PQM/PQMSI01Q/PQMSI01Q_M.aspx')]
    P, sm = build_pending(cfg, erp, cus, [r for r in unreplied if r['po']], [r for r in opened if r['po']], state)
    sync_pending(P)
    state['last'] = {'pending': bool(P), 'new': sm['new'], 'upd': sm['upd'], 'miss': sm['miss'], 'unreplied': sm['unreplied'], 'shipWait': 0, 'shipErr': []}
    log(f"抓到未回覆採購單 {sm['unreplied']} 張；待確認：新增 {sm['new']}、變更 {sm['upd']}、沒對到商品 {sm['miss']} 項")
    # 回覆交期：老闆在 ERP 按過「確認寫入」（訂單已經在 ERP、內容和崧泉一樣）的採購單，照崧泉給的交期、數量回覆接受
    if cfg.get('reply', True) and not NO_SHIP:
        keys = reply_targets(erp, cus, unreplied, state)
        if keys and DRY:
            log('（演練）要回覆：', json.dumps(keys, ensure_ascii=False))
        elif keys:
            try:
                st, msg = do_reply(br, cfg, keys, state)
            except NeedLogin:
                raise
            except Exception as e:
                st, msg = 'fail', str(e)[:200]
            log('回覆採購單', sorted({k['po'] for k in keys}), st, msg)
            tries = state.setdefault('replyTry', {})
            for po in {k['po'] for k in keys}:
                if st == 'done':
                    tries.pop(po, None)
                elif st != 'wait':
                    tries[po] = tries.get(po, 0) + 1
            if st == 'done':
                state['last']['replied'] = msg
                state['last']['unreplied'] = len({r['po'] for r in unreplied if r['po']} - {k['po'] for k in keys})
            else:
                state['last']['shipErr'].append('回覆採購單 ' + '、'.join(sorted({k['po'] for k in keys})) + '：' + msg)
            write_json(STATE_FILE, state)
    if cfg['ship'] and not NO_SHIP:
        jobs, waiting = ship_jobs(cfg, erp, cus, state)
        state['last']['shipWait'] = waiting
        for job in jobs:
            if job['err']:
                state['last']['shipErr'].append(f"銷貨單 {job['no']}：{job['err']}")
        for job in merge_jobs(cfg, [j for j in jobs if not j['err']], waiting):
            rec = {'po': job['po'], 'at': int(time.time() * 1000)}
            if DRY:
                log('（演練）要建出貨單：', json.dumps(job, ensure_ascii=False))
                continue
            try:
                st, msg = do_ship(br, cfg, job, state)
            except NeedLogin:
                raise
            except Exception as e:
                st, msg = 'fail', str(e)[:200]
            log('出貨單', job['no'], job['po'], st, msg)
            if st == 'done':
                for sid, sno in job['sales']:          # 合併出貨：每張銷貨單都記同一張崧泉出貨單
                    state['ships'][sid] = {**rec, 'no': sno, 'st': 'done', 'ship': msg}
            elif st == 'unknown':
                for sid, sno in job['sales']:
                    state['ships'][sid] = {**rec, 'no': sno, 'st': 'unknown', 'msg': msg}
                state['last']['shipErr'].append(f"銷貨單 {job['no']}：{msg}")
            else:
                state['last']['shipErr'].append(f"銷貨單 {job['no']}：{msg}")
            write_json(STATE_FILE, state)
        # 出貨標籤：出貨單建好就把崧泉平台產生的標籤 PDF 抓回來（抓不到的下一輪再試，最多 5 次）
        if cfg['label'] and not DRY:
            for rec in state['ships'].values():
                if rec.get('st') != 'done' or rec.get('label') or rec.get('labelTry', 0) >= 5:
                    continue
                got = next((x['label'] for x in state['ships'].values() if x.get('ship') == rec.get('ship') and x.get('label')), '')
                if got:                                # 同一張出貨單（合併出貨）的標籤已經抓過
                    rec['label'] = got
                    continue
                try:
                    rec['label'] = fetch_label(br, cfg, rec.get('ship'))
                except NeedLogin:
                    raise
                except Exception as e:
                    rec['labelTry'] = rec.get('labelTry', 0) + 1
                    log('出貨標籤抓不到', rec.get('ship'), e)
                    if rec['labelTry'] >= 5:
                        state['last']['shipErr'].append(f"出貨單 {rec.get('ship')} 的標籤抓不到，請到崧泉平台「出貨標籤」自己印")
                write_json(STATE_FILE, state)
        try:
            br.goto(cfg['base'] + '/FrameEnterprise/MainFrame_M.aspx')
        except Exception:
            pass
    write_json(STATE_FILE, state)
    write_status(state, attn=bool(state['last']['shipErr']))


def main():
    cfg = load_cfg()
    state = read_json(STATE_FILE, {})
    log('崧泉小幫手啟動', '（演練）' if DRY else '', 'data=' + DATA)
    br = Browser(cfg)
    asked = False
    while True:
        try:
            if not br.ws:
                br.start()
            cycle(br, cfg, state)
            asked = False
        except NeedLogin:
            if not asked:
                log('崧泉平台沒有登入，等人登入')
                try:
                    if 'login.aspx' not in (br.js('return location.href') or '').lower():
                        br.goto(cfg['base'] + '/Login.aspx')
                except Exception:
                    pass
                br.front()
                asked = True
            write_status(state, ok=False, needLogin=True, attn=True, msg='崧泉平台要重新登入：請到主機上的崧泉視窗輸入驗證碼、帳號、密碼')
            if ONCE:
                return 2
            time.sleep(20)          # 登入前每 20 秒看一次
            continue
        except (ConnectionError, OSError, TimeoutError) as e:
            log('瀏覽器連線問題：', e)
            if br.ws:
                br.ws.close()
            br.ws = None
            write_status(state, ok=False, msg='崧泉小幫手連不上瀏覽器，會自動重試', attn=True)
        except Exception as e:
            log('這一輪失敗：', e, traceback.format_exc()[-800:])
            write_status(state, ok=False, msg='崧泉小幫手這一輪失敗：' + str(e)[:160], attn=True)
        if ONCE:
            return 0
        time.sleep(max(1, min(15, float(cfg['interval_min']))) * 60)


if __name__ == '__main__':
    sys.exit(main() or 0)
