// 員工版 App：一般員工帳號登入手機版看到的畫面。首頁是「印標籤」，另外有「盤點」（#count，count.js 跟管理者版共用）。按鍵大、步驟少：
//   選標籤機 → 找商品（或掃 QR 碼）→ 填每張數量、張數 → 列印。
// 標籤的畫法、TSPL、標籤機清單都用 label.js 的（管理者版同一套）；清單記在這支手機上。
import { esc, today, ls } from '../core/util.js';
import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { goodsWt, wtSrc } from '../core/calc.js';
import { scanQR } from '../core/qr.js';
import { findByCode } from './stock.js';
import { lblParse, drawLabel, itemOf, queueLabels, pickGoods, fixSheet, pickPrinter, curPrinter, printers, STT, recentLabels, rememberLabels, recentHTML } from './label.js';

const KEY = 'zr.m.staff.lbl';
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); };
let st = null, lastJob = '', busy = false;
const load = () => { if (!st) { const x = ls.get(KEY, null); st = x && Array.isArray(x.items) ? x : { items: [] }; } return st; };
const keep = () => ls.set(KEY, st);
// 標籤上的單重：沒改過就跟商品資料的單重走（商品沒有單重就不印）；作業員在卡片上改過（或清空）就照改的
// 商品沒登錄單重時用估的（螺絲查價的單重參考 → 依規格估算），標籤上印「約」
const wtOf = x => { if (x.wt !== undefined) return x.wt; const w = goodsWt(store.get('goods', x.gid)); return w > 0 ? String(+(+w).toPrecision(3)) : ''; };
const wtEst = x => x.wt === undefined && !(+store.get('goods', x.gid)?.wt > 0) && !!wtOf(x);
const itOf = x => itemOf({ ...x, wt: wtOf(x) ? (wtEst(x) ? '約' : '') + wtOf(x) : '' }, today());
const packHint = () => { const a = store.list('packs').filter(o => !(o.steps || {}).done); const late = a.filter(o => o.due && o.due < today()).length; return a.length ? `要包裝 ${a.length} 筆${late ? `・逾期 ${late}` : ''}` : '目前沒有要包裝的'; };
const add = gid => { const g = store.get('goods', gid); if (!g) return; load().items.unshift({ gid, per: '', n: 1, unit: g.unit || 'PCS' }); keep(); };

/** 從別頁（包裝排程）把商品加進印標籤清單 */
export function addStaffLabel(gid) { add(gid); }
export function staffPage(view) {
  const s = load(); const pr = curPrinter(); const many = printers().length > 1;
  const total = s.items.reduce((a, x) => a + (Math.round(+x.n) || 0), 0);
  view.innerHTML = `<div class="hd"><h1>印標籤</h1><span class="sp"></span><span class="sub">${esc(store.user.name)}</span><button class="chip" id="slo">登出</button></div>
    <button type="button" class="sbtn pick" id="spr"><small>標籤機${many ? '（按這裡換）' : ''}</small><b>🖨 ${esc(pr.name)}</b></button>
    <div class="sgrid"><button type="button" class="sbtn" id="sadd"><b>🔍 找商品</b></button><button type="button" class="sbtn" id="sscan"><b>📷 掃 QR 碼</b></button></div>
    <button type="button" class="sbtn pick" id="scnt"><small>盤點表、掃碼盤點、印盤點標籤</small><b>📋 盤點</b></button>
    <button type="button" class="sbtn pick" id="spk"><small>${packHint()}</small><b>📦 包裝排程</b></button>
    <div id="sli">${s.items.map((x, i) => card(x, i)).join('') || '<div class="card ph"><b>還沒有標籤</b><span class="muted">按上面「找商品」或「掃 QR 碼」加進來。</span></div>'}</div>
    <div id="serr" class="err"></div>
    ${s.items.length ? `<button type="button" class="sbtn go" id="sgo"><b>列印 ${total} 張</b><small>印到「${esc(pr.name)}」</small></button><p><button class="btn ghost danger" id="sclr">全部清掉</button></p>` : ''}
    <div class="note" id="sph"></div>
    <div id="src">${recentHTML()}</div>`;
  const $ = q => view.querySelector(q); const redraw = () => staffPage(view);
  s.items.forEach((x, i) => { const cv = view.querySelector(`[data-cv="${i}"]`); if (cv) drawLabel(cv, itOf(x)).catch(() => {}); });
  $('#slo').onclick = async () => { if (!window.confirm('要登出嗎？')) return; try { await api.logout(); } catch (e) {} await store.clearCache(); location.reload(); };
  $('#spr').onclick = () => pickPrinter(redraw);
  $('#scnt').onclick = () => { location.hash = '#count'; };
  $('#spk').onclick = () => { location.hash = '#packs'; };
  $('#sadd').onclick = () => pickGoods(redraw, gid => add(gid));
  $('#sscan').onclick = () => scanQR(text => { const g = findByCode(text); if (!g) { toast('找不到料號：' + text); return; } add(g.id); redraw(); }, { title: '掃商品 QR 碼' });
  const li = $('#sli');
  li.addEventListener('change', ev => { const x = s.items[+ev.target.closest('[data-i]')?.dataset.i]; if (!x) return; const f = ev.target.dataset.f;
    if (f === 'per') x.per = ev.target.value; if (f === 'wt') x.wt = ev.target.value.trim().replace(/,/g, ''); if (f === 'n') x.n = Math.max(1, Math.round(+ev.target.value) || 1); keep(); redraw(); });
  li.addEventListener('focusin', ev => { if (ev.target.dataset.f) ev.target.select(); });
  li.addEventListener('click', ev => {
    const card0 = ev.target.closest('[data-i]'); if (!card0) return; const i = +card0.dataset.i; const x = s.items[i];
    const step = ev.target.closest('[data-step]'); if (step) { x.n = Math.max(1, (Math.round(+x.n) || 1) + +step.dataset.step); keep(); redraw(); return; }
    if (ev.target.closest('[data-del]')) { s.items.splice(i, 1); keep(); redraw(); return; }
    if (ev.target.closest('[data-fix]')) fixSheet(store.get('goods', x.gid), redraw);
  });
  $('#src').addEventListener('click', ev => { const b = ev.target.closest('[data-rc]'); if (!b) return; ev.preventDefault(); const x = recentLabels()[+b.dataset.rc]; if (!x) return; s.items.unshift({ gid: x.gid, per: x.per, n: x.n, unit: x.unit }); keep(); redraw(); window.scrollTo(0, 0); });
  $('#sclr')?.addEventListener('click', () => { if (!window.confirm('把清單全部清掉？')) return; s.items = []; keep(); redraw(); });
  $('#sgo')?.addEventListener('click', () => print(view));
  status(view);
}
function card(x, i) {
  const g = store.get('goods', x.gid) || {}; const p = lblParse(g);
  return `<div class="card scard ${p.ok ? '' : 'warnbox'}" data-i="${i}" data-gid="${esc(x.gid)}">
    <div class="lnh"><div class="gm"><b>${esc(g.name || '（商品已刪除）')}</b><small>${esc(g.code || '')}</small></div><button class="x" data-del aria-label="拿掉">×</button></div>
    <canvas class="lblcv" data-cv="${i}" width="400" height="320"></canvas>
    ${p.ok ? '' : `<div class="err" style="margin:6px 0 0">這個品名的標籤文字還沒確認：${esc(p.why)} <button class="chip" data-fix>確認文字</button></div>`}
    <div class="srow"><label>每張數量（${esc(x.unit)}）<input data-f="per" inputmode="decimal" value="${esc(x.per)}" placeholder="例如 1000"></label>
      <div class="scnt"><span>張數</span><div><button type="button" data-step="-1" aria-label="少一張">−</button><input data-f="n" inputmode="numeric" value="${esc(x.n)}"><button type="button" data-step="1" aria-label="多一張">＋</button></div></div></div>
    <label class="swt"><span>單重 g／支${wtEst(x) ? `<b class="west">估算（${esc(wtSrc(store.get('goods', x.gid)))}）</b>秤過請改成實際的` : '（印在標籤上；空白就不印）'}</span><input data-f="wt" inputmode="decimal" value="${esc(wtOf(x))}" placeholder="沒有單重"></label></div>`;
}
async function print(view) {
  if (busy) return; const s = load(); const err = view.querySelector('#serr'); err.textContent = '';
  const bad = s.items.filter(x => !lblParse(store.get('goods', x.gid) || {}).ok).length;
  const msg = s.items.some(x => !(+x.per > 0)) ? '每一種都要填「每張數量」' : bad ? `有 ${bad} 種的標籤文字還沒確認（黃色框），按「確認文字」` : '';
  if (msg) { err.textContent = msg; toast(msg); return; }
  busy = true; const btn = view.querySelector('#sgo'); btn.disabled = true;
  try {
    const labels = [];
    for (const x of s.items) { const cv = document.createElement('canvas'); await drawLabel(cv, itOf(x)); labels.push({ cv, copies: Math.max(1, Math.round(+x.n) || 1) }); }
    const n = labels.reduce((a, l) => a + l.copies, 0);
    lastJob = await queueLabels(labels, `標籤 ${n} 張`);
    rememberLabels([...s.items].reverse().map(x => ({ ...x, wt: wtOf(x) }))); s.items = []; keep(); toast(`已送出 ${n} 張，到「${curPrinter().name}」拿標籤`); staffPage(view); window.scrollTo(0, 0);
  } catch (e) { err.textContent = e.message || String(e); toast(e.message || String(e)); btn.disabled = false; }
  busy = false;
}
async function status(view) {
  const ph = view.querySelector('#sph'); if (!ph) return;
  const j = lastJob ? store.get('printjobs', lastJob) : null;
  ph.innerHTML = j ? `<div class="pst ${j.status}">${STT[j.status] || j.status}${j.msg ? `<small>${esc(j.msg)}</small>` : ''}</div>` : '';
  try { const r = await (await fetch('/api/print/helper', { credentials: 'same-origin' })).json(); if (!r.online && ph.isConnected && !ph.querySelector('.hw')) ph.insertAdjacentHTML('beforeend', '<div class="hw">⚠ 主機的列印小幫手沒有開，標籤會先排隊，請跟管理者說</div>'); } catch (e) {}
}
/** 資料有變動（列印狀態、商品、標籤機設定）時更新畫面；正在打字就只更新狀態 */
export function onStaffChange(view, ch) {
  if (ch.has('printjobs')) status(view);
  if ((ch.has('settings') || ch.has('goods') || ch.has('packs')) && !view.contains(document.activeElement)) staffPage(view);
}
