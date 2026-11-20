import json
"""志瑞 ERP 全站自動測試（Playwright ＋ 電腦上的 Edge）

做什麼：
  1. 把正式資料庫「唯讀」複製一份到暫存資料夾（不帶 AI 金鑰、信箱、嘉里帳號等設定），加一個測試帳號。
  2. 用那份複本在 127.0.0.1:8091 啟動測試主機（傳真、辨識都用模擬模式），正式主機完全不碰。
  3. 用 Edge 打開電腦版每個頁面 → 每個分頁 → 「新增／開單」視窗；再用手機尺寸打開 App 每個頁面。
     每一步檢查：有沒有 JavaScript 錯誤、頁面有沒有內容、API 有沒有回錯誤。
  4. 核心流程：在複本上開一張銷貨單、進貨單，確認庫存與應收應付有跟著變，再刪掉。
  5. 產生報告 test_reports/e2e_<時間>.html（失敗的步驟附截圖），跑完刪掉暫存資料。

安全：只連 127.0.0.1；外部網址一律擋掉；列印視窗、寄信、傳真、AI、嘉里送單這類按鈕不按。

用法（在 C:\\zhirui 底下）：
  python tools/e2e_test.py              # 全部測
  python tools/e2e_test.py --only sales,stock --headed   # 只測某些頁面、看得到瀏覽器
"""
import argparse, datetime, hashlib, html, json, os, secrets, shutil, socket, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
TEST_LOGIN, TEST_PW = 'e2e', 'e2e-' + secrets.token_hex(4)
# 不按的按鈕（會寄出、送單、花錢、刪資料、重新啟動、登出…）
DANGER = ('寄', '送出', '傳真', '發送', '刪除', '作廢', '重新啟動', '還原', '登出', '辨識', 'AI', '嘉里', '列印', '印', '匯出', '下載', '備份', '合併', '確認寫入', '儲存', '上傳', '拍照', '掃描', '關閉')
NEW_BTN = ('新增', '開單', '新單', '建立')

# ---------- 測試資料與測試主機 ----------
def make_data(src_db: Path) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix='zr_e2e_'))
    src = sqlite3.connect(f'file:{src_db.as_posix()}?mode=ro', uri=True)
    dst = sqlite3.connect(tmp / 'zhirui.db')
    src.backup(dst); src.close()
    salt = secrets.token_hex(16)
    hsh = hashlib.pbkdf2_hmac('sha256', TEST_PW.encode(), bytes.fromhex(salt), 120000).hex()
    dst.execute('DELETE FROM users WHERE login=?', (TEST_LOGIN,))
    dst.execute('INSERT INTO users(id,name,login,salt,hash,role,created) VALUES(?,?,?,?,?,?,?)',
                ('u_e2e', '自動測試', TEST_LOGIN, salt, hsh, 'admin', int(time.time() * 1000)))
    # 測試主機絕對不能往正式的備份資料夾寫：複本裡的備份設定改成關閉、資料夾指到暫存資料夾裡
    ver = (dst.execute('SELECT max(ver) FROM docs').fetchone()[0] or 0) + 1
    now = int(time.time() * 1000)
    dst.execute("INSERT OR REPLACE INTO docs(col,id,data,ver,ts,deleted) VALUES('settings','backup',?,?,?,0)",
                (json.dumps({'dir': str(tmp / 'backup'), 'time': '23:59', 'keep': 30, 'on': False}), ver, now))
    dst.execute("INSERT OR REPLACE INTO docs(col,id,data,ver,ts,deleted) VALUES('settings','backup_state',?,?,?,0)",
                (json.dumps({'last': now, 'file': '', 'err': None}), ver + 1, now))
    dst.commit(); dst.close()
    (tmp / 'mailbox').mkdir(); (tmp / 'files').mkdir()
    return tmp

def start_server(data: Path, port: int):
    env = dict(os.environ)
    mock = data / 'mock.json'; mock.write_text('{}', encoding='utf-8')
    for k in ('ZR_OCR_MOCK', 'ZR_DOC_MOCK', 'ZR_ORDER_MOCK'): env[k] = str(mock)
    env['ZR_FAX_IN'] = str(data / 'faxin'); (data / 'faxin').mkdir(exist_ok=True)
    log = open(data / 'server.log', 'w', encoding='utf-8')
    p = subprocess.Popen([PY, str(ROOT / 'server' / 'app.py'), '--port', str(port), '--host', '127.0.0.1', '--data', str(data)],
                         cwd=str(ROOT), env=env, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(120):
        try:
            socket.create_connection(('127.0.0.1', port), 0.5).close(); return p
        except OSError:
            if p.poll() is not None: raise RuntimeError('測試主機啟動失敗，請看 ' + str(data / 'server.log'))
            time.sleep(0.5)
    raise RuntimeError('測試主機 60 秒內沒有啟動')

# ---------- 紀錄 ----------
class Rec:
    def __init__(self, out: Path):
        self.out = out; self.rows = []; self.ev = []; self.n = 0
    def hook(self, page):
        page.on('console', lambda m: m.type == 'error' and not m.text.startswith('Failed to load resource') and self.ev.append('console：' + m.text[:300]))   # 載入失敗由下面的 API 檢查負責
        page.on('pageerror', lambda e: self.ev.append('程式錯誤：' + str(e)[:300]))
        def resp(r):
            # /api/files 404：測試複本沒有複製附件圖檔（照片、傳真），不算錯
            if '/api/' in r.url and r.status >= 400 and not r.url.endswith('/api/me') and not (r.status == 404 and '/api/files/' in r.url): self.ev.append(f'API {r.status}：{urlparse(r.url).path}')
        page.on('response', resp)
    def mark(self): return len(self.ev)
    def step(self, page, area, name, since, ok_extra=None, note=''):
        errs = [e for e in self.ev[since:] if 'ERR_CONNECTION_REFUSED' not in e and 'net::ERR_FAILED' not in e]
        if ok_extra: errs.append(ok_extra)
        shot = ''
        if errs:
            self.n += 1; shot = f'fail_{self.n:03d}.png'
            try: page.screenshot(path=str(self.out / shot), full_page=False)
            except Exception: shot = ''
        self.rows.append({'area': area, 'name': name, 'ok': not errs, 'errs': errs, 'shot': shot, 'note': note})
        print(('  OK  ' if not errs else '  !!  ') + f'{area} › {name}' + (f'  ({errs[0]})' if errs else ''), flush=True)

# ---------- 共用 ----------
INIT = """
window.__opens = 0;
window.open = function () { window.__opens++; const d = { open(){}, write(){}, close(){}, title: '', body: {} };
  return { document: d, closed: false, focus(){}, print(){}, close(){ this.closed = true; }, addEventListener(){}, location: {} }; };
window.print = function () {};
"""
def guard(ctx):
    def route(r):
        h = urlparse(r.request.url).hostname or ''
        if h in ('127.0.0.1', 'localhost') or r.request.url.startswith(('data:', 'blob:')): return r.continue_()
        return r.abort()
    ctx.route('**/*', route)
    ctx.add_init_script(INIT)
    ctx.on('dialog', lambda d: d.dismiss())

def settle(page, ms=600):
    try: page.wait_for_load_state('networkidle', timeout=8000)
    except Exception: pass
    page.wait_for_timeout(ms)

def main_text(page):
    try: return page.locator('#view').inner_text(timeout=3000)
    except Exception: return ''

def check_view(page):
    t = main_text(page).strip()
    # 圖面這類頁面內容在 iframe／svg／canvas 裡，文字抓不到：有這些元素就算有內容
    if len(t) < 5 and not page.locator('#view iframe, #view svg, #view canvas, #drawHost iframe').count(): return '頁面是空的'
    if '載入中' in t and len(t) < 20: return '一直顯示載入中'
    return None

def close_modal(page):
    for _ in range(3):
        if not page.locator('.modal-bg').count(): return
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        btn = page.locator('.modal-bg').last.locator('button', has_text='取消')
        if not page.locator('.modal-bg').count(): return
        try:
            if btn.count(): btn.first.click(timeout=1000)
            else: page.locator('.modal-bg').last.locator('button', has_text='關閉').first.click(timeout=1000)
        except Exception: pass
        page.wait_for_timeout(200)

def safe_text(t):
    t = (t or '').strip()
    return t and not any(x in t for x in DANGER)

# ---------- 電腦版 ----------
def desktop(pw_browser, base, rec, only):
    ctx = pw_browser.new_context(viewport={'width': 1440, 'height': 900}, locale='zh-TW')
    guard(ctx); page = ctx.new_page(); rec.hook(page)
    page.goto(base + '/'); settle(page)
    r = page.evaluate("async ([l, p]) => (await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({login:l, pw:p})})).status", [TEST_LOGIN, TEST_PW])
    if r != 200: raise RuntimeError('測試帳號登入失敗 ' + str(r))
    s = rec.mark(); page.goto(base + '/#home'); page.reload(); page.wait_for_selector('#view >> text=總覽', timeout=60000); settle(page, 1500)
    rec.step(page, '電腦版', '登入、載入資料', s, check_view(page))
    mods = page.evaluate("""async () => { const u = performance.getEntriesByType('resource').map(e => e.name).find(n => /modules\\/index\\.js/.test(n));
      const m = await import(u); return m.MODULES.filter(x => !x.hidden).map(x => ({ id: x.id, name: x.name })); }""")
    for mo in mods:
        if only and mo['id'] not in only: continue
        area = f"電腦版 {mo['name']}"
        s = rec.mark(); page.goto(f"{base}/#{mo['id']}"); page.reload(); page.wait_for_selector('#view', timeout=30000); settle(page, 1200)
        rec.step(page, area, '打開頁面', s, check_view(page))
        # 分頁
        n = page.locator('#view .tabs[data-tabs] button').count()
        for i in range(min(n, 15)):
            b = page.locator('#view .tabs[data-tabs] button').nth(i)
            try: label = b.inner_text(timeout=1000).strip()
            except Exception: continue
            if not safe_text(label) or 'on' in (b.get_attribute('class') or ''): continue
            s = rec.mark()
            try: b.click(timeout=3000); settle(page, 500)
            except Exception as e: rec.step(page, area, f'分頁「{label}」', s, f'按不下去：{e.__class__.__name__}'); continue
            rec.step(page, area, f'分頁「{label}」', s, check_view(page))
            close_modal(page)
        # 新增／開單
        # 頁首的「＋ 銷貨單」「＋ 新增」這類按鈕，每個都打開一次再關掉（不儲存）
        page.goto(f"{base}/#{mo['id']}"); page.reload(); page.wait_for_selector('#view', timeout=30000); settle(page, 800)
        labels = []
        btns = page.locator('#view .head button:visible, #view [data-new]:visible')
        for i in range(min(btns.count(), 30)):
            t = (btns.nth(i).inner_text(timeout=500) or '').strip()
            if (t.startswith(('＋', '+')) or any(t.startswith(x) for x in NEW_BTN)) and safe_text(t) and t not in labels: labels.append(t)
        for t in labels[:8]:
            close_modal(page)
            s = rec.mark()
            try:
                page.locator('#view button:visible', has_text=t).first.click(timeout=3000); settle(page, 800)
                rec.step(page, area, f'按「{t}」', s, None if (page.locator('.modal-bg').count() or check_view(page) is None) else '沒有反應')
            except Exception as e:
                rec.step(page, area, f'按「{t}」', s, f'按不下去：{e.__class__.__name__}')
            close_modal(page)
            if page.locator('.modal-bg').count(): page.reload(); page.wait_for_selector('#view', timeout=30000); settle(page, 800)
    # 核心流程
    flows(page, base, rec)
    ctx.close()

FLOW_JS = """async () => {
  const u = performance.getEntriesByType('resource').map(e => e.name).find(n => /core\\/calc\\.js/.test(n));
  const m = await import(u); const { store } = await import(u.replace('calc.js', 'store.js'));
  const out = [];
  const qty = (C, gid) => { const s = C.stock[gid]; return s == null ? 0 : typeof s === 'number' ? s : Object.values(s).reduce((a, b) => a + (+b || 0), 0); };
  let C = m.calc(); const wid = m.defWh()?.id || store.list('warehouses')[0]?.id;
  const g = store.list('goods').find(x => /PCS/i.test(x.unit || '') && !x.bom); const cu = store.list('contacts').find(x => x.kind === 'C'); const su = store.list('contacts').find(x => x.kind === 'S');
  if (!g || !cu || !su || !wid) return [['準備資料', false, '找不到商品／客戶／廠商／倉庫']];
  const day = new Date().toISOString().slice(0, 10);
  const sync = () => new Promise(r => setTimeout(r, 4000));   // 等跟伺服器同步完（存完馬上刪，同步回來的舊資料會讓單據短暫復活）
  for (const [type, c, sign] of [['SALE', cu, -1], ['PUR', su, 1]]) {
    C = m.calc(); const q0 = qty(C, g.id), b0 = +C.bal[c.id] || 0;
    const id = 'e2e_' + type; await store.save('bills', id, { type, date: day, no: m.nextNo(type, day), cid: c.id, wid, tax: false, lines: [{ gid: g.id, qty: 3, price: 10 }], note: '自動測試' }); await sync();
    C = m.calc(); const q1 = qty(C, g.id), b1 = +C.bal[c.id] || 0;
    out.push([type === 'SALE' ? '開銷貨單 → 庫存減 3' : '開進貨單 → 庫存加 3', Math.abs((q1 - q0) - sign * 3) < 1e-6, `庫存 ${q0} → ${q1}`]);
    out.push([type === 'SALE' ? '開銷貨單 → 應收加 30' : '開進貨單 → 應付加 30', Math.abs(Math.abs(b1 - b0) - 30) < 1e-6, `帳款 ${b0} → ${b1}`]);
    await store.remove('bills', id); await sync(); C = m.calc();
    out.push([type === 'SALE' ? '刪銷貨單 → 還原' : '刪進貨單 → 還原', Math.abs(qty(C, g.id) - q0) < 1e-6 && Math.abs((+C.bal[c.id] || 0) - b0) < 1e-6, '']);
  }
  return out;
}"""
def flows(page, base, rec):
    page.goto(base + '/#home'); settle(page, 800)
    s = rec.mark()
    try:
        res = page.evaluate(FLOW_JS)
    except Exception as e:
        rec.step(page, '核心流程', '執行', s, '執行失敗：' + str(e)[:200]); return
    for name, ok, note in res:
        rec.step(page, '核心流程', name, s, None if ok else '結果不對：' + note, note)
        s = rec.mark()

# ---------- App ----------
APP = [('home', '首頁'), ('stock', '查商品'), ('bill', '開單'), ('ar', '帳款'), ('up', '上傳'), ('rep', '經營報表'), ('lbl', '標籤'),
       ('set', '設定'), ('so', '客戶訂單'), ('em', '信箱'), ('fax', '傳真'), ('po', '採購單')]
def app(pw_browser, base, rec, only):
    ctx = pw_browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2, locale='zh-TW')
    guard(ctx); page = ctx.new_page(); rec.hook(page)
    page.goto(base + '/m/'); settle(page)
    page.evaluate("async ([l, p]) => (await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({login:l, pw:p})})).status", [TEST_LOGIN, TEST_PW])
    page.reload(); settle(page, 1500)
    for k, name in APP:
        if only and ('m:' + k) not in only and 'app' not in only: continue
        s = rec.mark(); page.goto(f'{base}/m/#{k}'); page.reload(); page.wait_for_selector('#view', timeout=30000); settle(page, 1500)
        rec.step(page, 'App', name, s, check_view(page))
    ctx.close()

# ---------- 報告 ----------
def report(rec, out: Path, secs):
    bad = [r for r in rec.rows if not r['ok']]
    rows = ''.join(f"<tr class='{'ok' if r['ok'] else 'bad'}'><td>{html.escape(r['area'])}</td><td>{html.escape(r['name'])}</td><td>{'通過' if r['ok'] else '失敗'}</td>"
                   f"<td>{'<br>'.join(html.escape(e) for e in r['errs'])}{('<br><a href=\"' + r['shot'] + '\">截圖</a>') if r['shot'] else ''}</td></tr>" for r in rec.rows)
    page = f"""<!doctype html><meta charset="utf-8"><title>志瑞ERP 自動測試</title><style>body{{font-family:sans-serif;margin:16px}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ccc;padding:4px 8px;font-size:14px;vertical-align:top}}tr.bad{{background:#fde8e8}}tr.ok td:nth-child(3){{color:#1a7f37}}tr.bad td:nth-child(3){{color:#c00;font-weight:bold}}</style>
<h1>志瑞ERP 自動測試 {datetime.datetime.now():%Y-%m-%d %H:%M}</h1><p>共 {len(rec.rows)} 項，通過 {len(rec.rows) - len(bad)}，失敗 <b>{len(bad)}</b>；花 {secs:.0f} 秒。</p>
<table><tr><th>區域</th><th>項目</th><th>結果</th><th>錯誤</th></tr>{rows}</table>"""
    (out / 'index.html').write_text(page, encoding='utf-8')
    (out / 'result.json').write_text(json.dumps(rec.rows, ensure_ascii=False, indent=1), encoding='utf-8')
    return bad

def main():
    ap = argparse.ArgumentParser(description='志瑞 ERP 全站自動測試')
    ap.add_argument('--db', default=str(ROOT / 'data' / 'zhirui.db'), help='要複製的資料庫（只讀取）')
    ap.add_argument('--port', type=int, default=8091)
    ap.add_argument('--only', default='', help='只測這些頁面 id，逗號隔開（App 用 app 或 m:bill）')
    ap.add_argument('--headed', action='store_true', help='顯示瀏覽器畫面')
    ap.add_argument('--keep', action='store_true', help='保留暫存資料（除錯用）')
    a = ap.parse_args()
    only = set(x.strip() for x in a.only.split(',') if x.strip())
    out = ROOT / 'test_reports' / f'e2e_{datetime.datetime.now():%Y%m%d_%H%M%S}'; out.mkdir(parents=True)
    t0 = time.time(); data = make_data(Path(a.db)); srv = None
    print('測試資料：', data, flush=True)
    try:
        srv = start_server(data, a.port); base = f'http://127.0.0.1:{a.port}'
        rec = Rec(out)
        with sync_playwright() as p:
            br = p.chromium.launch(channel='msedge', headless=not a.headed)
            if not only or any(not x.startswith('m:') and x != 'app' for x in only): desktop(br, base, rec, only)
            if not only or any(x.startswith('m:') or x == 'app' for x in only): app(br, base, rec, only)
            br.close()
        bad = report(rec, out, time.time() - t0)
        print(f'\n完成：{len(rec.rows)} 項，失敗 {len(bad)}。報告：{out / "index.html"}')
        return 1 if bad else 0
    finally:
        if srv: srv.terminate(); srv.wait(10)
        if not a.keep: shutil.rmtree(data, ignore_errors=True)

if __name__ == '__main__':
    sys.exit(main())
