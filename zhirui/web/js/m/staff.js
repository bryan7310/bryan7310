// 員工版 App：一般員工帳號登入手機版看到的畫面。目前只有「印標籤」，按鍵大、步驟少：
//   選標籤機 → 找商品（或掃 QR 碼）→ 填每張數量、張數 → 列印。
// 標籤的畫法、TSPL、標籤機清單都用 label.js 的（老闆版同一套）；清單記在這支手機上。
import { esc, today, ls } from '../core/util.js';
import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { scanQR } from '../core/qr.js';
import { findByCode } from './stock.js';
import { lblParse, drawLabel, itemOf, queueLabels, pickGoods, fixSheet, pickPrinter, curPrinter, printers, STT, recentLabels, rememberLabels, recentHTML } from './label.js';

const KEY = 'zr.m.staff.lbl';
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); };
let st = null, lastJob = '', busy = false;
const load = () => { if (!st) { const x = ls.get(KEY, null); st = x && Array.isArray(x.items) ? x : { items: [] }; } return st; };
const keep = () => ls.set(KEY, st);
const add = gid => { const g = store.get('goods', gid); if (!g) return; load().items.unshift({ gid, per: '', n: 1, unit: g.unit || 'PCS' }); keep(); };

export function staffPage(view) {
  const s = load(); const pr = curPrinter(); const many = printers().length > 1;
  const total = s.items.reduce((a, x) => a + (Math.round(+x.n) || 0), 0);
  view.innerHTML = `<div class="hd"><h1>印標籤</h1><span class="sp"></span><span class="sub">${esc(store.user.name)}</span><button class="chip" id="slo">登出</button></div>
    <button type="button" class="sbtn pick" id="spr"><small>標籤機${many ? '（按這裡換）' : ''}</small><b>🖨 ${esc(pr.name)}</b></button>
    <div class="sgrid"><button type="button" class="sbtn" id="sadd"><b>🔍 找商品</b></button><button type="button" class="sbtn" id="sscan"><b>📷 掃 QR 碼</b></button></div>
    <div id="sli">${s.items.map((x, i) => card(x, i)).join('') || '<div class="card ph"><b>還沒有標籤</b><span class="muted">按上面「找商品」或「掃 QR 碼」加進來。</span></div>'}</div>
    <div id="serr" class="err"></div>
    ${s.items.length ? `<button type="button" class="sbtn go" id="sgo"><b>列印 ${total} 張</b><small>印到「${esc(pr.name)}」</small></button><p><button class="btn ghost danger" id="sclr">全部清掉</button></p>` : ''}
    <div id="src">${recentHTML()}</div>
    <div class="note" id="sph"></div>`;
  const $ = q => view.querySelector(q); const redraw = () => staffPage(view);
  s.items.forEach((x, i) => { const cv = view.querySelector(`[data-cv="${i}"]`); if (cv) drawLabel(cv, itemOf(x, today())).catch(() => {}); });
  $('#slo').onclick = async () => { if (!window.confirm('要登出嗎？')) return; try { await api.logout(); } catch (e) {} await store.clearCache(); location.reload(); };
  $('#spr').onclick = () => pickPrinter(redraw);
  $('#sadd').onclick = () => pickGoods(redraw, gid => add(gid));
  $('#sscan').onclick = () => scanQR(text => { const g = findByCode(text); if (!g) { toast('找不到料號：' + text); return; } add(g.id); redraw(); }, { title: '掃商品 QR 碼' });
  const li = $('#sli');
  li.addEventListener('change', ev => { const x = s.items[+ev.target.closest('[data-i]')?.dataset.i]; if (!x) return; const f = ev.target.dataset.f;
    if (f === 'per') x.per = ev.target.value; if (f === 'n') x.n = Math.max(1, Math.round(+ev.target.value) || 1); keep(); redraw(); });
  li.addEventListener('focusin', ev => { if (ev.target.dataset.f) ev.target.select(); });
  li.addEventListener('click', ev => {
    const card0 = ev.target.closest('[data-i]'); if (!card0) return; const i = +card0.dataset.i; const x = s.items[i];
    const step = ev.target.closest('[data-step]'); if (step) { x.n = Math.max(1, (Math.round(+x.n) || 1) + +step.dataset.step); keep(); redraw(); return; }
    if (ev.target.closest('[data-del]')) { s.items.splice(i, 1); keep(); redraw(); return; }
    if (ev.target.closest('[data-fix]')) fixSheet(store.get('goods', x.gid), redraw);
  });
  $('#src').addEventListener('click', ev => { const b = ev.target.closest('[data-rc]'); if (!b) return; const x = recentLabels()[+b.dataset.rc]; if (!x) return; s.items.unshift({ gid: x.gid, per: x.per, n: x.n, unit: x.unit }); keep(); redraw(); window.scrollTo(0, 0); });
  $('#sclr')?.addEventListener('click', () => { if (!window.confirm('把清單全部清掉？')) return; s.items = []; keep(); redraw(); });
  $('#sgo')?.addEventListener('click', () => print(view));
  status(view);
}
function card(x, i) {
  const g = store.get('goods', x.gid) || {}; const p = lblParse(g);
  return `<div class="card scard ${p.ok ? '' : 'warnbox'}" data-i="${i}">
    <div class="lnh"><div class="gm"><b>${esc(g.name || '（商品已刪除）')}</b><small>${esc(g.code || '')}</small></div><button class="x" data-del aria-label="拿掉">×</button></div>
    <canvas class="lblcv" data-cv="${i}" width="400" height="320"></canvas>
    ${p.ok ? '' : `<div class="err" style="margin:6px 0 0">這個品名的標籤文字還沒確認：${esc(p.why)} <button class="chip" data-fix>確認文字</button></div>`}
    <div class="srow"><label>每張數量（${esc(x.unit)}）<input data-f="per" inputmode="decimal" value="${esc(x.per)}" placeholder="例如 1000"></label>
      <div class="scnt"><span>張數</span><div><button type="button" data-step="-1" aria-label="少一張">−</button><input data-f="n" inputmode="numeric" value="${esc(x.n)}"><button type="button" data-step="1" aria-label="多一張">＋</button></div></div></div></div>`;
}
async function print(view) {
  if (busy) return; const s = load(); const err = view.querySelector('#serr'); err.textContent = '';
  const bad = s.items.filter(x => !lblParse(store.get('goods', x.gid) || {}).ok).length;
  const msg = s.items.some(x => !(+x.per > 0)) ? '每一種都要填「每張數量」' : bad ? `有 ${bad} 種的標籤文字還沒確認（黃色框），按「確認文字」` : '';
  if (msg) { err.textContent = msg; toast(msg); return; }
  busy = true; const btn = view.querySelector('#sgo'); btn.disabled = true;
  try {
    const labels = [];
    for (const x of s.items) { const cv = document.createElement('canvas'); await drawLabel(cv, itemOf(x, today())); labels.push({ cv, copies: Math.max(1, Math.round(+x.n) || 1) }); }
    const n = labels.reduce((a, l) => a + l.copies, 0);
    lastJob = await queueLabels(labels, `標籤 ${n} 張`);
    rememberLabels([...s.items].reverse()); s.items = []; keep(); toast(`已送出 ${n} 張，到「${curPrinter().name}」拿標籤`); staffPage(view); window.scrollTo(0, 0);
  } catch (e) { err.textContent = e.message || String(e); toast(e.message || String(e)); btn.disabled = false; }
  busy = false;
}
async function status(view) {
  const ph = view.querySelector('#sph'); if (!ph) return;
  const j = lastJob ? store.get('printjobs', lastJob) : null;
  ph.innerHTML = j ? `<div class="pst ${j.status}">${STT[j.status] || j.status}${j.msg ? `<small>${esc(j.msg)}</small>` : ''}</div>` : '';
  try { const r = await (await fetch('/api/print/helper', { credentials: 'same-origin' })).json(); if (!r.online && ph.isConnected && !ph.querySelector('.hw')) ph.insertAdjacentHTML('beforeend', '<div class="hw">⚠ 主機的列印小幫手沒有開，標籤會先排隊，請跟老闆說</div>'); } catch (e) {}
}
/** 資料有變動（列印狀態、商品、標籤機設定）時更新畫面；正在打字就只更新狀態 */
export function onStaffChange(view, ch) {
  if (ch.has('printjobs')) status(view);
  if ((ch.has('settings') || ch.has('goods')) && !view.contains(document.activeElement)) staffPage(view);
}
