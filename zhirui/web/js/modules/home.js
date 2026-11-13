// 總覽：今天該注意的事
import { esc, fmt, money, today, thisMonth, daysLeft, slash, ymLabel, roc, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, TYPES, cshort, nextNo, defWh } from '../core/calc.js';
import { toast, confirm } from '../core/ui.js';
import { openBill } from './_bills.js';
import { arSummary } from './receivables.js';
import { apSummary } from './payables.js';
import { memoBoard, bindMemoBoard } from './memos.js';
const MU = { showDone: false };

export default {
  id: 'home', name: '總覽', icon: 'home',
  render(el) { this.el = el; draw(el); },
  onChange() { if (this.el && this.el.isConnected) draw(this.el); },
};
// ---------- 門市銷售：每筆自動開一張出貨單（客戶 門市銷售、商品 門市銷售螺絲、數量＝金額、單價 1） ----------
const RETAIL_GOODS = '門市銷售螺絲';
const ui = { rdate: '', focus: false };
const retailCustomer = () => store.list('contacts').find(c => c.kind === 'C' && (c.code === 'C999' || c.name === '門市銷售')) || null;
async function retailGoods() {
  let g = store.list('goods').find(x => x.name === RETAIL_GOODS); if (g) return g;
  const id = uid('g'); const doc = { code: '門市', name: RETAIL_GOODS, spec: '', cat: '', unit: 'PCS', purPrice: 0, salePrice: 1, safety: 0, nostock: true, note: '門市銷售用：數量＝金額，單價 1 元；不管庫存' };
  await store.save('goods', id, doc); return { ...doc, id };
}
/** 登記一筆門市銷售（自動開銷貨單）；回傳單號，失敗回傳 null */
export async function createRetail(amt, note, date) {
  amt = Math.round(+String(amt).replace(/,/g, '')); note = String(note || '').trim(); date = date || today();
  if (!(amt > 0)) { toast('請輸入金額'); return null; }
  const c = retailCustomer(); if (!c) { toast('找不到客戶「門市銷售」，請先到基本資料新增'); return null; }
  const g = await retailGoods(); const wid = defWh()?.id || ''; const cash = store.list('accounts').find(a => /現金/.test(a.name)) || store.list('accounts')[0];
  const no = nextNo('SALE', date);
  const doc = { type: 'SALE', no, date, cid: c.id, wid, lines: [{ gid: g.id, qty: amt, price: 1 }], disc: 0, tax: false, paid: amt, aid: cash?.id || '', note, retail: true, createdAt: Date.now(), updatedAt: Date.now(), createdBy: store.user.id };
  await store.save('bills', uid('b'), doc); store.log('新增', `銷貨單 ${no}｜門市銷售｜${fmt(amt)} 元`); toast(`門市銷售 ${fmt(amt)} 元已登記（${no}）`); return no;
}
async function addRetail(el) { const date = el.querySelector('#rtDate').value || today(); ui.rdate = date; ui.focus = true; await createRetail(el.querySelector('#rtAmt').value, el.querySelector('#rtNote').value, date); }
/** 某天的門市銷售單 */
export function retailBills(C, day) { const c = retailCustomer(); return c ? C.bills.filter(b => b.type === 'SALE' && b.cid === c.id && b.date === day).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : []; }
export const retailCustomerExists = () => !!retailCustomer();
export const retailCustomerId = () => retailCustomer()?.id || '';
function retailPanel(C, t) {
  const c = retailCustomer(); const day = ui.rdate || t;
  const list = retailBills(C, day);
  const sum = list.reduce((s, b) => s + (C.tot[b.id]?.total || 0), 0);
  const hm = ms => { const d = new Date(ms || 0); return ms ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };
  return `<div class="panel" id="retail"><div class="ptitle">門市銷售明細<small>輸入金額就會自動開一張出貨單：客戶「門市銷售」、商品「${RETAIL_GOODS}」、單價 1 元、現金收訖</small></div>
    <div class="tools" style="align-items:flex-end"><div class="f"><label for="rtDate">日期</label><input type="date" id="rtDate" value="${esc(day)}"></div><div class="f" style="width:140px"><label for="rtAmt">金額</label><input id="rtAmt" class="num" inputmode="numeric" placeholder="例如 350"></div><div class="f" style="flex:1 1 220px"><label for="rtNote">備註</label><input id="rtNote" placeholder="例如 M8 螺絲 20 支（選填）"></div><button class="btn pri" id="rtAdd">登記</button></div>
    ${c ? '' : '<div class="banner">找不到客戶「門市銷售」，請先到基本資料新增。</div>'}
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>時間</th><th>單號</th><th class="n">金額</th><th>備註</th><th></th></tr></thead><tbody>
    ${list.map(b => `<tr><td class="nowrap">${hm(b.createdAt)}</td><td class="mono"><a href="#" data-rt-open="${b.id}">${esc(b.no)}</a></td><td class="n">${fmt(C.tot[b.id]?.total || 0)}</td><td>${esc(b.note || '')}</td><td class="r"><button class="btn xs" data-rt-del="${b.id}">刪除</button></td></tr>`).join('') || `<tr><td colspan="5" class="muted">${esc(slash(day))} 還沒有門市銷售</td></tr>`}</tbody>
    ${list.length ? `<tfoot><tr><td colspan="2">${esc(slash(day))} 合計 ${list.length} 筆</td><td class="n">${fmt(sum)}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div></div>`;
}
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
    ${memoBoard(MU)}
    <div class="kpis">
      <a class="kpi" href="#sales"><span>本月銷貨（未稅）</span><b>${fmt(sales)}</b><small>${n} 張・毛利 ${fmt(profit)}</small></a>
      <a class="kpi" href="#purchase"><span>本月進貨（未稅）</span><b>${fmt(pur)}</b></a>
      <a class="kpi ${ar.late ? 'alert' : ''}" href="#receivables"><span>應收未收</span><b>${fmt(ar.open)}</b><small>${ar.openN} 筆${ar.late ? `・逾期 ${ar.late} 筆` : ''}</small></a>
      <a class="kpi" href="#payables"><span>應付待開票</span><b>${fmt(ap.open)}</b><small>${ap.openN} 筆</small></a>
      <a class="kpi ${late.length ? 'alert' : ''}" href="#checks-in"><span>待代收客票</span><b>${fmt(cin.reduce((s, c) => s + (+c.amt || 0), 0))}</b><small>${cin.length} 張${late.length ? `・已到期 ${late.length}` : ''}${soon.length ? `・7 天內 ${soon.length}` : ''}</small></a>
      <a class="kpi" href="#invoices"><span>本月發票</span><b>${fmt(invSum)}</b><small>${inv.length} 張${pendInv.length ? `・${pendInv.length} 張銷貨單未開` : ''}</small></a>
    </div>
    ${retailPanel(C, t)}
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
        <div class="tw"><table><tbody>${orders.sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 8).map(o => `<tr><td>${esc(o.cid ? cshort(o.cid) : o.vendor)}</td><td>${esc(o.prod)}</td><td class="n">${esc(o.qty)}</td><td class="nowrap ${o.due && o.due < t ? 'muted' : ''}" style="${o.due && o.due < t ? 'color:var(--bad)' : ''}">${o.due ? esc(roc(o.due)) : ''}</td></tr>`).join('') || '<tr><td class="muted">沒有進行中的訂貨</td></tr>'}</tbody></table></div>
      </div>
      <div class="panel"><div class="ptitle">即將到期客票<small>7 天內</small></div>
        <div class="tw"><table><tbody>${[...late, ...soon].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 8).map(c => `<tr><td class="nowrap" style="${c.due < t ? 'color:var(--bad)' : ''}">${esc(roc(c.due))}</td><td>${esc(c.cid ? cshort(c.cid) : c.name)}</td><td class="muted">${esc(c.bank || '')}</td><td class="n">${money(c.amt)}</td></tr>`).join('') || '<tr><td class="muted">沒有 7 天內到期的客票</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
  bindMemoBoard(el, MU, () => draw(el));
  el.querySelectorAll('tr[data-href]').forEach(tr => tr.addEventListener('click', () => location.hash = tr.dataset.href));
  // 門市銷售
  const rt = el.querySelector('#retail');
  rt.querySelector('#rtAdd').addEventListener('click', () => addRetail(el));
  rt.querySelectorAll('#rtAmt, #rtNote').forEach(i => i.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); addRetail(el); } }));
  rt.querySelector('#rtDate').addEventListener('change', ev => { ui.rdate = ev.target.value; ui.focus = true; draw(el); });
  rt.querySelectorAll('[data-rt-open]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openBill(null, a.dataset.rtOpen); }));
  rt.querySelectorAll('[data-rt-del]').forEach(b => b.addEventListener('click', async () => { const x = store.get('bills', b.dataset.rtDel); if (!x) return; if (await confirm(`刪除門市銷售 ${fmt(C.tot[x.id]?.total || 0)} 元（${x.no}）？`, { danger: true, ok: '刪除' })) { await store.remove('bills', x.id); store.log('刪除', `銷貨單 ${x.no}｜門市銷售`); } }));
  if (ui.focus) { ui.focus = false; setTimeout(() => el.querySelector('#rtAmt')?.focus(), 30); }
}
const href = b => b.type === 'SALE' || b.type === 'SALE_RET' ? 'sales' : b.type === 'PUR' || b.type === 'PUR_RET' || b.type === 'PO' ? 'purchase' : b.type === 'QUO' || b.type === 'RFQ' ? 'quotes' : b.type === 'SO' ? 'custorders' : TYPES[b.type].money ? 'money' : 'stock';
const todo = items => { const li = items.filter(([n]) => n > 0); return li.length ? `<div style="display:grid;gap:6px">${li.map(([, txt, h]) => `<a href="${h}" style="display:flex;gap:8px;align-items:center;color:inherit"><span class="pill bad">!</span>${esc(txt)}</a>`).join('')}</div>` : '<div class="muted">目前沒有需要處理的事 ✓</div>'; };
