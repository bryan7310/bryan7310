// 報表：銷售與毛利、客戶對帳單、進貨統計、庫存金額、應收明細
import { $, esc, fmt, fmtQ, money, today, thisMonth, slash, roc, downloadText, sum } from '../core/util.js';
import { store } from '../core/store.js';
import { tabs, combo, printHTML } from '../core/ui.js';
import { calc, TYPES, cname, cshort, gname, customers, suppliers } from '../core/calc.js';
import { openBill } from './_bills.js';

const ui = { tab: 'sales', from: thisMonth() + '-01', to: today(), cid: '' };
export default {
  id: 'reports', name: '報表', group: '管理', icon: 'reports',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('goods') || ch.has('contacts'))) draw(this.el); },
};
const TABS = [['sales', '銷售與毛利'], ['customer', '客戶對帳單'], ['goods', '商品銷售排行'], ['purchase', '進貨統計'], ['stock', '庫存金額']];
function draw(el) {
  el.innerHTML = `<div class="head"><h1>報表</h1><span class="sp"></span>${tabs('rp', TABS, ui.tab)}</div>
    <div class="panel" style="display:grid;gap:12px"><div class="tools">${ui.tab !== 'stock' ? `<div class="f"><label for="rpFrom">從</label><input type="date" id="rpFrom" value="${ui.from}"></div><div class="f"><label for="rpTo">到</label><input type="date" id="rpTo" value="${ui.to}"></div>` : ''}${ui.tab === 'customer' ? `<div class="f" style="flex:1 1 220px"><label for="rpC">客戶</label><div class="combo"><input id="rpC" value="${esc(ui.cid ? cname(ui.cid) : '')}" placeholder="搜尋客戶"></div></div>` : ''}<span class="sp"></span><button class="btn sm" id="rpCsv">匯出 CSV</button><button class="btn sm" id="rpPrint">列印</button></div><div id="rpBody"></div></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  $('#rpFrom', el)?.addEventListener('change', ev => { ui.from = ev.target.value; body(el); });
  $('#rpTo', el)?.addEventListener('change', ev => { ui.to = ev.target.value; body(el); });
  if ($('#rpC', el)) combo($('#rpC', el), { items: () => customers().map(c => ({ id: c.id, label: c.name, sub: c.short || '', text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { ui.cid = it.id; body(el); } });
  body(el);
}
let last = { title: '', head: [], rows: [], foot: [] };
function body(el) {
  const C = calc(); const inR = b => (b.date || '') >= ui.from && (b.date || '') <= ui.to;
  const box = $('#rpBody', el);
  if (ui.tab === 'sales') {
    const bills = C.bills.filter(b => (b.type === 'SALE' || b.type === 'SALE_RET') && inR(b)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let tn = 0, tc = 0, miss = 0;
    const rows = bills.map(b => { const s = b.type === 'SALE' ? 1 : -1; const net = s * (C.tot[b.id]?.net || 0), cg = s * (C.cogs[b.id] || 0); tn += net; tc += cg; miss += C.costMiss[b.id] || 0; return [slash(b.date), b.no + (s < 0 ? '（退回）' : ''), cshort(b.cid), fmt(net), fmt(cg), fmt(net - cg), net ? Math.round((net - cg) / net * 100) + '%' : ''] ; });
    last = { title: `銷售與毛利 ${ui.from}～${ui.to}`, head: ['日期', '單號', '客戶', '未稅金額', '成本', '毛利', '毛利率'], rows, foot: ['合計', `${bills.length} 張`, '', fmt(tn), fmt(tc), fmt(tn - tc), tn ? Math.round((tn - tc) / tn * 100) + '%' : ''] };
    box.innerHTML = `<div class="kpis"><div class="kpi"><span>銷貨（未稅）</span><b>${fmt(tn)}</b></div><div class="kpi"><span>成本</span><b>${fmt(tc)}</b></div><div class="kpi ok"><span>毛利</span><b>${fmt(tn - tc)}</b><small>${tn ? Math.round((tn - tc) / tn * 100) + '%' : ''}</small></div></div>${miss ? `<div class="banner">期間內有 ${miss} 行商品找不到成本（進貨單、採購單、查價牌價都沒有），成本以 0 計，毛利會偏高。可到「基本資料 → 商品」填手動成本。</div>` : ''}${table(last, bills.map(b => b.id))}`;
  } else if (ui.tab === 'customer') {
    if (!ui.cid) { box.innerHTML = '<div class="empty"><b>請先選客戶</b></div>'; return; }
    const c = C.ct[ui.cid]; const bills = C.bills.filter(b => b.cid === ui.cid && !TYPES[b.type].doc && !b.hist && inR(b)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
    const before = C.bills.filter(b => b.cid === ui.cid && !TYPES[b.type].doc && !b.hist && (b.date || '') < ui.from).reduce((s, b) => s + (C.eff[b.id] || 0), +c.init || 0);
    let bal = before; const rows = bills.map(b => { const e = C.eff[b.id] || 0; bal += e; const T = TYPES[b.type]; return [slash(b.date), T.name, b.no, T.lines ? (b.lines || []).filter(l => l.gid).map(l => `${gname(l.gid)} ×${fmtQ(l.qty)}`).join('、').slice(0, 80) : (b.note || ''), e > 0 ? fmt(T.lines ? C.tot[b.id].total : 0) : '', e < 0 || (T.lines && +b.paid) ? fmt(T.lines ? +b.paid : b.amount) : '', fmt(bal)]; });
    last = { title: `${c.name} 對帳單 ${ui.from}～${ui.to}`, head: ['日期', '單據', '單號', '內容', '應收', '收款', '餘額'], rows: [['', '期初餘額', '', '', '', '', fmt(before)], ...rows], foot: ['期末餘額', '', '', '', '', '', fmt(bal)] };
    box.innerHTML = `<div class="kpis"><div class="kpi"><span>期初</span><b>${fmt(before)}</b></div><div class="kpi"><span>期間應收</span><b>${fmt(bills.reduce((s, b) => s + Math.max(0, C.eff[b.id] || 0), 0))}</b></div><div class="kpi"><span>期末餘額</span><b>${fmt(bal)}</b></div></div>${table(last, ['', ...bills.map(b => b.id)])}`;
  } else if (ui.tab === 'goods') {
    const m = new Map();
    for (const b of C.bills) { if (b.type !== 'SALE' && b.type !== 'SALE_RET') continue; if (!inR(b)) continue; const s = b.type === 'SALE' ? 1 : -1; (b.lines || []).forEach((l, i) => { if (!l.gid) return; const x = m.get(l.gid) || m.set(l.gid, { q: 0, a: 0, c: 0, n: 0 }).get(l.gid); x.q += s * (+l.qty || 0); x.a += s * Math.round((+l.qty || 0) * (+l.price || 0)); x.c += s * ((C.lineCogs[b.id] || [])[i] || 0); x.n++; }); }
    const rows = [...m.entries()].sort((a, b) => b[1].a - a[1].a).map(([gid, x]) => [gname(gid), fmtQ(x.q), fmt(x.a), fmt(x.c), fmt(x.a - x.c), String(x.n)]);
    last = { title: `商品銷售排行 ${ui.from}～${ui.to}`, head: ['商品', '數量', '金額', '成本', '毛利', '筆數'], rows, foot: ['合計', '', fmt(sum([...m.values()], x => x.a)), fmt(sum([...m.values()], x => x.c)), fmt(sum([...m.values()], x => x.a - x.c)), ''] };
    box.innerHTML = table(last);
  } else if (ui.tab === 'purchase') {
    const m = new Map();
    for (const b of C.bills) { if (b.type !== 'PUR' && b.type !== 'PUR_RET') continue; if (!inR(b)) continue; const s = b.type === 'PUR' ? 1 : -1; const x = m.get(b.cid) || m.set(b.cid, { a: 0, n: 0 }).get(b.cid); x.a += s * (C.tot[b.id]?.net || 0); x.n++; }
    const rows = [...m.entries()].sort((a, b) => b[1].a - a[1].a).map(([cid, x]) => [cname(cid), String(x.n), fmt(x.a)]);
    last = { title: `進貨統計 ${ui.from}～${ui.to}`, head: ['廠商', '單數', '進貨金額（未稅）'], rows, foot: ['合計', String(sum([...m.values()], x => x.n)), fmt(sum([...m.values()], x => x.a))] };
    box.innerHTML = table(last);
  } else if (ui.tab === 'stock') {
    const rows = []; let tv = 0;
    for (const g of store.list('goods')) { const q = Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0); if (!q) continue; const c = C.cost[g.id]?.avg || +g.purPrice || 0; tv += q * c; rows.push([g.code, g.name + ' ' + (g.spec || ''), fmtQ(q), g.unit || '', fmtQ(c), fmt(q * c)]); }
    rows.sort((a, b) => parseFloat(b[5].replace(/,/g, '')) - parseFloat(a[5].replace(/,/g, '')));
    last = { title: `庫存金額 ${today()}`, head: ['料號', '商品', '數量', '單位', '平均成本', '金額'], rows, foot: ['合計', `${rows.length} 項`, '', '', '', fmt(tv)] };
    box.innerHTML = table(last);
  }
  box.querySelectorAll('tr[data-bid]').forEach(tr => tr.addEventListener('click', () => openBill(null, tr.dataset.bid)));
  $('#rpCsv', el).onclick = () => downloadText(last.title + '.csv', '﻿' + [last.head, ...last.rows, last.foot].map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv');
  $('#rpPrint', el).onclick = () => printHTML(last.title, `@page{size:A4;margin:12mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:10pt;margin:0}h1{font-size:15pt;text-align:center}table{width:100%;border-collapse:collapse}th,td{border-bottom:.4pt solid #999;padding:1.2mm 1.5mm;text-align:left}th{border-top:1pt solid #000;border-bottom:1pt solid #000}td.n{text-align:right}tfoot td{font-weight:bold;border-top:1pt solid #000}`, `<h1>${esc(store.setting('company').name || '')} ${esc(last.title)}</h1>${table(last, null, true)}`, { tip: '按 Ctrl+P 列印。' });
}
const isNum = s => /^-?[\d,]+(\.\d+)?%?$/.test(String(s));
function table(t, ids, plain) {
  if (!t.rows.length) return '<div class="empty"><b>這段期間沒有資料</b></div>';
  return `<div class="tw"><table><thead><tr>${t.head.map((h, i) => `<th class="${t.rows[0] && isNum(t.rows[0][i]) ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r, ri) => `<tr ${ids && ids[ri] && !plain ? `class="row" data-bid="${ids[ri]}"` : ''}>${r.map(c => `<td class="${isNum(c) ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr>${t.foot.map(c => `<td class="${isNum(c) ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr></tfoot></table></div>`;
}
