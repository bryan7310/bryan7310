// QR 碼：產生（qrcode-generator，MIT）與掃描（jsQR，Apache-2.0）。兩個元件放在 web/vendor，用到時才載入。
// 商品 QR 碼內容＝料號（code）原文，UTF-8。一維條碼由主機「自有辨識」（/api/vision）讀。
import { api } from './api.js';
const loaded = {};
function loadScript(src, name) {
  if (window[name]) return Promise.resolve(window[name]);
  return loaded[src] || (loaded[src] = new Promise((ok, bad) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => window[name] ? ok(window[name]) : bad(new Error('QR 元件載入失敗'));
    s.onerror = () => { delete loaded[src]; bad(new Error('QR 元件載入失敗，請確認網路')); };
    document.head.append(s);
  }));
}
/** 文字 → QR 碼 SVG 字串（cell：每格幾 px；margin：留白格數） */
export async function qrSvg(text, { cell = 4, margin = 2, ec = 'M' } = {}) {
  const qrcode = await loadScript('/vendor/qrcode.js', 'qrcode');
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const q = qrcode(0, ec); q.addData(String(text), 'Byte'); q.make();
  return q.createSvgTag({ cellSize: cell, margin, scalable: true });
}
/** 文字 → QR 碼的模組矩陣（true＝黑），給標籤機列印用 */
export async function qrMatrix(text, ec = 'M') {
  const qrcode = await loadScript('/vendor/qrcode.js', 'qrcode');
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const q = qrcode(0, ec); q.addData(String(text), 'Byte'); q.make();
  const n = q.getModuleCount(); const m = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
  return m;
}
export const loadJsQR = () => loadScript('/vendor/jsQR.js', 'jsQR');

/** 照片／畫面（data URL）送主機的「自有辨識」讀條碼與 QR 碼 → [{type, text}] */
export async function serverCodes(image) {
  const r = await api.post('/api/vision', { image, mode: 'codes' });
  return r.codes || [];
}
const fileToDataUrl = f => new Promise((ok, bad) => {
  const url = URL.createObjectURL(f), img = new Image();
  img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85)); };
  img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('讀不出照片')); };
  img.src = url;
});

/** 開相機掃 QR 碼與一維條碼（EAN、Code128…）：全螢幕畫面，讀到就呼叫 onText(text, type) 並關閉；回傳關閉函式。
 *  QR 碼在手機上用 jsQR 讀；一維條碼：瀏覽器有 BarcodeDetector（Android Chrome）就用，
 *  沒有（iPhone Safari）就每 0.8 秒把畫面送主機「自有辨識」讀。相機開不了時可以改拍照。 */
export function scanQR(onText, { title = '掃描條碼／QR 碼' } = {}) {
  const el = document.createElement('div'); el.className = 'scan';
  el.innerHTML = `<video playsinline muted autoplay></video><div class="scan-box"></div>
    <div class="scan-hd"><b>${title}</b><button type="button" class="scan-x">關閉</button></div>
    <div class="scan-msg">把條碼或 QR 碼放進框裡</div>
    <label class="scan-photo">📷 改用拍照<input type="file" accept="image/*" capture="environment" hidden></label>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const video = el.querySelector('video'), msg = el.querySelector('.scan-msg');
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const sv = document.createElement('canvas'), sx = sv.getContext('2d');
  let stream = null, raf = 0, done = false, last = 0, lastSrv = 0, busy = false, srvOff = false;
  const close = () => { done = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); el.remove(); document.body.classList.remove('noscroll'); };
  // 一維條碼容易誤判（螺紋、格線會被讀成 EAN）：相機連續掃描時要連續兩次讀到同一個號碼才算
  let cand = '', candAt = 0;
  const confirm2 = (text, type) => { text = String(text || '').trim(); if (!text) return;
    if (/qr/i.test(type)) return hit(text, type);
    const now = Date.now(); if (cand === text && now - candAt < 4000) return hit(text, type);
    cand = text; candAt = now; msg.textContent = '讀到 ' + text + '，再對準一下確認…'; };
  const hit = (text, type = 'QR') => { if (done) return; text = String(text || '').trim(); if (!text) return; if (navigator.vibrate) navigator.vibrate(60); close(); onText(text, type); };
  el.querySelector('.scan-x').onclick = close;
  el.querySelector('.scan-photo input').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    msg.classList.remove('err'); msg.textContent = '主機辨識中…';
    try { const codes = await serverCodes(await fileToDataUrl(f)); if (codes.length) hit(codes[0].text, codes[0].type); else msg.textContent = '照片裡沒有讀到條碼，請靠近一點、對焦清楚再拍'; }
    catch (e) { msg.textContent = e.message; msg.classList.add('err'); }
  };
  // 送主機：整個畫面（一維條碼是橫的，不能只取中間正方形），長邊最多 1280
  const toServer = async () => {
    busy = true;
    try {
      const vw = video.videoWidth, vh = video.videoHeight, k = Math.min(1, 1280 / Math.max(vw, vh));
      sv.width = Math.round(vw * k); sv.height = Math.round(vh * k); sx.drawImage(video, 0, 0, sv.width, sv.height);
      const codes = await serverCodes(sv.toDataURL('image/jpeg', 0.8));
      if (codes.length) confirm2(codes[0].text, codes[0].type);
    } catch (e) { if (e.status === 503 || e.status === 404) srvOff = true; }   // 主機沒有自有辨識：只用手機讀 QR
    busy = false;
  };
  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('這個網址不能開相機（要用 https 網址），可以按下面「改用拍照」');
      const native = 'BarcodeDetector' in window ? await window.BarcodeDetector.getSupportedFormats().then(f => f.length ? new window.BarcodeDetector({ formats: f }) : null).catch(() => null) : null;
      const [jsQR, s] = await Promise.all([loadJsQR(), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })]);
      if (done) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s; video.srcObject = s; await video.play().catch(() => {});
      const tick = async t => {
        if (done) return; raf = requestAnimationFrame(tick);
        if (t - last < 120 || video.readyState < 2 || !video.videoWidth) return; last = t;
        if (native) {
          if (busy) return; busy = true;
          try { const r = await native.detect(video); if (r && r[0]) confirm2(r[0].rawValue, r[0].format); } catch (e) {}
          busy = false; return;
        }
        // 只看畫面中間的正方形，縮到最多 640 點，速度比較快
        const vw = video.videoWidth, vh = video.videoHeight, side = Math.min(vw, vh) * 0.8, k = Math.min(1, 640 / side);
        cv.width = cv.height = Math.round(side * k);
        cx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, cv.width, cv.height);
        const img = cx.getImageData(0, 0, cv.width, cv.height);
        const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (r && r.data) return hit(r.data, 'QR');
        if (!srvOff && !busy && t - lastSrv > (cand ? 300 : 800)) { lastSrv = t; toServer(); }
      };
      raf = requestAnimationFrame(tick);
    } catch (e) {
      const m = e && e.name === 'NotAllowedError' ? '相機權限被拒絕：請到 iPhone「設定 › Safari › 相機」允許，或按下面「改用拍照」'
        : e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') ? '這台裝置找不到相機，可以按下面「改用拍照」' : (e.message || String(e));
      msg.textContent = m; msg.classList.add('err');
    }
  })();
  return close;
}
