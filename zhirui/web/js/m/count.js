// 手機版：盤點表（管理者版 #count、員工版共用）。
// 清單＝近一年有出貨的商品，自動分 A／B／C 類（core/abc.js）；可照料號、出貨金額、最近出貨日排序；
// 勾選後印「盤點標籤」（佳博 50×40：大 QR 碼＋品名＋單重），貼在貨架上；之後按「掃碼盤點」掃標籤 → 填數量、單重 → 儲存 → 自動掃下一個。
// 畫面上不顯示金額（員工也會用）。
import { esc, fmtQ, today, ls, slash } from '../core/util.js';
import { store } from '../core/store.js';
import { calc } from '../core/calc.js';
import { scanQR, qrMatrix } from '../core/qr.js';
import { estWeight } from '../core/spec.js';
import { abcList, countedOk } from '../core/abc.js';
import { adjustStock, findByCode } from './stock.js';
import { lblParse, queueLabels, curPrinter, pickPrinter, toBW, fitText } from './label.js';

const W = 400, H = 320;
const CLS = [['S', 'A★常出貨'], ['A', 'A 類'], ['B', 'B 類'], ['C', 'C 類'], ['all', '全部']];
const SORTS = [['code', '料號'], ['amt', '出貨金額'], ['last', '最近出貨日']];
const PKEY = 'zr.m.cnt.printed';   // 這支手機印過盤點標籤的商品
const ui = { cls: ls.get('zr.m.cnt.cls', 'S'), sort: ls.get('zr.m.cnt.sort', 'code'), todo: false, sel: new Set(), data: null, busy: false, back: '#stock' };
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); };
const printed = () => new Set(ls.get(PKEY, []) || []);

/** 單重文字：登錄值「2.5 g」、沒登錄用估算「約 2.5 g」、估不出來留空白手寫 */
export function wtText(g) { const w = +g.wt > 0 ? +g.wt : 0; if (w) return `${w} g`; const e = estWeight(g); return e ? `約 ${e} g` : '        g'; }

/** 盤點標籤（400×320 黑白）：上面品名、規格＋表面處理；左下大 QR 碼（料號）；右邊單重、料號 */
export async function drawCountLabel(cv, g) {
  cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.fillStyle = '#000'; cx.textBaseline = 'alphabetic';
  const P = 14, full = W - P * 2; const p = lblParse(g);
  let l1, l2;
  if (p.ok) { l1 = p.name; l2 = [p.spec, p.fin].filter(Boolean).join('　'); }
  else { const raw = String(g.name || '').trim(); const tok = raw.split(/\s+/); l1 = tok[0] || ''; l2 = tok.slice(1).join(' '); }
  let px = fitText(cx, l1, full, 50, true, 14); cx.fillText(l1, P, P + px * 0.92);
  if (l2) { px = fitText(cx, l2, full, 40, true, 14); cx.fillText(l2, P, 112); }
  const m = await qrMatrix(g.code || g.id, 'M'); const n = m.length; const s = Math.max(2, Math.floor(180 / n)); const qw = n * s;
  const x0 = P, y0 = H - P - qw;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (m[r][k]) cx.fillRect(x0 + k * s, y0 + r * s, s, s);
  const rx = x0 + qw + 16, rw = W - P - rx;
  cx.font = `26px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif`; cx.fillText('單重', rx, y0 + 30);
  const wt = wtText(g); fitText(cx, wt, rw, 46, true, 16); cx.fillText(wt, rx, y0 + 84);
  if (!(+g.wt > 0) && !estWeight(g)) cx.fillRect(rx, y0 + 90, rw - 30, 2);   // 手寫用的底線
  const code = String(g.code || ''); fitText(cx, code, rw, 22, false, 11); cx.fillText(code, rx, H - P - 4);
  toBW(cx); return cv;
}

function rows() {
  const D = ui.data; if (!D) return [];
  let list = D.list.filter(x => ui.cls === 'all' ? true : ui.cls === 'S' ? x.star : x.cls === ui.cls);
  if (ui.todo) list = list.filter(x => !countedOk(store.get('goods', x.gid), x.cls));
  const code = x => String(store.get('goods', x.gid)?.code || '');
  if (ui.sort === 'code') list = [...list].sort((a, b) => code(a).localeCompare(code(b)));
  else if (ui.sort === 'last') list = [...list].sort((a, b) => b.last.localeCompare(a.last) || a.rank - b.rank);
  return list;   // amt：abcList 本來就是金額由高到低
}

export async function countPage(view, opt = {}) {
  if (opt.back) ui.back = opt.back;
  if (!ui.data) {
    view.innerHTML = `<div class="hd"><a class="chip" href="${ui.back}">‹ 返回</a><h1>盤點表</h1></div><div class="note">整理近一年的出貨資料…</div>`;
    try { ui.data = await abcList(); } catch (e) { view.innerHTML += `<div class="err">載入失敗：${esc(e.message || e)}</div>`; return; }
    if (!location.hash.startsWith('#count')) return;
  }
  draw(view);
}

function draw(view) {
  const D = ui.data; const C = calc(); const list = rows(); const pr = curPrinter(); const pd = printed();
  const cnt = k => D.list.filter(x => k === 'all' ? true : k === 'S' ? x.star : x.cls === k).length;
  const sel = list.filter(x => ui.sel.has(x.gid)); const done = list.filter(x => countedOk(store.get('goods', x.gid), x.cls)).length;
  const y = window.scrollY;
  view.innerHTML = `<div class="hd"><a class="chip" href="${ui.back}">‹ 返回</a><h1>盤點表</h1><span class="sp"></span><span class="sub">${ui.todo ? '' : `已盤 ${done}／${list.length}`}</span></div>
    <div class="btn2"><button class="btn" id="cscan">📷 掃碼盤點</button><button class="btn ${sel.length ? '' : 'ghost'}" id="cprint">🖨 印盤點標籤${sel.length ? `（${sel.length}）` : ''}</button></div>
    <div class="chips">${CLS.map(([k, n]) => `<button class="chip ${ui.cls === k ? 'on' : ''}" data-cls="${k}">${n} ${cnt(k)}</button>`).join('')}</div>
    <div class="chips seg">${SORTS.map(([k, n]) => `<button class="chip ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${n}</button>`).join('')}</div>
    <div class="chips"><button class="chip ${ui.todo ? 'on' : ''}" id="ctodo">只看還沒盤的</button><button class="chip" id="call">全選</button><button class="chip" id="cnew">選沒印過標籤的</button>${ui.sel.size ? '<button class="chip" id="cnone">取消勾選</button>' : ''}</div>
    <div class="note" style="text-align:left;margin:0 0 8px">近一年有出貨的商品，依出貨金額分類：A 每月盤、B 每季盤、C 半年盤。點商品直接盤點；勾起來可以印盤點標籤（標籤機：<a href="#" id="cpp">${esc(pr.name)}</a>）。</div>
    <div class="card list" id="cl">${list.map(x => { const g = store.get('goods', x.gid); const q = Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0); const ok = countedOk(g, x.cls);
      return `<div class="row" data-g="${g.id}"><input type="checkbox" data-ck="${g.id}" ${ui.sel.has(g.id) ? 'checked' : ''} aria-label="勾選印標籤" style="width:22px;height:22px;flex:none;margin-right:10px"><div class="gm"><b>${esc(g.name)}</b><small>${esc(g.code || '')}・${x.cls}${x.star ? '★' : ''}・單重 ${+g.wt > 0 || estWeight(g) ? esc(wtText(g)) : '還沒有'}</small><small>系統 ${fmtQ(q)} ${esc(g.unit || '')}・最近出貨 ${esc(slash(x.last).slice(5))}・${g.cntAt ? `<span class="${ok ? 'good' : ''}">上次盤 ${esc(slash(g.cntAt))}</span>` : '還沒盤過'}${pd.has(g.id) ? '・已印標籤' : ''}</small></div><span class="go">›</span></div>`; }).join('') || '<div class="row muted">這個分類沒有要盤的商品</div>'}</div>`;
  window.scrollTo(0, y);
  const $ = q => view.querySelector(q); const redraw = () => draw(view);
  view.querySelectorAll('[data-cls]').forEach(b => b.onclick = () => { ui.cls = b.dataset.cls; ls.set('zr.m.cnt.cls', ui.cls); ui.sel.clear(); window.scrollTo(0, 0); redraw(); });
  view.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { ui.sort = b.dataset.sort; ls.set('zr.m.cnt.sort', ui.sort); redraw(); });
  $('#ctodo').onclick = () => { ui.todo = !ui.todo; redraw(); };
  $('#call').onclick = () => { list.forEach(x => ui.sel.add(x.gid)); redraw(); };
  $('#cnew').onclick = () => { ui.sel.clear(); list.forEach(x => { if (!pd.has(x.gid)) ui.sel.add(x.gid); }); redraw(); if (!ui.sel.size) toast('這個清單的標籤都印過了'); };
  $('#cnone')?.addEventListener('click', () => { ui.sel.clear(); redraw(); });
  $('#cpp').onclick = ev => { ev.preventDefault(); pickPrinter(redraw); };
  $('#cl').addEventListener('click', ev => {
    const ck = ev.target.closest('[data-ck]'); if (ck) { if (ck.checked) ui.sel.add(ck.dataset.ck); else ui.sel.delete(ck.dataset.ck); const b = $('#cprint'); const n = rows().filter(x => ui.sel.has(x.gid)).length; b.textContent = `🖨 印盤點標籤${n ? `（${n}）` : ''}`; b.classList.toggle('ghost', !n); return; }
    const r = ev.target.closest('[data-g]'); if (!r) return; const g = store.get('goods', r.dataset.g); if (g) adjustStock(g, redraw);
  });
  // 掃碼盤點：掃到 → 盤點表單 → 儲存後自動掃下一個（按取消就停）
  const scan = () => scanQR(text => { const g = findByCode(text); if (!g) { toast('找不到這個料號：' + text); return; } adjustStock(g, () => { redraw(); scan(); }); }, { title: '盤點：掃盤點標籤的 QR 碼' });
  $('#cscan').onclick = scan;
  $('#cprint').onclick = () => printSel(view, rows().filter(x => ui.sel.has(x.gid)));   // 現在勾的（勾選時沒有重畫，不能用上面的 sel）
}

/** 印勾選的盤點標籤：每 20 張送一份列印工作（一次太多張資料太大） */
async function printSel(view, list) {
  if (ui.busy) return;
  if (!list.length) { toast('先勾選要印標籤的商品（或按「全選」）'); return; }
  const pr = curPrinter();
  if (!window.confirm(`要印 ${list.length} 張盤點標籤到「${pr.name}」嗎？\n照目前的排列順序印，一個商品一張。`)) return;
  ui.busy = true; const btn = view.querySelector('#cprint'); let sent = 0; const pd = printed();
  try {
    for (let i = 0; i < list.length; i += 20) {
      const part = list.slice(i, i + 20); const labels = [];
      for (const x of part) { const cv = document.createElement('canvas'); await drawCountLabel(cv, store.get('goods', x.gid)); labels.push({ cv, copies: 1 }); }
      if (btn?.isConnected) btn.textContent = `送出中 ${Math.min(i + 20, list.length)}／${list.length}…`;
      await queueLabels(labels, `盤點標籤 ${i + 1}～${i + part.length}（共 ${list.length} 張）`);
      sent += part.length; part.forEach(x => pd.add(x.gid)); ls.set(PKEY, [...pd]);
    }
    toast(`已送出 ${sent} 張盤點標籤，到「${pr.name}」拿`); ui.sel.clear();
  } catch (e) { window.alert(`送出 ${sent} 張之後失敗：${e.message || e}\n已送出的不用重印，可以按「選沒印過標籤的」接著印。`); }
  ui.busy = false; if (location.hash.startsWith('#count')) draw(view);
}
