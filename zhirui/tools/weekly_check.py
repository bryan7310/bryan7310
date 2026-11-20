"""每週檢查：程式自動測試＋資料健康檢查＋電腦運行狀態＋硬碟健康度。

  python tools/weekly_check.py            全部跑（約 15 分鐘，全站測試最久）
  python tools/weekly_check.py --quick    不跑全站測試和還原演練（1 分鐘內），其餘照跑

平常由伺服器每週自動執行（設定備份 › 每週檢查 可以改星期、時間），也可以在那裡按「現在檢查」。
結果寫到 data/health.json（總覽和設定頁會顯示）和 test_reports/每週檢查_<日期>.md。

安全：正式資料只「唯讀」開啟；測試都在資料複本＋測試主機上跑（不碰正式主機、不寫正式備份資料夾）；
電腦和硬碟只讀取狀態，不改任何設定。
"""
import sys, os, json, sqlite3, subprocess, time, datetime, base64, re, shutil, argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
os.environ.pop('ZR_LAUNCHER', None)     # 這裡啟動的測試主機不是正式主機
os.environ['ZR_NO_WEEKLY'] = '1'        # 測試主機不要再排每週檢查
SECTIONS = []


class Sec:
    def __init__(self, title):
        self.title = title; self.items = []; SECTIONS.append(self)

    def add(self, name, st, info=''):
        """st：ok 正常／warn 要注意／bad 有問題／info 只是資訊"""
        self.items.append({'n': name, 'st': st, 'i': str(info)[:300]})
        print('  %-4s %s | %s' % ({'ok': 'OK', 'warn': '注意', 'bad': '!!', 'info': '--'}[st], name, str(info)[:160]), flush=True)


def run(args, timeout):
    """跑一支工具，回傳（結束碼, 輸出文字）；逾時算失敗"""
    try:
        p = subprocess.run(args, cwd=str(ROOT), capture_output=True, timeout=timeout, env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        return p.returncode, (p.stdout + p.stderr).decode('utf-8', 'replace')
    except subprocess.TimeoutExpired:
        return -1, '超過 %d 分鐘沒跑完' % (timeout // 60)
    except Exception as e:
        return -2, repr(e)


# ---------------------------------------------------------------- 一、程式測試
def tests(quick):
    s = Sec('程式自動測試')
    code, out = run([PY, str(ROOT / 'tools' / 'jscheck.py')], 300)
    last = (out.strip().splitlines() or [''])[-1]
    s.add('網頁程式都載得起來', 'ok' if code == 0 else 'bad', last)
    if quick:
        s.add('全站測試、備份還原演練', 'info', '這次是快速檢查，沒有跑')
        return
    code, out = run([PY, str(ROOT / 'tools' / 'e2e_test.py')], 1800)
    m = re.search(r'完成：(\d+) 項，失敗 (\d+)', out)
    if m:
        n, bad = int(m.group(1)), int(m.group(2))
        rp = re.search(r'報告：(.+)', out)
        s.add('全站測試（電腦版每一頁、App、開單流程）', 'ok' if bad == 0 else 'bad', '%d 項，失敗 %d 項%s' % (n, bad, ('｜' + rp.group(1).strip()) if rp and bad else ''))
    else:
        s.add('全站測試（電腦版每一頁、App、開單流程）', 'bad', '沒有跑完：' + (out.strip().splitlines() or ['沒有輸出'])[-1])
    code, out = run([PY, str(ROOT / 'tools' / 'restore_drill.py')], 600)
    bad = [l.replace('!!', '', 1).strip().replace(' | ', '：', 1) for l in out.splitlines() if l.strip().startswith('!!')]
    s.add('備份還原演練（最新備份還原到測試主機）', 'ok' if code == 0 else 'bad', '還原得回來' if code == 0 else ('沒通過：' + '、'.join(bad) if bad else (out.strip().splitlines() or ['沒有輸出'])[-1]))


# ---------------------------------------------------------------- 二、資料健康
def data_health(data_dir):
    s = Sec('資料健康檢查')
    dbp = data_dir / 'zhirui.db'
    con = sqlite3.connect('file:' + dbp.as_posix() + '?mode=ro', uri=True)
    chk = con.execute('pragma quick_check').fetchone()[0]
    s.add('資料庫完整性', 'ok' if chk == 'ok' else 'bad', '正常' if chk == 'ok' else chk)
    docs = {}
    for col, id, data in con.execute("select col, id, data from docs where deleted=0 and col in ('bills','goods','contacts','settings')"):
        try:
            docs.setdefault(col, {})[id] = json.loads(data)
        except Exception:
            docs.setdefault('_bad', {})[col + '/' + id] = 1
    s.add('資料格式', 'ok' if not docs.get('_bad') else 'bad', '都讀得出來' if not docs.get('_bad') else '讀不出來：' + '、'.join(list(docs['_bad'])[:5]))
    bills, goods, contacts = docs.get('bills', {}), docs.get('goods', {}), docs.get('contacts', {})
    seen, dup = {}, []
    for b in bills.values():
        k = (b.get('type'), b.get('no'))
        if b.get('no') and k in seen: dup.append(str(b.get('no')))
        seen[k] = 1
    s.add('單號沒有重複', 'ok' if not dup else 'bad', '%d 張單據' % len(bills) if not dup else '重複：' + '、'.join(dup[:8]))
    seen, dup, nocode = {}, [], 0
    for g in goods.values():
        c = str(g.get('code') or '').strip()
        if not c: nocode += 1; continue
        if c.upper() in seen: dup.append(c)
        seen[c.upper()] = 1
    s.add('料號沒有重複', 'ok' if not dup else 'bad', '%d 個商品' % len(goods) if not dup else '重複：' + '、'.join(dup[:8]))
    s.add('商品都有料號', 'ok' if not nocode else 'warn', '都有' if not nocode else '%d 個商品沒有料號' % nocode)
    lost, nocid, neg = [], [], []
    for b in bills.values():
        if b.get('cid') and b['cid'] not in contacts: nocid.append(str(b.get('no')))
        for l in b.get('lines') or []:
            if l.get('gid') and l['gid'] not in goods and str(b.get('no')) not in lost: lost.append(str(b.get('no')))
            try:
                if float(l.get('price') or 0) < 0 and str(b.get('no')) not in neg: neg.append(str(b.get('no')))
            except (TypeError, ValueError):
                pass
    s.add('單據上的商品都還在', 'ok' if not lost else 'warn', '都在' if not lost else '有明細的商品已被刪除：' + '、'.join(lost[:8]))
    s.add('單據上的客戶／廠商都還在', 'ok' if not nocid else 'bad', '都在' if not nocid else '對象已被刪除：' + '、'.join(nocid[:8]))
    if neg: s.add('單價是負數的明細', 'info', '、'.join(neg[:8]) + '（折讓就沒問題）')
    # 資料庫大小、已刪除資料的比例
    size = dbp.stat().st_size / 1e6
    total, dead = con.execute('select count(*), sum(deleted) from docs').fetchone()
    s.add('資料庫大小', 'ok' if size < 500 else 'warn', '%.0f MB，%d 筆（已刪除的佔 %.0f%%）' % (size, total, 100.0 * (dead or 0) / max(total, 1)))
    # 等確認寫入的檔案放太久
    pend = [p for p in (ROOT / 'web' / 'pending').glob('*.json')] if (ROOT / 'web' / 'pending').is_dir() else []
    old = [p.name for p in pend if time.time() - p.stat().st_mtime > 3 * 86400]
    s.add('等確認寫入的檔案', 'ok' if not old else 'warn', '沒有放太久的' if not old else '超過 3 天沒處理：' + '、'.join(old[:5]))
    # 備份
    cfg = docs.get('settings', {}).get('backup') or {}
    bdir = Path(cfg.get('dir') or data_dir / 'backup')
    zs = sorted(bdir.glob('志瑞平台備份_*.zip')) if bdir.is_dir() else []
    if not zs:
        s.add('每日備份', 'bad', '備份資料夾裡沒有備份：%s' % bdir)
    else:
        age = (time.time() - zs[-1].stat().st_mtime) / 3600
        s.add('每日備份', 'ok' if age < 36 else 'bad', '最新一份是 %.0f 小時前（%s），共 %d 份' % (age, zs[-1].name, len(zs)))
        junk = [f.name for f in bdir.iterdir() if f.is_file() and (f.name.endswith('.part') or (f.name.startswith('zhirui_') and f.name.endswith('.db'))) and time.time() - f.stat().st_mtime > 3600]
        if junk: s.add('備份資料夾裡有中斷留下的暫存檔', 'warn', '、'.join(junk[:5]))
    con.close()


# ---------------------------------------------------------------- 三、電腦狀態、硬碟（只讀取）
PS = r'''
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$o = @{}
$os = Get-CimInstance Win32_OperatingSystem
$o.os = $os.Caption + ' ' + $os.Version
$o.boot = [int]((Get-Date) - $os.LastBootUpTime).TotalHours
$o.memTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$o.memFree = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$o.cpu = [int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$o.cpuName = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$o.vols = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { @{ d = $_.DeviceID; label = $_.VolumeName; size = [math]::Round($_.Size / 1GB, 1); free = [math]::Round($_.FreeSpace / 1GB, 1) } })
$o.disks = @(Get-PhysicalDisk | ForEach-Object {
  $r = $_ | Get-StorageReliabilityCounter
  @{ name = $_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; size = [math]::Round($_.Size / 1GB, 0); health = [string]$_.HealthStatus; op = [string]($_.OperationalStatus -join ',');
     temp = $r.Temperature; wear = $r.Wear; hours = $r.PowerOnHours; rerr = $r.ReadErrorsUncorrected; werr = $r.WriteErrorsUncorrected }
})
$o.smart = @(Get-CimInstance Win32_DiskDrive | ForEach-Object { @{ model = $_.Model; status = $_.Status } })
$o.predict = @(Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus | ForEach-Object { @{ id = $_.InstanceName; fail = [bool]$_.PredictFailure } })
$since = (Get-Date).AddDays(-7)
$ev = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1, 2, 3; StartTime = $since; ProviderName = 'disk', 'Ntfs', 'volmgr', 'storahci', 'stornvme', 'Microsoft-Windows-Ntfs', 'Microsoft-Windows-Kernel-Power', 'EventLog', 'Microsoft-Windows-WHEA-Logger' } -MaxEvents 400)
$o.diskEv = @($ev | Where-Object { $_.ProviderName -in 'disk', 'Ntfs', 'volmgr', 'storahci', 'stornvme', 'Microsoft-Windows-Ntfs' -and $_.Level -le 2 }).Count
$o.diskWarn = @($ev | Where-Object { $_.ProviderName -eq 'disk' -and $_.Level -eq 3 }).Count
$o.badShut = @($ev | Where-Object { ($_.ProviderName -eq 'Microsoft-Windows-Kernel-Power' -and $_.Id -eq 41) -or ($_.ProviderName -eq 'EventLog' -and $_.Id -eq 6008) }).Count
$o.whea = @($ev | Where-Object { $_.ProviderName -eq 'Microsoft-Windows-WHEA-Logger' -and $_.Level -le 2 }).Count
$o.wheaFix = @($ev | Where-Object { $_.ProviderName -eq 'Microsoft-Windows-WHEA-Logger' -and $_.Level -eq 3 }).Count
$o.procs = @(Get-CimInstance Win32_Process -Filter "Name like 'python%'" | ForEach-Object { [string]$_.CommandLine })
$o | ConvertTo-Json -Depth 5 -Compress
'''


def pc_status():
    s = Sec('電腦運行狀態'); d = Sec('硬碟健康度')
    try:
        enc = base64.b64encode(PS.encode('utf-16-le')).decode()
        p = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', enc], capture_output=True, timeout=180)
        o = json.loads(p.stdout.decode('utf-8', 'replace').strip().splitlines()[-1])
    except Exception as e:
        s.add('讀取電腦狀態', 'bad', '讀不到：%r' % e); return
    lst = lambda v: v if isinstance(v, list) else ([v] if v else [])
    s.add('系統', 'info', '%s｜%s' % (o.get('os', ''), (o.get('cpuName') or '').strip()))
    days = (o.get('boot') or 0) / 24
    s.add('開機多久了', 'ok' if days < 30 else 'warn', ('%.0f 天' % days if days >= 1 else '%d 小時' % (o.get('boot') or 0)) + ('' if days < 30 else '，建議找時間重新開機一次（Windows 更新、清記憶體）'))
    mt, mf = o.get('memTotal') or 0, o.get('memFree') or 0
    pct = 100 * mf / mt if mt else 0
    s.add('記憶體', 'ok' if pct >= 15 else 'warn', '共 %.1f GB，還有 %.1f GB 可用（%.0f%%）' % (mt, mf, pct))
    cpu = o.get('cpu') or 0
    s.add('處理器使用率（檢查當下）', 'ok' if cpu < 90 else 'warn', '%d%%' % cpu)
    for v in lst(o.get('vols')):
        if 'google drive' in (v.get('label') or '').lower(): continue   # 雲端硬碟的虛擬磁碟，不是這台電腦的空間
        size, free = v.get('size') or 0, v.get('free') or 0
        pct = 100 * free / size if size else 0
        s.add('%s 槽空間%s' % (v.get('d', '').rstrip(':'), '（%s）' % v['label'] if v.get('label') else ''), 'bad' if pct < 8 else 'warn' if pct < 15 else 'ok', '共 %.0f GB，剩 %.0f GB（%.0f%%）' % (size, free, pct))
    bs = o.get('badShut') or 0
    s.add('最近 7 天不正常關機', 'ok' if not bs else 'warn', '沒有' if not bs else '%d 次（停電、當機或直接按電源）' % bs)
    wh, wf = o.get('whea') or 0, o.get('wheaFix') or 0
    if wh:
        s.add('最近 7 天硬體錯誤記錄', 'bad', '%d 筆沒辦法自動修正的硬體錯誤（Windows 事件檢視器 › 系統 › WHEA-Logger），建議請電腦店檢查' % wh)
    elif wf:
        # 已修正的錯誤（多半是 PCI Express 訊號重傳）：不影響資料，偶爾幾筆只記錄；很多才提醒
        s.add('最近 7 天硬體錯誤記錄', 'info' if wf < 20 else 'warn', '%d 筆「已自動修正」的訊號錯誤（多半是顯示卡或擴充卡插槽接觸、灰塵），不影響資料%s' % (wf, '' if wf < 20 else '；次數偏多，建議關機清潔、重插擴充卡'))
    else:
        s.add('最近 7 天硬體錯誤記錄', 'ok', '沒有')
    procs = ' '.join(lst(o.get('procs')))
    for key, name in (('fax_helper', '傳真小幫手'), ('print_helper', '列印小幫手')):
        s.add(name + '有在執行', 'ok' if key in procs else 'warn', '執行中' if key in procs else '沒有在執行（不能傳真／列印標籤、出貨單）')
    # 硬碟
    disks = lst(o.get('disks'))
    if not disks: d.add('讀取硬碟資訊', 'warn', '讀不到實體硬碟資訊')
    disks = [x for x in disks if (x.get('size') or 0) >= 1]   # 0 GB 的是螢幕、讀卡機之類的虛擬裝置
    for x in disks:
        h = x.get('health') or ''; op = x.get('op') or ''
        good = h in ('Healthy', '0', '良好') and op in ('OK', '2', '確定', '')
        kind = {'SSD': 'SSD', 'HDD': '傳統硬碟', '4': 'SSD', '3': '傳統硬碟'}.get(x.get('media') or '', '隨身碟' if x.get('bus') in ('USB', '7') else '硬碟')
        extra = []
        if x.get('temp'): extra.append('%s°C' % x['temp'])
        if x.get('hours'): extra.append('已通電 %s 小時（約 %.1f 年）' % (x['hours'], x['hours'] / 8760))
        if x.get('wear') is not None and kind == 'SSD': extra.append('已磨耗 %s%%' % x['wear'])
        if x.get('rerr'): extra.append('讀取錯誤 %s 次' % x['rerr'])
        if x.get('werr'): extra.append('寫入錯誤 %s 次' % x['werr'])
        st = 'ok' if good else 'bad'
        if good and ((x.get('temp') or 0) >= 55 or (x.get('wear') or 0) >= 80 or x.get('rerr') or x.get('werr')): st = 'warn'
        d.add('%s（%s %s GB）' % (x.get('name', '硬碟'), kind, x.get('size')), st,
              ('健康' if good else '狀態異常：%s／%s，請盡快備份並更換' % (h, op)) + ('｜' + '、'.join(extra) if extra else ''))
    if disks and not any(x.get('temp') or x.get('hours') for x in disks):
        d.add('溫度、通電時數、磨耗', 'info', '這台電腦要用系統管理員身分才讀得到這些細項；健康狀態不受影響')
    bad = [x.get('model') for x in lst(o.get('smart')) if (x.get('status') or 'OK') not in ('OK', '確定')]
    d.add('硬碟自我檢測（S.M.A.R.T.）', 'ok' if not bad else 'bad', '全部回報正常' if not bad else '回報異常：' + '、'.join(map(str, bad)))
    pf = [x.get('id') for x in lst(o.get('predict')) if x.get('fail')]
    if pf: d.add('硬碟預測即將故障', 'bad', '、'.join(map(str, pf)) + '：請盡快備份並更換')
    de, dw = o.get('diskEv') or 0, o.get('diskWarn') or 0
    d.add('最近 7 天硬碟／檔案系統錯誤', 'ok' if not de and not dw else ('bad' if de else 'warn'),
          '沒有' if not de and not dw else '錯誤 %d 筆、警告 %d 筆（Windows 事件檢視器 › 系統，來源 disk／Ntfs）' % (de, dw))


# ---------------------------------------------------------------- 輸出
def main():
    ap = argparse.ArgumentParser(description='志瑞 ERP 每週檢查')
    ap.add_argument('--quick', action='store_true', help='不跑全站測試、還原演練')
    ap.add_argument('--data', default=str(ROOT / 'data'), help='資料夾（讀 zhirui.db、結果寫 health.json）')
    ap.add_argument('--no-pc', action='store_true', help='不檢查電腦和硬碟')
    a = ap.parse_args()
    data_dir = Path(a.data); t0 = time.time()
    for name, fn in (('資料健康檢查', lambda: data_health(data_dir)), ('電腦狀態', (lambda: None) if a.no_pc else pc_status), ('程式測試', lambda: tests(a.quick))):
        print('==', name, flush=True)
        try:
            fn()
        except Exception as e:
            Sec(name + '（檢查本身出錯）').add('執行', 'bad', repr(e))
    cnt = {k: sum(1 for s in SECTIONS for i in s.items if i['st'] == k) for k in ('ok', 'warn', 'bad')}
    now = datetime.datetime.now()
    order = ['程式自動測試', '資料健康檢查', '電腦運行狀態', '硬碟健康度']
    secs = sorted(SECTIONS, key=lambda s: order.index(s.title) if s.title in order else 9)
    rep = '每週檢查_%s.md' % now.strftime('%Y%m%d_%H%M')
    out = {'at': int(time.time() * 1000), 'took': int(time.time() - t0), 'quick': bool(a.quick), 'report': rep, **cnt,
           'sections': [{'title': s.title, 'items': s.items} for s in secs]}
    W = {'ok': '正常', 'warn': '**要注意**', 'bad': '**有問題**', 'info': '—'}
    md = ['# 每週檢查（%s）' % now.strftime('%Y/%m/%d %H:%M'), '',
          '結果：正常 %d 項、要注意 %d 項、有問題 %d 項%s。花了 %d 分 %d 秒。' % (cnt['ok'], cnt['warn'], cnt['bad'], '（快速檢查，沒跑全站測試）' if a.quick else '', out['took'] // 60, out['took'] % 60), '']
    for s in secs:
        md += ['## ' + s.title, '', '| 項目 | 結果 | 說明 |', '|---|---|---|'] + ['| %s | %s | %s |' % (i['n'], W[i['st']], i['i'].replace('|', '／')) for i in s.items] + ['']
    (ROOT / 'test_reports').mkdir(exist_ok=True)
    (ROOT / 'test_reports' / rep).write_text('\n'.join(md), encoding='utf-8')
    tmp = data_dir / 'health.json.tmp'
    tmp.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8'); os.replace(tmp, data_dir / 'health.json')
    print('完成：正常 %d、要注意 %d、有問題 %d。報告：%s' % (cnt['ok'], cnt['warn'], cnt['bad'], ROOT / 'test_reports' / rep))
    return 1 if cnt['bad'] else 0


if __name__ == '__main__':
    sys.exit(main())
