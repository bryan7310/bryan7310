// 發票作業：銷項發票（由銷貨單開立）、待開清單、進項發票、套印
import { $, esc, fmt, money, today, thisMonth, roc, slash, parseNum, uid, cnMoney, ubnOk, shiftMonth, ymLabel, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, printHTML, pager } from '../core/ui.js';
import { calc, customers, suppliers, cshort, totals, gname } from '../core/calc.js';
import { openBill } from './_bills.js';

const ui = { tab: 'list', ym: thisMonth(), q: '', page: 0, pq: '', pPeriod: '' };
export default {
  id: 'invoices', name: '發票作業', group: '財務', icon: 'invoice',
  render(el, { sub }) { this.el = el; if (sub === 'pending') ui.tab = 'pending'; if (sub === 'purch') ui.tab = 'purch'; draw(el); },
  onChange(ch) { if (this.el?.isConnected && ['invoices', 'bills', 'purch_invoices', 'contacts', 'settings'].some(c => ch.has(c))) draw(this.el); },
  badge() { return { cnt: pendingBills().length }; },
};
export const pendingBills = () => calc().bills.filter(b => b.type === 'SALE' && !b.hist && !b.invNo && !b.noInv && (b.date || '') >= '2026-11-01');
const total = i => (+i.untaxed || 0) + (+i.tax || 0);
export function nextInvNo() {
  let best = null;
  for (const i of store.list('invoices')) { const m = /^([A-Z]{2})(\d{8})$/.exec(i.no); if (!m) continue; if (!best || i.date > best.date || (i.date === best.date && +m[2] > best.n)) best = { p: m[1], n: +m[2], date: i.date }; }
  return best ? best.p + String(best.n + 1).padStart(8, '0') : '';
}
function draw(el) {
  const TABS = [['list', '銷項發票'], ['pending', `待開 ${pendingBills().length || ''}`], ['purch', '進項發票']];
  el.innerHTML = `<div class="head"><h1>發票作業</h1><span class="sp"></span>${tabs('iv', TABS, ui.tab)}<button class="btn pri" id="ivNew">＋ 手開發票</button></div><div id="ivBody"></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  $('#ivNew', el).addEventListener('click', () => editInvoice(null));
  const body = $('#ivBody', el);
  if (ui.tab === 'pending') drawPending(body); else if (ui.tab === 'purch') drawPurch(body); else drawList(body);
}
function drawList(el) {
  const q = qTerms(ui.q);
  const list = store.list('invoices').filter(i => (!ui.ym || (i.date || '').startsWith(ui.ym)) && (!q.length || matchQ([i.no, i.name, i.buyer].join(' '), q))).sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.no).localeCompare(String(a.no)));
  const [s, e, pg] = pager('iv', list.length, ui.page);
  const sumU = list.reduce((a, i) => a + (+i.untaxed || 0), 0), sumT = list.reduce((a, i) => a + (+i.tax || 0), 0);
  el.innerHTML = `<div class="panel"><div class="tools"><input type="month" id="ivYm" value="${ui.ym}"><input type="search" id="ivQ" placeholder="搜尋發票號碼、買受人、統編" value="${esc(ui.q)}"><span class="muted small">${list.length} 張・銷售額 ${money(sumU)}・稅 ${money(sumT)}・合計 ${money(sumU + sumT)}</span><span class="sp"></span><button class="btn sm" id="ivPrintAll" ${list.length ? '' : 'disabled'}>列印本月明細</button></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>日期</th><th>發票號碼</th><th>買受人</th><th>統編</th><th class="n">銷售額</th><th class="n">稅額</th><th class="n">總計</th><th>來源</th><th></th></tr></thead><tbody>${list.slice(s, e).map(i => `<tr class="row" data-no="${esc(i.no)}"><td class="nowrap">${esc(slash(i.date))}</td><td class="mono">${esc(i.no)}${i.void ? ' <span class="pill bad">作廢</span>' : ''}</td><td>${esc(i.name)}</td><td class="mono">${esc(i.buyer || '')}</td><td class="n">${money(i.untaxed)}</td><td class="n">${money(i.tax)}</td><td class="n">${money(total(i))}</td><td class="muted small">${i.billId ? '銷貨單' : i.legacy ? '匯入' : '手開'}</td><td class="nowrap"><button class="btn xs" data-print="${esc(i.no)}">套印</button></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty"><b>這個月沒有發票</b></div></td></tr>'}</tbody></table></div>${pg}</div>`;
  $('#ivYm', el).addEventListener('change', ev => { ui.ym = ev.target.value; ui.page = 0; drawList(el); });
  $('#ivQ', el).addEventListener('input', ev => { ui.q = ev.target.value; ui.page = 0; drawList(el); const i = $('#ivQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; drawList(el); }));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button')) return; editInvoice(store.get('invoices', tr.dataset.no)); }));
  el.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => printInvoices([store.get('invoices', b.dataset.print)], 'form')));
  $('#ivPrintAll', el).addEventListener('click', () => printInvoices(list, 'list'));
}
function drawPending(el) {
  const C = calc(); const list = pendingBills().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  el.innerHTML = `<div class="panel"><p class="muted" style="margin:0 0 10px">這些銷貨單還沒開發票。按「開發票」會帶入客戶統編、品項與金額；不需要開的按「不開」。</p>
    <div class="tw"><table><thead><tr><th>日期</th><th>單號</th><th>客戶</th><th>統編</th><th class="n">未稅</th><th class="n">稅</th><th></th></tr></thead><tbody>${list.map(b => { const c = C.ct[b.cid]; const t = C.tot[b.id]; return `<tr><td class="nowrap">${esc(slash(b.date))}</td><td class="mono"><a href="#" data-open="${b.id}">${esc(b.no)}</a></td><td>${esc(c?.name || '')}</td><td class="mono ${c?.taxId ? '' : 'muted'}">${esc(c?.taxId || '（無）')}</td><td class="n">${money(t.net)}</td><td class="n">${money(b.tax ? t.tax : Math.round(t.net * 0.05))}</td><td class="nowrap"><button class="btn xs pri" data-inv="${b.id}">開發票</button> <button class="btn xs ghost" data-skip="${b.id}">不開</button></td></tr>`; }).join('') || '<tr><td colspan="7"><div class="empty"><b>沒有待開發票的銷貨單 ✓</b></div></td></tr>'}</tbody></table></div></div>`;
  el.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openBill(null, a.dataset.open); }));
  el.querySelectorAll('[data-inv]').forEach(b => b.addEventListener('click', () => makeInvoiceFromBill(store.get('bills', b.dataset.inv))));
  el.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', async () => { const bill = store.get('bills', b.dataset.skip); await store.save('bills', bill.id, { ...bill, noInv: true }); }));
}
export function makeInvoiceFromBill(b) {
  const C = calc(); const c = C.ct[b.cid] || {}; const t = totals(b);
  const items = (b.lines || []).filter(l => l.txt === undefined).map(l => ({ name: l.gid ? gname(l.gid) : l.n || '', qty: +l.qty || 0, price: +l.price || 0, amount: Math.round((+l.qty || 0) * (+l.price || 0)) }));
  editInvoice({ no: nextInvNo(), date: b.date, buyer: c.taxId || '', name: c.name || '', cid: b.cid, items, untaxed: t.net, tax: b.tax ? t.tax : Math.round(t.net * 0.05), billId: b.id, billNo: b.no }, true);
}
function editInvoice(inv, isNew) {
  const d = inv || { no: nextInvNo(), date: today(), buyer: '', name: '', items: [{ name: '螺絲', qty: '', price: '', amount: '' }], untaxed: 0, tax: 0 };
  isNew = isNew || !inv;
  const draw2 = () => {
    const rows = (d.items || []).map((it, i) => `<tr><td><input data-f="name" data-i="${i}" value="${esc(it.name)}"></td><td><input data-f="qty" data-i="${i}" class="num" value="${esc(it.qty ?? '')}"></td><td><input data-f="price" data-i="${i}" class="num" value="${esc(it.price ?? '')}"></td><td><input data-f="amount" data-i="${i}" class="num" value="${esc(it.amount ?? '')}"></td><td><button class="icon-btn" data-del="${i}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td></tr>`).join('');
    return `<div class="grid">
      <div class="f"><label for="iv-no">發票號碼</label><input id="iv-no" class="mono" value="${esc(d.no)}" placeholder="例如 GF14518253" ${!isNew ? 'readonly' : ''}></div>
      <div class="f"><label for="iv-date">日期</label><input type="date" id="iv-date" value="${esc(d.date)}"></div>
      <div class="f" style="grid-column:span 2"><label for="iv-name">買受人</label><div class="combo"><input id="iv-name" value="${esc(d.name)}" placeholder="搜尋客戶或直接輸入"></div></div>
      <div class="f"><label for="iv-buyer">統一編號</label><input id="iv-buyer" class="mono" value="${esc(d.buyer || '')}" maxlength="8"></div>
      ${d.billNo ? `<div class="f"><label>來源</label><div>銷貨單 ${esc(d.billNo)}</div></div>` : ''}</div>
      <table class="lines"><thead><tr><th>品名</th><th class="r" style="width:90px">數量</th><th class="r" style="width:100px">單價</th><th class="r" style="width:110px">金額</th><th style="width:30px"></th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tools"><button class="btn sm" id="iv-add">＋ 加一行</button><span class="sp"></span><label class="check"><input type="checkbox" id="iv-incl" ${d.taxMode === 'in' ? 'checked' : ''}> 金額為含稅（反推）</label></div>
      <div class="totals"><div><span>銷售額</span> <input id="iv-untaxed" class="num" value="${money(d.untaxed)}" style="width:110px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;text-align:right"></div><div><span>稅額</span> <input id="iv-tax" class="num" value="${money(d.tax)}" style="width:90px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;text-align:right"></div><div class="big"><span>總計</span> <b id="iv-total">${money(total(d))}</b></div></div>
      <div class="muted small" id="iv-cn">${cnMoney(total(d))}</div><div class="err" id="iv-err"></div>`;
  };
  const m = modal({
    title: isNew ? '開立發票' : `發票 ${d.no}`, width: 760, body: draw2(),
    footer: `${!isNew ? `<button class="btn danger" id="iv-void">${d.void ? '取消作廢' : '作廢'}</button><button class="btn" id="iv-print">套印</button>` : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="iv-ok">儲存</button>`,
    onOpen(el, close) {
      const recalc = () => {
        let sum = 0; for (const it of d.items) { if (it.qty !== '' && it.price !== '' && it.amount === '') it.amount = Math.round((+it.qty || 0) * (+it.price || 0)); sum += +it.amount || 0; }
        if (sum) { if ($('#iv-incl', el).checked) { d.untaxed = Math.round(sum / 1.05); d.tax = sum - d.untaxed; } else { d.untaxed = sum; d.tax = Math.round(sum * 0.05); } $('#iv-untaxed', el).value = money(d.untaxed); $('#iv-tax', el).value = money(d.tax); }
        $('#iv-total', el).textContent = money(total(d)); $('#iv-cn', el).textContent = cnMoney(total(d));
      };
      const bind = () => {
        el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => { const it = d.items[+inp.dataset.i]; it[inp.dataset.f] = inp.dataset.f === 'name' ? inp.value : inp.value; if (inp.dataset.f === 'qty' || inp.dataset.f === 'price') { it.amount = ''; } recalc(); }));
        el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { d.items.splice(+b.dataset.del, 1); el.querySelector('.mb').innerHTML = draw2(); bind(); }));
        $('#iv-add', el).onclick = () => { d.items.push({ name: '', qty: '', price: '', amount: '' }); el.querySelector('.mb').innerHTML = draw2(); bind(); };
        $('#iv-incl', el).onchange = () => { d.taxMode = $('#iv-incl', el).checked ? 'in' : 'ex'; d.items.forEach(it => { if (it.qty !== '' && it.price !== '') it.amount = ''; }); recalc(); };
        $('#iv-untaxed', el).addEventListener('change', () => { d.untaxed = parseNum($('#iv-untaxed', el).value) || 0; d.tax = Math.round(d.untaxed * 0.05); $('#iv-tax', el).value = money(d.tax); $('#iv-total', el).textContent = money(total(d)); });
        $('#iv-tax', el).addEventListener('change', () => { d.tax = parseNum($('#iv-tax', el).value) || 0; $('#iv-total', el).textContent = money(total(d)); });
        combo($('#iv-name', el), { items: () => customers().map(c => ({ id: c.id, label: c.name, sub: c.taxId || '', text: [c.code, c.name, c.short, c.taxId, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { const c = store.get('contacts', it.id); d.cid = c.id; d.name = c.name; if (c.taxId) $('#iv-buyer', el).value = c.taxId; }, onBlur: v => { d.name = v; } });
      };
      bind();
      $('#iv-ok', el).onclick = async () => {
        const no = $('#iv-no', el).value.trim().toUpperCase(); const buyer = $('#iv-buyer', el).value.trim();
        if (!/^[A-Z]{2}\d{8}$/.test(no)) return $('#iv-err', el).textContent = '發票號碼格式：2 個英文字母＋8 碼數字';
        if (isNew && store.get('invoices', no)) return $('#iv-err', el).textContent = '這個發票號碼已經開過';
        if (buyer && !ubnOk(buyer)) { if (!await confirm(`統一編號 ${buyer} 檢查碼不符，仍要儲存？`)) return; }
        const out = { no, date: $('#iv-date', el).value, buyer, name: $('#iv-name', el).value.trim(), cid: d.cid || null, items: d.items.filter(it => it.name).map(it => ({ name: it.name, qty: it.qty === '' ? null : +it.qty, price: it.price === '' ? null : +it.price, amount: +it.amount || 0 })), untaxed: parseNum($('#iv-untaxed', el).value) || 0, tax: parseNum($('#iv-tax', el).value) || 0, taxMode: d.taxMode || 'ex', billId: d.billId || null, void: d.void || false, createdAt: d.createdAt || Date.now() };
        const ops = [{ col: 'invoices', id: no, data: out }];
        if (d.billId) { const b = store.get('bills', d.billId); if (b) ops.push({ col: 'bills', id: b.id, data: { ...b, invNo: no } }); }
        if (d.cid && buyer) { const c = store.get('contacts', d.cid); if (c && !c.taxId) ops.push({ col: 'contacts', id: c.id, data: { ...c, taxId: buyer } }); }
        await store.batch(ops); store.log(isNew ? '開立' : '修改', `發票 ${no} ${out.name} ${money(total(out))}`); close(); toast(`發票 ${no} 已儲存`);
      };
      $('#iv-void', el)?.addEventListener('click', async () => { if (await confirm(d.void ? '取消作廢？' : `作廢發票 ${d.no}？`, { danger: !d.void })) { await store.save('invoices', d.no, { ...store.get('invoices', d.no), void: !d.void }); close(); } });
      $('#iv-print', el)?.addEventListener('click', () => printInvoices([d], 'form'));
    },
  });
}
// ---------- 套印：三聯式手開發票（3×5.5 吋）或 A4 明細 ----------
const ROW = 4.568, COL = { A: 0, B: 11.58, C: 28.25, D: 39.83, E: 50.7, end: 64.2 }, FORM_TOP = 20, FORM_LEFT = 4, FORM_LINES = 8;
export function printInvoices(list, mode) {
  const co = store.setting('company'); const ps = store.setting('invoice_print');
  const n0 = v => v == null || v === '' ? '' : Math.round(+v).toLocaleString('en-US'); const n2 = v => v == null || v === '' ? '' : (+v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (mode === 'form') {
    const f = (row, x, text, al) => text === '' || text == null ? '' : `<span class="f ${al || ''}" style="top:${((row - 1) * ROW).toFixed(3)}mm;left:${x.toFixed(2)}mm">${esc(text)}</span>`;
    const mid = (a, b) => (COL[a] + COL[b]) / 2;
    const sheets = list.map(inv => {
      let h = f(1, COL.A, co.name || '') + f(2, COL.A, `統編 ${co.taxId || ''}`) + f(3, COL.A, co.addr || '') + f(4, COL.B, slash(inv.date)) + f(5, COL.B, inv.name) + f(6, COL.B, inv.buyer ? '買受人統編:' + inv.buyer : '') + f(8, COL.A, '品名') + f(8, mid('C', 'D'), '數量', 'c') + f(8, mid('D', 'E'), '單價', 'c') + f(8, mid('E', 'end'), '金額', 'c');
      (inv.items || []).slice(0, FORM_LINES).forEach((it, k) => { const r = 9 + k; h += f(r, COL.A, it.name) + f(r, mid('C', 'D'), n0(it.qty), 'c') + f(r, mid('D', 'E'), n2(it.price), 'c') + f(r, mid('E', 'end'), it.qty != null && it.price != null ? n0(it.amount) : '', 'c'); });
      h += f(24, COL.E, n0(inv.untaxed), 'r') + f(25, COL.E, n0(inv.tax), 'r') + f(26, COL.E, n0(total(inv)), 'r');
      return `<div class="sheet"><div class="frm" style="top:${FORM_TOP + (+ps.dy || 0)}mm;left:${FORM_LEFT + (+ps.dx || 0)}mm">${h}</div></div>`;
    }).join('');
    printHTML('發票套印', `@page{size:3in 5.5in;margin:0}body{margin:0}.sheet{position:relative;width:76.2mm;height:139.4mm;page-break-after:always;overflow:hidden}.frm{position:absolute;width:64.2mm;font:11pt/1 "PMingLiU","新細明體","MingLiU","Noto Serif TC",serif}.frm .f{position:absolute;white-space:nowrap;height:${ROW}mm;line-height:${ROW}mm}.frm .f.c{transform:translateX(-50%)}.frm .f.r{transform:translateX(-100%)}`, sheets, { tip: `把三聯式發票放進印表機，紙張選 3×5.5 吋、邊界「無」、縮放 100%。位置偏了可到「設定 → 發票套印」調整（目前位移 ${ps.dx || 0}, ${ps.dy || 0} mm）。` });
  } else {
    const rows = list.map(i => `<tr><td>${esc(slash(i.date))}</td><td>${esc(i.no)}</td><td>${esc(i.name)}</td><td>${esc(i.buyer || '')}</td><td class="n">${n0(i.untaxed)}</td><td class="n">${n0(i.tax)}</td><td class="n">${n0(total(i))}</td></tr>`).join('');
    const su = list.reduce((a, i) => a + (+i.untaxed || 0), 0), st = list.reduce((a, i) => a + (+i.tax || 0), 0);
    printHTML('發票明細', `@page{size:A4;margin:12mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:10pt;margin:0}h1{font-size:15pt;text-align:center}table{width:100%;border-collapse:collapse}th,td{border-bottom:.4pt solid #999;padding:1.2mm 1.5mm;text-align:left}th{border-top:1pt solid #000;border-bottom:1pt solid #000}td.n,th.n{text-align:right}tfoot td{font-weight:bold;border-top:1pt solid #000}`, `<h1>${esc(co.name || '')} 銷項發票明細 ${esc(ymLabel(ui.ym))}</h1><table><thead><tr><th>日期</th><th>發票號碼</th><th>買受人</th><th>統編</th><th class="n">銷售額</th><th class="n">稅額</th><th class="n">總計</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4">合計 ${list.length} 張</td><td class="n">${n0(su)}</td><td class="n">${n0(st)}</td><td class="n">${n0(su + st)}</td></tr></tfoot></table>`, { tip: '按 Ctrl+P 列印，A4。' });
  }
}
// ---------- 進項發票 ----------
function drawPurch(el) {
  const q = qTerms(ui.pq);
  const list = store.list('purch_invoices').filter(p => (!ui.pPeriod || p.period === ui.pPeriod) && (!q.length || matchQ([p.no, p.name, p.note].join(' '), q))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const periods = [...new Set(store.list('purch_invoices').map(p => p.period).filter(Boolean))].sort().reverse();
  const su = list.reduce((a, p) => a + (+p.untaxed || 0), 0), st = list.reduce((a, p) => a + (+p.tax || 0), 0);
  el.innerHTML = `<div class="panel"><div class="tools"><select id="pvP"><option value="">全部期別</option>${periods.map(p => `<option ${p === ui.pPeriod ? 'selected' : ''}>${p}</option>`).join('')}</select><input type="search" id="pvQ" placeholder="搜尋廠商、發票號碼" value="${esc(ui.pq)}"><span class="muted small">${list.length} 張・未稅 ${money(su)}・稅 ${money(st)}</span><span class="sp"></span><button class="btn sm pri" id="pvAdd">＋ 新增進項發票</button></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>期別</th><th>日期</th><th>廠商</th><th>發票號碼</th><th>類別</th><th class="n">未稅</th><th class="n">稅額</th><th class="n">總計</th><th></th></tr></thead><tbody>${list.map(p => `<tr class="row" data-id="${p.id}"><td>${esc(p.period || '')}</td><td class="nowrap">${esc(slash(p.date))}</td><td>${esc(p.name)}</td><td class="mono">${esc(p.no)}</td><td>${esc(p.kind || '')}</td><td class="n">${money(p.untaxed)}</td><td class="n">${money(p.tax)}</td><td class="n">${money(p.total ?? (+p.untaxed + +p.tax))}</td><td></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty"><b>沒有進項發票</b></div></td></tr>'}</tbody></table></div></div>`;
  $('#pvP', el).addEventListener('change', ev => { ui.pPeriod = ev.target.value; drawPurch(el); });
  $('#pvQ', el).addEventListener('input', ev => { ui.pq = ev.target.value; drawPurch(el); const i = $('#pvQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#pvAdd', el).addEventListener('click', () => editPurch(null));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => editPurch(store.get('purch_invoices', tr.dataset.id))));
}
function editPurch(p) {
  const d = p || { period: thisMonth(), date: today(), name: '', no: '', untaxed: '', tax: '', kind: '進項', note: '' };
  modal({
    title: p ? `進項發票 ${p.no}` : '新增進項發票', width: 560,
    body: `<div class="grid"><div class="f"><label for="pu-period">期別（申報月）</label><input type="month" id="pu-period" value="${esc(d.period)}"></div><div class="f"><label for="pu-date">發票日期</label><input type="date" id="pu-date" value="${esc(d.date)}"></div>
      <div class="f" style="grid-column:span 2"><label for="pu-name">廠商</label><div class="combo"><input id="pu-name" value="${esc(d.name)}"></div></div><div class="f"><label for="pu-no">發票號碼</label><input id="pu-no" class="mono" value="${esc(d.no)}"></div><div class="f"><label for="pu-kind">類別</label><select id="pu-kind">${['進項', '固定資產', '不可扣抵', '其他'].map(k => `<option ${k === d.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
      <div class="f"><label for="pu-untaxed">未稅</label><input id="pu-untaxed" class="num" value="${d.untaxed !== '' ? money(d.untaxed) : ''}"></div><div class="f"><label for="pu-tax">稅額</label><input id="pu-tax" class="num" value="${d.tax !== '' ? money(d.tax) : ''}"></div><div class="f" style="grid-column:1/-1"><label for="pu-note">備註</label><input id="pu-note" value="${esc(d.note || '')}"></div></div>`,
    footer: `${p ? '<button class="btn danger" id="pu-del">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="pu-ok">儲存</button>`,
    onOpen(el, close) {
      let cid = d.cid;
      combo($('#pu-name', el), { items: () => suppliers().map(c => ({ id: c.id, label: c.name, sub: c.short || '', text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { cid = it.id; } });
      $('#pu-untaxed', el).addEventListener('change', () => { const u = parseNum($('#pu-untaxed', el).value); if (u && !$('#pu-tax', el).value) $('#pu-tax', el).value = money(Math.round(u * 0.05)); });
      $('#pu-ok', el).onclick = async () => {
        const untaxed = parseNum($('#pu-untaxed', el).value) || 0, tax = parseNum($('#pu-tax', el).value) || 0;
        if (!$('#pu-name', el).value.trim()) return toast('請填廠商');
        await store.save('purch_invoices', d.id || uid('pi'), { ...d, id: undefined, cid, period: $('#pu-period', el).value, date: $('#pu-date', el).value, name: $('#pu-name', el).value.trim(), no: $('#pu-no', el).value.trim().toUpperCase(), kind: $('#pu-kind', el).value, untaxed, tax, total: untaxed + tax, note: $('#pu-note', el).value.trim() }); close(); toast('已儲存');
      };
      $('#pu-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這張進項發票？', { danger: true, ok: '刪除' })) { await store.remove('purch_invoices', p.id); close(); } });
    },
  });
}
