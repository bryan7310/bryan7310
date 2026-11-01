"""把 data/ 下各供應商的 JSON 合併，寫入 index.html 的內建資料區塊。"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = ['jiuyun.json', 'shunlian.json', 'qianqian.json', 'cap.json', 'dongri.json', 'dongri2.json', 'jintongli.json']   # 新增供應商時加在這裡

merged = {'app': 'screw-pricing', 'version': 1, 'sources': [], 'categories': [], 'items': [], 'settings': {'decimals': 2}}
for fn in SOURCES:
    d = json.load(open(os.path.join(HERE, fn), encoding='utf-8'))
    merged['sources'].append(d['source'])
    merged['categories'] += d['categories']
    merged['items'] += d['items']
page = os.path.join(HERE, '..', 'index.html')
html = open(page, encoding='utf-8').read()
blob = json.dumps(merged, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
html, n = re.subn(r'/\*BUILTIN\*/.*?/\*END\*/', lambda m: '/*BUILTIN*/' + blob + '/*END*/', html, flags=re.S)
assert n == 1, 'index.html 找不到內建資料區塊'
open(page, 'w', encoding='utf-8').write(html)
print('index.html 內建資料：', len(merged['categories']), '類,', len(merged['items']), '項')
