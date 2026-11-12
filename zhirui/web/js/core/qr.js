// QR 碼：產生（qrcode-generator，MIT）與掃描（jsQR，Apache-2.0）。兩個元件放在 web/vendor，用到時才載入。
// 商品 QR 碼內容＝料號（code）原文，UTF-8。
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

/** 開相機掃 QR 碼：全螢幕畫面，讀到就呼叫 onText(text) 並關閉；回傳關閉函式 */
export function scanQR(onText, { title = '掃描 QR 碼' } = {}) {
  const el = document.createElement('div'); el.className = 'scan';
  el.innerHTML = `<video playsinline muted autoplay></video><div class="scan-box"></div>
    <div class="scan-hd"><b>${title}</b><button type="button" class="scan-x">關閉</button></div><div class="scan-msg">把 QR 碼放進框裡</div>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const video = el.querySelector('video'), msg = el.querySelector('.scan-msg');
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  let stream = null, raf = 0, done = false, last = 0;
  const close = () => { done = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); el.remove(); document.body.classList.remove('noscroll'); };
  el.querySelector('.scan-x').onclick = close;
  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('這個瀏覽器不能開相機（要用 https 網址開）');
      const [jsQR, s] = await Promise.all([loadJsQR(), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })]);
      if (done) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s; video.srcObject = s; await video.play().catch(() => {});
      const tick = t => {
        if (done) return; raf = requestAnimationFrame(tick);
        if (t - last < 120 || video.readyState < 2 || !video.videoWidth) return; last = t;
        // 只看畫面中間的正方形，縮到最多 640 點，速度比較快
        const vw = video.videoWidth, vh = video.videoHeight, side = Math.min(vw, vh) * 0.8, k = Math.min(1, 640 / side);
        cv.width = cv.height = Math.round(side * k);
        cx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, cv.width, cv.height);
        const img = cx.getImageData(0, 0, cv.width, cv.height);
        const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (r && r.data) { const text = r.data.trim(); if (navigator.vibrate) navigator.vibrate(60); close(); onText(text); }
      };
      raf = requestAnimationFrame(tick);
    } catch (e) {
      const m = e && e.name === 'NotAllowedError' ? '相機權限被拒絕：請到 iPhone「設定 › Safari › 相機」允許，或重新整理後按「允許」'
        : e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') ? '這台裝置找不到相機' : (e.message || String(e));
      msg.textContent = m; msg.classList.add('err');
    }
  })();
  return close;
}
