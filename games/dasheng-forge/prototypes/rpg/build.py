"""組合 RPG 版單檔：引擎 + 畫面 + 內嵌美術（用大聖煉寶專案壓好的 WebP）。"""
import os, json, base64, sys
here = os.path.dirname(os.path.abspath(__file__))
webp = os.path.join(here, '..', '..', 'dist', 'web-assets')
out = sys.argv[1]
keys = ['wukong', 'demon_shanxiao', 'demon_yellow', 'demon_spider', 'demon_bone'] + [f'gem_{e}_{g}' for e in ('metal', 'wood', 'water', 'fire', 'earth') for g in range(1, 6)]
art = {}
for k in keys:
    p = os.path.join(webp, k + '.webp')
    if os.path.exists(p):
        art[k] = 'data:image/webp;base64,' + base64.b64encode(open(p, 'rb').read()).decode()
u = open(os.path.join(here, 'ui.html')).read()
e = open(os.path.join(here, 'engine.js')).read()
u = u.replace('/*ENGINE*/', e).replace('/*ASSETS*/{}', json.dumps(art))
open(out, 'w').write(u)
print('built', out, len(u) // 1024, 'KB', len(art), 'images')
