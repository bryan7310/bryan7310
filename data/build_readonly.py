"""由 index.html 產生查價專用版 readonly.html（不能修改資料，只用內建牌價）。
執行：python3 data/build_readonly.py（每次更新 index.html 或內建牌價後重跑）。"""
import os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
s = s.replace('<title>螺絲查價系統</title>', '<title>螺絲查價（查價專用）</title>\n<meta name="screw-readonly" content="1">', 1)
assert 'screw-readonly" content' in s
open(os.path.join(root, 'readonly.html'), 'w', encoding='utf-8').write(s)
print('readonly.html 已產生')
