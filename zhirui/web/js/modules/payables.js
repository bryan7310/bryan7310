// 應付帳款：每月各廠商金額由進貨單自動彙總，可手動調整；填開票金額 → 直接開支票
import { $, esc, fmt, money, today, thisMonth, ymLabel, shiftMonth, roc, slash, parseNum, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo } from '../core/ui.js';
import { calc, suppliers, cshort } from '../core/calc.js';
import { openBill } from './_bills.js';
import { newCheckOut } from './checks_out.js';

const ui = { ym: thisMonth(), tab: 'month', filter: 'all' };
export default {
  id: 'payables', name: '應付帳款', group: '財務', icon: 'payables',
  render(el, { sub }) { this.el = el; if (sub === 'open') ui.tab = 'open'; draw(el); },
  onChange(ch) { if (this.el?.isConnected && ['bills', 'payables', 'contacts', 'checks_out'].some(c => ch.has(c))) draw(this.el); },
  badge() { const s = apSummary(); return { cnt: s.openN }; },
};
export function apRows(ym) {
  const C = calc(); const auto = new Map();
  for (const b of C.bills) {
    if ((b.type !== 'PUR' && b.type !== 'PUR_RET') || !(b.date || '').startsWith(ym) || !b.cid) continue;
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
  return out.sort((x, y) => (x.ord || 999) - (y.ord || 999) || String(x.name).localeCompare(String(y.name), 'zh-Hant'));
}
export function apSummary() {
  const months = new Set([...store.list('payables').map(r => r.ym), ...calc().bills.filter(b => b.type === 'PUR' && b.cid).map(b => (b.date || '').slice(0, 7))].filter(Boolean));
  let open = 0, openN = 0;
  for (const ym of months) for (const r of apRows(ym)) { if (r.pay == null && r.total > 0) { open += r.total; openN++; } }
  return { open, openN };
}
const rowId = r => r.id || ('ap' + r.ym + '_' + r.cid);
async function saveRow(r, patch) { const base = r.id ? store.get('payables', r.id) : { ym: r.ym, cid: r.cid, vendor: r.name, ord: r.ord }; await store.save('payables', rowId(r), { ...base, ...patch }); }

function draw(el) {
  const ym = ui.ym; const rows = apRows(ym);
  const list = ui.tab === 'open' ? allOpen() : rows.filter(r => ui.filter === 'all' || (ui.filter === 'open' ? r.pay == null : r.pay != null));
  const tot = f => rows.reduce((s, r) => s + f(r), 0); const paid = rows.filter(r => r.pay != null);
  el.innerHTML = `<div class="head"><h1>應付帳款</h1><span class="sp"></span>${tabs('ap', [['month', '本月'], ['open', '待開票']], ui.tab)}<button class="btn pri" id="apAdd">＋ 手動新增</button></div>
    ${ui.tab === 'month' ? `<div class="panel" style="display:grid;gap:12px">
      <div class="tools"><button class="btn sm" id="prevM">‹</button><input type="month" id="ym" value="${ym}" style="font-weight:600"><button class="btn sm" id="nextM">›</button><span class="muted">${ymLabel(ym)}</span><span class="sp"></span>${tabs('f', [['all', '全部'], ['open', '待開票'], ['done', '已開票']], ui.filter)}</div>
      <div class="kpis"><div class="kpi"><span>應付（未稅）</span><b>${money(tot(r => r.amt))}</b></div><div class="kpi"><span>稅額</span><b>${money(tot(r => r.tax))}</b></div><div class="kpi"><span>總額</span><b>${money(tot(r => r.total))}</b></div><div class="kpi ok"><span>已開票 ${paid.length} 家</span><b>${money(paid.reduce((s, r) => s + (+r.pay || 0), 0))}</b></div><div class="kpi ${rows.length - paid.length ? 'alert' : ''}"><span>待開票 ${rows.length - paid.length} 家</span><b>${money(rows.filter(r => r.pay == null).reduce((s, r) => s + r.total, 0))}</b></div></div>
      <p class="muted small" style="margin:0">金額由該月進貨單自動加總（進貨退出扣除，稅額以 5% 計）。在「開票金額」欄輸入金額並按 Enter 即完成；按「開支票」會直接帶到支票開立。</p>
      ${table(list, false)}</div>` : `<div class="panel">${table(list, true)}</div>`}`;
  el.addEventListener('tab', ev => { if (ev.detail.key === 'ap') ui.tab = ev.detail.val; else ui.filter = ev.detail.val; draw(el); }, { once: true });
  $('#ym', el)?.addEventListener('change', ev => { ui.ym = ev.target.value; draw(el); });
  $('#prevM', el)?.addEventListener('click', () => { ui.ym = shiftMonth(ui.ym, -1); draw(el); });
  $('#nextM', el)?.addEventListener('click', () => { ui.ym = shiftMonth(ui.ym, 1); draw(el); });
  $('#apAdd', el).addEventListener('click', () => editRow({ ym, manual: true }));
  el.querySelectorAll('[data-pay]').forEach(inp => inp.addEventListener('change', async () => { const r = list[+inp.dataset.pay]; const v = parseNum(inp.value); if (v != null && isNaN(v)) return toast('金額不正確'); await saveRow(r, { pay: v, payDate: v != null ? (r.payDate || today()) : undefined, amt: r.amt, tax: r.tax, manual: !!r.manual }); toast(v != null ? `${r.name} 開票 ${money(v)}` : `${r.name} 改回待開票`); }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editRow(list[+b.dataset.edit])));
  el.querySelectorAll('[data-chk]').forEach(b => b.addEventListener('click', async () => { const r = list[+b.dataset.chk]; const amt = r.pay != null ? +r.pay : Math.round(r.total); const c = store.get('contacts', r.cid); newCheckOut({ payee: c?.name || r.name, cid: r.cid, amount: amt, note: `${ymLabel(r.ym)} 貨款`, apId: rowId(r) }, async ck => { if (ck) { await saveRow(r, { pay: amt, payDate: today(), checkId: ck.id, amt: r.amt, tax: r.tax, manual: !!r.manual }); } }); }));
  el.querySelectorAll('[data-bills]').forEach(b => b.addEventListener('click', () => { const r = list[+b.dataset.bills]; modal({ title: `${r.name} ${ymLabel(r.ym)} 進貨單`, width: 640, body: `<div class="tw"><table><thead><tr><th>日期</th><th>單號</th><th class="n">未稅</th></tr></thead><tbody>${r.auto.bills.map(x => `<tr class="row" data-id="${x.id}"><td>${esc(slash(x.date))}</td><td class="mono">${esc(x.no)}${x.type === 'PUR_RET' ? ' <span class="pill bad">退出</span>' : ''}</td><td class="n">${money(calc().tot[x.id].net)}</td></tr>`).join('')}</tbody></table></div>`, onOpen(m, close) { m.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => { close(); openBill(null, tr.dataset.id); })); } }); }));
}
function allOpen() {
  const months = new Set([...store.list('payables').map(r => r.ym), ...calc().bills.filter(b => b.type === 'PUR' && b.cid).map(b => (b.date || '').slice(0, 7))].filter(Boolean));
  return [...months].sort().flatMap(ym => apRows(ym).filter(r => r.pay == null && r.total > 0));
}
function table(list, showYm) {
  if (!list.length) return `<div class="empty"><b>${showYm ? '沒有待開票的應付帳款 ✓' : '這個月沒有應付帳款'}</b></div>`;
  return `<div class="tw"><table><thead><tr>${showYm ? '<th>月份</th>' : ''}<th>廠商</th><th class="n">應付</th><th class="n">稅額</th><th class="n">總額</th><th class="n" style="width:130px">開票金額</th><th>開票日</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => `<tr data-i="${i}" class="${r.pay != null ? 'muted' : ''}">${showYm ? `<td class="nowrap">${esc(ymLabel(r.ym))}</td>` : ''}<td><b>${esc(r.name)}</b>${r.manual ? ' <span class="pill zinc">手調</span>' : ''}${r.checkId ? ' <span class="pill ok">已開支票</span>' : ''}${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}${r.auto ? `<span class="sub">${r.auto.bills.length} 張進貨單</span>` : ''}</td><td class="n">${money(r.amt)}</td><td class="n">${money(r.tax)}</td><td class="n"><b>${money(r.total)}</b></td><td class="n"><input data-pay="${i}" class="num" value="${r.pay != null ? money(r.pay) : ''}" placeholder="待開票" style="width:120px;text-align:right;border:1px solid var(--line);border-radius:6px;padding:4px 8px"></td><td class="nowrap">${r.payDate ? esc(roc(r.payDate)) : ''}</td><td class="nowrap"><button class="btn xs" data-edit="${i}">修改</button> ${!r.checkId ? `<button class="btn xs" data-chk="${i}">開支票</button>` : ''}${r.auto ? ` <button class="btn xs ghost" data-bills="${i}">單據</button>` : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr>${showYm ? '<td></td>' : ''}<td>合計 ${list.length} 家</td><td class="n">${money(list.reduce((s, r) => s + r.amt, 0))}</td><td class="n">${money(list.reduce((s, r) => s + r.tax, 0))}</td><td class="n">${money(list.reduce((s, r) => s + r.total, 0))}</td><td class="n">${money(list.reduce((s, r) => s + (+r.pay || 0), 0))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
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
      <div class="f"><label for="ap-payDate">開票日</label><input type="date" id="ap-payDate" value="${esc(r.payDate || '')}"></div>
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
        await store.save('payables', isNew ? uid('ap') : rowId({ ...r, cid }), { ...base, ym, cid, vendor: cshort(cid), amt, tax, manual, pay, payDate: pay != null ? ($('#ap-payDate', el).value || today()) : '', note: $('#ap-note', el).value.trim() }); close(); toast('已儲存');
      };
      $('#ap-auto', el)?.addEventListener('click', async () => { const d = store.get('payables', rowId(r)); if (d) { delete d.manual; delete d.amt; delete d.tax; await store.save('payables', d.id, d); } close(); });
      $('#ap-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這筆應付帳款？', { danger: true, ok: '刪除' })) { await store.remove('payables', r.id); close(); } });
    },
  });
}
