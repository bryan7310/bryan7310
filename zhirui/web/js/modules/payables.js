// 應付帳款：每月各廠商金額由進貨單自動彙總，可手動調整；勾選後送待開支票（支票開立的待列印）
import { $, esc, fmt, money, today, thisMonth, ymLabel, shiftMonth, roc, slash, parseNum, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo } from '../core/ui.js';
import { calc, suppliers, cshort } from '../core/calc.js';
import { openBill } from './_bills.js';

const ui = { ym: thisMonth(), tab: 'month', filter: 'all', sel: new Set() };
/** 兌現日預設：該月份往後兩個月的 10 日（115/10 的帳 → 115/12/10） */
const defDue = ym => shiftMonth(ym, 2) + '-10';
const dueOf = r => r.dueDate || defDue(r.ym);
export default {
  id: 'payables', name: '應付帳款', group: '財務', icon: 'payables',
  render(el, { sub }) { this.el = el; if (sub === 'open') ui.tab = 'open'; draw(el); },
  onChange(ch) { if (this.el?.isConnected && ['bills', 'payables', 'contacts', 'checks_out'].some(c => ch.has(c))) draw(this.el); },
  badge() { const s = apSummary(); return { cnt: s.openN }; },
};
// 應付帳款月份＝25 結：上月 26 日～本月 25 日（115/10 ＝ 115/09/26～115/10/25）
export const apYm = date => { const d = String(date || ''); if (d.length < 10) return d.slice(0, 7); return +d.slice(8, 10) >= 26 ? shiftMonth(d.slice(0, 7), 1) : d.slice(0, 7); };
export const apRange = ym => [shiftMonth(ym, -1) + '-26', ym + '-25'];
export function apRows(ym) {
  const C = calc(); const auto = new Map();
  for (const b of C.bills) {
    if ((b.type !== 'PUR' && b.type !== 'PUR_RET') || apYm(b.date) !== ym || !b.cid) continue;
    const s = b.type === 'PUR' ? 1 : -1; const t = C.tot[b.id];
    const a = auto.get(b.cid) || auto.set(b.cid, { amt: 0, tax: 0, bills: [] }).get(b.cid);
    a.amt += s * t.net; a.tax += s * (b.tax ? t.tax : Math.round(t.net * 0.05)); a.bills.push(b);
  }
  const docs = store.list('payables').filter(r => r.ym === ym); const out = []; const used = new Set();
  for (const r of docs) {
    const a = r.cid ? auto.get(r.cid) : null; if (r.cid) used.add(r.cid);
    const amt = r.amt != null && (r.manual || !a) ? +r.amt : (a ? a.amt : +r.amt || 0);
    const tax = r.tax != null && (r.manual || !a) ? +r.tax : (a ? a.tax : +r.tax || 0);
    out.push({ ...r, amt, tax, auto: a, total: amt + tax, name: r.cid ? cshort(r.cid) : r.vendor });
  }
  for (const [cid, a] of auto) if (!used.has(cid)) { if (Math.abs(a.amt) < 0.5) continue; out.push({ id: null, ym, cid, vendor: cshort(cid), name: cshort(cid), amt: a.amt, tax: a.tax, total: a.amt + a.tax, auto: a, pay: null }); }
  // 依總額由大到小；同額再依廠商名稱
  return out.sort((x, y) => (+y.total || 0) - (+x.total || 0) || String(x.name).localeCompare(String(y.name), 'zh-Hant'));
}
export function apSummary() {
  const months = new Set([...store.list('payables').map(r => r.ym), ...calc().bills.filter(b => b.type === 'PUR' && b.cid).map(b => apYm(b.date))].filter(Boolean));
  let open = 0, openN = 0;
  for (const ym of months) for (const r of apRows(ym)) { if (r.pay == null && r.total > 0) { open += r.total; openN++; } }
  return { open, openN };
}
const rowId = r => r.id || ('ap' + r.ym + '_' + r.cid);
// 這列的支票狀態：none 沒開票／open 已開票、還沒列印（可取消）／printed 已列印／gone 支票已不在
const ckState = r => { if (!r.checkId) return 'none'; const c = store.get('checks_out', r.checkId); return !c ? 'gone' : c.printedAt ? 'printed' : 'open'; };
const canSel = r => ['none', 'open'].includes(ckState(r));
async function saveRow(r, patch) { const base = r.id ? store.get('payables', r.id) : { ym: r.ym, cid: r.cid, vendor: r.name, ord: r.ord }; await store.save('payables', rowId(r), { ...base, ...patch }); }

function draw(el) {
  const ym = ui.ym; const rows = apRows(ym);
  const list = ui.tab === 'open' ? allOpen() : rows.filter(r => ui.filter === 'all' || (ui.filter === 'open' ? r.pay == null : r.pay != null));
  const tot = f => rows.reduce((s, r) => s + f(r), 0); const paid = rows.filter(r => r.pay != null);
  el.innerHTML = `<div class="head"><h1>應付帳款</h1><span class="sp"></span>${tabs('ap', [['month', '本月'], ['open', '待開票']], ui.tab)}<button class="btn pri" id="apAdd">＋ 手動新增</button></div>
    ${ui.tab === 'month' ? `<div class="panel" style="display:grid;gap:12px">
      <div class="tools"><button class="btn sm" id="prevM">‹</button><input type="month" id="ym" value="${ym}" style="font-weight:600"><button class="btn sm" id="nextM">›</button><span class="muted">${ymLabel(ym)}（${roc(apRange(ym)[0])}～${roc(apRange(ym)[1])}）</span><span class="sp"></span>${tabs('f', [['all', '全部'], ['open', '待開票'], ['done', '已開票']], ui.filter)}</div>
      <div class="kpis"><div class="kpi"><span>應付（未稅）</span><b>${money(tot(r => r.amt))}</b></div><div class="kpi"><span>稅額</span><b>${money(tot(r => r.tax))}</b></div><div class="kpi"><span>總額</span><b>${money(tot(r => r.total))}</b></div><div class="kpi ok"><span>已開票 ${paid.length} 家</span><b>${money(paid.reduce((s, r) => s + (+r.pay || 0), 0))}</b></div><div class="kpi ${rows.length - paid.length ? 'alert' : ''}"><span>待開票 ${rows.length - paid.length} 家</span><b>${money(rows.filter(r => r.pay == null).reduce((s, r) => s + r.total, 0))}</b></div></div>
      <p class="muted small" style="margin:0">金額由該月進貨單自動加總（25 結：上月 26 日～本月 25 日；進貨退出扣除，稅額以 5% 計）。在「開票金額」欄輸入金額並按 Enter 即完成。勾選要付的廠商、確認兌現日，按「送待開支票」會送到「支票開立」的待列印（兌現日＝票載日期）。</p>
      ${sendBar()}${table(list, false)}</div>` : `<div class="panel">${sendBar()}${table(list, true)}</div>`}`;
  el.addEventListener('tab', ev => { if (ev.detail.key === 'ap') ui.tab = ev.detail.val; else ui.filter = ev.detail.val; draw(el); }, { once: true });
  $('#ym', el)?.addEventListener('change', ev => { ui.ym = ev.target.value; draw(el); });
  $('#prevM', el)?.addEventListener('click', () => { ui.ym = shiftMonth(ui.ym, -1); draw(el); });
  $('#nextM', el)?.addEventListener('click', () => { ui.ym = shiftMonth(ui.ym, 1); draw(el); });
  $('#apAdd', el).addEventListener('click', () => editRow({ ym, manual: true }));
  el.querySelectorAll('[data-pay]').forEach(inp => inp.addEventListener('change', async () => { const r = list[+inp.dataset.pay]; const v = parseNum(inp.value); if (v != null && isNaN(v)) return toast('金額不正確'); await saveRow(r, { pay: v, payDate: v != null ? (r.payDate || today()) : undefined, amt: r.amt, tax: r.tax, manual: !!r.manual }); toast(v != null ? `${r.name} 開票 ${money(v)}` : `${r.name} 改回待開票`); }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editRow(list[+b.dataset.edit])));
  const selRows = () => list.filter(r => ui.sel.has(rowId(r)) && !r.checkId);
  const cancelRows = () => list.filter(r => ui.sel.has(rowId(r)) && ckState(r) === 'open');
  const updSel = () => { const n = selRows().length; const b = $('#apSend', el); if (b) { b.disabled = !n; b.textContent = n ? `送待開支票（${n}）` : '送待開支票'; } const k = cancelRows().length; const cb = $('#apCancel', el); if (cb) { cb.hidden = !k; cb.textContent = `取消支票（${k}）`; } const all = $('#apSelAll', el); if (all) { const can = list.filter(canSel); all.checked = can.length > 0 && can.every(r => ui.sel.has(rowId(r))); } };
  el.querySelectorAll('[data-sel]').forEach(cb => cb.addEventListener('change', () => { const id = rowId(list[+cb.dataset.sel]); cb.checked ? ui.sel.add(id) : ui.sel.delete(id); updSel(); }));
  $('#apSelAll', el)?.addEventListener('change', ev => { for (const r of list) if (canSel(r)) ev.target.checked ? ui.sel.add(rowId(r)) : ui.sel.delete(rowId(r)); el.querySelectorAll('[data-sel]').forEach(cb => { cb.checked = ev.target.checked && !cb.disabled; }); updSel(); });
  el.querySelectorAll('[data-due]').forEach(inp => inp.addEventListener('change', async () => { const r = list[+inp.dataset.due]; if (!inp.value) return; await saveRow(r, { dueDate: inp.value, amt: r.amt, tax: r.tax, manual: !!r.manual }); toast(`${r.name} 兌現日 ${roc(inp.value)}`); }));
  $('#apSend', el)?.addEventListener('click', () => sendChecks(selRows()));
  $('#apCancel', el)?.addEventListener('click', () => cancelChecks(cancelRows()));
  updSel();
  el.querySelectorAll('[data-bills]').forEach(b => b.addEventListener('click', () => { const r = list[+b.dataset.bills]; modal({ title: `${r.name} ${ymLabel(r.ym)} 進貨單`, width: 640, body: `<div class="tw"><table><thead><tr><th>日期</th><th>單號</th><th class="n">未稅</th></tr></thead><tbody>${r.auto.bills.map(x => `<tr class="row" data-id="${x.id}"><td>${esc(slash(x.date))}</td><td class="mono">${esc(x.no)}${x.type === 'PUR_RET' ? ' <span class="pill bad">退出</span>' : ''}</td><td class="n">${money(calc().tot[x.id].net)}</td></tr>`).join('')}</tbody></table></div>`, onOpen(m, close) { m.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => { close(); openBill(null, tr.dataset.id); })); } }); }));
}
function allOpen() {
  const months = new Set([...store.list('payables').map(r => r.ym), ...calc().bills.filter(b => b.type === 'PUR' && b.cid).map(b => apYm(b.date))].filter(Boolean));
  return [...months].sort().flatMap(ym => apRows(ym).filter(r => r.pay == null && r.total > 0));
}
function table(list, showYm) {
  if (!list.length) return `<div class="empty"><b>${showYm ? '沒有待開票的應付帳款 ✓' : '這個月沒有應付帳款'}</b></div>`;
  return `<div class="tw"><table><thead><tr><th style="width:32px"><input type="checkbox" id="apSelAll" aria-label="全選"></th>${showYm ? '<th>月份</th>' : ''}<th>廠商</th><th class="n">應付</th><th class="n">稅額</th><th class="n">總額</th><th class="n" style="width:130px">開票金額</th><th style="width:150px">兌現日</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => `<tr data-i="${i}" class="${r.pay != null ? 'muted' : ''}"><td><input type="checkbox" data-sel="${i}" ${!canSel(r) ? `disabled title="${ckState(r) === 'printed' ? '支票已列印；要取消請先到「支票開立」退回待列印' : '支票已不在待列印'}"` : ui.sel.has(rowId(r)) ? 'checked' : ''} aria-label="勾選 ${esc(r.name)}"></td>${showYm ? `<td class="nowrap">${esc(ymLabel(r.ym))}</td>` : ''}<td><b>${esc(r.name)}</b>${r.manual ? ' <span class="pill zinc">手調</span>' : ''}${r.checkId ? ' <span class="pill ok">已開支票</span>' : ''}${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}${r.auto ? `<span class="sub">${r.auto.bills.length} 張進貨單</span>` : ''}</td><td class="n">${money(r.amt)}</td><td class="n">${money(r.tax)}</td><td class="n"><b>${money(r.total)}</b></td><td class="n"><input data-pay="${i}" class="num" value="${r.pay != null ? money(r.pay) : ''}" placeholder="待開票" style="width:120px;text-align:right;border:1px solid var(--line);border-radius:6px;padding:4px 8px"></td><td><input type="date" data-due="${i}" value="${esc(dueOf(r))}" style="border:1px solid var(--line);border-radius:6px;padding:4px 6px" aria-label="${esc(r.name)} 兌現日"></td><td class="nowrap"><button class="btn xs" data-edit="${i}">修改</button>${r.auto ? ` <button class="btn xs ghost" data-bills="${i}">單據</button>` : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td>${showYm ? '<td></td>' : ''}<td>合計 ${list.length} 家</td><td class="n">${money(list.reduce((s, r) => s + r.amt, 0))}</td><td class="n">${money(list.reduce((s, r) => s + r.tax, 0))}</td><td class="n">${money(list.reduce((s, r) => s + r.total, 0))}</td><td class="n">${money(list.reduce((s, r) => s + (+r.pay || 0), 0))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
}
function editRow(r) {
  const isNew = !r.cid && !r.id;
  modal({
    title: isNew ? '新增應付帳款' : `${r.name} ${ymLabel(r.ym)}`, width: 560,
    body: `<div class="grid">
      ${isNew ? `<div class="f" style="grid-column:1/-1"><label for="ap-c">廠商</label><div class="combo"><input id="ap-c" placeholder="搜尋供應商"></div></div><div class="f"><label for="ap-ym">月份</label><input type="month" id="ap-ym" value="${r.ym}"></div>` : ''}
      <div class="f"><label for="ap-amt">應付（未稅）</label><input id="ap-amt" class="num" value="${r.amt != null ? money(r.amt) : ''}"></div>
      <div class="f"><label for="ap-tax">稅額</label><input id="ap-tax" class="num" value="${r.tax ? money(r.tax) : ''}"></div>
      <div class="f"><label for="ap-pay">開票金額</label><input id="ap-pay" class="num" value="${r.pay != null ? money(r.pay) : ''}" placeholder="空白＝待開票"></div>
      <div class="f"><label for="ap-due">兌現日</label><input type="date" id="ap-due" value="${esc(r.ym ? dueOf(r) : '')}"></div>
      <div class="f" style="grid-column:1/-1"><label for="ap-note">備註</label><input id="ap-note" value="${esc(r.note || '')}"></div></div>
      ${r.auto ? `<p class="muted small">自動金額：應付 ${money(r.auto.amt)}、稅額 ${money(r.auto.tax)}（${r.auto.bills.length} 張進貨單）。</p>` : ''}`,
    footer: `${r.id && !isNew ? `<button class="btn danger" id="ap-del">刪除</button>` : ''}${r.manual && r.auto ? '<button class="btn" id="ap-auto">恢復自動</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ap-ok">儲存</button>`,
    onOpen(el, close) {
      let cid = r.cid;
      if (isNew) combo($('#ap-c', el), { items: () => suppliers().map(c => ({ id: c.id, label: c.short || c.name, sub: [c.code, c.short ? c.name : ''].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { cid = it.id; } });
      $('#ap-ok', el).onclick = async () => {
        if (!cid) return toast('請選廠商');
        const amt = parseNum($('#ap-amt', el).value) || 0, tax = parseNum($('#ap-tax', el).value) || 0, pay = parseNum($('#ap-pay', el).value);
        if (isNaN(amt) || isNaN(tax) || (pay != null && isNaN(pay))) return toast('金額不正確');
        const ym = isNew ? $('#ap-ym', el).value : r.ym;
        const manual = isNew || !r.auto || Math.round(amt) !== Math.round(r.auto.amt) || Math.round(tax) !== Math.round(r.auto.tax) || !!r.manual;
        const base = (r.id ? store.get('payables', r.id) : null) || {};
        await store.save('payables', isNew ? uid('ap') : rowId({ ...r, cid }), { ...base, ym, cid, vendor: cshort(cid), amt, tax, manual, pay, payDate: pay != null ? (base.payDate || today()) : '', dueDate: $('#ap-due', el).value || base.dueDate || '', note: $('#ap-note', el).value.trim() }); close(); toast('已儲存');
      };
      $('#ap-auto', el)?.addEventListener('click', async () => { const d = store.get('payables', rowId(r)); if (d) { delete d.manual; delete d.amt; delete d.tax; await store.save('payables', d.id, d); } close(); });
      $('#ap-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這筆應付帳款？', { danger: true, ok: '刪除' })) { await store.remove('payables', r.id); close(); } });
    },
  });
}

function sendBar() {
  return `<div class="tools" style="margin:4px 0 8px"><button class="btn pri" id="apSend" disabled title="勾選的廠商各開一張支票，送到「支票開立」的待列印">送待開支票</button><button class="btn danger" id="apCancel" hidden title="刪掉還沒列印的支票，這家改回待開票">取消支票</button><span class="muted small">金額用「開票金額」，空白就用總額；兌現日＝支票上的日期。勾選已開票（支票還沒列印）的廠商可以「取消支票」，改好再重送。</span></div>`;
}
/** 取消支票：刪掉還沒列印的支票，應付帳款改回待開票（兌現日保留；開票金額要改就在欄位重填，再重送） */
async function cancelChecks(rows) {
  if (!rows.length) return;
  const items = rows.map(r => ({ r, c: store.get('checks_out', r.checkId) })).filter(x => x.c && !x.c.printedAt);
  if (!items.length) return toast('勾選的支票都已經列印，不能從這裡取消');
  if (!await confirm(`取消 ${items.length} 張還沒列印的支票？這幾家會改回「待開票」。\n${items.map(x => `${x.r.name}　${money(x.c.amount)}　兌現 ${roc(x.c.date)}`).join('\n')}`, { danger: true, ok: '取消支票' })) return;
  const ops = [];
  for (const { r, c } of items) {
    ops.push({ col: 'checks_out', id: c.id, delete: true });
    const d = { ...store.get('payables', rowId(r)) }; delete d.id; delete d.checkId; delete d.payDate; delete d.pay; d.dueDate = c.date;
    ops.push({ col: 'payables', id: rowId(r), data: d });
  }
  await store.batch(ops); for (const { r } of items) ui.sel.delete(rowId(r));
  store.log('刪除', `取消支票 ${items.length} 張（應付帳款改回待開票）：${items.map(x => `${x.r.name} ${money(x.c.amount)}`).join('、')}`); toast(`已取消 ${items.length} 張支票`);
}
/** 勾選的應付帳款各開一張支票（待列印），並把應付帳款標成已開票 */
async function sendChecks(rows) {
  if (!rows.length) return toast('請先勾選要開支票的廠商');
  const items = rows.map(r => ({ r, amt: r.pay != null ? +r.pay : Math.round(r.total), due: dueOf(r) }));
  const bad = items.filter(x => !(x.amt > 0)); if (bad.length) return toast(`${bad.map(x => x.r.name).join('、')} 金額是 0，不能開支票`);
  const sum = items.reduce((a, x) => a + x.amt, 0);
  if (!await confirm(`送 ${items.length} 張支票到「支票開立」的待列印？\n${items.map(x => `${x.r.name}　${money(x.amt)}　兌現 ${roc(x.due)}`).join('\n')}\n合計 ${money(sum)}`, { ok: '送待開支票' })) return;
  const ops = [];
  for (const { r, amt, due } of items) {
    const c = store.get('contacts', r.cid); const ckId = uid('co');
    ops.push({ col: 'checks_out', id: ckId, data: { payee: c?.name || r.name, cid: r.cid, amount: amt, date: due, no: '', note: `${r.name} ${ymLabel(r.ym)} 應付帳款`, apId: rowId(r), createdAt: Date.now() } });
    const base = r.id ? store.get('payables', r.id) : { ym: r.ym, cid: r.cid, vendor: r.name, ord: r.ord };
    const data = { ...base, pay: amt, payDate: today(), dueDate: due, checkId: ckId, amt: r.amt, tax: r.tax, manual: !!r.manual }; delete data.id;
    ops.push({ col: 'payables', id: rowId(r), data });
  }
  await store.batch(ops);
  for (const { r } of items) ui.sel.delete(rowId(r));
  store.log('開立', `支票 ${items.length} 張送待列印（應付帳款）：${items.map(x => `${x.r.name} ${money(x.amt)}`).join('、')}`);
  toast(`已送 ${items.length} 張到支票開立的待列印，合計 ${money(sum)}`);
}
