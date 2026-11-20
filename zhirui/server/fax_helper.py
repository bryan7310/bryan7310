"""志瑞傳真小幫手：在使用者的 Windows 桌面執行（登入後自動啟動），自動把平台排好的傳真送出。

流程：每 3 秒問伺服器有沒有待傳真 → 傳真稿 HTML 用 Edge 轉 PDF → 每頁轉成圖片 → 印到 Brother PC-FAX
→ 等 PC-FAX 視窗跳出 → 填傳真號碼、按「新增傳送位址」→ 確認清單只有這一個號碼 → 按「開始」→ 回報結果。

平台伺服器以系統帳號在背景執行，碰不到桌面上的視窗，所以要這支程式在使用者登入的桌面上幫忙按。
用法：pythonw server/fax_helper.py（--once 只處理一張就結束；--dry 演練：最後按取消、不送出）
"""
import ctypes
import glob
import json
import shutil
import os
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from ctypes import wintypes

HERE = os.path.dirname(os.path.abspath(__file__))
def _arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else default


DATA = _arg('--data', os.path.join(HERE, '..', 'data'))
SERVER = _arg('--server')
LOGDIR = os.path.join(os.environ.get('LOCALAPPDATA') or tempfile.gettempdir(), 'zhirui')
os.makedirs(LOGDIR, exist_ok=True)
LOG = os.path.join(LOGDIR, 'fax_helper.log')
EDGE = [r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', r'C:\Program Files\Microsoft\Edge\Application\msedge.exe']
TITLE = 'Brother  PC-FAX'          # PC-FAX 視窗標題（中間兩個空白）
ID_NUM, ID_ADD, ID_COUNT, ID_START, ID_CANCEL, ID_CLEAR = 3038, 1002, 1005, 3036, 3035, 3029


DRY = '--dry' in sys.argv


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


# ---------- 伺服器 ----------
def cfg():
    with open(os.path.join(DATA, 'fax_helper.json'), encoding='utf-8') as f:
        return json.load(f)


def call(method, path, body=None):
    c = cfg()
    url = (SERVER or c.get('server') or 'http://127.0.0.1:8080') + path + ('&' if '?' in path else '?') + 'token=' + c['token']
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


# ---------- Windows 視窗操作 ----------
u = ctypes.WinDLL('user32', use_last_error=True)
u.FindWindowW.restype = wintypes.HWND
u.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
u.GetDlgItem.restype = wintypes.HWND
u.GetDlgItem.argtypes = [wintypes.HWND, ctypes.c_int]
u.SendMessageW.restype = ctypes.c_ssize_t
u.SendMessageW.argtypes = [wintypes.HWND, ctypes.c_uint, ctypes.c_size_t, ctypes.c_void_p]
u.PostMessageW.argtypes = [wintypes.HWND, ctypes.c_uint, ctypes.c_size_t, ctypes.c_void_p]
u.IsWindowEnabled.argtypes = [wintypes.HWND]
u.IsWindowVisible.argtypes = [wintypes.HWND]
WM_SETTEXT, WM_GETTEXT, BM_CLICK = 0x000C, 0x000D, 0x00F5


def main_dialog():
    """PC-FAX 主視窗（有「開始」按鈕的那個；確認小視窗標題一樣，要分開）"""
    found = []
    CB = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def cb(h, _):
        cls = ctypes.create_unicode_buffer(64)
        t = ctypes.create_unicode_buffer(128)
        u.GetClassNameW(h, cls, 64)
        u.GetWindowTextW(h, t, 128)
        if cls.value == '#32770' and 'PC-FAX' in t.value and u.IsWindowVisible(h) and u.GetDlgItem(h, ID_START) and u.GetDlgItem(h, ID_NUM):
            found.append(h)
        return True
    u.EnumWindows(CB(cb), 0)
    return found[0] if found else None


def get_text(h, cid):
    b = ctypes.create_unicode_buffer(256)
    u.SendMessageW(u.GetDlgItem(h, cid), WM_GETTEXT, 256, ctypes.cast(b, ctypes.c_void_p))
    return b.value


def set_text(h, cid, s):
    b = ctypes.create_unicode_buffer(s)
    u.SendMessageW(u.GetDlgItem(h, cid), WM_SETTEXT, 0, ctypes.cast(b, ctypes.c_void_p))


def click(h, cid):
    u.PostMessageW(u.GetDlgItem(h, cid), BM_CLICK, 0, None)


# ---------- 傳真稿 → 圖片 → 印到 PC-FAX ----------
PS_PRINT = r'''param([string]$Printer, [string]$List)
Add-Type -AssemblyName System.Drawing
$files = @(Get-Content -LiteralPath $List -Encoding UTF8 | Where-Object { $_ })   # @( ) 一定要：只有一頁時才不會變成一段文字
$pd = New-Object System.Drawing.Printing.PrintDocument
if ($Printer) { $pd.PrinterSettings.PrinterName = $Printer }
if ($env:ZR_PRINT_TO_FILE) { $pd.PrinterSettings.PrintToFile = $true; $pd.PrinterSettings.PrintFileName = $env:ZR_PRINT_TO_FILE }   # 測試用：印到檔案
if (-not $pd.PrinterSettings.IsValid) {
  $p = Get-Printer | Where-Object { $_.Name -like '*PC-FAX*' } | Select-Object -First 1
  if (-not $p) { Write-Output 'NO_PRINTER'; exit 2 }
  $pd.PrinterSettings.PrinterName = $p.Name
}
$pd.DocumentName = 'zhirui fax'
$script:i = 0
$pd.add_PrintPage({
  param($s, $e)
  $img = [System.Drawing.Image]::FromFile([string]$files[$script:i])
  if (-not $img) { throw ('讀不到傳真稿圖片：' + $files[$script:i]) }
  $b = $e.PageBounds
  $e.Graphics.DrawImage($img, 0, 0, $b.Width, $b.Height)
  $img.Dispose()
  $script:i++
  $e.HasMorePages = ($script:i -lt $files.Count)
})
$pd.Print()
Write-Output ('PRINTED ' + $files.Count)
'''


# ---------- 安全：稿件 HTML 是平台使用者送來的，不能讓它讀到這台電腦的檔案或連到別的地方 ----------
# 做法（三層）：
# 1. 不用 file:// 開：稿件放在只聽 127.0.0.1 的臨時網頁伺服器，Edge 從 http 載入 → 網頁來源不是本機檔案，iframe／轉址／圖片都讀不到 C:\ 的檔案
# 2. 回應帶 Content-Security-Policy：只准行內樣式、data: 圖片與字型；傳真稿不准跑腳本、不准自動轉址（sandbox），列印稿（中一刀要用腳本排欄寬）只准行內腳本
# 3. Edge 加 --host-rules：除了 127.0.0.1 以外的主機一律解析不到（連不到內網、外網）
def _csp(allow_script):
    base = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"
    return base + ("; script-src 'unsafe-inline'; sandbox allow-scripts" if allow_script else '; sandbox')


def safe_html(html, allow_script):
    """多一層：把明顯不該有的標籤先拿掉（就算 CSP 沒生效也不會載入）"""
    import re
    html = str(html or '')
    html = re.sub(r'(?is)<\s*(iframe|frame|frameset|object|embed|applet|base|link)\b[^>]*>', '', html)
    html = re.sub(r'(?is)<\s*/\s*(iframe|frame|frameset|object|embed|applet)\s*>', '', html)
    html = re.sub(r'(?is)<\s*meta\b[^>]*http-equiv\s*=\s*["\']?\s*refresh[^>]*>', '', html)
    if not allow_script:
        html = re.sub(r'(?is)<\s*script\b.*?<\s*/\s*script\s*>', '', html)
        html = re.sub(r'(?is)<\s*script\b[^>]*>', '', html)
        html = re.sub(r'(?i)\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', '', html)
    return html


def edge_pdf(html, work, pdf, allow_script=False, extra=()):
    """稿件 HTML → PDF。回傳時 PDF 可能還沒寫完，呼叫端照舊等檔案出現"""
    import http.server
    import threading
    edge = next((e for e in EDGE if os.path.exists(e)), None)
    if not edge:
        raise RuntimeError('找不到 Edge 瀏覽器，無法產生列印稿')
    body = safe_html(html, allow_script).encode('utf-8')
    csp = _csp(allow_script)

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.split('?')[0] != '/doc.html':
                self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers(); return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Security-Policy', csp)
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        url = 'http://127.0.0.1:%d/doc.html' % srv.server_address[1]
        subprocess.run([edge, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', *extra,
                        '--host-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--no-first-run', '--disable-extensions',
                        '--user-data-dir=' + os.path.join(work, 'edge'), '--print-to-pdf=' + pdf, url],
                       timeout=90, creationflags=0x08000000)
    finally:
        srv.shutdown(); srv.server_close()


def html_to_pngs(html, work):
    pdf = os.path.join(work, 'fax.pdf')
    edge_pdf(html, work, pdf, allow_script=False)   # 傳真稿：不准腳本、不准讀本機檔案、不准連外
    t0 = time.time()   # Edge 可能先結束、PDF 晚一點才寫好
    while time.time() - t0 < 60 and not (os.path.exists(pdf) and os.path.getsize(pdf) > 0):
        time.sleep(0.5)
    time.sleep(0.5)
    if not os.path.exists(pdf):
        raise RuntimeError('傳真稿轉 PDF 失敗')
    import pymupdf
    doc = pymupdf.open(pdf)
    out = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=200, colorspace=pymupdf.csGRAY)
        fn = os.path.join(work, 'p%02d.png' % i)
        pix.save(fn)
        out.append(fn)
    doc.close()
    if not out:
        raise RuntimeError('傳真稿是空的')
    return out


def send_job(job):
    num = ''.join(ch for ch in str(job.get('dial') or job.get('to') or '') if ch.isdigit() or ch in '*#')
    if not num:
        raise RuntimeError('沒有傳真號碼')
    if main_dialog():
        raise RuntimeError('PC-FAX 視窗已經開著（可能有人正在手動傳真），這張先不送；請關掉視窗後重新排入')
    work = tempfile.mkdtemp(prefix='zrfax_')
    pngs = html_to_pngs(job.get('html') or '', work)
    lst = os.path.join(work, 'pages.txt')
    with open(lst, 'w', encoding='utf-8-sig') as f:
        f.write('\n'.join(pngs))
    ps = os.path.join(work, 'print.ps1')
    with open(ps, 'w', encoding='utf-8-sig') as f:
        f.write(PS_PRINT)
    proc = subprocess.Popen(['powershell', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ps,
                             '-Printer', job.get('printer') or 'Brother PC-FAX v.3.2', '-List', lst],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=0x08000000)
    h = None
    t0 = time.time()
    while time.time() - t0 < 90:
        h = main_dialog()
        if h or proc.poll() is not None:
            break
        time.sleep(0.5)
    if not h:
        out = proc.stdout.read().decode('utf-8', 'replace') if proc.poll() is not None else ''
        try:
            proc.kill()
        except Exception:
            pass
        raise RuntimeError('等不到 PC-FAX 視窗' + (('：' + out.strip()) if out.strip() else ''))
    time.sleep(1.0)
    if get_text(h, ID_COUNT) not in ('0/50', ''):
        click(h, ID_CANCEL)
        raise RuntimeError('PC-FAX 傳送清單裡已經有別的號碼（%s），為了安全沒有送出' % get_text(h, ID_COUNT))
    set_text(h, ID_NUM, num)
    time.sleep(0.4)
    if get_text(h, ID_NUM) != num:
        click(h, ID_CANCEL)
        raise RuntimeError('傳真號碼填不進去（填入 %s，讀回 %s）' % (num, get_text(h, ID_NUM)))
    click(h, ID_ADD)
    time.sleep(1.0)
    cnt = get_text(h, ID_COUNT)
    if cnt != '1/50':
        click(h, ID_CANCEL)
        raise RuntimeError('號碼沒有加到傳送清單（清單：%s），已取消' % cnt)
    if DRY:   # 演練：全部做完但按取消，不送出
        log('dry-run cancel', job.get('no'), num)
        click(h, ID_CANCEL)
        proc.communicate(timeout=60)
        return '演練完成（沒有送出）：號碼 %s 已填入清單，%d 頁' % (num, len(pngs))
    log('start', job.get('no'), num, 'pages', len(pngs))
    click(h, ID_START)
    try:
        out = proc.communicate(timeout=120)[0].decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        proc.kill()
        out = 'TIMEOUT'
    still = main_dialog()
    if still:
        raise RuntimeError('按了開始，但 PC-FAX 視窗還開著，請到電腦前確認')
    return '已交給 PC-FAX 送出（%d 頁，號碼 %s）%s' % (len(pngs), num, '' if 'PRINTED' in out else '；列印程式回應：' + out.strip()[:80])


def loop(once=False):
    log('傳真小幫手啟動', 'pid', os.getpid())
    while True:
        try:
            r = call('GET', '/api/fax/helper/next')
            job = r.get('job')
            if job:
                log('job', job.get('id'), job.get('no'), job.get('to'))
                try:
                    msg = send_job(job)
                    call('POST', '/api/fax/helper/report', {'id': job['id'], 'status': 'sent', 'msg': msg})
                    log('sent', msg)
                except Exception as e:
                    log('failed', e, traceback.format_exc()[-400:])
                    call('POST', '/api/fax/helper/report', {'id': job['id'], 'status': 'failed', 'msg': str(e)})
                if once:
                    return
        except Exception as e:
            log('poll error', e)
        finally:
            for d in glob.glob(os.path.join(tempfile.gettempdir(), 'zrfax_*')):   # 傳真暫存檔（超過 1 小時的）清掉
                try:
                    if time.time() - os.path.getmtime(d) > 3600:
                        shutil.rmtree(d, ignore_errors=True)
                except Exception:
                    pass
            time.sleep(10)
        time.sleep(3)


if __name__ == '__main__':
    # 同一時間只跑一個小幫手
    k = ctypes.WinDLL('kernel32')
    k.CreateMutexW.restype = wintypes.HANDLE
    k.CreateMutexW(None, False, 'Local\\zhirui_fax_helper')
    if ctypes.get_last_error() == 183 or k.GetLastError() == 183:   # ERROR_ALREADY_EXISTS
        sys.exit(0)
    loop('--once' in sys.argv)
