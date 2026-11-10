"""志瑞螺絲作業平台 伺服器

只用 Python 3 標準函式庫：HTTP 伺服器、SQLite、每日自動備份。
啟動：python app.py [--port 8080] [--data ../data]

API（全部回 JSON；除了登入與 /api/status 之外都要先登入）
  POST /api/setup            第一次使用：建立第一個帳號 {name, login, pw}
  POST /api/login            {login, pw} → 設定 cookie
  POST /api/logout
  GET  /api/me               目前登入者、伺服器狀態
  GET  /api/bootstrap        所有即時集合的全部資料 + 目前版本
  GET  /api/sync?since=N     long-polling：等到有新變更（最多 25 秒）
  POST /api/batch            [{col,id,data} | {col,id,delete:true}]
  GET  /api/hist?...         歷史單據查詢（cid、gid、type、q、from、to、limit、offset）
  GET  /api/hist/prices?gid= 某商品歷史單價
  POST /api/hist/save         修改一張舊系統歷史單據（仍是歷史單據，不計庫存帳款）
  POST /api/optimize          一鍵優化資料庫（先備份，再檢查、整理）
  POST /api/files?name=      上傳附檔（客戶圖面；內容直接放在 body）→ {id,name,type,size}
  GET  /api/files/<id>       讀附檔（?n=顯示檔名  ?dl=1 下載）   POST /api/files/<id>/delete 刪除
  GET  /api/users            帳號清單   POST /api/users {name,login,pw} 新增
  POST /api/users/<id>       {name?, login?, pw?, disabled?}
  POST /api/backup           立即備份
  GET  /api/status           版本、筆數、備份狀態
"""
import argparse
import datetime
import gzip
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import threading
import time
import traceback
import zipfile
import base64
import urllib.request
import urllib.error
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import DB  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, '..', 'web'))
# 網頁版本號：js／css 任何一個檔案改過就變。index.html 把 js/、css/ 改成 v<版本>/js/…，
# 瀏覽器（尤其 iPhone Safari，沒有 Ctrl+F5）一定拿到新檔；同版本的檔案可以放心長期快取。
VER_RE = re.compile(r'^/v[0-9a-f]{4,16}(/.*)$')
_webver = {'at': 0.0, 'v': ''}
def web_version():
    now = time.time()
    if now - _webver['at'] > 2:
        m = 0.0
        for sub in ('js', 'css', 'img'):
            for root, _dirs, files in os.walk(os.path.join(WEB, sub)):
                for fn in files:
                    try:
                        m = max(m, os.path.getmtime(os.path.join(root, fn)))
                    except OSError:
                        pass
        _webver.update(at=now, v='%x' % int(m))
    return _webver['v']

# 用戶端一開始就整批載入、之後即時同步的集合
LIVE_COLS = ['settings', 'contacts', 'goods', 'warehouses', 'accounts', 'bills',
             'pricing_cats', 'pricing', 'discounts', 'receivables', 'payables', 'invoices', 'purch_invoices',
             'checks_out', 'checks_in', 'orders', 'drawings', 'labels', 'mail', 'logs']
COOKIE = 'zr_session'
LONG_POLL = 25
# 附檔（客戶圖面）
FILE_TYPES = {'.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf'}
FILE_MAX = 25 * 1024 * 1024
START_AT = int(time.time() * 1000)
FILE_RE = re.compile(r'^/api/files/([0-9a-f]{16}\.(?:jpg|png|gif|webp|pdf))(/delete)?$')


class State:
    def __init__(self, db, data_dir):
        self.db = db
        self.data_dir = data_dir
        self.backup = {'last': None, 'file': None, 'err': None}


def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


class Handler(BaseHTTPRequestHandler):
    server_version = 'ZhiruiServer/1.0'
    protocol_version = 'HTTP/1.1'
    state: State = None

    # ---------- 工具 ----------
    def log_message(self, fmt, *args):
        if os.environ.get('ZR_QUIET'):
            return
        sys.stderr.write('%s %s\n' % (datetime.datetime.now().strftime('%H:%M:%S'), fmt % args))

    def send_json(self, obj, status=200, headers=None):
        body = json_bytes(obj)
        self.send_bytes(body, 'application/json; charset=utf-8', status, headers)

    def send_bytes(self, body, ctype, status=200, headers=None, cache=False):
        gz = len(body) > 1024 and 'gzip' in (self.headers.get('Accept-Encoding') or '') and not ctype.startswith(('image/', 'application/pdf'))
        if gz:
            body = gzip.compress(body, 5)
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        if gz:
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Cache-Control', cache if isinstance(cache, str) else ('public, max-age=3600' if cache else 'no-store'))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def error(self, msg, status=400):
        self.send_json({'error': msg}, status)

    def body_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 64 * 1024 * 1024:
            raise ValueError('body too large')
        raw = self.rfile.read(n) if n else b''
        return json.loads(raw.decode('utf-8')) if raw else None

    def cookie(self):
        c = self.headers.get('Cookie') or ''
        for part in c.split(';'):
            k, _, v = part.strip().partition('=')
            if k == COOKIE:
                return v
        return None

    def user(self):
        return self.state.db.session_user(self.cookie())

    # ---------- 路由 ----------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            u = urlparse(self.path)
            if u.path.startswith('/api/'):
                return self.api('GET', u.path, parse_qs(u.query), None)
            return self.static(u.path)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            try:
                self.error('伺服器錯誤', 500)
            except Exception:
                pass

    def do_POST(self):
        try:
            u = urlparse(self.path)
            if not u.path.startswith('/api/'):
                return self.error('not found', 404)
            if u.path == '/api/files':
                return self.upload(parse_qs(u.query))
            body = self.body_json()
            return self.api('POST', u.path, parse_qs(u.query), body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except ValueError as e:
            self.error(str(e), 400)
        except Exception:
            traceback.print_exc()
            try:
                self.error('伺服器錯誤', 500)
            except Exception:
                pass

    def static(self, path):
        vm = VER_RE.match(path)
        if vm:
            path = vm.group(1)
        if path == '/':
            path = '/index.html'
        fp = os.path.normpath(os.path.join(WEB, path.lstrip('/')))
        if not fp.startswith(WEB) or not os.path.isfile(fp):
            # 單頁應用：找不到的路徑回首頁
            fp = os.path.join(WEB, 'index.html')
            if not os.path.isfile(fp):
                return self.error('not found', 404)
        ctype = mimetypes.guess_type(fp)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
            ctype += '; charset=utf-8'
        if fp.endswith('.html'):
            with open(fp, 'rb') as f:
                body = f.read()
            if os.path.basename(fp) == 'index.html' and os.path.dirname(fp) == WEB:
                v = web_version().encode()
                body = body.replace(b'href="css/', b'href="v' + v + b'/css/').replace(b'src="js/', b'src="v' + v + b'/js/')
            return self.send_bytes(body, ctype, cache='no-store')
        if vm:
            # 有版本號的網址：內容永遠不變，快取一年
            with open(fp, 'rb') as f:
                body = f.read()
            return self.send_bytes(body, ctype, cache='public, max-age=31536000, immutable')
        # 沒版本號（舊頁面、legacy、vendor）：每次都問伺服器有沒有改，沒改回 304
        mt = int(os.path.getmtime(fp))
        lm = time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime(mt))
        if self.headers.get('If-Modified-Since') == lm:
            self.send_response(304)
            self.send_header('Last-Modified', lm)
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            return
        with open(fp, 'rb') as f:
            body = f.read()
        self.send_bytes(body, ctype, headers={'Last-Modified': lm}, cache='no-cache')

    def api(self, method, path, qs, body):
        db = self.state.db
        q = lambda k, d=None: (qs.get(k) or [d])[0]  # noqa: E731

        if path == '/api/status':
            return self.send_json(self.status())
        if path == '/api/setup' and method == 'POST':
            if db.user_count():
                return self.error('已經有帳號了，請直接登入', 403)
            b = body or {}
            if not b.get('login') or not b.get('pw') or len(b['pw']) < 4:
                return self.error('請填帳號與至少 4 碼的密碼')
            uid = db.add_user(b.get('name') or b['login'], b['login'], b['pw'])
            token = db.login(b['login'], b['pw'], self.headers.get('User-Agent', ''))
            return self.send_json({'ok': True, 'id': uid}, headers={'Set-Cookie': self.set_cookie(token)})
        if path == '/api/login' and method == 'POST':
            b = body or {}
            token = db.login(b.get('login') or '', b.get('pw') or '', self.headers.get('User-Agent', ''))
            if not token:
                time.sleep(0.5)
                return self.error('帳號或密碼不對', 401)
            return self.send_json({'ok': True, 'user': db.session_user(token)}, headers={'Set-Cookie': self.set_cookie(token)})

        me = self.user()
        if not me:
            return self.error('請先登入', 401)

        if path == '/api/logout' and method == 'POST':
            db.logout(self.cookie())
            return self.send_json({'ok': True}, headers={'Set-Cookie': f'{COOKIE}=; Path=/; Max-Age=0; SameSite=Lax'})
        if path == '/api/me':
            return self.send_json({'user': me, 'ver': db.ver, 'status': self.status()})
        if path == '/api/bootstrap':
            cols = {c: db.list(c) for c in LIVE_COLS}
            if 'logs' in cols:
                cols['logs'] = sorted(cols['logs'], key=lambda x: x.get('at', 0), reverse=True)[:500]
            return self.send_json({'ver': db.ver, 'user': me, 'cols': cols, 'users': db.users(), 'hist': db.hist_count()})
        if path == '/api/sync':
            since = int(q('since', 0) or 0)
            ver = db.wait_for_change(since, LONG_POLL)
            if ver <= since:
                return self.send_json({'ver': ver, 'changes': []})
            return self.send_json({'ver': ver, 'changes': db.changes_since(since)})
        if path == '/api/batch' and method == 'POST':
            ops = body if isinstance(body, list) else [body]
            for op in ops:
                if not isinstance(op, dict) or not op.get('col') or not op.get('id'):
                    return self.error('每筆要有 col 與 id')
                if op['col'] not in LIVE_COLS:
                    return self.error('不認識的集合：' + str(op['col']))
                if not op.get('delete') and not isinstance(op.get('data'), dict):
                    return self.error('data 要是物件')
            res = db.batch(ops, me['id'])
            return self.send_json({'ok': True, 'ver': db.ver, 'results': res})
        if path == '/api/hist':
            r = db.hist_query(cid=q('cid'), gid=q('gid'), type=q('type'), q=q('q'), frm=q('from'), to=q('to'),
                              limit=min(int(q('limit', 200)), 1000), offset=int(q('offset', 0)))
            return self.send_json(r)
        if path == '/api/hist/all':
            # 整批載入：資料庫裡的 JSON 原樣送出（省掉解開重包），一次最多 10000 張，gzip 由 send_bytes 處理
            total, raws = db.hist_raw(type=q('type'), limit=min(int(q('limit', 10000)), 10000), offset=int(q('offset', 0)))
            body = ('{"total":%d,"stamp":%s,"rows":[' % (total, json.dumps(db.hist_stamp()))).encode('utf-8') + ','.join(raws).encode('utf-8') + b']}'
            return self.send_bytes(body, 'application/json; charset=utf-8')
        if path == '/api/hist/prices':
            return self.send_json({'rows': db.hist_prices(q('gid', ''), int(q('limit', 50)), q('cid', ''))})
        if path == '/api/users' and method == 'GET':
            return self.send_json({'users': db.users()})
        if path == '/api/users' and method == 'POST':
            b = body or {}
            if not b.get('login') or not b.get('pw') or len(b['pw']) < 4:
                return self.error('請填帳號與至少 4 碼的密碼')
            if any(u['login'] == b['login'].strip().lower() for u in db.users()):
                return self.error('這個帳號已經存在')
            uid = db.add_user(b.get('name') or b['login'], b['login'], b['pw'])
            return self.send_json({'ok': True, 'id': uid, 'users': db.users()})
        if path.startswith('/api/users/') and method == 'POST':
            uid = path.rsplit('/', 1)[1]
            b = body or {}
            if 'pw' in b and b['pw']:
                if len(b['pw']) < 4:
                    return self.error('密碼至少 4 碼')
                db.set_password(uid, b['pw'])
            if b.get('disabled') and sum(1 for u in db.users() if not u['disabled']) <= 1:
                return self.error('至少要保留一個可用帳號')
            db.update_user(uid, b.get('name'), b.get('login'), b.get('disabled'))
            return self.send_json({'ok': True, 'users': db.users()})
        m = FILE_RE.match(path)
        if m:
            fp = os.path.join(self.files_dir(), m.group(1))
            if method == 'POST' and m.group(2) == '/delete':
                try:
                    os.remove(fp)
                except OSError:
                    pass
                return self.send_json({'ok': True})
            if not os.path.isfile(fp):
                return self.error('找不到檔案', 404)
            with open(fp, 'rb') as f:
                data = f.read()
            name = q('n') or m.group(1)
            ext = os.path.splitext(m.group(1))[1].lower()
            disp = 'attachment' if q('dl') else 'inline'
            return self.send_bytes(data, FILE_TYPES.get(ext, 'application/octet-stream'), cache=True,
                                   headers={'Content-Disposition': f"{disp}; filename*=UTF-8''{quote(name)}"})
        if path == '/api/optimize' and method == 'POST':
            # 先備份；備份失敗就不整理，避免沒有退路
            ok, msg = run_backup(self.state, manual=True)
            if not ok:
                return self.send_json({'ok': False, 'msg': msg})
            r = self.state.db.optimize()
            return self.send_json(dict(r, backup=msg, msg='資料庫檢查發現問題，未整理：' + r['check'] if not r['ok'] else '已優化'))
        if path == '/api/backup' and method == 'POST':
            ok, msg = run_backup(self.state, manual=True)
            return self.send_json({'ok': ok, 'msg': msg, 'backup': self.state.backup})

        # AI 辨識（支票拍照）：金鑰存在 data/ai.json，不進資料庫、不同步到瀏覽器
        if path == '/api/ai' and method == 'GET':
            return self.send_json(ai_status(self.state.data_dir))
        if path == '/api/ai' and method == 'POST':
            ai_update(self.state.data_dir, body or {})
            return self.send_json(ai_status(self.state.data_dir))
        if path == '/api/contacts/dups' and method == 'GET':
            kind = q('kind', 'S')
            if kind not in ('C', 'S'):
                return self.error('kind 要是 C 或 S')
            return self.send_json({'groups': db.contact_dups(kind)})
        if path == '/api/hist/save' and method == 'POST':
            b = body or {}
            if not isinstance(b, dict) or not isinstance(b.get('lines', []), list):
                return self.error('資料格式不對')
            try:
                stamp = db.hist_update(b)
            except ValueError as e:
                return self.error(str(e))
            return self.send_json({'ok': True, 'stamp': stamp})
        if path == '/api/contacts/merge' and method == 'POST':
            b = body or {}
            try:
                r = db.merge_contacts(str(b.get('keep') or ''), [str(x) for x in (b.get('merge') or [])], me['id'])
            except ValueError as e:
                return self.error(str(e))
            return self.send_json(dict(r, ok=True))
        if path == '/api/restart' and method == 'POST':
            # 由啟動器（run_forever.py）執行時，結束碼 3 會被立刻重開 → 載入新程式，不需 UAC
            if not os.environ.get('ZR_LAUNCHER'):
                return self.error('伺服器不是由啟動器執行，無法從網頁重啟：請在伺服器電腦執行「重啟伺服器.bat」', 409)
            self.send_json({'ok': True, 'msg': '伺服器重新啟動中，約 3～5 秒'})
            sys.stderr.write('restart requested by %s\n' % me.get('login'))
            threading.Timer(0.6, lambda: os._exit(3)).start()
            return
        if path == '/api/ocr/check' and method == 'POST':
            img = str((body or {}).get('image') or '')
            try:
                checks = ocr_check(self.state.data_dir, img)
            except OcrError as e:
                return self.error(str(e), e.status)
            if not checks:
                return self.error('照片裡沒有讀到支票，請重拍（對準、光線夠、整張入鏡）', 422)
            return self.send_json({'ok': True, 'checks': checks, 'fields': checks[0]})
        return self.error('not found', 404)

    # ---------- 附檔（客戶圖面）：存在 data/files，檔名是亂數＋副檔名 ----------
    def files_dir(self):
        d = os.path.join(self.state.data_dir, 'files')
        os.makedirs(d, exist_ok=True)
        return d

    def upload(self, qs):
        n = int(self.headers.get('Content-Length') or 0)
        if not self.user():
            if 0 < n <= FILE_MAX:
                self.rfile.read(n)
            else:
                self.close_connection = True
            return self.error('請先登入', 401)
        if n <= 0:
            return self.error('沒有收到檔案')
        if n > FILE_MAX:
            self.rfile.read(n)
            return self.error('檔案太大（上限 %d MB）' % (FILE_MAX // 1024 // 1024))
        name = (qs.get('name') or ['file'])[0][:200]
        ext = os.path.splitext(name)[1].lower()
        if ext == '.jpeg':
            ext = '.jpg'
        if ext not in FILE_TYPES:
            self.rfile.read(n)
            return self.error('只接受圖片（JPG、PNG、GIF、WEBP）或 PDF')
        data = self.rfile.read(n)
        fid = secrets.token_hex(8) + ext
        with open(os.path.join(self.files_dir(), fid), 'wb') as f:
            f.write(data)
        return self.send_json({'ok': True, 'id': fid, 'name': name, 'type': FILE_TYPES[ext], 'size': len(data)})

    def set_cookie(self, token):
        return f'{COOKIE}={token}; Path=/; Max-Age={86400 * 365}; HttpOnly; SameSite=Lax'

    def status(self):
        db = self.state.db
        return {'ver': db.ver, 'users': db.user_count(), 'needSetup': db.user_count() == 0,
                'counts': {c: db.count(c) for c in ('goods', 'contacts', 'bills', 'pricing', 'checks_in')},
                'hist': db.hist_count(), 'histVer': db.hist_stamp(), 'backup': self.state.backup, 'time': int(time.time() * 1000),
                'launcher': bool(os.environ.get('ZR_LAUNCHER')), 'started': START_AT}


# ---------- AI 辨識：支票拍照 → Claude 擷取欄位 ----------
AI_MODEL = 'claude-opus-5-5'
OCR_ITEM = {
    'type': 'object',
    'properties': {
        'drawer': {'type': 'string', 'description': '發票人（開票的公司或個人名稱）'},
        'bank': {'type': 'string', 'description': '付款銀行名稱，例如 華南商業銀行、臺中市霧峰區農會'},
        'branch': {'type': 'string', 'description': '分行／分部名稱，例如 南台中分行'},
        'checkNo': {'type': 'string', 'description': '支票號碼，英文字母＋數字，例如 KD0482749'},
        'account': {'type': 'string', 'description': '帳號'},
        'amount': {'type': 'number', 'description': '金額（新臺幣，數字）'},
        'dueDate': {'type': 'string', 'description': '票面日期，西元 YYYY-MM-DD'},
        'notes': {'type': 'string', 'description': '看不清楚或不確定的地方，用中文簡短說明；沒有就空字串'},
    },
    'required': ['drawer', 'bank', 'branch', 'checkNo', 'account', 'amount', 'dueDate', 'notes'],
    'additionalProperties': False,
}
OCR_SCHEMA = {
    'type': 'object',
    'properties': {'checks': {'type': 'array', 'items': OCR_ITEM, 'description': '照片裡的每一張支票，由上到下、由左到右'}},
    'required': ['checks'],
    'additionalProperties': False,
}
OCR_PROMPT = (
    '你在幫台灣的螺絲公司登記收到的客戶支票（客票）。使用者會給你一張照片，裡面可能只有一張支票，也可能桌上排了好幾張（例如 6 張）；'
    '照片可能是橫的、斜的或倒的，先自行轉正再讀。每一張支票各輸出一筆，順序由上到下、由左到右，不要漏掉也不要重複。\n'
    '每張請擷取：\n'
    '1. drawer 發票人：開這張票的公司或個人。通常是票面上方印刷的公司名，或下方「發票人簽章」印鑑上的名稱。'
    '注意「憑票支付」後面寫的是受款人（通常是志瑞螺絲企業有限公司），不是發票人。\n'
    '2. bank 付款銀行、branch 分行：票面印的付款行，例如「華南商業銀行」「南台中分行」；農會、信用合作社也算銀行。\n'
    '3. checkNo 票號：右上角「支票號碼」，通常 2 個英文字母＋7 位數字（例如 KD0482749），可用底部磁性墨水字軌的數字核對。\n'
    '4. account 帳號：右上角「帳號」，保留原本的數字與連字號。\n'
    '5. amount 金額：NT$ 阿拉伯數字與國字大寫（壹貳參肆伍陸柒捌玖拾佰仟萬）互相核對後回傳數字；兩者不一致時以國字大寫為準並在 notes 說明。\n'
    '6. dueDate 到期日：票面「中華民國 年 月 日」，民國年加 1911 換成西元，格式 YYYY-MM-DD（民國 113 年 12 月 31 日 → 2024-12-31）。\n'
    '看不清楚的欄位：字串回空字串、金額回 0，並在 notes 用中文簡短說明。不要猜。'
)


class OcrError(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


def ai_file(data_dir):
    return os.path.join(data_dir, 'ai.json')


GEMINI_MODEL = 'gemini-3.5-flash-lite'
PROVIDERS = ('gemini', 'claude')


def ai_cfg(data_dir):
    cfg = {}
    try:
        with open(ai_file(data_dir), encoding='utf-8') as f:
            cfg = json.load(f) or {}
    except Exception:
        cfg = {}
    if not cfg.get('anthropic_api_key') and os.environ.get('ANTHROPIC_API_KEY'):
        cfg['anthropic_api_key'] = os.environ['ANTHROPIC_API_KEY']
    if not cfg.get('gemini_api_key') and os.environ.get('GEMINI_API_KEY'):
        cfg['gemini_api_key'] = os.environ['GEMINI_API_KEY']
    if cfg.get('provider') not in PROVIDERS:
        cfg['provider'] = 'gemini' if cfg.get('gemini_api_key') or not cfg.get('anthropic_api_key') else 'claude'
    cfg['gemini_model'] = (cfg.get('gemini_model') or GEMINI_MODEL).strip()
    return cfg


def ai_update(data_dir, body):
    """body：provider（gemini／claude）、key（空＝不改）、clear（true＝清掉該供應商金鑰）、model（Gemini 模型名）"""
    cfg = {}
    try:
        with open(ai_file(data_dir), encoding='utf-8') as f:
            cfg = json.load(f) or {}
    except Exception:
        cfg = {}
    prov = str(body.get('provider') or cfg.get('provider') or 'gemini')
    if prov not in PROVIDERS:
        prov = 'gemini'
    cfg['provider'] = prov
    kname = 'gemini_api_key' if prov == 'gemini' else 'anthropic_api_key'
    key = str(body.get('key') or '').strip()
    if key:
        cfg[kname] = key
    elif body.get('clear'):
        cfg.pop(kname, None)
    if 'model' in body:
        m = re.sub(r'[^A-Za-z0-9._-]', '', str(body.get('model') or ''))
        if m:
            cfg['gemini_model'] = m
        else:
            cfg.pop('gemini_model', None)
    with open(ai_file(data_dir), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False)


def _hint(k):
    return (k[:6] + '…' + k[-4:]) if len(k) > 12 else ('已設定' if k else '')


def ai_status(data_dir):
    c = ai_cfg(data_dir)
    prov = c['provider']
    key = c.get('gemini_api_key' if prov == 'gemini' else 'anthropic_api_key') or ''
    return {'provider': prov, 'configured': bool(key), 'hint': _hint(key),
            'model': c['gemini_model'] if prov == 'gemini' else AI_MODEL,
            'keys': {'gemini': _hint(c.get('gemini_api_key') or ''), 'claude': _hint(c.get('anthropic_api_key') or '')},
            'mock': bool(os.environ.get('ZR_OCR_MOCK'))}


def _parse_json_text(text):
    text = (text or '').strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r'\{.*\}', text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    raise OcrError('AI 回傳的內容無法解析', 502)


def _http_json(url, headers, req, label):
    """POST JSON 到 AI 服務；回 (status, json)。HTTPError 也會解析 body 給呼叫端判斷"""
    data = json.dumps(req).encode('utf-8')
    r = urllib.request.Request(url, data=data, method='POST', headers=dict(headers, **{'Content-Type': 'application/json'}))
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode('utf-8'))
        except Exception:
            j = {}
        return e.code, j
    except Exception as e:
        raise OcrError('連不上 %s 服務：%s' % (label, e), 502)


def ocr_gemini(cfg, media, b64):
    key = cfg.get('gemini_api_key') or ''
    if not key:
        raise OcrError('還沒設定 Gemini API 金鑰：請到「設定備份 → AI 辨識」貼上', 409)
    model = cfg['gemini_model']
    schema_txt = json.dumps({k: v.get('description', '') for k, v in OCR_ITEM['properties'].items()}, ensure_ascii=False)
    req = {
        'systemInstruction': {'parts': [{'text': OCR_PROMPT + '\n只回傳一個 JSON 物件：{"checks": [ … ]}，陣列裡每張支票一個物件，鍵與說明如下（amount 是數字，其餘字串）：' + schema_txt}]},
        'contents': [{'role': 'user', 'parts': [
            {'inlineData': {'mimeType': media, 'data': b64}},
            {'text': '請辨識這張支票，只回傳 JSON。'},
        ]}],
        'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0},
    }
    url = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent' % model
    code, out = _http_json(url, {'x-goog-api-key': key}, req, 'Gemini')
    if code != 200:
        msg = ((out.get('error') or {}).get('message') or '')
        if code in (400, 401, 403) and ('key' in msg.lower() or 'permission' in msg.lower() or code in (401, 403)):
            raise OcrError('Gemini 金鑰無效或沒有權限：' + msg, 502)
        if code == 404:
            raise OcrError('Gemini 找不到模型「%s」，請到設定改模型名稱：%s' % (model, msg), 502)
        if code == 429:
            raise OcrError('Gemini 免費額度用完或太頻繁，請稍後再試：' + msg, 502)
        raise OcrError('Gemini 回應 %d：%s' % (code, msg), 502)
    cands = out.get('candidates') or []
    if not cands:
        reason = ((out.get('promptFeedback') or {}).get('blockReason') or '')
        raise OcrError('Gemini 沒有回傳結果' + ('（%s）' % reason if reason else ''), 502)
    parts = (cands[0].get('content') or {}).get('parts') or []
    text = ''.join(p.get('text', '') for p in parts)
    fields = _parse_json_text(text)
    u = out.get('usageMetadata') or {}
    sys.stderr.write('ocr/check gemini %s in=%s out=%s\n' % (model, u.get('promptTokenCount'), u.get('candidatesTokenCount')))
    return fields


def _ocr_list(fields):
    """AI 回傳的東西整理成支票清單（舊格式單一物件也接受）"""
    if isinstance(fields, dict) and isinstance(fields.get('checks'), list):
        items = fields['checks']
    elif isinstance(fields, list):
        items = fields
    else:
        items = [fields]
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        if not any(it.get(k) for k in ('drawer', 'checkNo', 'amount', 'dueDate', 'bank')):
            continue
        out.append(it)
    return out


def ocr_check(data_dir, data_url):
    """data_url：瀏覽器送來的 data:image/jpeg;base64,... → 回傳支票清單 list[dict]"""
    return _ocr_list(_ocr_raw(data_dir, data_url))


def _ocr_raw(data_dir, data_url):
    mock = os.environ.get('ZR_OCR_MOCK')
    if mock:
        with open(mock, encoding='utf-8') as f:
            return json.load(f)
    m = re.match(r'^data:(image/(?:jpeg|png|webp|gif));base64,(.+)$', data_url, re.S)
    if not m:
        raise OcrError('沒有收到圖片')
    media, b64 = m.group(1), m.group(2).strip()
    if len(b64) > 12 * 1024 * 1024:
        raise OcrError('圖片太大，請縮小後再試')
    cfg = ai_cfg(data_dir)
    if cfg['provider'] == 'gemini':
        return ocr_gemini(cfg, media, b64)
    key = cfg.get('anthropic_api_key') or ''
    if not key:
        raise OcrError('還沒設定 Claude（Anthropic）API 金鑰：請到「設定備份 → AI 辨識」貼上', 409)
    req = {
        'model': AI_MODEL,
        'max_tokens': 8192,  # 含思考 token；太小會被截斷、拿不到 JSON
        'system': OCR_PROMPT,
        'output_config': {'effort': 'high', 'format': {'type': 'json_schema', 'schema': OCR_SCHEMA}},
        'fallbacks': 'default',
        'messages': [{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': media, 'data': b64}},
            {'type': 'text', 'text': '請辨識這張支票，依指定的 JSON 格式回傳。'},
        ]}],
    }
    out = None
    for attempt in (1, 2):
        data = json.dumps(req).encode('utf-8')
        r = urllib.request.Request('https://api.anthropic.com/v1/messages', data=data, method='POST', headers={
            'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21',
            'anthropic-beta': 'server-side-fallback-2026-07-01'})
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                out = json.loads(resp.read().decode('utf-8'))
            break
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode('utf-8')).get('error', {}).get('message') or ''
            except Exception:
                msg = ''
            # 伺服端 fallback 參數若不被接受（例如與結構化輸出衝突），拿掉再試一次
            if attempt == 1 and e.code == 400 and 'fallback' in msg.lower() and 'fallbacks' in req:
                del req['fallbacks']
                continue
            if e.code in (401, 403):
                raise OcrError('AI 金鑰無效或沒有權限：' + msg, 502)
            if e.code == 429:
                raise OcrError('AI 服務暫時忙碌（額度或速率限制），請稍後再試', 502)
            raise OcrError('AI 服務回應 %d：%s' % (e.code, msg), 502)
        except OcrError:
            raise
        except Exception as e:
            raise OcrError('連不上 AI 服務：%s' % e, 502)
    if out.get('stop_reason') == 'refusal':
        raise OcrError('AI 拒絕處理這張圖片，請確認是支票照片', 502)
    text = ''.join(b.get('text', '') for b in out.get('content', []) if b.get('type') == 'text')
    if out.get('stop_reason') == 'max_tokens' and not text.strip():
        raise OcrError('AI 這次沒有讀完（輸出被截斷），請再按一次拍照辨識', 502)
    fields = _parse_json_text(text)
    u = out.get('usage') or {}
    sys.stderr.write('ocr/check %s in=%s out=%s\n' % (out.get('model'), u.get('input_tokens'), u.get('output_tokens')))
    return fields


# ---------- 每日自動備份 ----------
def backup_settings(db):
    s = db.get('settings', 'backup') or {}
    return {'dir': s.get('dir') or os.path.join(os.path.dirname(db.path), 'backup'),
            'time': s.get('time') or '12:00', 'keep': int(s.get('keep') or 30), 'on': s.get('on', True)}


def run_backup(state, manual=False):
    db = state.db
    cfg = backup_settings(db)
    try:
        os.makedirs(cfg['dir'], exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M')
        tmp = os.path.join(cfg['dir'], f'zhirui_{stamp}.db')
        db.backup_to(tmp)
        zpath = os.path.join(cfg['dir'], f'志瑞平台備份_{stamp}.zip')
        with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(tmp, 'zhirui.db')
        os.remove(tmp)
        # 客戶圖面等附檔：同步到備份資料夾的 files 子資料夾（只複製新的，不刪舊的，避免每份 zip 都重複一大包）
        fdir = os.path.join(state.data_dir, 'files')
        if os.path.isdir(fdir):
            bdir = os.path.join(cfg['dir'], 'files')
            os.makedirs(bdir, exist_ok=True)
            for f in os.listdir(fdir):
                if not os.path.exists(os.path.join(bdir, f)):
                    shutil.copy2(os.path.join(fdir, f), os.path.join(bdir, f))
        # 只保留最近 N 份（只刪這種檔名）
        files = sorted(f for f in os.listdir(cfg['dir']) if f.startswith('志瑞平台備份_') and f.endswith('.zip'))
        for f in files[:-cfg['keep']] if cfg['keep'] > 0 else []:
            try:
                os.remove(os.path.join(cfg['dir'], f))
            except OSError:
                pass
        state.backup = {'last': int(time.time() * 1000), 'file': zpath, 'err': None}
        db.put('settings', 'backup_state', {'last': state.backup['last'], 'file': zpath, 'err': None})
        return True, '已備份到 ' + zpath
    except Exception as e:
        state.backup = {'last': state.backup.get('last'), 'file': state.backup.get('file'), 'err': str(e)}
        try:
            db.put('settings', 'backup_state', state.backup)
        except Exception:
            pass
        return False, '備份失敗：' + str(e)


def backup_loop(state):
    db = state.db
    while True:
        try:
            cfg = backup_settings(db)
            if cfg['on']:
                now = datetime.datetime.now()
                hh, mm = (cfg['time'].split(':') + ['0'])[:2]
                due = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
                last = (db.get('settings', 'backup_state') or {}).get('last') or 0
                last_dt = datetime.datetime.fromtimestamp(last / 1000) if last else None
                # 到了時間、今天還沒備份（或昨天錯過了）就備份
                if now >= due and (not last_dt or last_dt < due):
                    run_backup(state)
        except Exception:
            traceback.print_exc()
        time.sleep(60)


def main():
    ap = argparse.ArgumentParser(description='志瑞螺絲作業平台伺服器')
    ap.add_argument('--port', type=int, default=int(os.environ.get('ZR_PORT', 8080)))
    ap.add_argument('--host', default=os.environ.get('ZR_HOST', '0.0.0.0'))
    ap.add_argument('--data', default=os.environ.get('ZR_DATA', os.path.join(HERE, '..', 'data')))
    a = ap.parse_args()
    data_dir = os.path.abspath(a.data)
    os.makedirs(data_dir, exist_ok=True)
    db = DB(os.path.join(data_dir, 'zhirui.db'))
    state = State(db, data_dir)
    st = db.get('settings', 'backup_state')
    if st:
        state.backup = {'last': st.get('last'), 'file': st.get('file'), 'err': st.get('err')}
    Handler.state = state
    threading.Thread(target=backup_loop, args=(state,), daemon=True).start()
    # Windows 的 SO_REUSEADDR 會讓第二個伺服器也綁到同一個埠（兩個伺服器同時跑、資料不同步），所以不重用位址：埠被占用就直接失敗
    class Server(ThreadingHTTPServer):
        allow_reuse_address = False
    try:
        srv = Server((a.host, a.port), Handler)
    except OSError as e:
        print(f'埠 {a.port} 已經有伺服器在用（{e}）。已經有一個伺服器在執行，請不要再開第二個；要更新程式請用「設定備份 → 重新啟動伺服器」或 重啟伺服器.bat。')
        sys.exit(2)
    srv.daemon_threads = True
    print(f'志瑞螺絲作業平台伺服器啟動：http://localhost:{a.port}/  資料：{db.path}')
    if db.user_count() == 0:
        print('還沒有帳號：請用瀏覽器開啟上面網址，建立第一個帳號。')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
