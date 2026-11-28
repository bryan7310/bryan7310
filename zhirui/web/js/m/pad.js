// 打包區平板版（TCL 護眼平板 11 吋）：帳號 tcl（或之後角色設成平板的帳號）登入 /m/ 看到的畫面。
//   上面兩個大分頁：印標籤（staff.js 員工版同一套）、盤點（count.js 同一套）；右邊一直放著計算機。
//   橫放：左邊作業、右邊計算機；直放（比較窄）：計算機收在右下角的「🧮」按鈕，點開從右邊滑出來。
//   護眼：米白紙色底、不用純白、字黑、按鍵大；TCL 的「墨水紙模式」（黑白）也看得清楚（選中狀態用粗框，不只靠顏色）。
//   計算機「填入」：把結果填到剛剛點過的數字欄（例如標籤的「每張數量」、盤點的數量）。
import { esc } from '../core/util.js';
import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { staffPage, onStaffChange } from './staff.js';
import { countPage } from './count.js';
import { goodsWt, wtSrc } from '../core/calc.js';

/** 這個帳號要不要用平板版：帳號 tcl，或使用者資料裡標 pad */
export const isPad = u => !!u && (String(u.login || '').toLowerCase() === 'tcl' || u.pad === true || u.role === 'pad');

const TABS = [['lbl', '🏷', '印標籤'], ['count', '📋', '盤點']];
let pv = null, lastInput = null, lastAt = null;
// 畫面重畫後（例如改了每張數量）原本的欄位會換新的：用「第幾張卡片＋哪一欄」再找回來
const curInput = () => {
  if (lastInput && lastInput.isConnected) return lastInput;
  if (!lastAt) return null;
  const card = document.querySelector(`[data-i="${lastAt.i}"][data-gid="${lastAt.gid}"]`); const f = card && lastAt.f ? card.querySelector(`[data-f="${lastAt.f}"]`) : null;
  if (f) return (lastInput = f);
  return null;
};

export function padBoot(view) {
  document.body.classList.add('staff', 'pad');
  view.innerHTML = `<header class="padhd"><b class="padlogo">志瑞・打包區</b>
      <nav class="padtabs">${TABS.map(([k, i, n]) => `<a href="#${k === 'lbl' ? '' : k}" data-tab="${k}"><span>${i}</span>${n}</a>`).join('')}</nav>
      <span class="sp"></span><span class="padclock" id="pclk"></span><span class="padme">${esc(store.user.name)}</span><button class="chip" id="plo">登出</button></header>
    <div class="padgrid"><section id="pv" class="padmain"></section>
      <aside class="padcalc" id="pcalc" aria-label="計算機"></aside></div>
    <button type="button" class="padfab" id="pfab" aria-label="打開計算機">🧮</button>`;
  pv = view.querySelector('#pv');
  const hd = view.querySelector('.padhd'); const fit = () => document.body.style.setProperty('--padhd', hd.offsetHeight + 'px'); fit(); window.addEventListener('resize', fit);
  calcInit(view.querySelector('#pcalc'));
  view.querySelector('#plo').onclick = async () => { if (!window.confirm('要登出嗎？')) return; try { await api.logout(); } catch (e) {} await store.clearCache(); location.reload(); };
  const calc = view.querySelector('#pcalc');
  view.querySelector('#pfab').onclick = () => calc.classList.toggle('open');
  // 記住最後點的數字欄（計算機「填入」用）；不記計算機自己
  document.addEventListener('focusin', ev => { const t = ev.target; if (t.matches?.('input') && !calc.contains(t) && (t.inputMode === 'decimal' || t.inputMode === 'numeric' || t.type === 'number')) { lastInput = t; const c = t.closest('[data-gid]'); lastAt = c ? { gid: c.dataset.gid, i: c.dataset.i, f: t.dataset.f } : null; } });
  const clk = () => { const e = view.querySelector('#pclk'); if (!e) return; const d = new Date(); e.textContent = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  clk(); setInterval(clk, 20000);
  const route = () => {
    const k = location.hash.startsWith('#count') ? 'count' : 'lbl';
    view.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === k));
    lastInput = null; lastAt = null;
    if (k === 'count') countPage(pv, { back: '#' }); else staffPage(pv);
    window.scrollTo(0, 0);
  };
  store.subscribe(ch => { if (!location.hash.startsWith('#count')) onStaffChange(pv, ch); });
  window.addEventListener('hashchange', route);
  route();
}

// ---------- 計算機（不用 eval，自己算；四則運算、先乘除後加減、%）----------
const C = { expr: '', hist: [], just: false };
const OPS = { '+': 1, '−': 1, '×': 2, '÷': 2 };
function evaluate(s) {
  const tk = []; let num = '';
  for (const ch of s) {
    if (/[0-9.]/.test(ch)) num += ch;
    else if (ch === '%') { if (num) { tk.push(+num / 100); num = ''; } else if (typeof tk[tk.length - 1] === 'number') tk.push(tk.pop() / 100); }
    else if (OPS[ch]) { if (num) { tk.push(+num); num = ''; } if (!tk.length && ch === '−') { num = '-'; continue; } if (typeof tk[tk.length - 1] !== 'number') { if (ch === '−') { num = '-'; continue; } tk.pop(); } tk.push(ch); }
  }
  if (num && num !== '-') tk.push(+num);
  while (tk.length && typeof tk[tk.length - 1] !== 'number') tk.pop();
  if (!tk.length || tk.some(t => typeof t === 'number' && !isFinite(t))) return null;
  const out = [], st = [];
  for (const t of tk) {
    if (typeof t === 'number') { out.push(t); continue; }
    while (st.length && OPS[st[st.length - 1]] >= OPS[t]) out.push(st.pop());
    st.push(t);
  }
  while (st.length) out.push(st.pop());
  const v = [];
  for (const t of out) {
    if (typeof t === 'number') { v.push(t); continue; }
    const b = v.pop(), a = v.pop(); if (a === undefined || b === undefined) return null;
    v.push(t === '+' ? a + b : t === '−' ? a - b : t === '×' ? a * b : b === 0 ? NaN : a / b);
  }
  const r = v[0]; return isFinite(r) ? +r.toPrecision(12) : NaN;
}
const show = n => n === null ? '' : Number.isNaN(n) ? '不能除以 0' : n.toLocaleString('en-US', { maximumFractionDigits: 6 });
const KEYS = [['C', 'fn'], ['⌫', 'fn'], ['%', 'fn'], ['÷', 'op'], ['7'], ['8'], ['9'], ['×', 'op'], ['4'], ['5'], ['6'], ['−', 'op'], ['1'], ['2'], ['3'], ['+', 'op'], ['00'], ['0'], ['.'], ['=', 'eq']];

function calcInit(box) {
  box.innerHTML = `<div class="pchd"><b>🧮 計算機</b><span class="sp"></span><button type="button" class="chip" id="pcx" aria-label="收起計算機">收起</button></div>
    <div class="pcdisp"><div class="pcexpr" id="pce"></div><div class="pcres" id="pcr">0</div></div>
    <div class="pckeys">${KEYS.map(([k, c]) => `<button type="button" class="pk ${c || ''}" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="pcconv"><button type="button" class="pk cv" data-cv="kg">公斤→支數</button><button type="button" class="pk cv" data-cv="pcs">支數→公斤</button><button type="button" class="pk cv pcfill" id="pcf">填入</button></div>
    <div class="pchint" id="pcfh">先點一下要填的數量欄，算好按「填入」</div>
    <div class="pcbox" id="pcb" hidden></div>
    <div class="pchist" id="pch"></div>`;
  const $ = q => box.querySelector(q);
  const paint = () => {
    const r = evaluate(C.expr);
    $('#pce').textContent = C.just ? C.hist[0]?.e + ' =' : C.expr || ' ';
    $('#pcr').textContent = C.expr ? show(C.just ? C.hist[0]?.r : r) || '0' : '0';
    $('#pch').innerHTML = C.hist.length ? '<small>剛剛算的（點一下再用）</small>' + C.hist.map((h, i) => `<button type="button" data-h="${i}"><span>${esc(h.e)} =</span><b>${esc(show(h.r))}</b></button>`).join('') : '';
  };
  const press = k => {
    if (cv) return cvKey(k);
    if (k === 'C') { C.expr = ''; C.just = false; }
    else if (k === '⌫') { if (C.just) { C.just = false; } C.expr = C.expr.slice(0, -1); }
    else if (k === '=') { const r = evaluate(C.expr); if (r === null) return; if (!Number.isNaN(r) && !C.just) { C.hist.unshift({ e: C.expr, r }); C.hist = C.hist.slice(0, 6); } C.expr = Number.isNaN(r) ? '' : String(r); C.just = !Number.isNaN(r); if (Number.isNaN(r)) { $('#pcr').textContent = show(r); return; } }
    else if (OPS[k]) { C.just = false; if (OPS[C.expr.slice(-1)] && C.expr.length > 1) C.expr = C.expr.slice(0, -1); C.expr += k; }
    else { if (C.just) { C.expr = ''; C.just = false; } if (k === '.') { const last = C.expr.split(/[+−×÷]/).pop(); if (last.includes('.')) return; if (!last) C.expr += '0'; } if (C.expr.length < 40) C.expr += k; }
    paint();
  };
  box.querySelector('.pckeys').addEventListener('click', ev => { const b = ev.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  $('#pch').addEventListener('click', ev => { const b = ev.target.closest('[data-h]'); if (!b) return; const h = C.hist[+b.dataset.h]; C.expr = String(h.r); C.just = false; paint(); });
  $('#pcx').onclick = () => box.classList.remove('open');
  // ---- 公斤 ⇄ 支數：數字用計算機目前的結果；單重先抓正在處理的商品（標籤卡片、盤點表單），沒有就自己填 ----
  const ctxGoods = () => {
    const el = document.querySelector('.sheet[data-gid]') || curInput()?.closest('[data-gid]') || (lastAt && document.querySelector(`[data-gid="${lastAt.gid}"]`));
    const g = el ? store.get('goods', el.dataset.gid) : null; if (!g) return null;
    const adw = el.querySelector?.('#adw'); const typed = adw ? +String(adw.value).replace(/,/g, '') : 0;
    if (typed > 0) return { g, w: typed, src: '盤點表單填的單重' };
    if (+g.wt > 0) return { g, w: +g.wt, src: '商品資料的單重' };
    const e = goodsWt(g); return { g, w: e ? +(+e).toPrecision(4) : '', src: e ? wtSrc(g) + '（約）' : '' };
  };
  let cv = null;   // { dir: 'kg'|'pcs', v, g, w（字串，用計算機按鍵打）, src, fresh（還沒動過：第一下按鍵整個換掉）, save }
  const cvW = () => +String(cv.w).replace(/,/g, '') || 0;
  const cvR = () => { const w = cvW(); return w > 0 ? (cv.dir === 'kg' ? Math.round(cv.v * 1000 / w) : +(cv.v * w / 1000).toPrecision(10)) : null; };
  const cvPaint = () => {
    const b = $('#pcb'); box.classList.toggle('conv', !!cv); if (!cv) { b.hidden = true; b.innerHTML = ''; return; }
    const r = cvR(); const w = cvW(); const canSave = cv.g && w > 0 && w !== +cv.g.wt;
    b.hidden = false;
    b.innerHTML = `<div class="pcbh"><b>${cv.dir === 'kg' ? '公斤 → 支數' : '支數 → 公斤'}</b><span class="muted small pcgn">${cv.g ? esc(cv.g.name) : '沒有選商品'}</span><button type="button" class="chip" data-cvx>關閉</button></div>
      <div class="pcrow"><span>${show(cv.v)} ${cv.dir === 'kg' ? 'KG' : '支'}</span><span class="pcwl">單重 g／支<output class="pcwv ${cv.fresh ? 'sel' : ''}" id="pcw">${esc(cv.w) || '<i>用下面按鍵打</i>'}</output></span></div>
      <div class="pcout"><small>${esc(cv.src || (cv.g ? '這個商品還沒有單重' : '用下面的按鍵打單重'))}</small><b>${r === null ? '先打單重' : cv.dir === 'kg' ? `＝ ${show(r)} 支` : `＝ ${show(r)} KG`}</b></div>
      <div class="pcact">${canSave ? `<label class="pcsv"><input type="checkbox" id="pcsv" ${cv.save ? 'checked' : ''}>存成商品單重</label>` : '<span></span>'}<button type="button" class="pk eq" data-cvok ${r === null ? 'disabled' : ''}>用這個結果</button></div>`;
    b.querySelector('[data-cvx]').onclick = () => { cv = null; cvPaint(); };
    b.querySelector('#pcsv')?.addEventListener('change', ev => { cv.save = ev.target.checked; });
    b.querySelector('[data-cvok]').onclick = cvOk;
  };
  const cvOk = async () => {
    const r = cvR(); if (r === null) { flash('先打單重'); return; }
    const w = cvW();
    if (cv.save && cv.g && w > 0) { const g = store.get('goods', cv.g.id); if (g) { try { await store.save('goods', g.id, { ...g, wt: w }); store.log?.('改單重', `${g.name}：${g.wt || '—'} → ${w} g（平板計算機）`); const adw = document.querySelector('.sheet[data-gid] #adw'); if (adw && !adw.value) adw.value = w; flash(`單重 ${w} g 已存到商品`); } catch (e) { flash('單重沒存成功：' + (e.message || e)); } } }
    C.hist.unshift({ e: cv.dir === 'kg' ? `${show(cv.v)}KG÷${w}g` : `${show(cv.v)}支×${w}g`, r }); C.hist = C.hist.slice(0, 6);
    C.expr = String(r); C.just = true; cv = null; cvPaint(); paint();
  };
  // 換算框開著的時候，計算機按鍵是在打單重（不會跳出平板的鍵盤）
  const cvKey = k => {
    if (k === '=') return cvOk();
    if (k === 'C') { cv.w = ''; cv.fresh = false; }
    else if (k === '⌫') { cv.w = cv.fresh ? '' : String(cv.w).slice(0, -1); cv.fresh = false; }
    else if (/^[0-9]+$/.test(k) || k === '.') { let t = cv.fresh ? '' : String(cv.w); cv.fresh = false; if (k === '.') { if (t.includes('.')) return; if (!t) t = '0'; } if (t.length < 10) t += k; cv.w = t; }
    else { flash('現在在打單重；按「＝」或「用這個結果」完成'); return; }
    cvPaint();
  };
  box.querySelectorAll('[data-cv]').forEach(btn => btn.onclick = () => {
    const v = C.expr ? (C.just ? C.hist[0]?.r : evaluate(C.expr)) : null;
    if (v === null || v === undefined || Number.isNaN(v) || !(v > 0)) { flash(btn.dataset.cv === 'kg' ? '先用計算機打公斤數，再按換算' : '先用計算機打支數，再按換算'); return; }
    const c = ctxGoods(); cv = { dir: btn.dataset.cv, v, g: c?.g || null, w: c?.w ? String(c.w) : '', src: c?.src || '', fresh: true, save: !!(c?.g && !(+c.g.wt > 0)) }; cvPaint();
  });
  $('#pcf').onclick = () => {
    const r = C.expr ? evaluate(C.expr) : null; const inp = curInput();
    if (r === null || Number.isNaN(r)) { flash('先算出一個數字'); return; }
    if (!inp) { flash('先點一下要填的數量欄，再按填入'); return; }
    const v = inp.inputMode === 'numeric' ? String(Math.round(r)) : String(r);
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
    flash(`已填入 ${show(+v)}`); box.classList.remove('open');
  };
  const flash = msg => { const h = $('#pcfh'); h.textContent = msg; clearTimeout(flash.t); h.classList.add('on'); flash.t = setTimeout(() => { h.textContent = '先點一下要填的數量欄，算好按「填入」'; h.classList.remove('on'); }, 2600); };
  // 實體鍵盤（藍牙鍵盤）：游標不在輸入框時可以直接打
  document.addEventListener('keydown', ev => {
    if (ev.target.matches?.('input,textarea,select') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const m = { '*': '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', '%': '%', '.': '.' };
    const k = /^[0-9]$/.test(ev.key) ? ev.key : m[ev.key]; if (!k) return;
    ev.preventDefault(); press(k);
  });
  paint();
}
