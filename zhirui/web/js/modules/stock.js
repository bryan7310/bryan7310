// 庫存：各倉庫數量、低於安全庫存、其他出入庫、調撥
import { $, esc, fmt, fmtQ, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { tabs, pager, onSearch, printHTML } from '../core/ui.js';
import { today, slash } from '../core/util.js';
import { abcList, countedOk } from '../core/abc.js';
import { calc, goodsLabel, TYPES } from '../core/calc.js';
import { billList, openBill } from './_bills.js';
import { openMaster } from './master.js';

const ui = { tab: 'qty', q: '', page: 0, bills: {}, ccls: 'S', csort: 'code', ctodo: false };
const STABS = [['qty', '庫存數量'], ['low', '低於安全庫存'], ['count', '盤點表'], ['moves', '出入庫／調撥／組包']];
export default {
  id: 'stock', name: '庫存數量', group: '倉儲', icon: 'stock',
  render(el, { sub, params }) { this.el = el; if (sub === 'low') ui.tab = 'low'; if (sub === 'moves') ui.tab = 'moves'; if (sub === 'count') ui.tab = 'count'; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('goods') || ch.has('warehouses'))) draw(this.el); },
};
function draw(el) {
  if (ui.tab === 'count') return drawCount(el);
  if (ui.tab === 'moves') {
    const box = document.createElement('div'); box.style.display = 'grid'; box.style.gap = '16px';
    el.innerHTML = ''; el.append(box);
    billList(box, { key: 'moves', title: '庫存異動', types: ['IN', 'OUT', 'TRANSFER', 'ASM'], tabList: [['all', '全部'], ['IN', '其他入庫'], ['OUT', '其他出庫'], ['TRANSFER', '調撥單'], ['ASM', '組包單']], newTypes: ['IN', 'OUT', 'TRANSFER', 'ASM'], extraHead: tabs('s', STABS, 'moves') }, ui.bills);
    el.addEventListener('tab', ev => { if (ev.detail.key === 's') { ui.tab = ev.detail.val; draw(el); } }, { once: true });
    return;
  }
  const C = calc(); const whs = store.list('warehouses'); const q = qTerms(ui.q);
  let list = store.list('goods').filter(g => matchQ(goodsLabel(g) + ' ' + (g.cat || ''), q)).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));
  const all = g => Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0);
  if (ui.tab === 'low') list = list.filter(g => +g.safety > 0 && all(g) < +g.safety);
  else if (!ui.q) list = list.filter(g => all(g) !== 0);
  const tv = list.reduce((s, g) => s + all(g) * (C.cost[g.id]?.avg || +g.purPrice || 0), 0);
  const [s, e, pg] = pager('st', list.length, ui.page);
  el.innerHTML = `<div class="head"><h1>庫存</h1><span class="sp"></span><button class="btn" data-new="IN">＋ 其他入庫</button><button class="btn" data-new="OUT">＋ 其他出庫</button><button class="btn" data-new="TRANSFER">＋ 調撥</button><button class="btn" data-new="ASM" title="螺絲包：依配方扣零件、成品加庫存">＋ 組包</button></div>
    <div class="panel"><div class="tools">${tabs('s', STABS, ui.tab)}<input type="search" id="sq" placeholder="搜尋料號、品名、規格" value="${esc(ui.q)}"><span class="muted small">${list.length} 項${ui.tab === 'qty' && !ui.q ? '（有庫存的）' : ''}・庫存金額約 ${fmt(tv)}</span></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>料號</th><th>品名規格</th>${whs.map(w => `<th class="n">${esc(w.name)}</th>`).join('')}<th class="n">合計</th><th>單位</th><th class="n">安全庫存</th><th class="n">平均成本</th></tr></thead>
    <tbody>${list.slice(s, e).map(g => { const t = all(g); return `<tr class="row" data-id="${g.id}"><td class="mono">${esc(g.code)}</td><td>${esc(g.name)} <span class="muted">${esc(g.spec || '')}</span></td>${whs.map(w => `<td class="n">${fmtQ((C.stock[g.id] || {})[w.id] || 0)}</td>`).join('')}<td class="n" style="${+g.safety > 0 && t < +g.safety ? 'color:var(--bad);font-weight:600' : ''}">${fmtQ(t)}</td><td>${esc(g.unit || '')}</td><td class="n muted">${g.safety ? fmtQ(g.safety) : ''}</td><td class="n muted">${C.cost[g.id]?.avg ? fmtQ(C.cost[g.id].avg) : ''}</td></tr>`; }).join('') || `<tr><td colspan="${6 + whs.length}"><div class="empty"><b>${ui.tab === 'low' ? '沒有低於安全庫存的商品' : '沒有庫存紀錄'}</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; draw(el); }, { once: true });
  onSearch($('#sq', el), v => { ui.q = v; ui.page = 0; draw(el); const i = $('#sq', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openBill(b.dataset.new)));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => openMaster('goods', store.get('goods', tr.dataset.id))));
}

// ---------- 盤點表：近一年有出貨的商品分 A／B／C 類（core/abc.js），看哪些該盤、盤了沒；實際盤點、印盤點標籤在 App「查商品 › 盤點表」 ----------
const CCLS = [['S', 'A★常出貨'], ['A', 'A 類'], ['B', 'B 類'], ['C', 'C 類'], ['all', '全部']];
const CSORT = [['code', '料號'], ['amt', '出貨金額'], ['last', '最近出貨日']];
let cseq = 0;
async function drawCount(el) {
  const seq = ++cseq;
  if (!el.querySelector('#cnt-box')) el.innerHTML = `<div class="head"><h1>庫存</h1></div><div class="panel"><div class="tools">${tabs('s', STABS, 'count')}</div><div id="cnt-box" class="muted" style="margin-top:12px">整理近一年的出貨資料…</div></div>`;
  let D; try { D = await abcList(); } catch (e) { D = { list: [], from: '' }; }
  if (seq !== cseq || !el.isConnected || ui.tab !== 'count') return;
  const C = calc(); const whs = store.list('warehouses'); const G = x => store.get('goods', x.gid);
  const cnt = k => D.list.filter(x => k === 'all' ? true : k === 'S' ? x.star : x.cls === k).length;
  let list = D.list.filter(x => ui.ccls === 'all' ? true : ui.ccls === 'S' ? x.star : x.cls === ui.ccls);
  const done = list.filter(x => countedOk(G(x), x.cls)).length; const n0 = list.length;
  if (ui.ctodo) list = list.filter(x => !countedOk(G(x), x.cls));
  if (ui.csort === 'code') list = [...list].sort((a, b) => String(G(a).code || '').localeCompare(String(G(b).code || '')));
  else if (ui.csort === 'last') list = [...list].sort((a, b) => b.last.localeCompare(a.last) || a.rank - b.rank);
  const all = g => Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0);
  const row = (x, paper) => { const g = G(x); const ok = countedOk(g, x.cls);
    return `<tr${paper ? '' : ` class="row" data-id="${g.id}"`}><td>${x.cls}${x.star ? '★' : ''}</td><td class="mono">${esc(g.code)}</td><td>${esc(g.name)}</td><td class="n">${+g.wt > 0 ? esc(g.wt) : ''}</td><td class="n">${fmtQ(all(g))}</td><td>${esc(g.unit || '')}</td>${paper ? '<td></td><td></td>' : `<td class="n">${fmt(x.amt)}</td><td class="n">${x.n}</td>`}<td>${esc(slash(x.last))}</td><td${ok ? ' style="color:var(--good,#1a7f37)"' : ''}>${g.cntAt ? esc(slash(g.cntAt)) : paper ? '' : '<span class="muted">還沒盤過</span>'}</td></tr>`; };
  el.innerHTML = `<div class="head"><h1>庫存</h1><span class="sp"></span><button class="btn" id="cnt-print">列印盤點表（紙本）</button></div>
    <div class="panel"><div class="tools">${tabs('s', STABS, 'count')}${tabs('cc', CCLS.map(([k, n]) => [k, `${n} ${cnt(k)}`]), ui.ccls)}<span class="muted small">排列</span>${tabs('cs', CSORT, ui.csort)}<label class="small"><input type="checkbox" id="cnt-todo" ${ui.ctodo ? 'checked' : ''}> 只看還沒盤的</label><span class="muted small">已盤 ${done}／${n0}</span></div>
    <div class="muted small" style="margin:8px 0">依 ${slash(D.from)} 起近一年的出貨金額分類（新平台＋舊系統）：累計前 80%＝A 類每月盤、到 95%＝B 類每季盤、其餘 C 類半年盤；★＝A 類且出貨 6 次以上，最先盤。實際盤點和印盤點標籤（50×40，QR 碼＋品名＋單重）請用手機 App「查商品 › 盤點庫存 › 盤點表」。</div>
    <div class="tw" id="cnt-box"><table><thead><tr><th>類別</th><th>料號</th><th>品名規格</th><th class="n">單重 g</th><th class="n">系統庫存</th><th>單位</th><th class="n">近一年出貨金額</th><th class="n">次數</th><th>最近出貨</th><th>上次盤點</th></tr></thead>
    <tbody>${list.map(x => row(x)).join('') || '<tr><td colspan="10"><div class="empty"><b>這個分類沒有要盤的商品</b></div></td></tr>'}</tbody></table></div></div>`;
  if (el._cntTab) el.removeEventListener('tab', el._cntTab);
  el._cntTab = ev => { el.removeEventListener('tab', el._cntTab); el._cntTab = null; const { key, val } = ev.detail; if (key === 's') { ui.tab = val; ui.page = 0; draw(el); } else { if (key === 'cc') ui.ccls = val; if (key === 'cs') ui.csort = val; drawCount(el); } };
  el.addEventListener('tab', el._cntTab);
  $('#cnt-todo', el).addEventListener('change', ev => { ui.ctodo = ev.target.checked; drawCount(el); });
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => openMaster('goods', store.get('goods', tr.dataset.id))));
  $('#cnt-print', el).addEventListener('click', () => printHTML('盤點表', '@page{size:A4;margin:10mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:11px}h2{margin:0 0 6px;font-size:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:3px 5px;text-align:left}td.n,th.n{text-align:right}.mono{font-family:Consolas,monospace}',
    `<h2>盤點表　${esc(CCLS.find(c => c[0] === ui.ccls)[1])}${ui.ctodo ? '（還沒盤的）' : ''}　${slash(today())}　共 ${list.length} 項</h2><table><thead><tr><th>類別</th><th>料號</th><th>品名規格</th><th class="n">單重 g</th><th class="n">系統庫存</th><th>單位</th><th style="width:70px">實際數量</th><th style="width:50px">差異</th><th>最近出貨</th><th>上次盤點</th></tr></thead><tbody>${list.map(x => row(x, true)).join('')}</tbody></table>`, { tip: '按 Ctrl+P 列印，紙張 A4。' }));
}
