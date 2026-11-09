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
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import DB  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, '..', 'web'))

# 用戶端一開始就整批載入、之後即時同步的集合
LIVE_COLS = ['settings', 'contacts', 'goods', 'warehouses', 'accounts', 'bills',
             'pricing_cats', 'pricing', 'discounts', 'receivables', 'payables', 'invoices', 'purch_invoices',
             'checks_out', 'checks_in', 'orders', 'drawings', 'labels', 'mail', 'logs']
COOKIE = 'zr_session'
LONG_POLL = 25
# 附檔（客戶圖面）
FILE_TYPES = {'.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf'}
FILE_MAX = 25 * 1024 * 1024
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
        self.send_header('Cache-Control', 'public, max-age=3600' if cache else 'no-store')
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
        with open(fp, 'rb') as f:
            body = f.read()
        self.send_bytes(body, ctype, cache=not fp.endswith('.html'))

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
            return self.send_json({'rows': db.hist_prices(q('gid', ''), int(q('limit', 50)))})
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
        if path == '/api/backup' and method == 'POST':
            ok, msg = run_backup(self.state, manual=True)
            return self.send_json({'ok': ok, 'msg': msg, 'backup': self.state.backup})
        return self.error('not found', 404)

    # ---------- 附檔（客戶圖面）：存在 data/files，檔名是亂數＋副檔名 ----------
    def files_dir(self):
        d = os.path.join(self.state.data_dir, 'files')
        os.makedirs(d, exist_ok=True)
        return d

    def upload(self, qs):
        if not self.user():
            return self.error('請先登入', 401)
        n = int(self.headers.get('Content-Length') or 0)
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
                'hist': db.hist_count(), 'histVer': db.hist_stamp(), 'backup': self.state.backup, 'time': int(time.time() * 1000)}


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
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
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
