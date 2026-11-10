// 庫存：各倉庫數量、低於安全庫存、其他出入庫、調撥
import { $, esc, fmt, fmtQ, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { tabs, pager, onSearch } from '../core/ui.js';
import { calc, goodsLabel, TYPES } from '../core/calc.js';
import { billList, openBill } from './_bills.js';
import { openMaster } from './master.js';

const ui = { tab: 'qty', q: '', page: 0, bills: {} };
export default {
  id: 'stock', name: '庫存數量', group: '倉儲', icon: 'stock',
  render(el, { sub, params }) { this.el = el; if (sub === 'low') ui.tab = 'low'; if (sub === 'moves') ui.tab = 'moves'; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('goods') || ch.has('warehouses'))) draw(this.el); },
};
function draw(el) {
  if (ui.tab === 'moves') {
    const box = document.createElement('div'); box.style.display = 'grid'; box.style.gap = '16px';
    el.innerHTML = ''; el.append(box);
    billList(box, { key: 'moves', title: '庫存異動', types: ['IN', 'OUT', 'TRANSFER'], tabList: [['all', '全部'], ['IN', '其他入庫'], ['OUT', '其他出庫'], ['TRANSFER', '調撥單']], newTypes: ['IN', 'OUT', 'TRANSFER'], extraHead: tabs('s', [['qty', '庫存數量'], ['low', '低於安全庫存'], ['moves', '出入庫／調撥']], 'moves') }, ui.bills);
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
  el.innerHTML = `<div class="head"><h1>庫存</h1><span class="sp"></span><button class="btn" data-new="IN">＋ 其他入庫</button><button class="btn" data-new="OUT">＋ 其他出庫</button><button class="btn" data-new="TRANSFER">＋ 調撥</button></div>
    <div class="panel"><div class="tools">${tabs('s', [['qty', '庫存數量'], ['low', '低於安全庫存'], ['moves', '出入庫／調撥']], ui.tab)}<input type="search" id="sq" placeholder="搜尋料號、品名、規格" value="${esc(ui.q)}"><span class="muted small">${list.length} 項${ui.tab === 'qty' && !ui.q ? '（有庫存的）' : ''}・庫存金額約 ${fmt(tv)}</span></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>料號</th><th>品名規格</th>${whs.map(w => `<th class="n">${esc(w.name)}</th>`).join('')}<th class="n">合計</th><th>單位</th><th class="n">安全庫存</th><th class="n">平均成本</th></tr></thead>
    <tbody>${list.slice(s, e).map(g => { const t = all(g); return `<tr class="row" data-id="${g.id}"><td class="mono">${esc(g.code)}</td><td>${esc(g.name)} <span class="muted">${esc(g.spec || '')}</span></td>${whs.map(w => `<td class="n">${fmtQ((C.stock[g.id] || {})[w.id] || 0)}</td>`).join('')}<td class="n" style="${+g.safety > 0 && t < +g.safety ? 'color:var(--bad);font-weight:600' : ''}">${fmtQ(t)}</td><td>${esc(g.unit || '')}</td><td class="n muted">${g.safety ? fmtQ(g.safety) : ''}</td><td class="n muted">${C.cost[g.id]?.avg ? fmtQ(C.cost[g.id].avg) : ''}</td></tr>`; }).join('') || `<tr><td colspan="${6 + whs.length}"><div class="empty"><b>${ui.tab === 'low' ? '沒有低於安全庫存的商品' : '沒有庫存紀錄'}</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; draw(el); }, { once: true });
  onSearch($('#sq', el), v => { ui.q = v; ui.page = 0; draw(el); const i = $('#sq', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openBill(b.dataset.new)));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => openMaster('goods', store.get('goods', tr.dataset.id))));
}
