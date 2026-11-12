// 應收帳款：每月各客戶金額由銷貨單自動彙總，可手動調整；勾選已收款、未收追蹤、門市收入
import { $, esc, fmt, money, today, thisMonth, ymLabel, shiftMonth, roc, slash, parseNum, uid, daysLeft, rnd0 } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo } from '../core/ui.js';
import { calc, customers, cshort, TYPES, totals } from '../core/calc.js';
import { openBill, histView } from './_bills.js';
import { api } from '../core/api.js';
import { mailImport } from './mail.js';
import { apYm, apRange } from './payables.js';

const ui = { ym: thisMonth(), tab: 'month', filter: 'all', year: thisMonth().slice(0, 4), yc: '' };
const picked = new Set();
export default {
  id: 'receivables', name: '應收帳款', group: '財務', icon: 'receivables',
  render(el, { sub }) { this.el = el; if (sub === 'open' || sub === 'year') ui.tab = sub; ensureHistAR(); draw(el); },
  onChange(ch) { if (this.el?.isConnected && ['bills', 'receivables', 'contacts', 'settings', 'checks_in'].some(c => ch.has(c))) draw(this.el); },
  badge() { ensureHistAR(); const s = arSummary(); return { cnt: s.late, alert: s.late > 0 }; },
};

// 舊系統銷貨單：只算「舊系統應收資料」最後一個月之後的（之前的已經在匯入的應收資料裡，不重複計算）
let HIST_AR = [], histKey = '', histBusy = false;
const oldArEnd = () => store.list('receivables').reduce((m, r) => r.src === 'platform' && r.ym > m ? r.ym : m, '');
function ensureHistAR(force) {
  const end = oldArEnd(); const key = end + '|' + (store.histVer || '');
  if (!end || histBusy || (!force && key === histKey)) return;
  histBusy = true; histKey = key;   // 失敗也不立刻重試，避免一直重抓
  (async () => {
    const from = end + '-26'; const out = [];
    for (const type of ['SALE', 'SALE_RET']) {
      let offset = 0;
      for (;;) { const r = await api.get(`/api/hist?type=${type}&from=${from}&limit=1000&offset=${offset}`); out.push(...r.rows); offset += r.rows.length; if (!r.rows.length || offset >= r.total) break; }
    }
    for (const b of out) b.hist = true;
    HIST_AR = out;
  })().catch(e => console.warn('舊系統銷貨單載入失敗', e)).finally(() => { histBusy = false; store.emit(new Set(['receivables'])); });
}
const bt = b => b.hist ? totals(b) : calc().tot[b.id];
const saleMonths = () => [...calc().bills, ...HIST_AR].filter(b => b.type === 'SALE' && b.cid).map(b => apYm(b.date));

// 自動加稅：銷貨單沒勾含稅時，依客戶在舊系統應收資料「最後一個月」有沒有收稅決定是否加 5%（月合計 × 5%，四捨五入）；
// 舊資料裡沒有的新客戶：預設加稅（舊資料大多數客戶都有收稅）；門市銷售（C999）不加
function taxPlan() {
  const last = new Map();
  for (const r of store.list('receivables')) if (r.src === 'platform' && r.cid && (!last.has(r.cid) || r.ym > last.get(r.cid).ym)) last.set(r.cid, { ym: r.ym, tax: +r.tax > 0 });
  const shop = cid => { const c = store.get('contacts', cid); return !!c && (c.code === 'C999' || c.name === '門市銷售'); };
  return cid => { if (shop(cid)) return false; const h = last.get(cid); return h ? h.tax : true; };
}

/** 某月的應收列：銷貨單（含舊系統銷貨單）自動彙總 + 手動覆寫／舊資料 */
export function arRows(ym) {
  const C = calc();
  const auto = new Map();
  for (const b of [...C.bills, ...HIST_AR]) {
    if ((b.type !== 'SALE' && b.type !== 'SALE_RET') || apYm(b.date) !== ym || !b.cid) continue;
    const s = b.type === 'SALE' ? 1 : -1; const t = bt(b);
    const a = auto.get(b.cid) || auto.set(b.cid, { amt: 0, tax: 0, free: 0, bills: [] }).get(b.cid);
    a.amt += s * t.net; a.tax += s * t.tax; if (!t.tax && !b.retail) a.free += s * t.net; a.bills.push(b);
  }
  const taxable = taxPlan();
  for (const [cid, a] of auto) if (Math.round(a.free) && taxable(cid)) { a.autoTax = rnd0(a.free * 0.05); a.tax += a.autoTax; }
  const docs = store.list('receivables').filter(r => r.ym === ym);
  const out = []; const used = new Set();
  for (const r of docs) {
    const a = r.cid ? auto.get(r.cid) : null; if (r.cid) used.add(r.cid);
    const amt = r.amt != null && (r.manual || !a) ? +r.amt : (a ? a.amt : +r.amt || 0);
    const tax = r.tax != null && (r.manual || !a) ? +r.tax : (a ? a.tax : +r.tax || 0);
    out.push({ ...r, amt, tax, auto: a, total: r.tot != null ? +r.tot : amt + tax, name: r.cid ? cshort(r.cid) : r.cust });
  }
  for (const [cid, a] of auto) if (!used.has(cid)) { if (Math.abs(a.amt) < 0.5) continue; const c = C.ct[cid]; out.push({ id: null, ym, cid, cust: cshort(cid), name: cshort(cid), amt: a.amt, tax: a.tax, total: a.amt + a.tax, auto: a, method: c?.payMethod || '' }); }
  // 依總額由大到小；同額再依客戶名稱
  return out.sort((x, y) => (+y.total || 0) - (+x.total || 0) || String(x.name).localeCompare(String(y.name), 'zh-Hant'));
}
export function arSummary() {
  ensureHistAR();   // 手機版沒有選單徽章會先載，這裡也確保載入舊系統銷貨單（已載過不會重抓）
  const t = today(); const months = new Set([...store.list('receivables').map(r => r.ym), ...saleMonths()].filter(Boolean));
  let open = 0, openN = 0, late = 0; const lateC = new Set();
  for (const ym of months) for (const r of arRows(ym)) { if (r.rec || !(r.total > 0)) continue; open += r.total; openN++; if (isLate(r)) { late++; lateC.add(r.cid || r.name); } }
  return { open, openN, late, lateCust: lateC.size };
}
const isLate = r => !r.rec && r.total > 0 && ((r.due && r.due < today()) || (!r.due && shiftMonth(r.ym, 2) + '-15' < today()));
const rowId = r => r.id || ('ar' + r.ym + '_' + r.cid);
async function saveRow(r, patch) {
  const base = r.id ? store.get('receivables', r.id) : { ym: r.ym, cid: r.cid, cust: r.name, ord: r.ord };
  await store.save('receivables', rowId(r), { ...base, ...patch });
}

function draw(el) {
  const ym = ui.ym; const rows = arRows(ym); const st = (store.setting('ar_store').months || {})[ym] || {};
  const tot = f => rows.reduce((s, r) => s + f(r), 0);
  const done = rows.filter(r => r.rec), open = rows.filter(r => !r.rec);
  const list = ui.tab === 'open' ? allOpen() : rows.filter(r => ui.filter === 'all' || (ui.filter === 'open' ? !r.rec : r.rec));
  el.innerHTML = `<div class="head"><h1>應收帳款</h1><span class="sp"></span>${tabs('ar', [['month', '本月'], ['open', '未收款'], ['year', '年度彙總']], ui.tab)}${ui.tab === 'year' ? '' : `<button class="btn" id="arMail" ${picked.size ? '' : 'disabled'}>導入郵寄掛號${picked.size ? `（${picked.size}）` : ''}</button><button class="btn pri" id="arAdd">＋ 手動新增</button>`}</div>
    ${ui.tab === 'month' ? `<div class="panel" style="display:grid;gap:12px">
      <div class="tools"><button class="btn sm" id="prevM">‹</button><input type="month" id="ym" value="${ym}" style="font-weight:600"><button class="btn sm" id="nextM">›</button><span class="muted">${ymLabel(ym)}（${roc(apRange(ym)[0])}～${roc(apRange(ym)[1])}）</span><span class="sp"></span>${tabs('f', [['all', '全部'], ['open', '未收'], ['done', '已收']], ui.filter)}</div>
      <div class="kpis"><div class="kpi"><span>貨款</span><b>${money(tot(r => r.amt))}</b></div><div class="kpi"><span>稅額</span><b>${money(tot(r => r.tax))}</b></div><div class="kpi"><span>總額</span><b>${money(tot(r => r.total))}</b></div><div class="kpi"><span>門市收入</span><b>${money(st.amt || 0)}</b><small>${esc(st.note || '')}</small></div><div class="kpi ok"><span>已收 ${done.length} 筆</span><b>${money(done.reduce((s, r) => s + (r.recAmt ?? r.total), 0))}</b></div><div class="kpi ${open.length ? 'alert' : ''}"><span>未收 ${open.length} 筆</span><b>${money(open.reduce((s, r) => s + r.total, 0))}</b></div></div>
      <div class="tools"><div class="f" style="width:160px"><label for="stAmt">門市收入</label><input id="stAmt" class="num" value="${st.amt ? money(st.amt) : ''}"></div><div class="f" style="flex:1"><label for="stNote">門市收入備註</label><input id="stNote" value="${esc(st.note || '')}"></div></div>
      <p class="muted small" style="margin:0">金額由該月銷貨單（含舊系統銷貨單）自動加總（25 結：上月 26 日～本月 25 日；銷貨退回扣除；依客戶舊資料自動加 5% 稅）。點金額可手動修改；有 <span class="pill zinc">手調</span> 標記的是手動輸入，可按「恢復自動」。</p>
      ${table(list, ym)}</div>`
    : ui.tab === 'year' ? yearView() : `<div class="panel">${table(list, null, true)}</div>`}`;
  el.addEventListener('tab', ev => { if (ev.detail.key === 'ar') ui.tab = ev.detail.val; else ui.filter = ev.detail.val; draw(el); }, { once: true });
  $('#ym', el)?.addEventListener('change', ev => { ui.ym = ev.target.value; draw(el); });
  $('#prevM', el)?.addEventListener('click', () => { ui.ym = shiftMonth(ui.ym, -1); draw(el); });
  $('#nextM', el)?.addEventListener('click', () => { ui.ym = shiftMonth(ui.ym, 1); draw(el); });
  const saveStore = async () => { const a = parseNum($('#stAmt', el).value), n = $('#stNote', el).value.trim(); if (a != null && isNaN(a)) return toast('金額不正確'); const s = store.setting('ar_store'); const months = { ...(s.months || {}) }; if (a == null && !n) delete months[ym]; else months[ym] = { amt: a || 0, note: n }; await store.saveSetting('ar_store', { months }); };
  $('#stAmt', el)?.addEventListener('change', saveStore); $('#stNote', el)?.addEventListener('change', saveStore);
  $('#arAdd', el)?.addEventListener('click', () => editRow({ ym, manual: true }));
  if (ui.tab === 'year') bindYear(el); else bindRows(el, list);
  el.querySelectorAll('[data-pk]').forEach(cb => cb.addEventListener('change', () => { cb.checked ? picked.add(cb.dataset.pk) : picked.delete(cb.dataset.pk); draw(el); }));
  $('#arPkAll', el)?.addEventListener('change', ev => { list.forEach(r => { if (r.cid) ev.target.checked ? picked.add(r.cid) : picked.delete(r.cid); }); draw(el); });
  $('#arMail', el)?.addEventListener('click', async () => { const r = await mailImport([...picked]); picked.clear(); toast(`已導入 ${r.add} 家到郵寄掛號${r.miss.length ? `；找不到地址：${r.miss.join('、')}` : ''}`); location.hash = '#mail'; });
}
function allOpen() {
  const months = new Set([...store.list('receivables').map(r => r.ym), ...saleMonths()].filter(Boolean));
  return [...months].sort().flatMap(ym => arRows(ym).filter(r => !r.rec && r.total > 0));
}
function table(list, ym, showYm) {
  if (!list.length) return `<div class="empty"><b>${showYm ? '全部都收齊了 ✓' : '這個月沒有應收帳款'}</b>${showYm ? '' : '開銷貨單後會自動出現，或按「手動新增」'}</div>`;
  return `<div class="tw"><table><thead><tr><th><input type="checkbox" id="arPkAll" title="全選（導入郵寄掛號）"></th><th>已收</th>${showYm ? '<th>月份</th>' : ''}<th>客戶</th><th class="n">貨款</th><th class="n">稅額</th><th class="n">總額</th><th>付款方式</th><th>到期</th><th class="n">實收</th><th>收款日</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => `<tr class="${r.rec ? 'muted' : ''}" data-i="${i}"><td><input type="checkbox" data-pk="${r.cid || ''}" ${r.cid && picked.has(r.cid) ? 'checked' : ''} ${r.cid ? '' : 'disabled'} title="導入郵寄掛號"></td><td><input type="checkbox" data-rec="${i}" ${r.rec ? 'checked' : ''} aria-label="已收款"></td>${showYm ? `<td class="nowrap">${esc(ymLabel(r.ym))}</td>` : ''}<td><b>${esc(r.name)}</b>${r.manual ? ' <span class="pill zinc">手調</span>' : r.src === 'platform' && !r.auto ? ' <span class="pill">舊資料</span>' : ''}${isLate(r) ? ' <span class="pill bad">逾期</span>' : ''}${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}${r.auto ? `<span class="sub">${r.auto.bills.length} 張銷貨單${r.auto.autoTax && !r.manual ? '・自動加稅 5%' : ''}</span>` : ''}</td><td class="n"><a href="#" data-edit="${i}">${money(r.amt)}</a></td><td class="n">${r.tax ? money(r.tax) : '—'}</td><td class="n"><b>${money(r.total)}</b></td><td>${esc(r.method || '')}</td><td class="nowrap">${r.due ? esc(roc(r.due)) : ''}</td><td class="n">${r.rec ? money(r.recAmt ?? r.total) : ''}</td><td class="nowrap">${r.rec && r.recDate ? esc(roc(r.recDate)) : ''}</td><td class="nowrap"><button class="btn xs" data-edit="${i}">修改</button>${r.auto ? ` <button class="btn xs ghost" data-bills="${i}">單據</button>` : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td></td>${showYm ? '<td></td>' : ''}<td>合計 ${list.length} 筆</td><td class="n">${money(list.reduce((s, r) => s + r.amt, 0))}</td><td class="n">${money(list.reduce((s, r) => s + r.tax, 0))}</td><td class="n">${money(list.reduce((s, r) => s + r.total, 0))}</td><td colspan="2"></td><td class="n">${money(list.filter(r => r.rec).reduce((s, r) => s + (r.recAmt ?? r.total), 0))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
}
function bindRows(el, list) {
  el.querySelectorAll('[data-rec]').forEach(cb => cb.addEventListener('change', async () => {
    const r = list[+cb.dataset.rec];
    if (cb.checked) await saveRow(r, { rec: true, recAmt: Math.round(r.total), recDate: today(), amt: r.amt, tax: r.tax, manual: !!r.manual });
    else { const d = store.get('receivables', rowId(r)); if (d) { delete d.rec; delete d.recAmt; delete d.recDate; await store.save('receivables', d.id, d); } }
    toast(cb.checked ? `${r.name} 已收款 ${money(r.total)}` : `${r.name} 改回未收`);
  }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); editRow(list[+b.dataset.edit]); }));
  el.querySelectorAll('[data-bills]').forEach(b => b.addEventListener('click', () => { const r = list[+b.dataset.bills]; modal({ title: `${r.name} ${ymLabel(r.ym)} 銷貨單`, width: 640, body: `<div class="tw"><table><thead><tr><th>日期</th><th>單號</th><th class="n">未稅</th><th class="n">稅</th><th>發票</th></tr></thead><tbody>${r.auto.bills.map((x, k) => `<tr class="row" data-k="${k}"><td>${esc(slash(x.date))}</td><td class="mono">${esc(x.no)}${x.type === 'SALE_RET' ? ' <span class="pill bad">退回</span>' : ''}${x.hist ? ' <span class="pill">舊系統</span>' : ''}</td><td class="n">${money(bt(x).net)}</td><td class="n">${money(bt(x).tax)}</td><td>${esc(x.invNo || '')}</td></tr>`).join('')}</tbody></table></div>`, onOpen(m, close) { m.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => { const x = r.auto.bills[+tr.dataset.k]; close(); if (x.hist) histView(x, () => ensureHistAR(true)); else openBill(null, x.id); })); } }); }));
}
function editRow(r) {
  const isNew = r.isNew || (!r.cid && !r.id);
  modal({
    title: isNew ? (r.cid ? `新增應收帳款｜${cshort(r.cid)}` : '新增應收帳款') : `${r.name} ${ymLabel(r.ym)}`, width: 560,
    body: `<div class="grid">
      ${isNew ? `<div class="f" style="grid-column:1/-1"><label for="ar-c">客戶</label><div class="combo"><input id="ar-c" placeholder="搜尋客戶" value="${r.cid ? esc(cshort(r.cid)) : ''}"></div></div><div class="f"><label for="ar-ym">月份</label><input type="month" id="ar-ym" value="${r.ym}"></div>` : ''}
      <div class="f"><label for="ar-amt">貨款</label><input id="ar-amt" class="num" value="${r.amt != null ? money(r.amt) : ''}"></div>
      <div class="f"><label for="ar-tax">稅額</label><input id="ar-tax" class="num" value="${r.tax ? money(r.tax) : ''}"></div>
      <div class="f"><label for="ar-method">付款方式</label><input id="ar-method" list="ar-methods" value="${esc(r.method || '')}"><datalist id="ar-methods"><option>匯款</option><option>支票</option><option>現金</option><option>扣趴</option></datalist></div>
      <div class="f"><label for="ar-due">到期日</label><input type="date" id="ar-due" value="${esc(r.due || '')}"></div>
      <div class="f" style="grid-column:1/-1"><label for="ar-note">備註</label><input id="ar-note" value="${esc(r.note || '')}"></div>
      <label class="check"><input type="checkbox" id="ar-rec" ${r.rec ? 'checked' : ''}> 已收款</label>
      <div class="f"><label for="ar-recAmt">實收金額</label><input id="ar-recAmt" class="num" value="${r.recAmt != null ? money(r.recAmt) : ''}" placeholder="同總額"></div>
      <div class="f"><label for="ar-recDate">收款日</label><input type="date" id="ar-recDate" value="${esc(r.recDate || '')}"></div></div>
      ${r.auto ? `<p class="muted small">自動金額：貨款 ${money(r.auto.amt)}、稅額 ${money(r.auto.tax)}（${r.auto.bills.length} 張銷貨單${r.auto.autoTax ? `；稅額含依舊資料自動加的 5%：${money(r.auto.autoTax)}，不收稅請把稅額改成 0` : ''}）。改了金額就變成手動；按「恢復自動」回到銷貨單加總。</p>` : ''}`,
    footer: `${r.id && !isNew ? `<button class="btn danger" id="ar-del">刪除</button>` : ''}${r.manual && r.auto ? '<button class="btn" id="ar-auto">恢復自動</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ar-ok">儲存</button>`,
    onOpen(el, close) {
      let cid = r.cid;
      if (isNew) combo($('#ar-c', el), { items: () => customers().map(c => ({ id: c.id, label: c.short || c.name, sub: [c.code, c.short ? c.name : ''].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { cid = it.id; const c = store.get('contacts', cid); if (c?.payMethod && !$('#ar-method', el).value) $('#ar-method', el).value = c.payMethod; } });
      $('#ar-ok', el).onclick = async () => {
        if (!cid) return toast('請選客戶');
        const amt = parseNum($('#ar-amt', el).value) || 0, tax = parseNum($('#ar-tax', el).value) || 0;
        if (isNaN(amt) || isNaN(tax)) return toast('金額不正確');
        const ym = isNew ? $('#ar-ym', el).value : r.ym;
        const manual = isNew || !r.auto || Math.round(amt) !== Math.round(r.auto.amt) || Math.round(tax) !== Math.round(r.auto.tax) || !!r.manual;
        const rec = $('#ar-rec', el).checked;
        const patch = { ym, cid, cust: cshort(cid), amt, tax, manual, method: $('#ar-method', el).value.trim(), due: $('#ar-due', el).value, note: $('#ar-note', el).value.trim() };
        if (rec) { patch.rec = true; patch.recAmt = parseNum($('#ar-recAmt', el).value) ?? Math.round(amt + tax); patch.recDate = $('#ar-recDate', el).value || today(); }
        const base = (r.id ? store.get('receivables', r.id) : null) || {}; const out = { ...base, ...patch }; if (!rec) { delete out.rec; delete out.recAmt; delete out.recDate; }
        await store.save('receivables', isNew ? uid('ar') : rowId({ ...r, cid }), out); close(); toast('已儲存');
      };
      $('#ar-auto', el)?.addEventListener('click', async () => { const d = store.get('receivables', rowId(r)); if (d) { delete d.manual; delete d.amt; delete d.tax; delete d.tot; await store.save('receivables', d.id, d); } close(); toast('已恢復為銷貨單自動加總'); });
      $('#ar-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這筆應收帳款？', { danger: true, ok: '刪除' })) { await store.remove('receivables', r.id); close(); } });
    },
  });
}

// 年度彙總：每家客戶 1～12 月應收總額（含稅），依全年合計由大到小；點客戶看整年明細
const rkey = r => r.cid || 'n:' + r.name;
const mm = (y, i) => y + '-' + String(i + 1).padStart(2, '0');
let yRows = [];
function yearData(y) {
  const st = store.setting('ar_store').months || {};
  const map = new Map(); const shop = [];
  for (let i = 0; i < 12; i++) {
    shop.push(+(st[mm(y, i)]?.amt) || 0);
    for (const r of arRows(mm(y, i))) {
      const k = rkey(r);
      const o = map.get(k) || map.set(k, { k, name: r.name, cid: r.cid, m: Array(12).fill(0), rows: [] }).get(k);
      o.m[i] += +r.total || 0; o.rows.push(r);
    }
  }
  const list = [...map.values()].map(o => ({ ...o, tot: o.m.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.tot - a.tot || String(a.name).localeCompare(String(b.name), 'zh-Hant'));
  return { list, shop };
}
function arYears() {
  const ys = new Set([thisMonth().slice(0, 4), ui.year]);
  for (const r of store.list('receivables')) if (r.ym) ys.add(r.ym.slice(0, 4));
  for (const b of calc().bills) if (b.type === 'SALE' && b.date) ys.add(apYm(b.date).slice(0, 4));
  return [...ys].filter(y => /^\d{4}$/.test(y)).sort().reverse();
}
function yearView() {
  const y = ui.year; const { list, shop } = yearData(y);
  const cell = v => Math.round(v) ? money(v) : '<span class="muted">·</span>';
  const mt = Array.from({ length: 12 }, (_, i) => list.reduce((s, o) => s + o.m[i], 0) + shop[i]);
  const grand = mt.reduce((s, v) => s + v, 0), shopTot = shop.reduce((s, v) => s + v, 0);
  const sel = list.find(o => o.k === ui.yc);
  yRows = sel ? sel.rows.slice().sort((a, b) => a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0) : [];
  return `<div class="panel" style="display:grid;gap:12px">
    <div class="tools"><button class="btn sm" id="prevY" aria-label="上一年">‹</button><select id="yy" style="font-weight:600">${arYears().map(v => `<option value="${v}" ${v === y ? 'selected' : ''}>${+v - 1911} 年（${v}）</option>`).join('')}</select><button class="btn sm" id="nextY" aria-label="下一年">›</button><span class="muted">${list.length} 家客戶・全年合計 <b>${money(grand)}</b></span></div>
    <p class="muted small" style="margin:0">各月應收總額（含稅，25 結），依全年合計由大到小。點客戶看整年明細；點月份跳到那個月的應收。</p>
    ${list.length || shopTot ? `<div class="tw"><table class="ary"><thead><tr><th>客戶</th>${Array.from({ length: 12 }, (_, i) => `<th class="n"><a href="#" data-ym="${mm(y, i)}" title="看 ${i + 1} 月應收">${i + 1} 月</a></th>`).join('')}<th class="n">全年</th></tr></thead><tbody>
      ${list.map(o => `<tr class="row${o.k === ui.yc ? ' on' : ''}" data-yc="${esc(o.k)}"><td><b>${esc(o.name)}</b></td>${o.m.map(v => `<td class="n">${cell(v)}</td>`).join('')}<td class="n"><b>${money(o.tot)}</b></td></tr>`).join('')}
      ${shopTot ? `<tr><td><b style="color:var(--blue)">門市收入</b></td>${shop.map(v => `<td class="n">${cell(v)}</td>`).join('')}<td class="n"><b>${money(shopTot)}</b></td></tr>` : ''}
    </tbody><tfoot><tr><td class="nowrap">合計（${list.length} 家）</td>${mt.map(v => `<td class="n">${money(v)}</td>`).join('')}<td class="n">${money(grand)}</td></tr></tfoot></table></div>`
    : `<div class="empty"><b>${+y - 1911} 年沒有應收帳款</b></div>`}
  </div>
  ${sel ? yearDetail(sel, y) : ''}`;
}
function yearDetail(o, y) {
  const rows = yRows; const sum = f => rows.reduce((s, r) => s + f(r), 0);
  return `<div class="panel" id="arYd" style="margin-top:12px;scroll-margin-top:64px">
    <div class="tools"><h3 style="margin:0">${esc(o.name)}　${+y - 1911} 年明細</h3><span class="muted">${rows.length} 筆</span><span class="sp"></span>${o.cid ? '<button class="btn sm" id="ydAdd">＋ 新增一筆</button>' : ''}<button class="btn sm ghost" id="ydClose">關閉</button></div>
    <div class="tw"><table><thead><tr><th>已收</th><th>月份</th><th class="n">貨款</th><th class="n">稅額</th><th class="n">總額</th><th class="n">實收</th><th>付款方式</th><th>收款日</th><th>備註</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.rec ? 'muted' : ''}"><td><input type="checkbox" data-rec="${i}" ${r.rec ? 'checked' : ''} aria-label="已收款"></td><td class="nowrap"><b>${+r.ym.slice(5)} 月</b>${r.manual ? ' <span class="pill zinc">手調</span>' : r.src === 'platform' && !r.auto ? ' <span class="pill">舊資料</span>' : ''}${isLate(r) ? ' <span class="pill bad">逾期</span>' : ''}</td><td class="n">${money(r.amt)}</td><td class="n">${r.tax ? money(r.tax) : '—'}</td><td class="n"><b>${money(r.total)}</b></td><td class="n">${r.rec ? `<b>${money(r.recAmt ?? r.total)}</b>` : '<span class="muted">未收</span>'}</td><td>${r.method ? `<span class="pill">${esc(r.method)}</span>` : ''}</td><td class="nowrap">${r.rec && r.recDate ? esc(roc(r.recDate)) : ''}</td><td class="small">${esc(r.note || '')}</td><td class="nowrap"><button class="btn xs" data-edit="${i}">修改</button>${r.auto ? ` <button class="btn xs ghost" data-bills="${i}">單據</button>` : ''}${r.id && !r.auto ? ` <button class="btn xs danger" data-ydel="${i}">刪除</button>` : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td>合計</td><td class="n">${money(sum(r => r.amt))}</td><td class="n">${money(sum(r => r.tax))}</td><td class="n">${money(sum(r => r.total))}</td><td class="n">${money(sum(r => r.rec ? (r.recAmt ?? r.total) : 0))}</td><td colspan="4">${rows.some(r => !r.rec && r.total > 0) ? `<span class="muted">未收 ${money(sum(r => !r.rec ? r.total : 0))}</span>` : ''}</td></tr></tfoot></table></div></div>`;
}
function bindYear(el) {
  const go = y => { ui.year = String(y); ui.yc = ''; draw(el); };
  $('#yy', el)?.addEventListener('change', ev => go(ev.target.value));
  $('#prevY', el)?.addEventListener('click', () => go(+ui.year - 1));
  $('#nextY', el)?.addEventListener('click', () => go(+ui.year + 1));
  el.querySelectorAll('a[data-ym]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); ui.ym = a.dataset.ym; ui.tab = 'month'; draw(el); }));
  el.querySelectorAll('tr[data-yc]').forEach(tr => tr.addEventListener('click', () => {
    ui.yc = ui.yc === tr.dataset.yc ? '' : tr.dataset.yc; draw(el);
    if (ui.yc) $('#arYd', el)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $('#ydClose', el)?.addEventListener('click', () => { ui.yc = ''; draw(el); });
  $('#ydAdd', el)?.addEventListener('click', () => {
    const cid = ui.yc; const ym = ui.year === thisMonth().slice(0, 4) ? thisMonth() : ui.year + '-12';
    editRow({ ym, cid, isNew: true, manual: true, method: store.get('contacts', cid)?.payMethod || '' });
  });
  el.querySelectorAll('[data-ydel]').forEach(b => b.addEventListener('click', async () => {
    const r = yRows[+b.dataset.ydel];
    if (await confirm(`刪除 ${r.name} ${ymLabel(r.ym)} 的應收帳款（總額 ${money(r.total)}）？`, { danger: true, ok: '刪除' })) { await store.remove('receivables', r.id); toast('已刪除'); }
  }));
  bindRows(el, yRows);
}

// 手機版（/m/）用
export { allOpen, isLate, saveRow, rowId };
