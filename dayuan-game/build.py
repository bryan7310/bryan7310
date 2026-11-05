# Builds index.html from src.html by embedding logo.png and the art/ images as data URIs.
import base64, json, pathlib
d = pathlib.Path(__file__).parent
logo = 'data:image/png;base64,' + base64.b64encode((d/'logo.png').read_bytes()).decode()
art = {f.stem: 'data:image/webp;base64,' + base64.b64encode(f.read_bytes()).decode() for f in sorted((d/'art').glob('*.webp'))}
(d/'index.html').write_text((d/'src.html').read_text(encoding='utf-8').replace('__LOGO__', logo).replace('__ART__', json.dumps(art)), encoding='utf-8')
print('ok', len(art), 'art images')
