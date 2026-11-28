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

/** 這個帳號要不要用平板版：帳號 tcl，或使用者資料裡標 pad */
export const isPad = u => !!u && (String(u.login || '').toLowerCase() === 'tcl' || u.pad === true || u.role === 'pad');

const TABS = [['lbl', '🏷', '印標籤'], ['count', '📋', '盤點']];
let pv = null, lastInput = null;

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
  document.addEventListener('focusin', ev => { const t = ev.target; if (t.matches?.('input') && !calc.contains(t) && (t.inputMode === 'decimal' || t.inputMode === 'numeric' || t.type === 'number')) lastInput = t; });
  const clk = () => { const e = view.querySelector('#pclk'); if (!e) return; const d = new Date(); e.textContent = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  clk(); setInterval(clk, 20000);
  const route = () => {
    const k = location.hash.startsWith('#count') ? 'count' : 'lbl';
    view.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === k));
    lastInput = null;
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
    <button type="button" class="sbtn pcfill" id="pcf"><b>填入</b><small id="pcfh">先點一下要填的數量欄</small></button>
    <div class="pchist" id="pch"></div>`;
  const $ = q => box.querySelector(q);
  const paint = () => {
    const r = evaluate(C.expr);
    $('#pce').textContent = C.just ? C.hist[0]?.e + ' =' : C.expr || ' ';
    $('#pcr').textContent = C.expr ? show(C.just ? C.hist[0]?.r : r) || '0' : '0';
    $('#pch').innerHTML = C.hist.length ? '<small>剛剛算的（點一下再用）</small>' + C.hist.map((h, i) => `<button type="button" data-h="${i}"><span>${esc(h.e)} =</span><b>${esc(show(h.r))}</b></button>`).join('') : '';
  };
  const press = k => {
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
  $('#pcf').onclick = () => {
    const r = C.expr ? evaluate(C.expr) : null; const inp = lastInput && lastInput.isConnected ? lastInput : null;
    if (r === null || Number.isNaN(r)) { flash('先算出一個數字'); return; }
    if (!inp) { flash('先點一下要填的數量欄，再按填入'); return; }
    const v = inp.inputMode === 'numeric' ? String(Math.round(r)) : String(r);
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
    flash(`已填入 ${show(+v)}`); box.classList.remove('open');
  };
  const flash = msg => { const h = $('#pcfh'); h.textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(() => h.textContent = '先點一下要填的數量欄', 2600); };
  // 實體鍵盤（藍牙鍵盤）：游標不在輸入框時可以直接打
  document.addEventListener('keydown', ev => {
    if (ev.target.matches?.('input,textarea,select') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const m = { '*': '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', '%': '%', '.': '.' };
    const k = /^[0-9]$/.test(ev.key) ? ev.key : m[ev.key]; if (!k) return;
    ev.preventDefault(); press(k);
  });
  paint();
}
