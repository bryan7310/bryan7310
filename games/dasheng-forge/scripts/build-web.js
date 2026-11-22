// 把 game/ 資料夾合成一個單檔網頁（試玩版），輸出到 dist/web/index.html。
// 美術圖會轉成內嵌資料，所以單檔就能開；圖多的話檔案會變大。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const game = path.join(root, 'game');
const read = (f) => fs.readFileSync(path.join(game, f), 'utf8');

let html = read('index.html');
const files = (() => {
  const sandbox = { window: {} };
  new Function('window', read('assets/manifest.js'))(sandbox.window);
  return sandbox.window.ASSET_FILES || [];
})();

// 美術：把 assets/xxx.png 換成 data URI
let app = read('app.js');
const images = {};
const webpDir = path.join(root, 'dist', 'web-assets'); // 先跑 scripts/make-webp.py 就會用較小的 WebP
for (const k of files) {
  const w = path.join(webpDir, k + '.webp');
  const p = path.join(game, 'assets', k + '.png');
  if (fs.existsSync(w)) images[k] = 'data:image/webp;base64,' + fs.readFileSync(w).toString('base64');
  else if (fs.existsSync(p)) images[k] = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  else console.warn('manifest lists a missing file:', k + '.png');
}
const manifest = `window.ASSET_FILES = ${JSON.stringify(Object.keys(images))};\nwindow.ASSET_DATA = ${JSON.stringify(images)};`;
app = app.replace(/assets\/\$\{k\}\.png/g, '${(window.ASSET_DATA && window.ASSET_DATA[k]) || `assets/${k}.png`}')
         .replace(/url\(assets\/bg_\$\{k\}\.png\)/g, 'url(${(window.ASSET_DATA && window.ASSET_DATA["bg_" + k]) || `assets/bg_${k}.png`})');

const inline = (tag, body) => `<${tag}>\n${body}\n</${tag}>`;
html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, '')
  .replace('<link rel="stylesheet" href="style.css">', inline('style', read('style.css')))
  .replace('<script src="assets/manifest.js"></script>', inline('script', manifest))
  .replace('<script src="engine.js"></script>', inline('script', read('engine.js')))
  .replace('<script src="app.js"></script>', inline('script', app));

const out = path.join(root, 'dist', 'web');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('web build:', path.join(out, 'index.html'), Math.round(html.length / 1024) + ' KB,', Object.keys(images).length, 'images');

// Claude 網頁發布用的片段版：平台會自己加上 <html>、<head>、<body>
const pick = (re) => (html.match(re) || [''])[0];
const fragment = [
  pick(/<title>[\s\S]*?<\/title>/),
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...(html.match(/<link [^>]+>/g) || []),
  pick(/<style>[\s\S]*?<\/style>/),
  html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim(),
].join('\n');
fs.writeFileSync(path.join(out, 'artifact.html'), fragment);
console.log('artifact fragment:', path.join(out, 'artifact.html'));
