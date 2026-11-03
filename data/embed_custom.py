"""把訂製品報價（analysis/custom_quotes.py）寫進 index.html 的「成本估算」參考表。
執行：python3 data/embed_custom.py，之後再跑 python3 data/build_readonly.py。"""
import json
import math
import os
import re
import sys

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, os.path.join(root, 'analysis'))
from custom_quotes import build  # noqa: E402

rows = []
for r in build().to_dict('records'):
    clean = lambda v: None if v is None or (isinstance(v, float) and math.isnan(v)) else v
    rows.append({'id': r['編號'], 'sup': r['廠商'], 'date': r['日期'], 'name': r['品名'], 'spec': r['規格'],
                 'mg': r['材質群'], 'fin': r['表面'], 'qty': int(r['數量']), 'price': r['單價'],
                 'mold': clean(r['模具費']), 'w': clean(r['估計重量g'])})
# 第二批：澤發詢價（analysis/zefa_quotes.py 估重）
from zefa_quotes import load as load_zefa  # noqa: E402
MG = {'不鏽鋼': 'SUS', '鐵／低碳鋼': '鐵', '合金鋼': '合金鋼', '中碳鋼': '中碳鋼', '彈簧鋼': '彈簧鋼'}
for r in load_zefa().to_dict('records'):
    if r['單價n'] != r['單價n']:
        continue
    num = lambda v: None if v != v else v
    rows.append({'id': r['file'], 'sup': r['廠商'], 'date': r['日期'], 'name': r['品名'], 'spec': r['規格'],
                 'mg': MG.get(r['材質群'], r['材質群']), 'fin': r['表面'], 'qty': int(r['數量n']) if r['數量n'] == r['數量n'] else 0,
                 'price': r['單價n'], 'mold': num(r['模具n']), 'w': num(r['估重g'])})
path = os.path.join(root, 'index.html')
s = open(path, encoding='utf-8').read()
s, n = re.subn(r'/\*CUSTOM\*/.*?/\*ENDCUSTOM\*/', lambda m: '/*CUSTOM*/' + json.dumps(rows, ensure_ascii=False) + '/*ENDCUSTOM*/', s, count=1, flags=re.S)
assert n == 1
open(path, 'w', encoding='utf-8').write(s)
print(f'已寫入 {len(rows)} 筆訂製品報價')
