"""把 game/assets/ 的 PNG 壓成 WebP，放到 dist/web-assets/，給單檔網頁試玩版用（檔案小很多）。
桌面版仍用原本的 PNG。需要 Python 3 與 Pillow：pip install pillow
用法：python3 scripts/make-webp.py
"""
import os
from PIL import Image

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
src = os.path.join(root, 'game', 'assets')
dst = os.path.join(root, 'dist', 'web-assets')
os.makedirs(dst, exist_ok=True)
total = 0
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'):
        continue
    im = Image.open(os.path.join(src, f))
    # 網頁上頭像最多顯示 72 像素、寶石 120 像素，縮小一些不影響畫質
    side = 256 if f.startswith(('wukong', 'demon_')) else 192
    if im.width > side:
        im = im.resize((side, side), Image.LANCZOS)
    out = os.path.join(dst, f[:-4] + '.webp')
    im.save(out, 'WEBP', quality=85, method=6)
    total += os.path.getsize(out)
print(f'webp: {len(os.listdir(dst))} files, {total // 1024} KB -> {dst}')
