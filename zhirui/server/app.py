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
import hashlib
import subprocess
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
             'checks_out', 'checks_in', 'orders', 'drawings', 'labels', 'mail', 'logs', 'faxjobs', 'printjobs', 'drafts', 'uploads']
COOKIE = 'zr_session'
LONG_POLL = 25
# 附檔（客戶圖面）
FILE_TYPES = {'.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf'}
FILE_MAX = 25 * 1024 * 1024
# 接收傳真：瀏覽這個資料夾裡的傳真檔（PDF、圖檔；TIF 會轉成 PNG 給瀏覽器看）
FAXIN_DIR = os.environ.get('ZR_FAX_IN') or os.path.normpath(os.path.join(HERE, '..', 'fax'))
FAXIN_EXT = {'.pdf', '.tif', '.tiff', '.jpg', '.jpeg', '.png', '.gif', '.bmp'}
FAXIN_PS = r'''
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($env:ZR_SRC)
try {
  $n = 1
  if ($img.FrameDimensionsList.Count -gt 0) { $dim = New-Object System.Drawing.Imaging.FrameDimension($img.FrameDimensionsList[0]); $n = $img.GetFrameCount($dim) }
  for ($i = 0; $i -lt $n; $i++) { if ($n -gt 1) { $img.SelectActiveFrame($dim, $i) | Out-Null }; $img.Save(($env:ZR_OUT + '-' + $i + '.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  Write-Output $n
} finally { $img.Dispose() }
'''
START_AT = int(time.time() * 1000)
FILE_RE = re.compile(r'^/api/files/([0-9a-f]{16}\.(?:jpg|png|gif|webp|pdf))(/delete)?$')


FAX_HELPER = {}
PRINT_HELPER = {}
ASR = {'model': None}
ASR_LOCK = threading.Lock()
ASR_PROMPT = ('螺絲、螺帽、華司、彈簧華司、平華司、六角、十字、內六角、外六角、平頭、圓頭、大扁、喇叭頭、尖尾、鑽尾、鐵板牙、機械牙、'
              '全牙、半牙、馬車螺絲、法蘭螺帽、止付螺絲、牙條、拉釘、白鐵、鍍鋅、三價、錏黑、染黑、鍍鎳、二分、三分、四分、五分、吋、'
              '報價單、銷貨單、出貨單、採購單、進貨單、傳真。M6*20、M8*25、1/4*38、一萬支、五千個。')


def asr_transcribe(pcm):
    """16kHz 單聲道 16-bit PCM → 文字；第一次用到才載入模型（約 10 秒、1.6 GB 記憶體），同一時間只辨識一段"""
    model_dir = os.path.join(HERE, '..', 'models', 'breeze-asr-26')
    if not os.path.exists(os.path.join(model_dir, 'model.bin')):
        raise OcrError('伺服器還沒有語音辨識模型（models/breeze-asr-26）', 500)
    import types
    sys.modules.setdefault('av', types.ModuleType('av'))   # faster-whisper 只有讀音檔才用到 av；我們直接給 PCM
    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except Exception as e:
        raise OcrError('伺服器沒有安裝語音辨識元件（faster-whisper）：%s' % e, 500)
    with ASR_LOCK:
        if ASR['model'] is None:
            ASR['model'] = WhisperModel(model_dir, device='cpu', compute_type='int8', cpu_threads=max(2, (os.cpu_count() or 4)))
        a = np.frombuffer(pcm[:len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
        t = time.time()
        segs, _ = ASR['model'].transcribe(a, language='zh', beam_size=1, vad_filter=False,
                                          condition_on_previous_text=False, initial_prompt=ASR_PROMPT)
        text = ''.join(x.text for x in segs).strip()
        return text, time.time() - t


def fax_token(data_dir):
    """傳真小幫手用的 token：data/fax_helper.json，沒有就建立"""
    f = os.path.join(data_dir, 'fax_helper.json')
    try:
        with open(f, encoding='utf-8') as fh:
            t = (json.load(fh) or {}).get('token')
            if t:
                return t
    except Exception:
        pass
    t = secrets.token_urlsafe(24)
    with open(f, 'w', encoding='utf-8') as fh:
        json.dump({'token': t, 'server': 'http://127.0.0.1:8080'}, fh)
    return t


ZIP_CACHE = {}
ZIP_LOCK = threading.Lock()


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
            if u.path == '/api/pdf/parse':
                return self.pdf_parse()
            if u.path == '/api/asr':
                return self.asr()
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
        if os.path.isdir(fp) and fp.startswith(WEB) and os.path.isfile(os.path.join(fp, 'index.html')):
            if not path.endswith('/'):
                # /m → /m/，相對路徑才會對
                self.send_response(301)
                self.send_header('Location', path + '/')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            fp = os.path.join(fp, 'index.html')
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
            elif os.path.basename(fp) == 'index.html' and os.path.dirname(fp) == os.path.join(WEB, 'm'):
                v = web_version().encode()
                body = body.replace(b'href="/css/', b'href="/v' + v + b'/css/').replace(b'src="/js/', b'src="/v' + v + b'/js/')
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

    def kerry_api(self, method, path, body, me):
        """嘉里大榮：帳號設定（管理者）、測試登入、送出一筆託運"""
        import kerry as KR
        dd = self.state.data_dir
        admin = me.get('role', 'admin') == 'admin'
        try:
            if path == '/api/kerry/cfg' and method == 'GET':
                return self.send_json(KR.cfg_public(dd))
            if path == '/api/kerry/send' and method == 'POST':
                r = KR.send(dd, body.get('ship') or {}, bool(body.get('confirm')))
                sys.stderr.write('kerry send %s %s %s\n' % (me.get('name', ''), (body.get('ship') or {}).get('no', ''), json.dumps(r, ensure_ascii=False)[:200]))
                return self.send_json(r)
            if not admin:
                return self.error('只有管理者可以設定嘉里帳號', 403)
            if path == '/api/kerry/cfg' and method == 'POST':
                return self.send_json(KR.cfg_save(dd, body))
            if path == '/api/kerry/test' and method == 'POST':
                return self.send_json({'ok': True, 'msg': KR.test(dd, body)})
        except KR.KerryError as e:
            if path == '/api/kerry/test':
                return self.send_json({'ok': False, 'msg': str(e)})
            return self.error(str(e), e.status)
        except Exception as e:  # noqa: BLE001
            return self.error('連嘉里失敗：%s' % str(e)[:200], 502)
        return self.error('不支援', 404)

    def email_api(self, method, path, q, body, me):
        import zrmail as MB
        dd = self.state.data_dir
        admin = me.get('role', 'admin') == 'admin'
        if path == '/api/email/list':
            try:
                before = int(q('before', '0') or 0)
            except ValueError:
                before = 0
            return self.send_json(MB.listing2(dd, q('folder', 'inbox'), q('q', ''), 300, before))
        if path == '/api/email/msg':
            m = MB.message(dd, q('id', ''))
            return self.send_json(m) if m else self.error('找不到這封信', 404)
        if path == '/api/email/att':
            try:
                r = MB.attachment(dd, q('id', ''), int(q('n', '-1')))
            except ValueError:
                r = None
            if not r:
                return self.error('找不到附件', 404)
            a, data = r
            disp = 'attachment' if q('dl') else 'inline'
            return self.send_bytes(data, a.get('type') or 'application/octet-stream', cache='no-store',
                                   headers={'Content-Disposition': f"{disp}; filename*=UTF-8''{quote(a['name'])}"})
        if path == '/api/email/cfg' and method == 'GET':
            return self.send_json(MB.cfg_public(dd))
        ids = [str(x) for x in (body.get('ids') or [])][:500]
        if path == '/api/email/del' and method == 'POST':
            MB.set_deleted(dd, ids, bool(body.get('on', True)))
            return self.send_json({'ok': True})
        if path == '/api/email/purge' and method == 'POST':
            MB.purge(dd, ids)
            return self.send_json({'ok': True})
        if path in ('/api/email/draft', '/api/email/send') and method == 'POST':
            try:
                mid = MB.save_draft(dd, body) if path.endswith('draft') else MB.send(dd, body)
            except Exception as e:  # noqa: BLE001
                return self.error(str(e)[:300], 400)
            return self.send_json({'ok': True, 'id': mid})
        if not admin:
            return self.error('只有管理者可以設定收信', 403)
        if path == '/api/email/cfg' and method == 'POST':
            return self.send_json(MB.cfg_save(dd, body))
        if path == '/api/email/smtptest' and method == 'POST':
            try:
                return self.send_json({'ok': True, 'msg': MB.smtp_test(dd, body)})
            except Exception as e:  # noqa: BLE001
                return self.send_json({'ok': False, 'msg': '寄信伺服器連線失敗：%s' % str(e)[:300]})
        if path == '/api/email/test' and method == 'POST':
            try:
                return self.send_json({'ok': True, 'msg': MB.test(dd, body)})
            except Exception as e:  # noqa: BLE001
                return self.send_json({'ok': False, 'msg': '連線失敗：%s' % str(e)[:300]})
        if path == '/api/email/fetch' and method == 'POST':
            def run():
                try:
                    MB.fetch(dd)
                except Exception:
                    pass
            threading.Thread(target=run, daemon=True).start()
            return self.send_json({'ok': True})
        return self.error('不支援', 404)

    def faxin_path(self, name):
        """傳真資料夾裡的檔案完整路徑；不在資料夾裡（../ 之類）或副檔名不對就回傳 None"""
        if not name:
            return None
        base = os.path.realpath(FAXIN_DIR)
        fp = os.path.realpath(os.path.join(base, name.replace('/', os.sep)))
        if os.path.commonpath([base, fp]) != base or os.path.splitext(fp)[1].lower() not in FAXIN_EXT or not os.path.isfile(fp):
            return None
        return fp

    def faxin_tif(self, fp):
        return Handler.faxin_tif_static(self.state.data_dir, fp)

    @staticmethod
    def faxin_tif_static(data_dir, fp):
        """TIF／BMP 轉成 PNG（多頁一頁一張），存在 data/faxcache；回傳 (頁數, 檔名前綴)"""
        st = os.stat(fp)
        key = hashlib.sha1(f'{fp}|{st.st_mtime_ns}|{st.st_size}'.encode('utf-8')).hexdigest()[:20]
        cache = os.path.join(data_dir, 'faxcache'); os.makedirs(cache, exist_ok=True)
        out = os.path.join(cache, key); meta = out + '.json'
        if os.path.isfile(meta):
            with open(meta, encoding='utf-8') as f:
                return json.load(f)['pages'], out
        env = dict(os.environ, ZR_SRC=fp, ZR_OUT=out)
        r = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', FAXIN_PS],
                           capture_output=True, text=True, timeout=60, env=env, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            n = int((r.stdout or '').strip().splitlines()[-1])
        except (ValueError, IndexError):
            raise ValueError('TIF 轉檔失敗：' + ((r.stderr or r.stdout or '').strip()[:200] or '沒有輸出'))
        with open(meta, 'w', encoding='utf-8') as f:
            json.dump({'pages': n}, f)
        return n, out

    def faxin_api(self, path, q):
        if path == '/api/faxin/list':
            out = []
            if os.path.isdir(FAXIN_DIR):
                for root, dirs, files in os.walk(FAXIN_DIR):
                    dirs[:] = [d for d in dirs if not d.startswith('.')]
                    for fn in files:
                        ext = os.path.splitext(fn)[1].lower()
                        if ext not in FAXIN_EXT:
                            continue
                        fp = os.path.join(root, fn)
                        try:
                            st = os.stat(fp)
                        except OSError:
                            continue
                        rel = os.path.relpath(fp, FAXIN_DIR).replace(os.sep, '/')
                        out.append({'name': rel, 'size': st.st_size, 'mtime': int(st.st_mtime * 1000), 'ext': ext[1:]})
            out.sort(key=lambda x: -x['mtime'])
            idx, cfg = faxidx_load(self.state.data_dir)
            for x in out:
                r = idx.get(x['name'])
                if r and r.get('mtime') == x['mtime']:
                    x['idx'] = {k: r[k] for k in ('sender', 'recipient', 'doc_type', 'doc_no', 'date', 'fax_no', 'summary', 'err') if r.get(k)}
            done = sum(1 for x in out if x.get('idx') and not x['idx'].get('err'))
            return self.send_json({'dir': FAXIN_DIR, 'exists': os.path.isdir(FAXIN_DIR), 'files': out[:3000],
                                   'index': {'auto': bool(cfg.get('auto')), 'done': done, 'total': len(out), 'running': FAXIDX_STATE['running'],
                                             'current': FAXIDX_STATE['current'], 'err': FAXIDX_STATE['err'], 'model': FAXIDX_MODEL,
                                             'ai': bool(ai_cfg(self.state.data_dir).get('anthropic_api_key')) or bool(os.environ.get('ZR_FAXIDX_MOCK'))}})
        if path == '/api/faxin/index':   # 打開／關閉自動辨識（只有老闆帳號可以改）
            if (self.user() or {}).get('role', 'admin') != 'admin':
                return self.error('只有管理者可以設定', 403)
            idx, cfg = faxidx_load(self.state.data_dir)
            cfg['auto'] = q('auto') == '1'
            faxidx_save(self.state.data_dir, cfg=cfg)
            return self.send_json({'ok': True, 'auto': cfg['auto']})
        fp = self.faxin_path(q('name', ''))
        if not fp:
            return self.error('找不到這個傳真檔', 404)
        ext = os.path.splitext(fp)[1].lower()
        conv = ext in ('.tif', '.tiff', '.bmp')
        if path == '/api/faxin/info':
            try:
                n = self.faxin_tif(fp)[0] if conv else 1
            except Exception as e:  # noqa: BLE001
                return self.error(str(e), 500)
            return self.send_json({'pages': n, 'conv': conv})
        if path == '/api/faxin/file':
            if q('dl'):
                with open(fp, 'rb') as f:
                    data = f.read()
                return self.send_bytes(data, mimetypes.guess_type(fp)[0] or 'application/octet-stream', cache='no-store',
                                       headers={'Content-Disposition': f"attachment; filename*=UTF-8''{quote(os.path.basename(fp))}"})
            if conv:
                try:
                    n, pre = self.faxin_tif(fp)
                except Exception as e:  # noqa: BLE001
                    return self.error(str(e), 500)
                pg = min(max(int(q('page', '0') or 0), 0), n - 1)
                with open(f'{pre}-{pg}.png', 'rb') as f:
                    data = f.read()
                return self.send_bytes(data, 'image/png', cache='no-store')
            with open(fp, 'rb') as f:
                data = f.read()
            ctype = {'.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif'}.get(ext, 'application/octet-stream')
            return self.send_bytes(data, ctype, cache='no-store', headers={'Content-Disposition': f"inline; filename*=UTF-8''{quote(os.path.basename(fp))}"})
        return self.error('不支援', 404)

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

        if path.startswith('/api/fax/helper/'):
            return self.fax_helper_api(method, path, qs, body or {})
        if path.startswith('/api/print/helper/'):
            return self.print_helper_api(method, path, qs, body or {})

        me = self.user()
        if not me:
            return self.error('請先登入', 401)

        if path == '/api/zip33' and method == 'GET':
            return self.zip33(q('addr', ''))
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
        if path.startswith('/api/users') and method == 'POST' and me.get('role') != 'admin':
            return self.error('只有老闆帳號可以新增或修改帳號', 403)
        if path == '/api/users' and method == 'POST':
            b = body or {}
            if not b.get('login') or not b.get('pw') or len(b['pw']) < 4:
                return self.error('請填帳號與至少 4 碼的密碼')
            if any(u['login'] == b['login'].strip().lower() for u in db.users()):
                return self.error('這個帳號已經存在')
            uid = db.add_user(b.get('name') or b['login'], b['login'], b['pw'], 'admin' if b.get('role') == 'admin' else 'staff')
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
            role = b.get('role') if b.get('role') in ('admin', 'staff') else None
            if (b.get('disabled') or role == 'staff') and not any(u['role'] == 'admin' and not u['disabled'] and u['id'] != uid for u in db.users()):
                return self.error('至少要保留一個可用的老闆帳號')
            db.update_user(uid, b.get('name'), b.get('login'), b.get('disabled'), role)
            return self.send_json({'ok': True, 'users': db.users()})
        if path.startswith('/api/faxin/'):
            return self.faxin_api(path, q)
        if path.startswith('/api/email/'):
            return self.email_api(method, path, q, body or {}, me)
        if path.startswith('/api/kerry/'):
            return self.kerry_api(method, path, body or {}, me)
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
        if path == '/api/ai/usage' and method == 'GET':
            try:
                return self.send_json(ai_usage(self.state.data_dir, q('from', ''), q('to', '')))
            except OcrError as e:
                return self.error(str(e), e.status)
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
        if path == '/api/goods/merge' and method == 'POST':
            b = body or {}
            if me.get('role', 'admin') != 'admin':
                return self.error('只有管理者可以合併商品', 403)
            groups = b.get('groups') if isinstance(b.get('groups'), list) else [b]
            try:
                r = db.merge_goods([{'keep': str(g.get('keep') or ''), 'merge': [str(x) for x in (g.get('merge') or [])]} for g in groups if isinstance(g, dict)], me['id'])
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
        if path == '/api/print/helper' and method == 'GET':
            seen = PRINT_HELPER.get('seen') or 0
            return self.send_json({'online': time.time() - seen < 30, 'seen': seen, 'busy': PRINT_HELPER.get('busy') or ''})
        if path == '/api/fax/helper' and method == 'GET':
            seen = FAX_HELPER.get('seen') or 0
            return self.send_json({'online': time.time() - seen < 30, 'seen': seen, 'busy': FAX_HELPER.get('busy') or ''})
        if path == '/api/agent' and method == 'POST':
            try:
                return self.send_json(agent_step(self.state.data_dir, body or {}, me))
            except OcrError as e:
                return self.error(str(e), e.status)
        if path == '/api/ocr/doc' and method == 'POST':
            try:
                return self.send_json(doc_extract(self.state.data_dir, body or {}))
            except OcrError as e:
                return self.error(str(e), e.status)
        if path == '/api/ocr/order' and method == 'POST':
            try:
                return self.send_json(order_extract(self.state.data_dir, body or {}, self.faxin_path))
            except OcrError as e:
                return self.error(str(e), e.status)
        if path == '/api/ocr/po' and method == 'POST':
            try:
                return self.send_json(po_extract(self.state.data_dir, body or {}))
            except OcrError as e:
                return self.error(str(e), e.status)
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

    def zip33(self, addr):
        """地址 → 3+3 郵遞區號（向中華郵政「全國標準郵遞地址服務平臺」查；查過的存在 data/zip33_cache.json）"""
        import ssl
        addr = re.sub(r'\s+', '', str(addr or ''))
        addr = re.sub(r'^\d{3,6}', '', addr)   # 地址前面已經有的郵遞區號先拿掉
        if not addr:
            return self.error('沒有地址')
        cf = os.path.join(self.state.data_dir, 'zip33_cache.json')
        with ZIP_LOCK:
            if not ZIP_CACHE and os.path.exists(cf):
                try:
                    ZIP_CACHE.update(json.load(open(cf, encoding='utf-8')))
                except Exception:
                    pass
            hit = ZIP_CACHE.get(addr)
        if hit:
            return self.send_json({'ok': True, 'cached': True, **hit})
        body = json.dumps({'Address': addr, 'AddressResultType': ['1', '2', '3'], 'StandardAddressType': '1'}).encode('utf-8')
        req = urllib.request.Request('https://nsda.post.gov.tw/StandardAddress_Public_Api/Api/AddressTrans/GetOneAddress', data=body, headers={'Content-Type': 'application/json', 'User-Agent': 'ZhiruiServer/1.0'})
        ctx = ssl.create_default_context()
        ctx.verify_flags &= ~getattr(ssl, 'VERIFY_X509_STRICT', 0)   # 臺灣 TWCA 根憑證較舊，新版 Python 的嚴格檢查會擋，仍照常驗證憑證鏈
        try:
            with urllib.request.urlopen(req, timeout=15, context=ctx) as f:
                r = json.loads(f.read().decode('utf-8'))
        except Exception as e:
            return self.error('郵局查詢服務連不上：%s' % e, 502)
        d = (r or {}).get('data') or {}
        z = str(d.get('zipCode') or '')
        if not r.get('isSuccess') or not re.fullmatch(r'\d{6}', z):
            return self.send_json({'ok': False, 'error': d.get('errMesg') or (r or {}).get('message') or '郵局查不到這個地址'})
        out = {'zip': z, 'city': d.get('transAddress2') or '', 'street': d.get('transAddress3') or '', 'addr': addr}
        with ZIP_LOCK:
            ZIP_CACHE[addr] = out
            try:
                tmp = cf + '.tmp'
                json.dump(ZIP_CACHE, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False)
                os.replace(tmp, cf)
            except Exception:
                pass
        return self.send_json({'ok': True, **out})

    def asr(self):
        """語音 → 文字（Breeze-ASR-26，華語／台語，輸出華語漢字）；body 是 16kHz 單聲道 16-bit PCM"""
        n = int(self.headers.get('Content-Length') or 0)
        if not self.user():
            if 0 < n <= FILE_MAX:
                self.rfile.read(n)
            else:
                self.close_connection = True
            return self.error('請先登入', 401)
        if n <= 0:
            return self.error('沒有收到聲音')
        if n > 16000 * 2 * 120:
            self.rfile.read(n)
            return self.error('錄音太長（上限 2 分鐘）')
        pcm = self.rfile.read(n)
        try:
            text, secs = asr_transcribe(pcm)
        except OcrError as e:
            return self.error(str(e), e.status)
        sys.stderr.write('asr %.1fs audio -> %.1fs: %s\n' % (len(pcm) / 32000, secs, text[:60]))
        return self.send_json({'ok': True, 'text': text, 'secs': round(secs, 1)})

    def fax_helper_api(self, method, path, qs, body):
        """傳真小幫手（在使用者桌面執行）：/next 取下一張待傳真、/report 回報結果；用 data/fax_helper.json 的 token 驗證"""
        tok = (qs.get('token') or [''])[0] or body.get('token') or ''
        if not tok or tok != fax_token(self.state.data_dir):
            return self.error('token 不對', 403)
        db = self.state.db
        FAX_HELPER['seen'] = time.time()
        if path == '/api/fax/helper/next' and method == 'GET':
            FAX_HELPER['busy'] = ''
            jobs = [j for j in db.list('faxjobs') if j.get('status') == 'queued']
            if not jobs:
                return self.send_json({'job': None})
            j = sorted(jobs, key=lambda x: x.get('at') or '')[0]
            d = {k: v for k, v in j.items() if k != 'id'}
            d['status'] = 'sending'
            d['startAt'] = datetime.datetime.now().isoformat(timespec='seconds')
            db.put('faxjobs', j['id'], d)
            FAX_HELPER['busy'] = j.get('no') or j['id']
            return self.send_json({'job': j})
        if path == '/api/fax/helper/report' and method == 'POST':
            jid = str(body.get('id') or '')
            j = db.get('faxjobs', jid)
            if not j:
                return self.error('找不到這個傳真工作', 404)
            st = body.get('status') if body.get('status') in ('sent', 'failed') else 'failed'
            d = {k: v for k, v in j.items() if k != 'id'}
            d.update(status=st, msg=str(body.get('msg') or '')[:300], doneAt=datetime.datetime.now().isoformat(timespec='seconds'), html='')
            db.put('faxjobs', jid, d)
            FAX_HELPER['busy'] = ''
            sys.stderr.write('fax %s %s %s %s\n' % (j.get('no'), j.get('to'), st, d['msg']))
            return self.send_json({'ok': True})
        return self.error('not found', 404)

    def print_helper_api(self, method, path, qs, body):
        """列印小幫手（在伺服器電腦的桌面執行）：/next 取下一張待列印、/report 回報結果；token 和傳真小幫手同一個"""
        tok = (qs.get('token') or [''])[0] or body.get('token') or ''
        if not tok or tok != fax_token(self.state.data_dir):
            return self.error('token 不對', 403)
        db = self.state.db
        PRINT_HELPER['seen'] = time.time()
        if path == '/api/print/helper/next' and method == 'GET':
            PRINT_HELPER['busy'] = ''
            jobs = [j for j in db.list('printjobs') if j.get('status') == 'queued']
            if not jobs:
                return self.send_json({'job': None})
            j = sorted(jobs, key=lambda x: x.get('at') or '')[0]
            d = {k: v for k, v in j.items() if k != 'id'}
            d['status'] = 'printing'
            d['startAt'] = datetime.datetime.now().isoformat(timespec='seconds')
            db.put('printjobs', j['id'], d)
            PRINT_HELPER['busy'] = j.get('no') or j['id']
            return self.send_json({'job': j})
        if path == '/api/print/helper/report' and method == 'POST':
            jid = str(body.get('id') or '')
            j = db.get('printjobs', jid)
            if not j:
                return self.error('找不到這個列印工作', 404)
            st = body.get('status') if body.get('status') in ('done', 'failed') else 'failed'
            d = {k: v for k, v in j.items() if k != 'id'}
            d.update(status=st, msg=str(body.get('msg') or '')[:300], doneAt=datetime.datetime.now().isoformat(timespec='seconds'), html='')
            db.put('printjobs', jid, d)
            PRINT_HELPER['busy'] = ''
            sys.stderr.write('print %s %s %s\n' % (j.get('no'), st, d['msg']))
            return self.send_json({'ok': True})
        return self.error('not found', 404)

    def pdf_parse(self):
        """讀 PDF（內容直接放在 body）→ 每頁的文字與表格（給匯入客戶 ERP 出貨單用；需要 pymupdf）"""
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
        data = self.rfile.read(n)
        try:
            import pymupdf
        except Exception:
            return self.error('伺服器沒有安裝 PDF 讀取元件（pymupdf），請在伺服器電腦執行：pip install pymupdf')
        try:
            doc = pymupdf.open(stream=data, filetype='pdf')
            pages = []
            for p in doc:
                tables = []
                try:
                    for t in p.find_tables().tables:
                        tables.append([[c if c is not None else '' for c in row] for row in t.extract()])
                except Exception:
                    pass
                images = []
                for im in p.get_images(full=True)[:10]:
                    try:
                        info = doc.extract_image(im[0])
                        if len(info['image']) > 200000:
                            continue
                        rects = p.get_image_rects(im[0])
                        r = rects[0] if rects else None
                        images.append({'ext': info['ext'], 'w': info['width'], 'h': info['height'], 'rect': [r.x0, r.y0, r.x1, r.y1] if r else None,
                                       'data': base64.b64encode(info['image']).decode('ascii')})
                    except Exception:
                        pass
                pages.append({'text': p.get_text(), 'tables': tables, 'images': images, 'size': [p.rect.width, p.rect.height]})
        except Exception as e:
            return self.error('PDF 讀取失敗：%s' % e)
        return self.send_json({'ok': True, 'pages': pages})

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


# ---------- AI 費用紀錄：每次呼叫 AI 記一行到 data/ai_usage.jsonl（設定 → AI 費用 可以查） ----------
AI_LOG_DIR = None
AI_LOG_LOCK = threading.Lock()
# 每百萬 token 美元：(輸入, 輸出, 快取讀取, 快取寫入)。依 Anthropic 公告價格；Gemini 用免費額度，不計費
AI_PRICES = [('claude-haiku-5-5', (0.10, 0.50, 0.01, 0.125)), ('claude-opus-5-5', (4.0, 20.0, 0.20, 5.0)),
             ('claude-fable-5-2', (8.0, 40.0, 0.20, 10.0))]


def ai_log(feature, model, inp=0, out=0, cache_r=0, cache_w=0, user='', note=''):
    """feature：faxidx 傳真索引、order 訂單轉單、po 採購單、pur／quote／order-doc 拍照單據、check 支票、agent AI 助理"""
    try:
        model = str(model or '')
        usd = None
        if model.startswith('gemini'):
            usd = 0.0
        else:
            for pre, (pi, po, pr, pw) in AI_PRICES:
                if model.startswith(pre):
                    usd = round(((inp or 0) * pi + (out or 0) * po + (cache_r or 0) * pr + (cache_w or 0) * pw) / 1e6, 6)
                    break
        row = {'t': int(time.time() * 1000), 'f': feature, 'm': model, 'in': int(inp or 0), 'out': int(out or 0),
               'cr': int(cache_r or 0), 'cw': int(cache_w or 0), 'usd': usd, 'u': user or '', 'n': note or ''}
        if not AI_LOG_DIR:
            return
        with AI_LOG_LOCK:
            with open(os.path.join(AI_LOG_DIR, 'ai_usage.jsonl'), 'a', encoding='utf-8') as f:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')
    except Exception:   # 記帳失敗不影響辨識
        pass


def ai_usage(data_dir, frm='', to=''):
    """frm／to：YYYY-MM-DD（含）；回傳區間內每一筆（新的在前）"""
    fp = os.path.join(data_dir, 'ai_usage.jsonl')
    rows = []
    try:
        lo = int(time.mktime(time.strptime(frm, '%Y-%m-%d')) * 1000) if frm else 0
        hi = int((time.mktime(time.strptime(to, '%Y-%m-%d')) + 86400) * 1000) if to else 1 << 62
    except ValueError:
        raise OcrError('日期格式不對')
    if os.path.isfile(fp):
        with open(fp, encoding='utf-8') as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                if lo <= r.get('t', 0) < hi:
                    rows.append(r)
    rows.sort(key=lambda r: -r.get('t', 0))
    return {'rows': rows, 'prices': {k: v for k, v in AI_PRICES}}


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
    ai_log('check', model, u.get('promptTokenCount'), u.get('candidatesTokenCount'))
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
    ai_log('check', out.get('model'), u.get('input_tokens'), u.get('output_tokens'), u.get('cache_read_input_tokens'), u.get('cache_creation_input_tokens'))
    return fields


# ---------- AI 助理：瀏覽器跑工具（查資料、擬單據），伺服器只負責呼叫 Claude（金鑰不出伺服器） ----------
AGENT_PROMPT = """你是「志瑞螺絲企業有限公司」智能ERP（作業平台）裡的 AI 助理。志瑞是台中的螺絲、螺帽、五金零件貿易商，平台管理商品、客戶與供應商、報價單、銷貨單（出貨單）、採購單、進貨單、庫存、應收應付帳款、支票。使用的人是公司同事，對產業很熟。

回答原則：
- 一律用繁體中文回答，口氣簡潔、像同事之間說話；數字用千分位，金額單位是新台幣元。
- 平台資料一定先用工具查，不要憑印象回答；查不到就直說查不到，並說明查了什麼。
- 料號（code）是公司內部料號；「客料號」是客戶那邊的料號；「規格」欄有時放客戶料號。同一個品名可能有多個料號（鍍鋅、三價、白鐵不同），有疑問時列出候選請使用者確認。
- 應收、應付的「月份」以每月 25 日結帳：當月 26 日以後的單據算到下個月。
- 舊系統搬來的歷史單據（hist）是唯讀的；平台上新開的單據才能修改。
- 回答盡量短，列表或表格只放需要的欄位。

開單（代開單據）：
- 使用者要開報價單、銷貨單、採購單、進貨單時，先用工具確認客戶／供應商和每個商品的 id；不確定是哪一個就先問，不要猜。
- 單價沒有指定時：銷貨／報價用該客戶上次單價（工具會帶），採購／進貨用上次進價；都沒有就留空，並提醒使用者。
- 用 draft_bill 建草稿。草稿只會顯示在畫面上，要使用者按「開啟草稿」檢查後自己存檔；你不能直接存檔，也不要說已經存檔。
- 不要刪除或修改任何既有資料；被要求時說明需要使用者自己在平台上操作。

語音輸入：
- 使用者可能用語音（國語或台語）下指令，文字是語音辨識轉出來的，常有同音錯字，例如「螺拳／羅斯」＝螺絲、「滑絲／華詩」＝華司、「螺母／螺絲母」＝螺帽、「一萬隻」＝一萬支。依螺絲業常識和平台資料判斷，真的不確定再問。
- 台語、業界常用說法：二分＝1/4 吋、三分＝3/8 吋、四分＝1/2 吋、五分＝5/8 吋、六分＝3/4 吋、一分＝1/8 吋；「一吋半」＝1-1/2 吋；「M6 乘 20」＝M6*20；白鐵＝不鏽鋼；錏黑＝黑色鍍鋅；三價＝三價鍍鋅；鑽尾＝鑽尾螺絲；鐵板牙＝自攻牙；牙條＝全牙螺桿；「一千支」可能說「一千枝／一千粒」。
- 回答會被唸出來，所以結論放第一句，數字講清楚。

文件辨識（使用者傳照片或 PDF）：
- 先判斷是什麼文件。志瑞的統編是 25095094、地址台中市大里區現岱路88號。
- 統一發票（廠商開給志瑞的進項發票，買方是志瑞）→ purchase_invoice_draft：日期、發票號碼（2 個英文字＋8 碼數字）、賣方名稱與統編、銷售額（未稅）、稅額。買方不是志瑞或是志瑞開出去的發票，要提醒使用者。
- 廠商出貨單／送貨單 → 先用 find_contacts 找供應商，每一行用 find_goods 以廠商料號、規格或品名找商品（多個候選時選最像的，並在回答列出），再用 draft_bill 擬 PUR 進貨單：日期用單據日期、單價照單據；系統裡沒有的商品省略 goods_id、填 name。
- 支票（客戶開給志瑞的客票）→ checks_in_draft：民國年要換成西元，金額以國字大寫為準。
- 印地址標籤（例如「幫我印澤發的地址標籤」）→ 先 find_contacts，再 address_label。
- 看不清楚的欄位要說出來，不要猜；所有辨識結果都只出確認卡，使用者確認後才會存。

傳真：
- 使用者要傳真報價單、採購單、詢價單給客戶或廠商時，用 fax_bill。它只會顯示確認卡，使用者按「確認傳真」才會由傳真小幫手自動送出；不要說已經傳出去了。

使用者訊息開頭會附上今天日期。"""


def agent_step(data_dir, body, me):
    """一步對話：messages、tools 由瀏覽器送來（工具在瀏覽器執行），回傳 Claude 的回應內容"""
    messages = body.get('messages')
    tools = body.get('tools') or []
    if not isinstance(messages, list) or not messages:
        raise OcrError('沒有對話內容')
    if not isinstance(tools, list) or len(tools) > 40 or any(not isinstance(t, dict) or 'input_schema' not in t for t in tools):
        raise OcrError('工具定義不正確')
    key = ai_cfg(data_dir).get('anthropic_api_key') or ''
    if not key:
        raise OcrError('還沒設定 Claude（Anthropic）API 金鑰：請到「設定備份 → AI 辨識」選 Claude 並貼上金鑰', 409)
    try:
        import anthropic
    except Exception:
        raise OcrError('伺服器沒有安裝 Claude 元件，請在伺服器電腦執行：python -m pip install anthropic', 500)
    client = anthropic.Anthropic(api_key=key, timeout=300.0, max_retries=2)
    try:
        resp = client.beta.messages.create(
            model=AI_MODEL,
            max_tokens=16000,
            system=AGENT_PROMPT,
            tools=tools,
            messages=messages,
            output_config={'effort': 'medium'},
            cache_control={'type': 'ephemeral'},
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
        )
    except anthropic.AuthenticationError:
        raise OcrError('Claude 金鑰無效，請到「設定備份 → AI 辨識」重新設定', 502)
    except anthropic.PermissionDeniedError as e:
        raise OcrError('Claude 金鑰沒有權限：%s' % e.message, 502)
    except anthropic.RateLimitError:
        raise OcrError('Claude 暫時忙碌（額度或速率限制），請稍後再試', 502)
    except anthropic.BadRequestError as e:
        raise OcrError('Claude 不接受這次的內容：%s' % e.message, 502)
    except anthropic.APIStatusError as e:
        raise OcrError('Claude 服務回應 %d：%s' % (e.status_code, e.message), 502)
    except anthropic.APIConnectionError:
        raise OcrError('連不上 Claude 服務，請確認伺服器電腦有網路', 502)
    out = resp.to_dict()
    u = out.get('usage') or {}
    sys.stderr.write('agent %s %s stop=%s in=%s cache_r=%s cache_w=%s out=%s\n' % (
        (me or {}).get('name', ''), out.get('model'), out.get('stop_reason'), u.get('input_tokens'),
        u.get('cache_read_input_tokens'), u.get('cache_creation_input_tokens'), u.get('output_tokens')))
    ai_log('agent', out.get('model'), u.get('input_tokens'), u.get('output_tokens'), u.get('cache_read_input_tokens'), u.get('cache_creation_input_tokens'), (me or {}).get('name', ''))
    return {'content': out.get('content') or [], 'stop_reason': out.get('stop_reason'),
            'stop_details': out.get('stop_details'), 'usage': u, 'model': out.get('model')}


# ---------- 客戶採購單辨識（如陽採購憑單等）：PDF 或照片 → 採購單號、明細 ----------
PO_PROMPT = """你在讀台灣螺絲業客戶開給「志瑞螺絲企業有限公司」的採購單（例如如陽科技的「採購憑單」）。
- 產品編號是客戶的料號（例如 GC-05010-01-00），照抄，不要改。
- 被劃線刪除（有橫線劃過整行）的明細行代表取消，cancelled 填 true；其他填 false。
- 數量、單價、金額只填數字（去掉千分位）；單位照抄（PCS、KG…）。
- 日期一律轉成 YYYY-MM-DD（民國年要轉西元）；沒有就填空字串。
- 預進貨日填在 due；分錄備註填 note；圖號填 drawing（例如 DFGH0001_免驗）。
- 看不清楚的欄位填空字串，不要猜；doubts 寫下哪裡看不清楚。"""
PO_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['po_no', 'po_date', 'buyer', 'vendor', 'remark', 'doubts', 'lines'],
    'properties': {
        'po_no': {'type': 'string'}, 'po_date': {'type': 'string'}, 'buyer': {'type': 'string'},
        'vendor': {'type': 'string'}, 'remark': {'type': 'string'}, 'doubts': {'type': 'string'},
        'lines': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['part_no', 'name', 'qty', 'unit', 'price', 'amount', 'due', 'note', 'drawing', 'cancelled'],
            'properties': {
                'part_no': {'type': 'string'}, 'name': {'type': 'string'}, 'qty': {'type': 'number'},
                'unit': {'type': 'string'}, 'price': {'type': 'number'}, 'amount': {'type': 'number'},
                'due': {'type': 'string'}, 'note': {'type': 'string'}, 'drawing': {'type': 'string'},
                'cancelled': {'type': 'boolean'}}}}}}


FAXIDX_MODEL = 'claude-haiku-5-5'
FAXIDX_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['sender', 'recipient', 'doc_type', 'doc_no', 'date', 'fax_no', 'summary'],
    'properties': {k: {'type': 'string'} for k in ('sender', 'recipient', 'doc_type', 'doc_no', 'date', 'fax_no', 'summary')}}
FAXIDX_PROMPT = """你在讀台灣螺絲公司「志瑞螺絲企業有限公司」收到的傳真（通常是客戶的採購單、廠商的報價單、出貨單、對帳單）。只要回傳 JSON：
- sender：發出這張傳真的公司名稱（照抄全名；是志瑞自己發的就填志瑞）
- recipient：收件公司名稱（通常是志瑞）
- doc_type：採購單／訂單／報價單／詢價單／出貨單／對帳單／請款單／匯款通知／其他，選一個
- doc_no：單號（採購單號、報價單號…），沒有填空字串
- date：單據日期 YYYY-MM-DD（民國年轉西元），沒有填空字串
- fax_no：傳真頁首或寄件公司的傳真號碼，沒有填空字串
- summary：20 字以內的重點（例如品名、規格或用途）
看不清楚的欄位填空字串，不要猜。"""


def faxidx_paths(data_dir):
    return os.path.join(data_dir, 'faxindex.json'), os.path.join(data_dir, 'faxindex_cfg.json')


def faxidx_load(data_dir):
    fi, fc = faxidx_paths(data_dir)
    def rd(fp, d):
        try:
            with open(fp, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return d
    return rd(fi, {}), rd(fc, {'auto': False})


def faxidx_save(data_dir, idx=None, cfg=None):
    fi, fc = faxidx_paths(data_dir)
    for fp, obj in ((fi, idx), (fc, cfg)):
        if obj is None:
            continue
        tmp = fp + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False)
        os.replace(tmp, fp)


def faxidx_read_one(data_dir, fp):
    """讀一張傳真：PDF 直接給 Claude；JPG／PNG 給圖；TIF／BMP 轉第一頁 PNG。回傳欄位 dict"""
    mock = os.environ.get('ZR_FAXIDX_MOCK')
    if mock:   # 測試用：不呼叫 Claude
        nm = os.path.basename(fp)
        with open(mock, encoding='utf-8') as f:
            m = json.load(f)
        return dict(m.get(nm) or m.get('*') or {})
    key = ai_cfg(data_dir).get('anthropic_api_key') or ''
    if not key:
        raise OcrError('還沒設定 Claude（Anthropic）API 金鑰', 409)
    import anthropic
    ext = os.path.splitext(fp)[1].lower()
    if ext in ('.tif', '.tiff', '.bmp'):
        n, pre = Handler.faxin_tif_static(data_dir, fp)
        fp, ext = f'{pre}-0.png', '.png'
    with open(fp, 'rb') as f:
        data = base64.b64encode(f.read()).decode('ascii')
    media = {'.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif'}[ext]
    blk = ({'type': 'document', 'source': {'type': 'base64', 'media_type': media, 'data': data}} if media == 'application/pdf'
           else {'type': 'image', 'source': {'type': 'base64', 'media_type': media, 'data': data}})
    client = anthropic.Anthropic(api_key=key, timeout=120.0, max_retries=2)
    resp = client.messages.create(model=FAXIDX_MODEL, max_tokens=1500, system=FAXIDX_PROMPT, thinking={'type': 'disabled'},
                                  output_config={'effort': 'low', 'format': {'type': 'json_schema', 'schema': FAXIDX_SCHEMA}},
                                  messages=[{'role': 'user', 'content': [blk, {'type': 'text', 'text': '請讀這張傳真，依指定的 JSON 格式回傳。'}]}])
    text = ''.join(b.text for b in resp.content if b.type == 'text')
    u = resp.usage
    sys.stderr.write('faxidx %s in=%s out=%s\n' % (resp.model, u.input_tokens, u.output_tokens))
    ai_log('faxidx', resp.model, u.input_tokens, u.output_tokens, getattr(u, 'cache_read_input_tokens', 0), getattr(u, 'cache_creation_input_tokens', 0), note=os.path.basename(fp))
    return _parse_json_text(text)


FAXIDX_STATE = {'running': False, 'err': '', 'current': ''}

# ---------- 訂單辨識：傳真、Email 附件或信件內文 → 客戶、單號、明細（用 Haiku，結果存起來，同一份不重複花錢） ----------
ORDER_MODEL = FAXIDX_MODEL
ORDER_PROMPT = """你在讀台灣螺絲公司「志瑞螺絲企業有限公司」收到的客戶訂單（採購單、訂購單、詢價單；可能是傳真、PDF、照片或 Email 內文）。只要回傳 JSON：
- buyer：下單（或詢價）的公司名稱，照抄全名；buyer_fax：對方傳真或電話號碼；contact：聯絡人
- doc_type：採購單／訂單／詢價單／其他；po_no：對方的單號；po_date：單據日期 YYYY-MM-DD（民國年轉西元）
- lines：每一個品項一行
  - part_no：客戶自己的料號／產品編號（照抄，不要改），沒有填空字串
  - name：品名規格照抄（例如「十字盤頭螺絲 M4*10 白鐵」「六角螺帽 3/8"」）
  - material：材質（白鐵、鐵、SUS304…），沒有填空字串；finish：表面處理（鍍鋅、鍍鎳、染黑…），沒有填空字串
  - qty：數量（數字，去掉千分位）；unit：單位照抄（PCS、支、K、KG…）；price：單價（沒寫填 0）
  - due：交期 YYYY-MM-DD，沒有填空字串；note：這一行的備註
  - cancelled：被劃線刪除或寫「取消」的行填 true
- remark：整張單的備註（交貨地點、包裝要求…）
- doubts：看不清楚或不確定的地方寫在這裡；看不清楚的欄位填空字串或 0，不要猜
志瑞自己是賣方，不是 buyer。"""
_S = {'type': 'string'}
ORDER_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['buyer', 'buyer_fax', 'contact', 'doc_type', 'po_no', 'po_date', 'remark', 'doubts', 'lines'],
    'properties': {
        'buyer': _S, 'buyer_fax': _S, 'contact': _S, 'doc_type': _S, 'po_no': _S, 'po_date': _S, 'remark': _S, 'doubts': _S,
        'lines': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['part_no', 'name', 'material', 'finish', 'qty', 'unit', 'price', 'due', 'note', 'cancelled'],
            'properties': {'part_no': _S, 'name': _S, 'material': _S, 'finish': _S, 'qty': {'type': 'number'}, 'unit': _S,
                           'price': {'type': 'number'}, 'due': _S, 'note': _S, 'cancelled': {'type': 'boolean'}}}}}}
ORDER_LOCK = threading.Lock()


def _order_cache(data_dir, key, val=None):
    fp = os.path.join(data_dir, 'orderocr.json')
    with ORDER_LOCK:
        try:
            with open(fp, encoding='utf-8') as f:
                c = json.load(f)
        except Exception:
            c = {}
        if val is None:
            return c.get(key)
        c[key] = val
        if len(c) > 2000:
            for k in sorted(c, key=lambda k: c[k].get('_at', 0))[:len(c) - 2000]:
                c.pop(k, None)
        tmp = fp + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(c, f, ensure_ascii=False)
        os.replace(tmp, fp)


def order_extract(data_dir, body, fax_path):
    """body：{fax: 檔名} 或 {mail: 信件 id, n: 附件編號}（n 省略＝讀信件內文）；again＝重新辨識（會再花一次錢）"""
    import zrmail as MB
    blocks = []
    MEDIA = {'.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp'}

    def add_file(fp, ext, data=None):
        ext = (ext or '').lower()
        if ext in ('.tif', '.tiff', '.bmp'):
            if fp is None:
                raise OcrError('TIF 附件請先存成 PDF 或 JPG 再辨識')
            n, pre = Handler.faxin_tif_static(data_dir, fp)
            for i in range(min(n, 4)):
                with open(f'{pre}-{i}.png', 'rb') as f:
                    blocks.append({'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(f.read()).decode('ascii')}})
            return
        media = MEDIA.get(ext)
        if not media:
            raise OcrError('這種檔案不能辨識（只能 PDF、JPG、PNG、TIF）')
        if data is None:
            with open(fp, 'rb') as f:
                data = f.read()
        if len(data) > 20 * 1024 * 1024:
            raise OcrError('檔案太大')
        b64 = base64.b64encode(data).decode('ascii')
        blocks.append({'type': 'document', 'source': {'type': 'base64', 'media_type': media, 'data': b64}} if media == 'application/pdf'
                      else {'type': 'image', 'source': {'type': 'base64', 'media_type': media, 'data': b64}})

    if body.get('fax'):
        fp = fax_path(str(body['fax']))
        if not fp:
            raise OcrError('找不到這個傳真檔', 404)
        key = 'fax:%s:%d' % (body['fax'], int(os.stat(fp).st_mtime))
        hit = None if body.get('again') else _order_cache(data_dir, key)
        if hit:
            return {**hit, 'cached': True}
        add_file(fp, os.path.splitext(fp)[1])
    elif body.get('mail'):
        mid = str(body['mail'])
        m = MB.message(data_dir, mid)
        if not m:
            raise OcrError('找不到這封信', 404)
        n = body.get('n')
        whole = n is None or n == ''
        key = 'mail:%s:%s' % (mid, 'body' if whole else int(n))
        hit = None if body.get('again') else _order_cache(data_dir, key)
        if hit:
            return {**hit, 'cached': True}
        if whole:
            txt = (m.get('text') or re.sub(r'<[^>]+>', ' ', m.get('html') or '')).strip()
            if not txt:
                raise OcrError('這封信沒有文字內容')
            blocks.append({'type': 'text', 'text': '寄件人：%s <%s>\n主旨：%s\n\n%s' % (m.get('from_name', ''), m.get('from', ''), m.get('subject', ''), txt[:20000])})
        else:
            r = MB.attachment(data_dir, mid, int(n))
            if not r:
                raise OcrError('找不到附件', 404)
            a, data = r
            add_file(None, os.path.splitext(a.get('name') or '')[1] or mimetypes.guess_extension(a.get('type') or '') or '', data)
            blocks.append({'type': 'text', 'text': '（這是 Email 附件。信件寄件人：%s <%s>，主旨：%s）' % (m.get('from_name', ''), m.get('from', ''), m.get('subject', ''))})
    else:
        raise OcrError('沒有指定要辨識的傳真或信件')
    mock = os.environ.get('ZR_ORDER_MOCK')
    if mock:   # 測試用：不呼叫 Claude
        with open(mock, encoding='utf-8') as f:
            out = json.load(f)
        ai_log('order', ORDER_MODEL, 1800, 400, note='測試 ' + key)
    else:
        akey = ai_cfg(data_dir).get('anthropic_api_key') or ''
        if not akey:
            raise OcrError('還沒設定 Claude（Anthropic）API 金鑰：請到「設定備份 → AI 辨識」貼上金鑰', 409)
        try:
            import anthropic
        except Exception:
            raise OcrError('伺服器沒有安裝 Claude 元件，請在伺服器電腦執行：python -m pip install anthropic', 500)
        client = anthropic.Anthropic(api_key=akey, timeout=180.0, max_retries=2)
        try:
            resp = client.messages.create(model=ORDER_MODEL, max_tokens=8000, system=ORDER_PROMPT, thinking={'type': 'disabled'},
                                          output_config={'effort': 'medium', 'format': {'type': 'json_schema', 'schema': ORDER_SCHEMA}},
                                          messages=[{'role': 'user', 'content': blocks + [{'type': 'text', 'text': '請讀這份客戶訂單，依指定的 JSON 格式回傳。'}]}])
        except anthropic.AuthenticationError:
            raise OcrError('Claude 金鑰無效，請到「設定備份 → AI 辨識」重新設定', 502)
        except anthropic.RateLimitError:
            raise OcrError('Claude 暫時忙碌，請稍後再試', 502)
        except anthropic.BadRequestError as e:
            raise OcrError('Claude 不接受這個檔案：%s' % e.message, 502)
        except anthropic.APIStatusError as e:
            raise OcrError('Claude 服務回應 %d：%s' % (e.status_code, e.message), 502)
        except anthropic.APIConnectionError:
            raise OcrError('連不上 Claude 服務，請確認伺服器電腦有網路', 502)
        if resp.stop_reason == 'refusal':
            raise OcrError('Claude 拒絕處理這個檔案', 502)
        if resp.stop_reason == 'max_tokens':
            raise OcrError('明細太多，這次沒有讀完，請再試一次', 502)
        text = ''.join(b.text for b in resp.content if b.type == 'text')
        u = resp.usage
        sys.stderr.write('order %s in=%s out=%s\n' % (resp.model, u.input_tokens, u.output_tokens))
        ai_log('order', resp.model, u.input_tokens, u.output_tokens, getattr(u, 'cache_read_input_tokens', 0), getattr(u, 'cache_creation_input_tokens', 0), note=key)
        out = _parse_json_text(text)
        if isinstance(out, dict):
            out['_usd'] = round((u.input_tokens * 0.10 + u.output_tokens * 0.50) / 1e6, 5)   # Haiku 5.5 價格
    if not isinstance(out, dict) or not isinstance(out.get('lines'), list):
        raise OcrError('沒有讀到訂單明細', 502)
    out['_at'] = int(time.time())
    _order_cache(data_dir, key, out)
    return out


def faxidx_loop(state):
    """每分鐘看一次傳真資料夾；有開「自動辨識」就一張一張讀還沒讀過的（或檔案改過的）"""
    while True:
        try:
            idx, cfg = faxidx_load(state.data_dir)
            if cfg.get('auto') and os.path.isdir(FAXIN_DIR):
                todo = []
                for root, dirs, files in os.walk(FAXIN_DIR):
                    dirs[:] = [d for d in dirs if not d.startswith('.')]
                    for fn in files:
                        if os.path.splitext(fn)[1].lower() not in FAXIN_EXT:
                            continue
                        fp = os.path.join(root, fn); rel = os.path.relpath(fp, FAXIN_DIR).replace(os.sep, '/')
                        mt = int(os.path.getmtime(fp) * 1000)
                        x = idx.get(rel)
                        if not x or x.get('mtime') != mt or (x.get('err') and x.get('tries', 0) < 3 and time.time() - x.get('at', 0) / 1000 > 3600):
                            todo.append((mt, rel, fp))
                todo.sort(reverse=True)   # 新的先讀
                for mt, rel, fp in todo:
                    if not faxidx_load(state.data_dir)[1].get('auto'):
                        break
                    FAXIDX_STATE.update(running=True, current=rel)
                    old = idx.get(rel) or {}
                    try:
                        r = faxidx_read_one(state.data_dir, fp)
                        idx[rel] = {**{k: str(r.get(k) or '').strip() for k in FAXIDX_SCHEMA['properties']}, 'mtime': mt, 'at': int(time.time() * 1000)}
                        FAXIDX_STATE['err'] = ''
                    except Exception as e:  # noqa: BLE001
                        msg = getattr(e, 'message', None) or str(e)
                        idx[rel] = {'mtime': mt, 'err': msg[:200], 'tries': old.get('tries', 0) + 1 if old.get('mtime') == mt else 1, 'at': int(time.time() * 1000)}
                        FAXIDX_STATE['err'] = msg[:200]
                        if 'API 金鑰' in msg or 'authentication' in msg.lower() or 'credit' in msg.lower():
                            faxidx_save(state.data_dir, idx)
                            break
                    faxidx_save(state.data_dir, idx)
                    time.sleep(1.5)
            FAXIDX_STATE.update(running=False, current='')
        except Exception as e:  # noqa: BLE001
            FAXIDX_STATE.update(running=False, current='', err=str(e)[:200])
        time.sleep(60)


def po_extract(data_dir, body, system=None, schema=None, ask='請讀這張採購單，依指定的 JSON 格式回傳。', tag='po'):
    """body：data（base64）、media（application/pdf、image/jpeg…）；system／schema 沒給就是讀客戶採購單"""
    data = str(body.get('data') or '')
    media = str(body.get('media') or '')
    if not data or media not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'):
        raise OcrError('請給 PDF 或照片')
    if len(data) > 30 * 1024 * 1024:
        raise OcrError('檔案太大')
    key = ai_cfg(data_dir).get('anthropic_api_key') or ''
    if not key:
        raise OcrError('還沒設定 Claude（Anthropic）API 金鑰：請到「設定備份 → AI 辨識」選 Claude 並貼上金鑰', 409)
    try:
        import anthropic
    except Exception:
        raise OcrError('伺服器沒有安裝 Claude 元件，請在伺服器電腦執行：python -m pip install anthropic', 500)
    blk = ({'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': data}} if media == 'application/pdf'
           else {'type': 'image', 'source': {'type': 'base64', 'media_type': media, 'data': data}})
    req = dict(model=AI_MODEL, max_tokens=16000, system=system or PO_PROMPT,
               output_config={'effort': 'medium', 'format': {'type': 'json_schema', 'schema': schema or PO_SCHEMA}},
               messages=[{'role': 'user', 'content': [blk, {'type': 'text', 'text': ask}]}])
    client = anthropic.Anthropic(api_key=key, timeout=300.0, max_retries=2)
    resp = None
    for attempt in (1, 2):
        try:
            if attempt == 1:
                resp = client.beta.messages.create(betas=['server-side-fallback-2026-07-01'], fallbacks='default', **req)
            else:
                resp = client.messages.create(**req)
            break
        except anthropic.BadRequestError as e:
            if attempt == 1 and 'fallback' in (e.message or '').lower():
                continue   # 伺服端 fallback 和結構化輸出不相容時，拿掉再試一次
            raise OcrError('Claude 不接受這個檔案：%s' % e.message, 502)
        except anthropic.AuthenticationError:
            raise OcrError('Claude 金鑰無效，請到「設定備份 → AI 辨識」重新設定', 502)
        except anthropic.RateLimitError:
            raise OcrError('Claude 暫時忙碌（額度或速率限制），請稍後再試', 502)
        except anthropic.APIStatusError as e:
            raise OcrError('Claude 服務回應 %d：%s' % (e.status_code, e.message), 502)
        except anthropic.APIConnectionError:
            raise OcrError('連不上 Claude 服務，請確認伺服器電腦有網路', 502)
    if resp.stop_reason == 'refusal':
        raise OcrError('Claude 拒絕處理這個檔案', 502)
    text = ''.join(b.text for b in resp.content if b.type == 'text')
    if resp.stop_reason == 'max_tokens' and not text.strip():
        raise OcrError('這次沒有讀完（輸出被截斷），請再試一次', 502)
    out = _parse_json_text(text)
    u = resp.usage
    sys.stderr.write('ocr/%s %s in=%s out=%s lines=%d\n' % (tag, resp.model, u.input_tokens, u.output_tokens, len(out.get('lines') or [])))
    ai_log('order-doc' if tag == 'order' else tag, resp.model, u.input_tokens, u.output_tokens, getattr(u, 'cache_read_input_tokens', 0), getattr(u, 'cache_creation_input_tokens', 0))
    return out


# ---------- 手機拍照上傳：廠商進貨單、廠商報價、客戶手寫訂單 → 單頭與明細 ----------
DOC_COMMON = """
- 品名、規格照抄，不要改寫；料號（產品代號、廠商料號、客料號）照抄到 code，沒有就填空字串。
- 數量、單價、金額只填數字（去掉千分位）；單位照抄（PCS、支、H、KG、千支…），沒寫填空字串；看不到單價填 0。
- 有「折數」欄的，price 照抄單價欄（原價），折數填在 disc（例如 80 表示 8 折、75 表示 75 折、8.5 表示 85 折）；沒有折數欄 disc 填 0。
- 日期一律轉成 YYYY-MM-DD（民國年要轉西元）；沒有就填空字串。
- 被劃線刪除的明細不要列。看不清楚的欄位填空字串或 0，不要猜；doubts 寫下哪裡看不清楚。"""
DOC_PROMPTS = {
    'pur': '你在讀台灣螺絲業廠商開給「志瑞螺絲企業有限公司」的出貨單／送貨單（志瑞是買方、收貨方）。party 填出貨的廠商公司名稱（不是志瑞），doc_no 填廠商的出貨單號。' + DOC_COMMON,
    'quote': '你在讀台灣螺絲業廠商給「志瑞螺絲企業有限公司」的報價單。party 填報價的廠商公司名稱（不是志瑞），doc_no 填報價單號，price 填報價單價；沒寫數量填 0。' + DOC_COMMON,
    'order': '你在讀客戶給「志瑞螺絲企業有限公司」的訂單，可能是手寫、傳真或照片。party 填下訂單的客戶名稱（不是志瑞），doc_no 填客戶的訂單號或採購單號；手寫的字盡量辨識，不確定的寫在 doubts。' + DOC_COMMON,
}
DOC_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['party', 'doc_no', 'date', 'doubts', 'lines'],
    'properties': {
        'party': {'type': 'string'}, 'doc_no': {'type': 'string'}, 'date': {'type': 'string'}, 'doubts': {'type': 'string'},
        'lines': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['code', 'name', 'spec', 'qty', 'unit', 'price', 'disc', 'amount'],
            'properties': {
                'code': {'type': 'string'}, 'name': {'type': 'string'}, 'spec': {'type': 'string'}, 'qty': {'type': 'number'},
                'unit': {'type': 'string'}, 'price': {'type': 'number'}, 'disc': {'type': 'number'}, 'amount': {'type': 'number'}}}}}}


def doc_extract(data_dir, body):
    """body：kind（pur 進貨單、quote 廠商報價、order 客戶訂單）、data（base64）、media"""
    kind = str(body.get('kind') or '')
    if kind not in DOC_PROMPTS:
        raise OcrError('不認識的單據類型')
    if os.environ.get('ZR_DOC_MOCK'):   # 測試用：回傳固定的辨識結果（json 檔，依 kind 分）
        with open(os.environ['ZR_DOC_MOCK'], encoding='utf-8') as f:
            return json.load(f).get(kind) or {'party': '', 'doc_no': '', 'date': '', 'doubts': '', 'lines': []}
    return po_extract(data_dir, body, system=DOC_PROMPTS[kind], schema=DOC_SCHEMA, ask='請讀這張單據，依指定的 JSON 格式回傳。', tag=kind)


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
    global AI_LOG_DIR
    AI_LOG_DIR = data_dir   # AI 費用紀錄寫在 data/ai_usage.jsonl
    try:
        fax_token(data_dir)   # 傳真小幫手要讀的 token 檔，先建好
    except Exception:
        pass
    st = db.get('settings', 'backup_state')
    if st:
        state.backup = {'last': st.get('last'), 'file': st.get('file'), 'err': st.get('err')}
    Handler.state = state
    threading.Thread(target=backup_loop, args=(state,), daemon=True).start()
    threading.Thread(target=faxidx_loop, args=(state,), daemon=True).start()
    import zrmail as _mb
    threading.Thread(target=_mb.loop, args=(data_dir,), daemon=True).start()
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
