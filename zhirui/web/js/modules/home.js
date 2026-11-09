// 總覽：今天該注意的事
import { esc, fmt, money, today, thisMonth, daysLeft, slash, ymLabel, roc } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, TYPES, cshort } from '../core/calc.js';
import { arSummary } from './receivables.js';
import { apSummary } from './payables.js';

export default {
  id: 'home', name: '總覽', icon: 'home',
  render(el) { this.el = el; draw(el); },
  onChange() { if (this.el && this.el.isConnected) draw(this.el); },
};
function draw(el) {
  const C = calc(); const m = thisMonth(); const t = today();
  let sales = 0, profit = 0, n = 0;
  for (const b of C.bills) if ((b.type === 'SALE' || b.type === 'SALE_RET') && (b.date || '').startsWith(m)) { const s = b.type === 'SALE' ? 1 : -1; const net = C.tot[b.id]?.net || 0; sales += s * net; profit += s * (net - (C.cogs[b.id] || 0)); n++; }
  let pur = 0; for (const b of C.bills) if ((b.type === 'PUR' || b.type === 'PUR_RET') && (b.date || '').startsWith(m)) pur += (b.type === 'PUR' ? 1 : -1) * (C.tot[b.id]?.net || 0);
  const ar = arSummary(), ap = apSummary();
  const cin = store.list('checks_in').filter(c => !c.col); const late = cin.filter(c => c.due && c.due < t), soon = cin.filter(c => c.due >= t && daysLeft(c.due) <= 7);
  const cout = store.list('checks_out').filter(c => !c.printedAt);
  const orders = store.list('orders').filter(o => !(o.steps || {}).done); const oLate = orders.filter(o => o.due && o.due < t);
  const low = store.list('goods').filter(g => +g.safety > 0 && Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0) < +g.safety);
  const inv = store.list('invoices').filter(i => (i.date || '').startsWith(m)); const invSum = inv.reduce((s, i) => s + (+i.untaxed || 0) + (+i.tax || 0), 0);
  const pendInv = C.bills.filter(b => b.type === 'SALE' && !b.invNo && !b.noInv && (b.date || '') >= '2026-01-01');
  const recent = [...C.bills].filter(b => !TYPES[b.type].doc).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 8);
  el.innerHTML = `
    <div class="head"><h1>總覽</h1><span class="sub">${esc(roc(t))}・${esc(store.user.name)}</span></div>
    <div class="kpis">
      <a class="kpi" href="#sales"><span>本月銷貨（未稅）</span><b>${fmt(sales)}</b><small>${n} 張・毛利 ${fmt(profit)}</small></a>
      <a class="kpi" href="#purchase"><span>本月進貨（未稅）</span><b>${fmt(pur)}</b></a>
      <a class="kpi ${ar.late ? 'alert' : ''}" href="#receivables"><span>應收未收</span><b>${fmt(ar.open)}</b><small>${ar.openN} 筆${ar.late ? `・逾期 ${ar.late} 筆` : ''}</small></a>
      <a class="kpi" href="#payables"><span>應付待開票</span><b>${fmt(ap.open)}</b><small>${ap.openN} 筆</small></a>
      <a class="kpi ${late.length ? 'alert' : ''}" href="#checks-in"><span>待代收客票</span><b>${fmt(cin.reduce((s, c) => s + (+c.amt || 0), 0))}</b><small>${cin.length} 張${late.length ? `・已到期 ${late.length}` : ''}${soon.length ? `・7 天內 ${soon.length}` : ''}</small></a>
      <a class="kpi" href="#invoices"><span>本月發票</span><b>${fmt(invSum)}</b><small>${inv.length} 張${pendInv.length ? `・${pendInv.length} 張銷貨單未開` : ''}</small></a>
    </div>
    <div class="grid2">
      <div class="panel"><div class="ptitle">待辦<small>需要處理的事</small></div>
        ${todo([
          [oLate.length, `訂貨排程有 ${oLate.length} 筆逾期`, '#orders'],
          [late.length, `${late.length} 張客票已到期還沒送代收`, '#checks-in'],
          [cout.length, `${cout.length} 張付款支票待列印`, '#checks-out'],
          [pendInv.length, `${pendInv.length} 張銷貨單還沒開發票`, '#invoices/pending'],
          [ar.late, `${ar.late} 筆應收逾期未收`, '#receivables/open'],
          [low.length, `${low.length} 項商品低於安全庫存`, '#stock/low'],
        ])}
      </div>
      <div class="panel"><div class="ptitle">最近單據</div>
        <div class="tw"><table><tbody>${recent.map(b => `<tr class="row" data-href="#${href(b)}?open=${b.id}"><td class="nowrap">${esc(slash(b.date))}</td><td>${esc(TYPES[b.type].name)}</td><td>${esc(b.cid ? cshort(b.cid) : '')}</td><td class="n">${fmt(TYPES[b.type].lines ? C.tot[b.id]?.total : b.amount)}</td></tr>`).join('') || '<tr><td class="muted">還沒有單據</td></tr>'}</tbody></table></div>
      </div>
      <div class="panel"><div class="ptitle">訂貨進行中<small>${orders.length} 筆</small></div>
        <div class="tw"><table><tbody>${orders.sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 8).map(o => `<tr><td>${esc(o.vendor)}</td><td>${esc(o.prod)}</td><td class="n">${esc(o.qty)}</td><td class="nowrap ${o.due && o.due < t ? 'muted' : ''}" style="${o.due && o.due < t ? 'color:var(--bad)' : ''}">${o.due ? esc(roc(o.due)) : ''}</td></tr>`).join('') || '<tr><td class="muted">沒有進行中的訂貨</td></tr>'}</tbody></table></div>
      </div>
      <div class="panel"><div class="ptitle">即將到期客票<small>7 天內</small></div>
        <div class="tw"><table><tbody>${[...late, ...soon].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 8).map(c => `<tr><td class="nowrap" style="${c.due < t ? 'color:var(--bad)' : ''}">${esc(roc(c.due))}</td><td>${esc(c.name)}</td><td class="muted">${esc(c.bank || '')}</td><td class="n">${money(c.amt)}</td></tr>`).join('') || '<tr><td class="muted">沒有 7 天內到期的客票</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
  el.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', () => location.hash = tr.dataset.href));
}
const href = b => b.type === 'SALE' || b.type === 'SALE_RET' ? 'sales' : b.type === 'PUR' || b.type === 'PUR_RET' || b.type === 'PO' ? 'purchase' : b.type === 'QUO' || b.type === 'RFQ' ? 'quotes' : TYPES[b.type].money ? 'money' : 'stock';
const todo = items => { const li = items.filter(([n]) => n > 0); return li.length ? `<div style="display:grid;gap:6px">${li.map(([, txt, h]) => `<a href="${h}" style="display:flex;gap:8px;align-items:center;color:inherit"><span class="pill bad">!</span>${esc(txt)}</a>`).join('')}</div>` : '<div class="muted">目前沒有需要處理的事 ✓</div>'; };
