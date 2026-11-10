// 圖面檢視：滾輪／＋－ 放大縮小、按住拖曳（小手）、雙擊放大、手機雙指縮放、旋轉
import { modal } from './ui.js';
import { esc } from './util.js';

export function imageViewer({ url, title = '', name = '', dl = '' }) {
  modal({
    title, width: 1200,
    body: `<div class="iv" tabindex="0" aria-label="圖面，可放大與拖曳"><img src="${esc(url)}" alt="${esc(name || title)}" draggable="false"></div>
      <div class="muted small" style="margin-top:6px">${esc(name)}　滾輪或 ＋／－ 放大縮小，按住拖曳移動，雙擊放大</div>`,
    footer: `${dl ? `<a class="btn" href="${esc(dl)}">下載</a>` : ''}<span class="sp"></span>
      <div class="iv-tools"><button class="btn sm" data-z="out" aria-label="縮小">－</button><span class="iv-pct">—</span><button class="btn sm" data-z="in" aria-label="放大">＋</button><button class="btn sm" data-z="fit">符合視窗</button><button class="btn sm" data-z="one">原尺寸</button><button class="btn sm" data-z="rot">旋轉</button></div>
      <button class="btn" data-close>關閉</button>`,
    onOpen(m) {
      const vp = m.querySelector('.iv'), img = vp.querySelector('img'), pct = m.querySelector('.iv-pct');
      let s = 1, x = 0, y = 0, rot = 0, fitS = 1, fitted = true;
      const size = () => rot % 180 ? [img.naturalHeight, img.naturalWidth] : [img.naturalWidth, img.naturalHeight];
      const show = () => { img.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${s}) rotate(${rot}deg)`; pct.textContent = Math.round(s * 100) + '%'; };
      // 拖曳範圍：圖面至少留 60px 在視窗內
      const clamp = () => {
        const [w, h] = size(), r = vp.getBoundingClientRect();
        const mx = Math.max(0, (w * s + r.width) / 2 - 60), my = Math.max(0, (h * s + r.height) / 2 - 60);
        x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
      };
      const fit = () => {
        const [w, h] = size(), r = vp.getBoundingClientRect(); if (!w || !h || !r.width) return;
        fitS = Math.min(r.width / w, r.height / h); s = fitS; x = y = 0; fitted = true; show();
      };
      // 以視窗內某點（相對中心）為基準縮放，滑鼠指著的地方不會跑掉
      const zoomAt = (px, py, ns) => {
        ns = Math.min(Math.max(ns, fitS * 0.5, 0.05), Math.max(8, fitS * 4));
        x = px - (px - x) * (ns / s); y = py - (py - y) * (ns / s); s = ns; fitted = false; clamp(); show();
      };
      const rel = e => { const r = vp.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
      if (img.complete && img.naturalWidth) fit(); else img.addEventListener('load', fit, { once: true });
      new ResizeObserver(() => { if (fitted) fit(); else { clamp(); show(); } }).observe(vp);

      vp.addEventListener('wheel', e => { e.preventDefault(); const [px, py] = rel(e); zoomAt(px, py, s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });
      vp.addEventListener('dblclick', e => { const [px, py] = rel(e); if (s < fitS * 1.9) zoomAt(px, py, s * 2); else fit(); });
      // 拖曳＋雙指縮放（pointer events：滑鼠、觸控、觸控筆都適用）
      const pts = new Map(); let drag = null, pinch = null;
      const startDrag = () => { const [p] = pts.values(); drag = { cx: p.x, cy: p.y, x0: x, y0: y }; pinch = null; };
      vp.addEventListener('pointerdown', e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        vp.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); vp.classList.add('drag');
        if (pts.size === 1) startDrag();
        else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s0: s }; drag = null; }
      });
      vp.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pts.size >= 2) {
          const [a, b] = [...pts.values()]; const [px, py] = rel({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
          zoomAt(px, py, pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y) / (pinch.d || 1));
        } else if (drag) { x = drag.x0 + e.clientX - drag.cx; y = drag.y0 + e.clientY - drag.cy; fitted = false; clamp(); show(); }
      });
      const up = e => { pts.delete(e.pointerId); if (pts.size === 1) startDrag(); if (!pts.size) { drag = pinch = null; vp.classList.remove('drag'); } };
      vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);

      const act = k => {
        if (k === 'in') zoomAt(0, 0, s * 1.25); else if (k === 'out') zoomAt(0, 0, s / 1.25);
        else if (k === 'fit') fit(); else if (k === 'one') { x = y = 0; zoomAt(0, 0, 1); }
        else if (k === 'rot') { rot = (rot + 90) % 360; fit(); }
      };
      m.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => act(b.dataset.z)));
      vp.addEventListener('keydown', e => { const k = { '+': 'in', '=': 'in', '-': 'out', '0': 'fit', r: 'rot' }[e.key]; if (k) { e.preventDefault(); act(k); } });
      vp.focus({ preventScroll: true });
    },
  });
}
