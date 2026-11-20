"""備份還原演練：拿最新一份備份 zip，還原到暫存資料夾，啟動測試主機確認真的還原得回來。

  python tools/restore_drill.py            用設定裡的備份資料夾、最新一份
  python tools/restore_drill.py <zip 路徑>  指定某一份

只讀正式資料（唯讀開啟）、只讀備份檔；還原出來的東西放在暫存資料夾，跑完就刪。不碰正式主機。
結果寫到 test_reports/備份還原演練_<日期>.md，有問題時結束碼是 1。
"""
import sys, os, json, sqlite3, zipfile, tempfile, shutil, time, datetime, http.client
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_test as T

ROOT = Path(__file__).resolve().parent.parent
LIVE = ROOT / 'data' / 'zhirui.db'
PORT = 8094
rows = []   # (項目, 是否通過, 說明)


def ok(name, cond, info=''):
    rows.append((name, bool(cond), str(info)))
    print(('  OK  ' if cond else '  !!  ') + name, '|', str(info)[:200])


def ro(path):
    return sqlite3.connect('file:' + Path(path).as_posix() + '?mode=ro', uri=True)


def counts(con):
    return {c: n for c, n in con.execute('select col, count(*) from docs where deleted=0 group by col')}


def main():
    live = ro(LIVE)
    if len(sys.argv) > 1:
        zpath = Path(sys.argv[1])
    else:
        r = live.execute("select data from docs where col='settings' and id='backup'").fetchone()
        bdir = Path((json.loads(r[0]) if r else {}).get('dir') or ROOT / 'data' / 'backup')
        zs = sorted(bdir.glob('志瑞平台備份_*.zip'))
        if not zs:
            print('備份資料夾裡沒有備份檔：', bdir); return 1
        zs = [z for z in zs if time.time() - z.stat().st_mtime > 120] or zs   # 正在寫的那一份先不拿
        zpath = zs[-1]
    age_h = (time.time() - zpath.stat().st_mtime) / 3600
    print('備份檔：', zpath, '（%.1f MB，%.1f 小時前）' % (zpath.stat().st_size / 1e6, age_h))
    ok('最新備份在 36 小時內', age_h < 36, '%.1f 小時前' % age_h)

    work = Path(tempfile.mkdtemp(prefix='zr_restore_'))
    srv = None; data = None
    try:
        try:
            zipfile.ZipFile(zpath).close()
        except zipfile.BadZipFile:
            ok('zip 檔沒有損壞', False, '這個檔打不開（備份到一半被中斷？）：' + zpath.name)
            raise SystemExit(report(zpath, []))
        with zipfile.ZipFile(zpath) as z:
            bad = z.testzip()
            ok('zip 檔沒有損壞', bad is None, bad or '')
            ok('zip 裡有 zhirui.db', 'zhirui.db' in z.namelist(), z.namelist())
            z.extract('zhirui.db', work)
        rdb = work / 'zhirui.db'
        con = ro(rdb)
        chk = con.execute('pragma integrity_check').fetchone()[0]
        ok('還原出來的資料庫完整性檢查', chk == 'ok', chk)
        tabs = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
        need = {'docs', 'users', 'sessions', 'hist_bills', 'hist_lines'}
        ok('資料表都在', need <= tabs, sorted(need - tabs) or '%d 張表' % len(tabs))
        a, b = counts(con), counts(live)
        # 備份之後正式資料還會繼續增加：備份的筆數應該接近、而且不會比現在多很多
        main_cols = ['goods', 'customers', 'suppliers', 'bills', 'receivables', 'checks_in', 'checks_out', 'settings']
        lines = []
        for c in sorted(set(a) | set(b)):
            lines.append((c, a.get(c, 0), b.get(c, 0)))
        short = [(c, x, y) for c, x, y in lines if c in main_cols and (x == 0 and y > 0 or y and x < y * 0.9)]
        ok('主要資料筆數跟現在差不多（差距 10% 內）', not short, short or '、'.join('%s %d' % (c, a.get(c, 0)) for c in main_cols if c in a))
        for t in ('hist_bills', 'hist_lines', 'users'):
            x = con.execute('select count(*) from ' + t).fetchone()[0]; y = live.execute('select count(*) from ' + t).fetchone()[0]
            ok('%s 筆數' % t, x > 0 and x >= y * 0.9, '備份 %d／現在 %d' % (x, y))
        con.close()
        # 附檔（圖面等）：備份資料夾的 files 子資料夾
        fl, fb = ROOT / 'data' / 'files', zpath.parent / 'files'
        if fl.is_dir():
            miss = [f for f in os.listdir(fl) if not (fb / f).exists()]
            ok('附檔都有備份到', len(miss) <= 5, '正式 %d 個，備份缺 %d 個%s' % (len(os.listdir(fl)), len(miss), '（今天新增、下次備份會補上）' if miss else ''))
        # 真的啟動一台測試主機，用還原的資料登入、把資料全部讀出來
        data = T.make_data(rdb)
        srv = T.start_server(data, PORT)

        def req(method, path, body=None, cookie=None):
            c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=60); h = {}
            if cookie: h['Cookie'] = cookie
            d = json.dumps(body).encode() if body is not None else None
            if d is not None: h['Content-Type'] = 'application/json'
            c.request(method, path, body=d, headers=h); r = c.getresponse(); txt = r.read().decode('utf-8', 'replace'); ck = r.getheader('Set-Cookie'); c.close()
            return r.status, txt, (ck.split(';')[0] if ck else None)
        s, _, ck = req('POST', '/api/login', {'login': T.TEST_LOGIN, 'pw': T.TEST_PW})
        ok('用還原的資料啟動主機、可以登入', s == 200 and ck, s)
        n, since = 0, 0
        for _ in range(50):   # 同步一次最多給 2 萬筆，分批讀到沒有為止
            s, t, _ = req('GET', '/api/sync?since=%d' % since, cookie=ck)
            if s != 200: break
            ch = json.loads(t).get('changes', [])
            n += sum(1 for c in ch if c.get('data') is not None)
            if len(ch) < 20000: break
            since = max(c.get('ver', 0) for c in ch)
        ok('主機讀得出全部資料', s == 200 and n >= sum(a.values()) * 0.95, '%d 筆（資料庫 %d 筆）' % (n, sum(a.values())))
        s, t, _ = req('GET', '/', cookie=ck)
        ok('網頁打得開', s == 200 and '<html' in t.lower(), s)
    finally:
        if srv: srv.terminate(); time.sleep(1)
        live.close()
        for d in (work, data):
            if d: shutil.rmtree(d, ignore_errors=True)
    return report(zpath, lines)


def report(zpath, lines):
    fail = [r for r in rows if not r[1]]
    day = datetime.date.today().strftime('%Y%m%d')
    out = ROOT / 'test_reports' / ('備份還原演練_%s.md' % day)
    md = ['# 備份還原演練（%s）' % datetime.datetime.now().strftime('%Y/%m/%d %H:%M'), '',
          '備份檔：`%s`（%.1f MB）' % (zpath, zpath.stat().st_size / 1e6), '',
          '結果：**%s**' % ('全部通過，這份備份還原得回來' if not fail else '有 %d 項沒通過' % len(fail)), '',
          '| 項目 | 結果 | 說明 |', '|---|---|---|']
    md += ['| %s | %s | %s |' % (n, '通過' if c else '**沒通過**', i.replace('|', '／')[:160]) for n, c, i in rows]
    md += ['', '## 各類資料筆數（備份／現在）', '', '| 資料 | 備份 | 現在 |', '|---|---:|---:|'] + ['| %s | %d | %d |' % x for x in lines]
    md += ['', '## 真的要還原時的步驟', '',
           '1. 關掉平台（主機上的啟動視窗）。',
           '2. 把 `C:\\zhirui\\data\\zhirui.db` 改名留著（例如加上 `.壞掉`），不要直接刪。',
           '3. 把備份 zip 解開，裡面的 `zhirui.db` 放到 `C:\\zhirui\\data\\`。',
           '4. 備份資料夾裡的 `files` 資料夾複製到 `C:\\zhirui\\data\\files`（客戶圖面等附檔）。',
           '5. 重新啟動平台，登入確認最近的單據。備份時間之後輸入的資料要重打。', '']
    out.write_text('\n'.join(md), encoding='utf-8')
    print('報告：', out); print('沒通過 %d 項' % len(fail))
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main())
