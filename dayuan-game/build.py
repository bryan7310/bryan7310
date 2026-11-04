# Builds index.html from src.html by embedding logo.png as a data URI.
import base64, pathlib
d = pathlib.Path(__file__).parent
logo = 'data:image/png;base64,' + base64.b64encode((d/'logo.png').read_bytes()).decode()
(d/'index.html').write_text((d/'src.html').read_text(encoding='utf-8').replace('__LOGO__', logo), encoding='utf-8')
print('ok')
