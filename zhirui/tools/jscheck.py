"""改完 web/js 之後馬上跑：確認每一支 JS 都載得起來（語法錯誤、import 名稱打錯、匯出不存在）。
網頁檔一存檔正式站就生效，一行語法錯誤會讓整頁打不開，所以每次改完都要跑這支（約 15 秒）。

用法：python tools/jscheck.py
做法：複製一份資料庫啟動測試主機（8093，跟 e2e_test.py 一樣只讀正式資料），用 Edge 開電腦版和 App，
     再把 web/js 底下每一支檔案各 import 一次。有錯印出檔名和錯誤、結束碼 1。
"""
import sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_test as T
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8093


def main():
    files = sorted(str(p.relative_to(ROOT / 'web')).replace(os.sep, '/') for p in (ROOT / 'web' / 'js').rglob('*.js'))
    data = T.make_data(ROOT / 'data' / 'zhirui.db'); srv = T.start_server(data, PORT)
    base = f'http://127.0.0.1:{PORT}'; bad = []
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge')
            for name, url, ready in (('電腦版', '/#home', '#view, .head'), ('App', '/m/#home', '#view, nav')):
                ctx = br.new_context(); T.guard(ctx); pg = ctx.new_page(); errs = []
                pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
                pg.goto(base + '/'); pg.wait_for_timeout(300)
                pg.evaluate("async ([l, p]) => (await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({login:l, pw:p})})).status", [T.TEST_LOGIN, T.TEST_PW])
                pg.goto(base + url); pg.reload(); pg.wait_for_timeout(5000)
                txt = pg.inner_text('body')
                if errs or len(txt) < 200 or '載入中' in txt[:40] or '連線中' in txt[:40]:
                    bad.append((name + ' 整頁', '；'.join(errs) or '頁面沒有畫出來（卡在載入中）'))
                if name == '電腦版':   # 每一支各自 import 一次（含動態載入、沒被首頁用到的）
                    res = pg.evaluate(r"""async files => { const pre = (performance.getEntriesByType('resource').map(e => e.name).find(n => /\/v[0-9a-f]+\/js\//.test(n)) || '').match(/^.*\/v[0-9a-f]+\//)?.[0] || '/'; const out = []; for (const f of files) { try { await import(pre + f); } catch (e) { out.push([f, String(e && e.message || e)]); } } return out; }""", [f for f in files if f not in ('js/app.js', 'js/m/app.js')])
                    bad += [tuple(x) for x in res]
                ctx.close()
    finally:
        srv.terminate()
    if bad:
        print('JS 檢查失敗 %d 項：' % len(bad))
        for f, e in bad: print('  ✗ %s　%s' % (f, e))
        return 1
    print('JS 檢查通過：%d 支檔案都載得起來，電腦版和 App 首頁正常。' % len(files))
    return 0


if __name__ == '__main__':
    sys.exit(main())
