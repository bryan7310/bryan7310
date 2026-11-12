"""志瑞列印小幫手：在伺服器電腦的桌面執行（登入後自動啟動），把手機版排好的列印工作印出來（例如中一刀出貨單印到 LQ-310）。

流程：每 3 秒問伺服器有沒有待列印 → 出貨單 HTML 用 Edge 轉 PDF → 每頁轉成黑白圖片 → 依紙張大小印到指定印表機 → 回報結果。
平台伺服器在背景（系統帳號）執行，不方便直接列印，所以跟傳真小幫手一樣由桌面上的這支程式負責。
傳真小幫手（fax_helper.py）完全不動，只借用它連線伺服器的設定（data/fax_helper.json 的 token）。
用法：pythonw server/print_helper.py（--once 只處理一張；--tofile <檔名> 測試：印到檔案、不出紙）
"""
import ctypes
import glob
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from ctypes import wintypes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fax_helper as fh   # noqa: E402  只用 call()（連伺服器）和 EDGE 路徑

LOG = os.path.join(fh.LOGDIR, 'print_helper.log')
TOFILE = fh._arg('--tofile')


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


def html_to_pngs(html, work, dpi=180):
    """HTML → PDF（Edge，依 @page 的紙張大小）→ 每頁一張黑白 PNG；回傳 [(檔名, 寬mm, 高mm)]"""
    hp = os.path.join(work, 'doc.html')
    pdf = os.path.join(work, 'doc.pdf')
    with open(hp, 'w', encoding='utf-8') as f:
        f.write(html)
    edge = next((e for e in fh.EDGE if os.path.exists(e)), None)
    if not edge:
        raise RuntimeError('找不到 Edge 瀏覽器，無法產生列印稿')
    uri = 'file:///' + hp.replace('\\', '/')
    subprocess.run([edge, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=3000',
                    '--user-data-dir=' + os.path.join(work, 'edge'), '--print-to-pdf=' + pdf, uri],
                   timeout=90, creationflags=0x08000000)
    t0 = time.time()   # Edge 可能先結束、PDF 晚一點才寫好
    while time.time() - t0 < 60 and not (os.path.exists(pdf) and os.path.getsize(pdf) > 0):
        time.sleep(0.5)
    time.sleep(0.5)
    if not os.path.exists(pdf):
        raise RuntimeError('列印稿轉 PDF 失敗')
    import pymupdf
    doc = pymupdf.open(pdf)
    out = []
    lut = bytes(0 if v < 160 else 255 for v in range(256))   # 轉純黑白：點陣印表機印起來比較清楚
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
        bw = pymupdf.Pixmap(pymupdf.csGRAY, pix.width, pix.height, bytes(pix.samples).translate(lut), False)
        fn = os.path.join(work, 'p%02d.png' % i)
        bw.save(fn)
        out.append((fn, page.rect.width / 72 * 25.4, page.rect.height / 72 * 25.4))
    doc.close()
    if not out:
        raise RuntimeError('列印稿是空的')
    return out


# 依 PDF 頁面大小設定紙張（印表機已有相近尺寸的紙張就用它，否則自訂），從紙張左上角開始印
PS_PRINT = r'''param([string]$Printer, [string]$List, [double]$Wmm, [double]$Hmm, [int]$Copies = 1, [string]$ToFile = '')
Add-Type -AssemblyName System.Drawing
$files = @(Get-Content -LiteralPath $List -Encoding UTF8 | Where-Object { $_ })
$pd = New-Object System.Drawing.Printing.PrintDocument
$pd.PrinterSettings.PrinterName = $Printer
if (-not $pd.PrinterSettings.IsValid) { Write-Output ('NO_PRINTER ' + $Printer); exit 2 }
if ($ToFile) { $pd.PrinterSettings.PrintToFile = $true; $pd.PrinterSettings.PrintFileName = $ToFile }
$pd.PrinterSettings.Copies = [int16][Math]::Max(1, $Copies)
$w = [int][Math]::Round($Wmm / 25.4 * 100); $h = [int][Math]::Round($Hmm / 25.4 * 100)
$paper = $null
foreach ($p in $pd.PrinterSettings.PaperSizes) { if ([Math]::Abs($p.Width - $w) -le 8 -and [Math]::Abs($p.Height - $h) -le 8) { $paper = $p; break } }
if (-not $paper) { $paper = New-Object System.Drawing.Printing.PaperSize('zhirui', $w, $h) }
$pd.DefaultPageSettings.PaperSize = $paper
$pd.DefaultPageSettings.Landscape = $false
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$pd.DocumentName = 'zhirui print'
$pd.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$script:i = 0
$pd.add_PrintPage({
  param($s, $e)
  $img = [System.Drawing.Image]::FromFile([string]$files[$script:i])
  $x = - $e.PageSettings.HardMarginX; $y = - $e.PageSettings.HardMarginY
  $e.Graphics.DrawImage($img, [single]$x, [single]$y, [single]$w, [single]$h)
  $img.Dispose()
  $script:i++
  $e.HasMorePages = ($script:i -lt $files.Count)
})
$pd.Print()
Write-Output ('PRINTED ' + $files.Count + ' paper=' + $paper.PaperName + ' ' + $paper.Width + 'x' + $paper.Height)
'''


class DOC_INFO_1(ctypes.Structure):
    _fields_ = [('pDocName', wintypes.LPWSTR), ('pOutputFile', wintypes.LPWSTR), ('pDatatype', wintypes.LPWSTR)]


def raw_print(printer, data, name='zhirui label'):
    """原始指令（例如標籤機的 TSPL）直接交給 Windows 列印佇列，不經過驅動程式排版"""
    ws = ctypes.WinDLL('winspool.drv', use_last_error=True)
    ws.OpenPrinterW.argtypes = [wintypes.LPWSTR, ctypes.POINTER(wintypes.HANDLE), ctypes.c_void_p]
    ws.StartDocPrinterW.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(DOC_INFO_1)]
    ws.WritePrinter.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    for f in ('StartPagePrinter', 'EndPagePrinter', 'EndDocPrinter', 'ClosePrinter'):
        getattr(ws, f).argtypes = [wintypes.HANDLE]
    h = wintypes.HANDLE()
    if not ws.OpenPrinterW(printer, ctypes.byref(h), None):
        raise RuntimeError('找不到印表機：' + printer)
    try:
        di = DOC_INFO_1(name, None, 'RAW')
        if not ws.StartDocPrinterW(h, 1, ctypes.byref(di)):
            raise RuntimeError('印表機不接受列印工作（錯誤 %d）' % ctypes.get_last_error())
        try:
            ws.StartPagePrinter(h)
            buf = ctypes.create_string_buffer(data, len(data))
            n = wintypes.DWORD(0)
            if not ws.WritePrinter(h, buf, len(data), ctypes.byref(n)) or n.value != len(data):
                raise RuntimeError('送資料到印表機失敗（只送出 %d / %d bytes）' % (n.value, len(data)))
            ws.EndPagePrinter(h)
        finally:
            ws.EndDocPrinter(h)
    finally:
        ws.ClosePrinter(h)


def print_job(job):
    printer = str(job.get('printer') or '').strip()
    if not printer:
        raise RuntimeError('沒有指定印表機')
    if job.get('raw'):   # 標籤機 TSPL 等原始指令：手機已經組好，直接送
        import base64
        data = base64.b64decode(job['raw'])
        if TOFILE:
            with open(TOFILE, 'wb') as f:
                f.write(data)
        else:
            raw_print(printer, data)
        return '已送出 %s（%s，%d bytes）%s' % (job.get('what') or '標籤', printer, len(data), '（測試：存到檔案）' if TOFILE else '')
    work = tempfile.mkdtemp(prefix='zrprint_')
    pages = html_to_pngs(job.get('html') or '', work)
    lst = os.path.join(work, 'pages.txt')
    with open(lst, 'w', encoding='utf-8-sig') as f:
        f.write('\n'.join(p[0] for p in pages))
    ps = os.path.join(work, 'print.ps1')
    with open(ps, 'w', encoding='utf-8-sig') as f:
        f.write(PS_PRINT)
    w, h = pages[0][1], pages[0][2]
    args = ['powershell', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Printer', printer, '-List', lst,
            '-Wmm', '%.2f' % w, '-Hmm', '%.2f' % h, '-Copies', str(max(1, int(job.get('copies') or 1)))]
    if TOFILE:
        args += ['-ToFile', TOFILE]
    r = subprocess.run(args, capture_output=True, timeout=180, creationflags=0x08000000)
    out = (r.stdout or b'').decode('utf-8', 'replace').strip()
    if r.returncode != 0 or 'PRINTED' not in out:
        err = (r.stderr or b'').decode('utf-8', 'replace').strip()
        raise RuntimeError(('找不到印表機：' + printer) if 'NO_PRINTER' in out else ('列印失敗：' + (out or err)[-200:]))
    return '已印出 %d 頁（%s，紙張 %.0f×%.0f mm）%s' % (len(pages), printer, w, h, '（測試：印到檔案）' if TOFILE else '')


def loop(once=False):
    log('列印小幫手啟動', 'pid', os.getpid(), 'tofile' if TOFILE else '')
    while True:
        try:
            r = fh.call('GET', '/api/print/helper/next')
            job = r.get('job')
            if job:
                log('job', job.get('id'), job.get('no'), job.get('printer'))
                try:
                    msg = print_job(job)
                    fh.call('POST', '/api/print/helper/report', {'id': job['id'], 'status': 'done', 'msg': msg})
                    log('done', msg)
                except Exception as e:
                    log('failed', e, traceback.format_exc()[-400:])
                    fh.call('POST', '/api/print/helper/report', {'id': job['id'], 'status': 'failed', 'msg': str(e)})
                if once:
                    return
                continue
        except Exception as e:
            log('poll error', e)
            time.sleep(7)
        finally:
            for d in glob.glob(os.path.join(tempfile.gettempdir(), 'zrprint_*')):   # 超過 1 小時的暫存檔清掉
                try:
                    if time.time() - os.path.getmtime(d) > 3600:
                        shutil.rmtree(d, ignore_errors=True)
                except Exception:
                    pass
        time.sleep(3)


if __name__ == '__main__':
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.CreateMutexW.restype = wintypes.HANDLE
    k.CreateMutexW(None, False, 'Local\\zhirui_print_helper' + ('_test' if TOFILE else ''))
    if ctypes.get_last_error() == 183:   # 同一時間只跑一個
        sys.exit(0)
    loop('--once' in sys.argv)
