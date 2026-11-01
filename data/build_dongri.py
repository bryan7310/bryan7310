"""東日不鏽鋼牌價本（2017.8.1 印製，106/8/1 起）＋折數表（2026/04/07＝115/04/07 實施）轉成查價系統資料。
表格原稿在 dongri_tables.py。折扣照第 1 頁折數表設在每個品項。
執行：python3 data/build_dongri.py，再執行 python3 data/embed.py。
"""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dongri_tables as T

HERE = os.path.dirname(os.path.abspath(__file__))
SUP, NOTE = '東日', '東日牌價 折數115/04/07'
CATS = [('dr-hb', '六角頭螺絲（不鏽鋼）'), ('dr-nut', '螺帽（不鏽鋼）'), ('dr-wsh', '華司（不鏽鋼）'),
        ('dr-ms', '十字機械／鐵板牙螺絲（不鏽鋼）'), ('dr-sock', '內六角螺絲（不鏽鋼）'), ('dr-anc', '壁虎／膨脹螺絲（不鏽鋼）'),
        ('dr-rod', '牙條（不鏽鋼）'), ('dr-ub', 'U型螺絲（不鏽鋼）'), ('dr-pin', '開口銷（不鏽鋼）')]
items = []

def num(v):
    v = float(v); return int(v) if v == int(v) else v
def inch(x): return x if x.endswith('"') else x + '"'
def isM(d): return d.startswith('M')
def system(d): return '公制' if isM(d) or d.startswith('M') else '英制'
def dia_name(d): return '1"' if d == '1' else (d + '"' if d in ('2',) else d)

def add(cat, name, spec, dia, length, price, unit, disc, mat='SUS304', head='', thread='', nut=False, extra=None, note=None):
    it = dict(id=f'dr{len(items):04d}', cat=cat, code='', name=name, spec=spec, material=mat, finish='', head=head,
              system='公制' if dia.startswith('M') else '英制', dia=dia, thread=thread, length=str(length),
              unit=unit, price=num(price), disc=str(disc), sup=SUP, note=note or NOTE)
    if nut: it['nut'] = True
    if extra: it.update(extra)
    items.append(it)

def parse(tbl):
    lines = [l for l in tbl.strip().splitlines() if l.strip()]
    cols = lines[0].split()
    for ln in lines[1:]:
        r, vals = ln.split(':', 1)
        for c, v in zip(cols, vals.split()):
            if v != '.':
                yield r.strip(), c, v

def grid(tbl, cat, name, unit, disc_fn, head='', thread_fn=None, row_is_dia=True, mat='SUS304', names=None):
    for r, c, v in parse(tbl):
        d, L = (r, c) if row_is_dia else (c, r)
        dd = dia_name(d)
        Ls = L if isM(d) else inch(L)
        spec = f'{dd}×{Ls}'
        for nm, hd in (names or [(name, head)]):
            add(cat, nm, spec, dd, Ls, v, unit, disc_fn(d, L), mat, hd, thread_fn(d) if thread_fn else ('公制' if isM(d) else '英制'))

# ── 1 六角頭螺絲（每支）304 25 折；鍛造品（1-1/8"、M27 以上）及 3/8"×13"、1/2"×13"、5/8"×13"、3/4"×11" 以上 30 折
def hb_disc(d, L):
    if d in ('1-1/8', '1-1/4', 'M27', 'M30'): return 30
    if not isM(d):
        n = float(eval(L.replace('-', '+'))) if '/' in L or '-' in L else float(L)
        if (d in ('3/8', '1/2', '5/8') and n >= 13) or (d == '3/4' and n >= 11): return 30
    return 25
for t in (T.HB_I1, T.HB_I2, T.HB_M1, T.HB_M2):
    grid(t, 'dr-hb', '六角頭螺絲', '支', hb_disc, head='六角')
for it in items:
    if it['disc'] == '30': it['name'] = '六角頭螺絲（鍛造品）'

# ── 螺帽（每個）
def nuts(cat, name, pairs, disc, mat='SUS304', thread='', unit='個'):
    for d, v in pairs:
        if v is None: continue
        dd = dia_name(d.split(' ')[0])
        add(cat, name, d if d.startswith('M') or d.startswith('#') else (dd if ' ' not in d else d), dd if not d.startswith('#') else d,
            '', v, unit, disc(d) if callable(disc) else disc, mat, '', thread, nut=True)
X = None
I13 = ['1/8', '5/32', '3/16', '1/4', '5/16', '3/8', '7/16', '1/2', '5/8', '3/4', '7/8', '1', '1-1/8']
M14 = ['M2', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M14', 'M16', 'M18', 'M20', 'M22', 'M24']
hd = lambda d: 35 if d in ('1-1/8',) else 26
nuts('dr-nut', '六角螺帽', zip(I13, [0.9, 0.9, 0.9, 1.1, 1.9, 3.1, 6.0, 7.2, 13.8, 20.4, 40.0, 70.0, 220.0]), hd)
nuts('dr-nut', '六角螺帽', zip(I13, [X, X, 2.0, 2.7, 4.4, 6.1, 13.3, 15.3, 30.0, 48.0, 88.0, 128.0, 320.0]), hd, 'SUS316')
nuts('dr-nut', '六角螺帽', zip(M14, [1.2, 0.9, 0.9, 0.9, 1.1, 2.4, 5.2, 7.8, 13.0, 15.2, 26.0, 29.4, 40.0, 60.0]), 26)
nuts('dr-nut', '六角螺帽', zip(M14, [X, 1.7, 1.7, 1.7, 2.0, 4.3, 9.2, 13.4, 23.0, 26.4, 46.0, 51.0, 75.0, 130.0]), 26, 'SUS316')
HI = ['1/4', '5/16', '3/8', '7/16', '1/2', '5/8', '3/4', '7/8', '1']
HM = ['M10', 'M12', 'M14', 'M16', 'M18', 'M20', 'M22', 'M24']
hv = lambda d: 30 if d in ('7/8', '1') else 28
nuts('dr-nut', '重型（大型）螺帽', zip(HI, [5.1, 6.0, 8.0, 14.0, 17.0, 34.0, 52.0, 80.0, 130.0]), hv)
nuts('dr-nut', '重型（大型）螺帽', zip(HI, [X, 12, 16, 24, 30, 52, 84, 140, 240]), 31, 'SUS316')
nuts('dr-nut', '重型（大型）螺帽', zip(HM, [9.2, 13.3, 25.0, 30.0, 50.0, 60.0, 80.0, 120.0]), 28)
nuts('dr-nut', '重型（大型）螺帽', zip(HM, [20, 27, 50, 60, 100, 120, 160, 215]), 31, 'SUS316')
FL = ['M27', 'M30', 'M33', 'M36']
nuts('dr-nut', '鍛造輕型螺帽', zip(FL, [130, 160, 200, 280]), 35)
nuts('dr-nut', '鍛造輕型螺帽', zip(FL, [220, 290, 380, 510]), 35, 'SUS316')
FH = ['1-1/8', '1-1/4', '1-3/8', '1-1/2', '1-5/8', '1-3/4', '1-7/8', '2', 'M27', 'M30', 'M33', 'M36']
nuts('dr-nut', '鍛造重型螺帽', zip(FH, [190, 250, 330, 420, 520, 650, 770, 950, 160, 230, 280, 380]), 35)
nuts('dr-nut', '鍛造重型螺帽', zip(FH, [350, 470, 600, 780, 960, 1200, 1400, 1800, 260, 370, 450, 620]), 35, 'SUS316')
nuts('dr-nut', '四角螺帽', zip(['M5', 'M6', 'M8', 'M10'], [1.8, 2.6, 4.8, 10]), 40)
nuts('dr-nut', '番數螺帽', zip(['#0', '#1', '#2', '#3', '#4', '#5', '#6', '#8', '#10', '#12'], [0.9] * 6 + [1.2] * 4), 40)
nuts('dr-nut', '法蘭螺帽', zip(['3/16', '1/4', '5/16', '3/8', '1/2', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'],
                             [2.8, 3.0, 4.2, 6.0, 16.6, 1.8, 2.0, 2.2, 2.4, 5.4, 9.6, 16.6]), 23)
nuts('dr-nut', 'UNC螺帽', zip(['1/4', '5/16', '3/8', '7/16', '1/2', '5/8', '3/4', '7/8'], [2.0, 3.0, 4.2, 7.5, 10.2, 21.0, 33.0, 51.0]), 23, thread='UNC')
nuts('dr-nut', 'UNF螺帽', zip(['1/4', '5/16', '3/8', '7/16', '1/2', '5/8', '3/4', '7/8', '1'], [2.2, 3.6, 5.0, 8.0, 12.0, 24.0, 36.0, 60.0, 100.0]), 29, thread='UNF')
nuts('dr-nut', '細牙螺帽', zip(['M6 P0.75', 'M8 P1.0', 'M10 P1.25', 'M12 P1.25', 'M12 P1.5', 'M14 P1.5', 'M16 P1.5', 'M18 P1.5', 'M20 P1.5', 'M22 P1.5', 'M24 P2.0'],
                          [8.0, 8.0, 10.0, 13.0, 13.0, 18.0, 22.0, 32.0, 43.0, 180.0, 220.0]), 29, thread='公制細牙')
CI = ['1/8', '5/32', '3/16', '1/4', '5/16', '3/8', '1/2', '5/8', '3/4', '7/8', '1']
CM = ['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16', 'M20', 'M22', 'M24']
nuts('dr-nut', '焊接袋帽', zip(CI, [4.6, 4.6, 4.6, 4.8, 6.4, 8.4, 16.6, 34.0, 66.0, 90.0, 140.0]), 30)
nuts('dr-nut', '焊接袋帽', zip(CM, [4.6, 4.6, 4.6, 4.8, 7.0, 11.8, 16.6, 40.0, 80.0, 100.0, 140.0]), 30)
nuts('dr-nut', '尼龍螺帽', zip(CI, [1.8, 1.8, 1.8, 2.4, 3.4, 5.8, 13.6, 30.0, 50.0, 150.0, 250.0]), 29)
nuts('dr-nut', '尼龍螺帽', zip(CM, [1.2, 1.2, 1.2, 1.8, 3.4, 7.0, 10.6, 23.0, 70.0, 150.0, 250.0]), 29)
nuts('dr-nut', '蝶型螺帽', zip(['5/32', '3/16', '1/4', '5/16', '3/8', '1/2', '5/8', '3/4', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16'],
                           [6.0, 6.0, 8.0, 11.0, 17.0, 50.0, 200.0, 330.0, 5.0, 5.0, 5.4, 7.0, 10.0, 17.0, 50.0, 200.0]), 35)
nuts('dr-nut', 'U型防鬆螺帽', zip(['M5', 'M6', 'M8', 'M10', 'M12', 'M16'], [6.0, 7.5, 9.0, 21.0, 24.0, 54.0]), 50)
for it in items:   # 1-1/8" 六角螺帽為鍛造品
    if it['name'] == '六角螺帽' and it['dia'] == '1-1/8': it['name'] = '六角螺帽（鍛造品）'
    if it['cat'] == 'dr-nut' and ' ' in it['spec'] and it['spec'].startswith('M'): it['dia'] = it['spec'].split(' ')[0]

# ── 華司
W = ['1/8', '5/32', '3/16', '1/4', '5/16', '3/8', '7/16', '1/2', '5/8', '3/4', '7/8', '1', '1-1/8', '1-1/4', '1-1/2']
OD = [9.5, 11.1, 12.7, 15.9, 19.0, 22.2, 24.0, 27.0, 33.3, 39.6, 44.4, 50.8, 63.5, 69.9, 82.5]
ID = [3.6, 4.5, 5.6, 6.8, 8.7, 10.3, 13.0, 13.5, 16.8, 21.25, 23.8, 27.0, 30.2, 33.3, 40.0]
TH = [0.8, 0.8, 1.0, 1.0, 1.0, 1.0, 1.5, 1.2, 1.5, 2.0, 3.0, 3.0, 3.0, 3.0, 3.5]
PK = [2600, 1951, 1237, 778, 566, 420, 262, 245, 130, 71, 38, 28, 17, 14, 8]
P304 = [0.3, 0.4, 0.6, 0.6, 0.8, 1.0, 2.0, 1.7, 3.4, 6.0, 10.9, 15.3, 31.0, 41.0, 80.0]
P316 = [1.3, 1.3, 1.8, 1.8, 2.4, 3.0, 8.0, 5.0, 12.0, 17.0, 33.0, 46.0, 90.0, 120.0, 240.0]
KG304 = [720, 720, 680, 450, 380, 380, 430, 380, 430, 430, 430, 430]
def wsh(name, sizes, od, idd, th, pk, prices, unit, disc, mat='SUS304'):
    for i, (d, p) in enumerate(zip(sizes, prices)):
        dd = dia_name(d)
        add('dr-wsh', name, f'{dd} {idd[i]}×{od[i]}×{th[i]}', dd, '', p, unit, disc, mat, nut=True, extra={'perKg': pk[i]})
wsh('平華司', W, OD, ID, TH, PK, P304, '個', 42)
wsh('平華司', W, OD, ID, TH, PK, P316, '個', 42, 'SUS316')
wsh('平華司（秤重）', W[:12], OD, ID, TH, PK, KG304, 'kg', 42)
wsh('大型平華司', ['1/4', '5/16', '3/8', '1/2', '5/8', '3/4', '7/8', '1'], [19.0, 22.2, 25.4, 31.6, 38.1, 44.4, 50.8, 63.5],
    [7.2, 8.7, 10.3, 13.5, 17.5, 20.6, 23.8, 27], [1.0, 1.0, 1.2, 1.5, 3.0, 3.0, 3.0, 3.0], [520, 383, 248, 131, 47, 35, 26, 17],
    [0.9, 1.4, 1.9, 3.4, 10.2, 14.0, 17.0, 31.0], '個', 42)
wsh('四角華司', ['3/8', '1/2', '5/8', '3/4'], [32.0, 40.0, 50.0, 60.0], [10.4, 13.0, 16.8, 21.3], [2.0, 3.0, 3.0, 3.0], [67, 27, 18, 13],
    [8.5, 18.0, 27.0, 38.0], '個', 42)
for d, a, b in zip(W, [21, 21, 27, 36, 62, 106, 150, 210, 360, 600, 850, 1300, 2900, 3900, 5000],
                   [70, 70, 70, 77, 156, 312, 384, 504, 888, 1320, 1920, 3120, 5040, 6600, 10000]):
    add('dr-wsh', '彈簧華司', dia_name(d), dia_name(d), '', a, '100個', 36, 'SUS304', nut=True)
    add('dr-wsh', '彈簧華司', dia_name(d), dia_name(d), '', b, '100個', 36, 'SUS316', nut=True)

# ── 十字機械／鐵板牙（每 100 支）丸頭、皿頭整盒 20 折；大扁頭整盒 20 折（不足一盒 23 折）
MSN = 'SUS304'
box = '東日牌價 折數115/04/07（整盒20折，不足一盒23折）'
def ms(tbl, base, heads, thread):
    for r, c, v in parse(tbl):
        dd = dia_name(r); Ls = c if isM(r) else inch(c)
        for h in heads:
            add('dr-ms', f'{h}十字{base}', f'{dd}×{Ls}', dd, Ls, v, '100支', 20, MSN, h, thread, note=box)
ms(T.MS_I, '機械牙螺絲', ['丸頭', '皿頭'], '英制機械牙'); ms(T.MS_M, '機械牙螺絲', ['丸頭', '皿頭'], '公制機械牙')
ms(T.TS_I, '鐵板牙螺絲', ['丸頭', '皿頭'], '鐵板牙'); ms(T.TS_M, '鐵板牙螺絲', ['丸頭', '皿頭'], '鐵板牙')
ms(T.FMS_I, '機械牙螺絲', ['大扁頭'], '英制機械牙'); ms(T.FMS_M, '機械牙螺絲', ['大扁頭'], '公制機械牙')
ms(T.FTS_I, '鐵板牙螺絲', ['大扁頭'], '鐵板牙'); ms(T.FTS_M, '鐵板牙螺絲', ['大扁頭'], '鐵板牙')

# ── 內六角（每 100 支）有頭 34 折；無頭 45 折（M12、M16、1/2" 47 折）；半圓頭、平頭 34 折
def sock(tbl, name, head, disc, row_is_dia=True):
    for r, c, v in parse(tbl):
        d, L = (r, c) if row_is_dia else (c, r)
        dd = dia_name(d); Ls = L if isM(d) else inch(L)
        add('dr-sock', name, f'{dd}×{Ls}', dd, Ls, v, '100支', disc(d) if callable(disc) else disc, 'SUS304', head,
            '公制' if isM(d) else '英制')
for t in (T.SH_I, T.SH_M1, T.SH_M2): sock(t, '有頭內六角螺絲', '內六角', 34)
setd = lambda d: 47 if d in ('M12', 'M16', '1/2') else 45
for t in (T.SET_I, T.SET_M): sock(t, '無頭內六角螺絲', '無頭', setd)
sock(T.BTN, '半圓頭內六角螺絲', '半圓頭', 34, row_is_dia=False)
sock(T.CSK, '平頭內六角螺絲', '皿頭', 34, row_is_dia=False)

# ── 壁虎／膨脹螺絲（每支）套管、平頭 304 48 折；內牙、內迫、接頭 304 40 折
for d, L, p in [('1/4', '2', 7.6), ('5/16', '2-1/4', 9.2), ('5/16', '3', 12.0), ('3/8', '2-1/2', 16.4), ('3/8', '3', 19.8), ('3/8', '4', 25.2),
                ('1/2', '3', 32.0), ('1/2', '4', 43.2), ('1/2', '5', 64.6), ('5/8', '4', 66.0), ('5/8', '5', 90.0), ('3/4', '5', 170.0)]:
    add('dr-anc', '膨脹螺絲（套管式）', f'{d}×{inch(L)}', d, inch(L), p, '支', 48, nut=True)
for d, L, p in [('1/4', '2', 9.0), ('5/16', '2-1/4', 10.6), ('5/16', '3', 13.0), ('3/8', '2-1/2', 22.6), ('3/8', '3', 26.0), ('1/2', '3', 38.0), ('1/2', '4', 60.0)]:
    add('dr-anc', '膨脹螺絲（平頭式）', f'{d}×{inch(L)}', d, inch(L), p, '支', 48, nut=True)
for d, od, L, p in [('1/4', '7/16', '1-1/2', 24.0), ('5/16', '1/2', '1-1/2', 26.0), ('3/8', '1/2', '1-1/2', 28.0), ('1/2', '11/16', '2', 60.0),
                    ('5/8', '7/8', '2-1/2', 140.0), ('3/4', '1', '3', 224.0)]:
    add('dr-anc', '膨脹螺絲（內牙式）', f'{d}（外徑{inch(od)}）×{inch(L)}', d, inch(L), p, '支', 40, nut=True)
for d, L, p in [('1/4', 25, 28.8), ('5/16', 30, 32.4), ('3/8', 40, 34.2), ('1/2', 50, 72), ('5/8', 60, 172.8), ('3/4', 80, 270)]:
    add('dr-anc', '內迫式壁虎', f'{d}×{L}mm', d, '', p, '支', 40, nut=True)
for d, p in [('1/4', 27.2), ('5/16', 30.6), ('3/8', 30.6), ('1/2', 61.2), ('5/8', 153), ('3/4', 238)]:
    add('dr-anc', '接頭式壁虎', d, d, '', p, '支', 40, nut=True)

# ── 牙條（每支）304 1"、M24 以下 32 折；1-1/8"、M27 以上 38 折；3 米 32 折
RI = ['3/16', '1/4', '5/16', '3/8', '7/16', '1/2', '5/8', '3/4', '7/8', '1', '1-1/8', '1-1/4', '1-1/2']
for d, p in zip(RI, [132, 78, 122, 180, 280, 320, 494, 746, 1020, 1340, 1900, 2400, 3600]):
    add('dr-rod', '全牙牙條（1米）', f'{dia_name(d)}×1M', dia_name(d), '', p, '支', 38 if d.startswith('1-') else 32, nut=True)
for d, p in zip(['M5', 'M6', 'M8', 'M10', 'M12', 'M14', 'M16', 'M18', 'M20', 'M22', 'M24', 'M30', 'M36'],
                [132, 72, 126, 200, 292, 438, 520, 718, 832, 1100, 1200, 2100, 3200]):
    add('dr-rod', '全牙牙條（1米）', f'{d}×1M', d, '', p, '支', 38 if d in ('M30', 'M36') else 32, nut=True)
for d, p in zip(['3/8', '1/2', '5/8', '3/4'], [580, 1080, 1670, 2500]):
    add('dr-rod', '全牙牙條（3米）', f'{d}×3M', d, '', p, '支', 32, nut=True)

# ── U型螺絲（每支）56 折；列＝牙徑、欄＝管規
for r, c, v in parse(T.UB):
    add('dr-ub', 'U型螺絲', f'{r}（管{inch(c)}）', r, '', v, '支', 56, nut=True)
# ── 開口銷（每 100 支）38 折
for r, c, v in parse(T.PIN):
    add('dr-pin', '開口銷', f'{r}×{inch(c)}', r, inch(c), v, '100支', 38)

data = {'app': 'screw-pricing', 'version': 1, 'source': '東日不鏽鋼牌價本（106/8/1）＋折數表（115/04/07）',
        'categories': [{'id': c, 'name': n, 'discount': ''} for c, n in CATS], 'items': items}
json.dump(data, open(os.path.join(HERE, 'dongri.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
cn = dict(CATS)
with open(os.path.join(HERE, 'dongri.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['類別', '品名', '規格', '材質', '頭型', '牙系', '直徑', '長度', '單位', '牌價', '折數', '備註'])
    for it in items:
        w.writerow([cn[it['cat']], it['name'], it['spec'], it['material'], it['head'], it['system'], it['dia'],
                    it['length'], it['unit'], it['price'], it['disc'], it['note']])
from collections import Counter
print(len(items), 'items', Counter(cn[i['cat']] for i in items))
print(Counter(i['disc'] for i in items))
