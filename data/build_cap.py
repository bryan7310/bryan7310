"""虹瑩（CAP）合金鋼內六角系列價目表（13 頁）轉成查價系統資料。
表格原稿在 cap_tables.py；單價為每百支（NT$/100支）。折扣：有頭內六角 M3~M8 48 折、M10~M16 50 折，其他品項 57 折（類別折扣）。
執行：python3 data/build_cap.py，再執行 python3 data/embed.py。
"""
import csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cap_tables as T

HERE = os.path.dirname(os.path.abspath(__file__))
SUP = '虹瑩'
CATS = [('cap-shcs', '內六角螺絲（有頭）'), ('cap-set', '無頭固定螺絲'), ('cap-csk', '皿頭內六角螺絲'),
        ('cap-btn', '半圓頭內六角螺絲'), ('cap-shd', '等高套筒螺絲'), ('cap-plug', '管牙塞頭')]
PITCH = {'M2': '0.4', 'M2.5': '0.45', 'M2.6': '0.45', 'M3': '0.5', 'M4': '0.7', 'M5': '0.8', 'M6': '1.0', 'M7': '1.0',
         'M8': '1.25', 'M10': '1.5', 'M12': '1.75', 'M14': '2.0', 'M16': '2.0', 'M18': '2.5', 'M20': '2.5', 'M22': '2.5', 'M24': '3.0'}
TPI = {'1/8': '40', '5/32': '32', '3/16': '24', '1/4': '20', '5/16': '18', '3/8': '16', '7/16': '14', '1/2': '12',
       '5/8': '11', '3/4': '10'}
UNC = {'4#': '40', '5#': '40', '6#': '32', '8#': '32', '10#': '24', '1/4': '20', '5/16': '18', '3/8': '16', '7/16': '14',
       '1/2': '13', '5/8': '11', '3/4': '10', '7/8': '9', '1': '8'}
UNF = {'10#': '32', '1/4': '28', '5/16': '24', '3/8': '24'}
FINE = {'M8': '1.0', 'M10': '1.0/1.25', 'M12': '1.25/1.5'}

def parse(tbl):
    lines = [l for l in tbl.strip().splitlines() if l.strip()]
    cols = lines[0].split()
    for ln in lines[1:]:
        L, vals = ln.split(':', 1)
        for c, v in zip(cols, vals.split()):
            if v != '.':
                yield c, L.strip(), float(v)

items = []
def add(cat, name, spec, head, system, dia, thread, length, price, grade, date, extra=''):
    p = int(price) if price == int(price) else price
    items.append(dict(id=f'cap{len(items):04d}', cat=cat, code='', name=name, spec=spec, material='合金鋼SCM435',
                      finish='', head=head, system=system, dia=dia, thread=thread, length=length, unit='100支',
                      price=p, disc='', sup=SUP, note=f'虹瑩牌價 {date}' + (f'（{extra}）' if extra else ''), grade=grade))

def inch(L): return L if L.endswith('"') else L + '"'

def metric(tbl, cat, name, head, grade, date, thread='公制粗牙', pitch=PITCH, full=None):
    for d, L, p in parse(tbl):
        nm = name
        if full is not None:
            nm = name + ('（全牙）' if int(L) <= full else '（半牙）')
        pt = pitch[d]
        add(cat, nm, f'{d}×{L}' if thread == '公制粗牙' else f'{d}×P{pt}×{L}', head, '公制', d,
            f'{thread} P{pt}', L, p, grade, date)

def imperial(tbl, cat, name, head, grade, date, tpi, thread):
    for d, L, p in parse(tbl):
        dd = d + '"' if d == '1' else d
        add(cat, name, f'{dd}×{inch(L)}', head, '英制', dd, f'{thread} {tpi[d]}T', inch(L), p, grade, date)

S, B, C, R = '內六角', '無頭', '皿頭', '半圓頭'
metric(T.P1, 'cap-shcs', '內六角螺絲', S, '12.9', '2021/9/1', full=25)
imperial(T.P2, 'cap-shcs', '內六角螺絲', S, '12.9', '2008/3/25', TPI, '英制粗牙')
imperial(T.P3, 'cap-shcs', '內六角螺絲', S, '12.9', '2008/3/25', UNC, 'UNC')
metric(T.P4M, 'cap-shcs', '內六角螺絲（全牙特製品）', S, '12.9', '2004/12/25')
imperial(T.P4I, 'cap-shcs', '內六角螺絲（全牙特製品）', S, '12.9', '2004/12/25', TPI, '英制粗牙')
metric(T.P5M, 'cap-shcs', '內六角螺絲（細牙特製品）', S, '12.9', '2004/12/25', thread='公制細牙', pitch=FINE)
imperial(T.P5U, 'cap-shcs', '內六角螺絲（細牙特製品）', S, '12.9', '2004/12/25', UNF, 'UNF')
metric(T.P6, 'cap-set', '無頭固定螺絲', B, '14.9', '2021/9/1')
imperial(T.P7, 'cap-set', '無頭固定螺絲', B, '14.9', '2004/12/25', TPI, '英制粗牙')
imperial(T.P8, 'cap-set', '無頭固定螺絲', B, '14.9', '2004/12/25', UNC, 'UNC')
metric(T.P9, 'cap-csk', '皿頭內六角螺絲', C, '10.9', '2004/12/25')
imperial(T.P10, 'cap-csk', '皿頭內六角螺絲', C, '10.9', '2004/12/25', {**UNC, '3/16': '24', '10#': '24/32', '1/2': '12/13'}, 'UNC')
metric(T.P11, 'cap-btn', '半圓頭內六角螺絲', R, '10.9', '2004/12/25')
for col, L, p in parse(T.P12):
    gd, th = col.split(':')
    add('cap-shd', f'等高套筒螺絲（研磨徑{gd}）', f'Φ{gd}×{L}（牙{th}）', S, '公制', th, f'公制粗牙 P{PITCH[th]}', L, p, '12.9', '2021/3/25')
for col, L, p in parse(T.P13):
    d, kind, t = col.split(':')
    add('cap-plug', f'管牙六角孔塞頭 {kind}', f'{d} {kind}×{L}mm', '無頭', '英制', d, f'{kind} {t}', L, p, '10.9', '2004/12/25')

# 折扣（使用者提供）：有頭內六角 M3~M8 48 折、M10~M16 50 折；其他品項套類別折扣 57 折
SHCS48 = {'M3', 'M4', 'M5', 'M6', 'M7', 'M8'}
SHCS50 = {'M10', 'M12', 'M14', 'M16'}
for it in items:
    if it['cat'] == 'cap-shcs':
        it['disc'] = '48' if it['dia'] in SHCS48 else '50' if it['dia'] in SHCS50 else ''

data = {'app': 'screw-pricing', 'version': 1, 'source': '虹瑩 CAP 合金鋼內六角系列價目表',
        'categories': [{'id': c, 'name': n, 'discount': '57'} for c, n in CATS], 'items': items}
json.dump(data, open(os.path.join(HERE, 'cap.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(HERE, 'cap.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['類別', '品名', '規格', '材質', '強度', '頭型', '牙系', '直徑', '牙型', '長度', '單位', '牌價', '備註'])
    cn = dict(CATS)
    for it in items:
        w.writerow([cn[it['cat']], it['name'], it['spec'], it['material'], it['grade'], it['head'], it['system'],
                    it['dia'], it['thread'], it['length'], it['unit'], it['price'], it['note']])
from collections import Counter
print(len(items), 'items', Counter(dict(CATS)[i['cat']] for i in items))
