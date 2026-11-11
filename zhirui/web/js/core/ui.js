// 共用介面元件：提示、對話框、確認、下拉搜尋、分頁、分段按鈕
import { $, esc, matchQ, qTerms } from './util.js';

let toastT, toastUndo;
export function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" id="toastUndo">復原</button>' : ''}`;
  t.hidden = false; clearTimeout(toastT);
  toastUndo = undo;
  if (undo) $('#toastUndo').onclick = () => { t.hidden = true; const f = toastUndo; toastUndo = null; f && f(); };
  toastT = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 2600);
}

/** 開對話框。opts: {title, body(html), footer(html), width, onOpen(el, close), closeOnBg} → 回傳 {el, close} */
export function modal(opts) {
  const host = $('#modals');
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="--mw:${opts.width || 720}px">
    <div class="mh"><h2>${esc(opts.title || '')}</h2><span class="sp"></span>${opts.headExtra || ''}<button class="icon-btn" data-close aria-label="關閉"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="mb">${opts.body || ''}</div>
    ${opts.footer != null ? `<div class="mf">${opts.footer}</div>` : ''}</div>`;
  host.append(bg);
  const el = bg.firstElementChild;
  const close = v => { bg.remove(); document.querySelectorAll('.combo-list').forEach(x => x.remove()); document.removeEventListener('keydown', onKey); opts.onClose && opts.onClose(v); };
  const onKey = e => { if (e.key === 'Escape' && host.lastElementChild === bg) { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', e => { if (e.target === bg && opts.closeOnBg !== false) close(); });
  el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => close()));
  setTimeout(() => { const f = el.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button.pri'); f && f.focus(); }, 30);
  opts.onOpen && opts.onOpen(el, close);
  return { el, close };
}
export function confirm(msg, opts = {}) {
  return new Promise(res => {
    modal({
      title: opts.title || '請確認', width: 420,
      body: `<div style="white-space:pre-wrap">${esc(msg)}</div>`,
      footer: `<span class="sp"></span><button class="btn" data-close>${esc(opts.cancel || '取消')}</button><button class="btn ${opts.danger ? 'danger' : 'pri'}" id="cfOk" autofocus>${esc(opts.ok || '確定')}</button>`,
      onOpen: (el, close) => { el.querySelector('#cfOk').onclick = () => { res(true); close(); }; },
      onClose: () => res(false),
    });
  });
}
export function prompt(msg, def = '', opts = {}) {
  return new Promise(res => {
    let val = null;
    modal({
      title: opts.title || msg, width: 420,
      body: `${opts.title ? `<div>${esc(msg)}</div>` : ''}<div class="f"><input id="pmIn" value="${esc(def)}" ${opts.type ? `type="${opts.type}"` : ''} autofocus></div>`,
      footer: `<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="pmOk">${esc(opts.ok || '確定')}</button>`,
      onOpen: (el, close) => { const ok = () => { val = el.querySelector('#pmIn').value; close(); }; el.querySelector('#pmOk').onclick = ok; el.querySelector('#pmIn').addEventListener('keydown', e => { if (e.key === 'Enter') ok(); }); },
      onClose: () => res(val),
    });
  });
}

/** 分段按鈕 */
export const tabs = (key, list, cur) => `<div class="tabs" data-tabs="${key}">${list.map(([k, l]) => `<button type="button" data-val="${esc(k)}" class="${cur === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;

/** 分頁：回傳 [start, end, html] */
export function pager(key, n, page, size = 100) {
  const pages = Math.max(1, Math.ceil(n / size)); const p = Math.min(Math.max(0, page || 0), pages - 1);
  const html = n <= size ? (n ? `<div class="pager">共 ${n.toLocaleString('zh-TW')} 筆</div>` : '')
    : `<div class="pager"><span>共 ${n.toLocaleString('zh-TW')} 筆・第 ${p + 1}/${pages} 頁</span><button class="btn sm" data-page="${key}" data-to="${p - 1}" ${p === 0 ? 'disabled' : ''}>上一頁</button><button class="btn sm" data-page="${key}" data-to="${p + 1}" ${p >= pages - 1 ? 'disabled' : ''}>下一頁</button></div>`;
  return [p * size, Math.min(n, (p + 1) * size), html, p];
}

/**
 * 下拉搜尋輸入框。把 <input data-combo> 變成可搜尋的選單。
 * opts: {items(): [{id, label, sub, text}], value, onPick(item), onClear(), allowFree}
 */
export function combo(input, opts) {
  let list = null, idx = -1, cur = [];
  const wrap = input.parentElement.classList.contains('combo') ? input.parentElement : (() => { const w = document.createElement('div'); w.className = 'combo'; input.replaceWith(w); w.append(input); return w; })();
  // 下拉清單浮在整個畫面最上層（position:fixed 掛在 body），不會被表格外框、對話框捲動區裁掉
  const place = () => {
    if (!list) return; if (!input.isConnected) return close();
    const r = input.getBoundingClientRect(); const vh = window.innerHeight, vw = window.innerWidth;
    const below = vh - r.bottom - 8, above = r.top - 8; const up = below < 180 && above > below;
    const w = Math.min(Math.max(r.width, opts.minWidth || 300), vw - 16);
    list.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px'; list.style.width = w + 'px';
    list.style.maxHeight = Math.max(120, Math.min(320, up ? above : below)) + 'px';
    if (up) { list.style.top = ''; list.style.bottom = (vh - r.top + 4) + 'px'; } else { list.style.bottom = ''; list.style.top = (r.bottom + 4) + 'px'; }
  };
  const onMove = () => place();
  const close = () => { if (list) { list.remove(); list = null; window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); } idx = -1; };
  const render = () => {
    const q = qTerms(input.value);
    const all = opts.items();
    cur = (q.length ? all.filter(it => matchQ(it.text || it.label + ' ' + (it.sub || ''), q)) : all).slice(0, 60);
    if (!list) { list = document.createElement('div'); list.className = 'combo-list'; document.body.append(list); window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove); }
    place();
    list.innerHTML = cur.length ? cur.map((it, i) => `<div data-i="${i}" class="${i === idx ? 'on' : ''}"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div>`).join('')
      : `<div class="none">${opts.allowFree ? '找不到，直接使用輸入的文字' : '找不到符合的資料'}</div>`;
    list.querySelectorAll('[data-i]').forEach(d => d.addEventListener('mousedown', e => { e.preventDefault(); pick(cur[+d.dataset.i]); }));
  };
  const pick = it => { if (!it) return; input.value = it.label; close(); opts.onPick(it); };
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('focus', () => { render(); input.select && input.select(); });
  input.addEventListener('input', () => { idx = -1; render(); if (opts.onClear && !input.value) opts.onClear(); });
  input.addEventListener('blur', () => setTimeout(() => { close(); opts.onBlur && opts.onBlur(input.value); }, 120));
  input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (!list && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) render();
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(cur.length - 1, idx + 1); render(); list && list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
    else if (e.key === 'Enter') { if (list && (idx >= 0 || cur.length === 1)) { e.preventDefault(); pick(cur[idx >= 0 ? idx : 0]); } else if (list && opts.allowFree) { close(); opts.onBlur && opts.onBlur(input.value); } }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab' && list && cur.length && idx >= 0) pick(cur[idx]);
  });
  return { close, render };
}

/** 把 <form> 裡的欄位讀成物件 */
export function formData(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach(i => { o[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
  return o;
}
export const field = (name, label, value = '', extra = '') => `<div class="f"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" value="${esc(value)}" ${extra}></div>`;
export const selectField = (name, label, value, options, extra = '') => `<div class="f"><label for="f-${name}">${esc(label)}</label><select id="f-${name}" name="${name}" ${extra}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;

/** 開新視窗列印一段 HTML（出貨單、支票、標籤等） */
export function printHTML(title, css, bodyHtml, opts = {}) {
  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器擋住了新視窗，請允許彈出視窗'); return; }
  w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${opts.tip ? `<div class="tip" style="font-family:sans-serif;font-size:13px;background:#fff6dd;border:1px solid #e0c060;padding:8px 12px;margin:8px">${opts.tip}</div><style>@media print{.tip{display:none}}</style>` : ''}${bodyHtml}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),${opts.delay ?? 400}));<\/script></body></html>`);
  w.document.close();
}
export const icon = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
export const ICONS = {
  home: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  pricing: '<path d="M3.5 11.5V4.5a1 1 0 0 1 1-1h7l9 9-8 8z"/><circle cx="8" cy="8" r="1.6"/>',
  quotes: '<path d="M7 3h7l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  sales: '<path d="M4 7h16l-1.5 11.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/><path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7"/>',
  purchase: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  stock: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
  orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10l1.5 1.5 3-3"/><path d="M8.5 15.5l1.5 1.5 3-3"/><path d="M15 11h1.5M15 16.5h1.5"/>',
  drawing: '<rect x="3" y="5.5" width="5" height="8" rx="1"/><path d="M8 7.5h10.5l2.5 2-2.5 2H8"/><path d="M11 7.5v4M14 7.5v4M17 7.5v4"/><path d="M3 18.5h18M3 17v3M21 17v3"/>',
  receivables: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/><path d="M15.5 14.5l1.5 1.5 3-3"/>',
  payables: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="M15.5 15.5l1.5 1.5 3-3"/>',
  invoice: '<path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  checks: '<rect x="2.5" y="6" width="19" height="12" rx="1.8"/><path d="M6 10h8M6 14h4"/><path d="M14.5 15.5l4-4"/>',
  checksin: '<path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M3.5 13.5H8l1.2 2.2h5.6l1.2-2.2h4.5"/><path d="M12 3.5v6M9.5 7.5 12 10l2.5-2.5"/>',
  money: '<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M6.5 15h4"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  master: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  ai: '<path d="M11 3.5l1.7 4.3 4.3 1.7-4.3 1.7L11 15.5l-1.7-4.3L5 9.5l4.3-1.7z"/><path d="M18 14l.9 2.1 2.1.9-2.1.9L18 20l-.9-2.1-2.1-.9 2.1-.9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 15v6h10v-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  log: '<path d="M4 6h16M4 12h10M4 18h7"/>',
  fax: '<path d="M6 9V3h9l3 3v3"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 18v3h10v-3M17 13h.01"/>',
  labels: '<path d="M3 12.6V4.5A1.5 1.5 0 0 1 4.5 3h8.1a1.5 1.5 0 0 1 1 .4l7 7a1.5 1.5 0 0 1 0 2.1l-8.1 8.1a1.5 1.5 0 0 1-2.1 0l-7-7a1.5 1.5 0 0 1-.4-1z"/><circle cx="8" cy="8" r="1.6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
};
/** 列表搜尋框：中文輸入法組字中不觸發（重畫會打斷組字、打不出中文），組字完成或一般輸入才觸發 fn(value) */
// ---------- 打字時重畫畫面：保留正在打字的輸入框（手機鍵盤才不會收起來、跳回英文） ----------
let KEEP = null;
/** 把 el 換成新的 html，但正在打字的輸入框（有 id）原封不動留著；結構對不上就整個換。回傳是否有保留 */
export function morphKeep(el, html) {
  const a = document.activeElement;
  const tmp = document.createElement(el.tagName); tmp.innerHTML = html;
  const nu = a && a.id && el.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? tmp.querySelector('#' + CSS.escape(a.id)) : null;
  const plain = () => { HTML.set.call(el, html); return false; };
  if (!nu || nu.tagName !== a.tagName) return plain();
  const pn = []; for (let n = nu; n && n !== tmp; n = n.parentNode) pn.unshift(n);
  const po = []; for (let n = a; n && n !== el; n = n.parentNode) po.unshift(n);
  if (pn.length !== po.length || pn.some((n, i) => n.tagName !== po[i].tagName)) return plain();
  let parent = el;
  for (let i = 0; i < po.length; i++) {
    const co = po[i], cn = pn[i];
    while (co.previousSibling) parent.removeChild(co.previousSibling);
    while (co.nextSibling) parent.removeChild(co.nextSibling);
    const before = []; for (let x = cn.previousSibling; x; x = x.previousSibling) before.unshift(x);
    const after = []; for (let x = cn.nextSibling; x; x = x.nextSibling) after.push(x);
    for (const x of before) parent.insertBefore(x, co);
    for (const x of after) parent.appendChild(x);
    if (co !== a) { for (const at of [...co.attributes]) if (!cn.hasAttribute(at.name)) co.removeAttribute(at.name); for (const at of [...cn.attributes]) co.setAttribute(at.name, at.value); }
    parent = co;
  }
  return true;
}
const HTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
Object.defineProperty(Element.prototype, 'innerHTML', {
  configurable: true, enumerable: HTML.enumerable,
  get() { return HTML.get.call(this); },
  set(v) { if (KEEP && KEEP.isConnected && this.contains(KEEP)) { morphKeep(this, v); return; } HTML.set.call(this, v); },
});
/** 搜尋框打字觸發的重畫用這個包起來：期間 innerHTML 會保留這個輸入框 */
export function keepWhile(inp, fn) { const prev = KEEP; KEEP = document.activeElement === inp ? inp : null; try { return fn(); } finally { KEEP = prev; } }

export function onSearch(inp, fn) {
  if (!inp) return;
  if (inp._zrSearch) { inp._zrSearch.fn = fn; return; }   // 重畫後保留下來的同一個輸入框：只換回呼，不重複綁
  const box = inp._zrSearch = { fn };
  let comp = false, last = inp.value;
  const run = () => { if (inp.value === last) return; last = inp.value; keepWhile(inp, () => box.fn(last)); };
  inp.addEventListener('compositionstart', () => { comp = true; });
  inp.addEventListener('compositionend', () => { comp = false; run(); });
  inp.addEventListener('input', ev => { if (comp || ev.isComposing) return; run(); });
}
