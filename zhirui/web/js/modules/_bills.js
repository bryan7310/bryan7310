// 單據共用：清單、編輯器、列印（銷貨、進貨、報價、採購、出入庫、調撥、收付款）
import { $, $$, esc, fmt, fmtQ, fp4, today, uid, matchQ, qTerms, roc, slash, thisMonth, money, isoOf, downloadText } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, combo, pager, tabs, printHTML } from '../core/ui.js';
import { TYPES, totals, lineAmt, calc, nextNo, cname, cshort, wname, gname, goodsLabel, customers, suppliers, defWh, qtyAt, bqty, uRate, lastSale, unitPrice, unitFactor } from '../core/calc.js';
import { api } from '../core/api.js';
import { labelPicker } from './labels.js';
import { faxDialog } from './faxes.js';

export const billText = b => { const C = calc(); const c = C.ct[b.cid]; return [b.no, c?.code, c?.name, c?.short, b.cn, b.note, ...(b.lines || []).flatMap(l => { const g = C.g[l.gid]; return [g?.code, g?.name, g?.spec, l.n, l.memo]; })].filter(Boolean).join(' '); };
export const partyLabel = b => { const C = calc(); const c = C.ct[b.cid]; return c ? (c.short || c.name) : (b.cn || '—'); };

/**
 * 單據清單頁。opts: {key, title, types:[...], tabList:[[k,label]], newTypes:[type...], extraHead(html), extraRow(b)->html, actions(b)->html}
 * state 由呼叫端保存（ui 物件），以便切換頁面後保留。
 */
// ---------- 期間快捷鍵（全部、本月、上月、上月 25 結帳）與日期區間 ----------
const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return isoOf(new Date(y, m, 0)); };
function quickPeriods() {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  return [
    { label: '全部', from: '', to: '' },
    { label: `${m + 1}月`, from: isoOf(new Date(y, m, 1)), to: isoOf(new Date(y, m + 1, 0)) },
    { label: `${m === 0 ? 12 : m}月`, from: isoOf(new Date(y, m - 1, 1)), to: isoOf(new Date(y, m, 0)) },
    { label: '上月25結', from: isoOf(new Date(y, m - 2, 26)), to: isoOf(new Date(y, m - 1, 25)) },
  ];
}
const inPeriod = (b, f, t) => (!f || (b.date || '') >= f) && (!t || (b.date || '') <= t);
/** 期間列：快捷鍵（附張數）、其他月份、日期區間 */
function periodBar(ui, count) {
  const ps = quickPeriods();
  return `<div class="tools" style="margin-top:8px;align-items:center"><span class="muted small">期間</span>${ps.map(p => `<button type="button" class="btn sm ${p.from === ui.from && p.to === ui.to ? 'pri' : ''}" data-per="${p.from}|${p.to}">${p.label}${count ? `（${count(p)}）` : ''}</button>`).join('')}<input type="month" id="bmon" title="其他月份" aria-label="其他月份"><span class="muted small">日期區間</span><input type="date" id="bfrom" value="${esc(ui.from)}"><span class="muted">～</span><input type="date" id="bto" value="${esc(ui.to)}"></div>`;
}
function bindPeriod(el, ui, redraw) {
  el.querySelectorAll('[data-per]').forEach(b => b.addEventListener('click', () => { [ui.from, ui.to] = b.dataset.per.split('|'); ui.page = 0; redraw(); }));
  $('#bmon', el)?.addEventListener('change', e2 => { if (!e2.target.value) return; ui.from = e2.target.value + '-01'; ui.to = monthEnd(e2.target.value); ui.page = 0; redraw(); });
  $('#bfrom', el)?.addEventListener('change', e2 => { ui.from = e2.target.value; ui.page = 0; redraw(); });
  $('#bto', el)?.addEventListener('change', e2 => { ui.to = e2.target.value; ui.page = 0; redraw(); });
}
/** 搜尋框：中文輸入法組字中不重畫（否則打不出中文），組字完成或一般輸入才重畫 */
function bindSearch(el, ui, redraw, delay = 0) {
  const inp = $('#bq', el); if (!inp) return; let timer = null;
  const go = () => { ui.q = inp.value; ui.page = 0; clearTimeout(timer); timer = setTimeout(() => { if (!el.isConnected) return; redraw(); setTimeout(() => { const i = $('#bq', el); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, delay); };
  inp.addEventListener('input', e2 => { if (e2.isComposing) return; go(); });
  inp.addEventListener('compositionend', go);
}
const csvOf = (name, head, rows) => downloadText(name + '.csv', '﻿' + [head, ...rows].map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n'), 'text/csv');
function billsCsv(title, list, C) {
  const rows = list.map(b => { const T = TYPES[b.type] || {}; const t = C ? (C.tot[b.id] || totals(b)) : totals(b); const ls = (b.lines || []).filter(l => l.txt === undefined); return [slash(b.date), T.name || b.type, b.no, partyLabel(b), ls.map(l => `${l.gid ? gname(l.gid) : l.n || ''} ×${fmtQ(l.qty)}`).join('；'), b.hist && b.oamt != null ? Math.round(b.oamt) : (T.lines ? Math.round(t.total) : +b.amount || 0), T.lines && T.party && !T.doc && !b.hist ? +b.paid || 0 : '', b.note || '']; });
  csvOf(`${title}_${today()}`, ['日期', '類型', '單號', '對象', '內容', '金額', '已收付', '備註'], rows);
}
export function billList(el, opts, ui) {
  ui.tab ??= 'all'; ui.q ??= ''; ui.from ??= ''; ui.to ??= ''; ui.page ??= 0;
  const C = calc();
  const types = opts.types;
  const typeOk = b => ui.tab === 'all' ? types.includes(b.type) : ui.tab.split(',').includes(b.type);
  const q = qTerms(ui.q);
  // 舊系統搬來的歷史單據（伺服器另一表）第一次用到時整批載入，之後和新平台的單一起列、一起搜尋
  let histNote = '', hist = [];
  if (opts.histTypes) {
    const cached = histCache.get(opts.histTypes.join(','));
    if (cached) hist = cached;
    else { histNote = '<span class="muted small">載入舊系統的單據…</span>'; histFetch(opts.histTypes).then(() => { if (el.isConnected) billList(el, opts, ui); }).catch(e2 => toast('歷史單據載入失敗：' + (e2.message || e2))); }
  }
  const base = [...C.bills, ...hist].filter(b => typeOk(b) && (!q.length || matchQ(billText(b), q)));
  let list = base.filter(b => inPeriod(b, ui.from, ui.to));
  list = list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.no).localeCompare(String(a.no)));
  const [s, e, pg] = pager(opts.key, list.length, ui.page);
  const sumT = list.reduce((a, b) => a + (TYPES[b.type].ps || 1) * (b.hist ? (+b.oamt || 0) : (C.tot[b.id]?.total || 0)), 0);
  const byId = new Map(list.map(b => [b.id, b]));
  el.innerHTML = `
    <div class="head"><h1>${esc(opts.title)}</h1><span class="sp"></span><button class="btn" id="bcsv" ${list.length ? '' : 'disabled'}>匯出 Excel (CSV)</button>${(opts.newTypes || []).map(t => `<button class="btn ${t === opts.newTypes[0] ? 'pri' : ''}" data-new="${t}">＋ ${TYPES[t].name}</button>`).join('')}${opts.extraHead || ''}</div>
    <div class="panel">
      <div class="tools">${opts.tabList ? tabs('t', opts.tabList, ui.tab) : ''}<input type="search" id="bq" placeholder="搜尋單號、客戶／廠商、商品、備註" value="${esc(ui.q)}"><span class="muted small">${list.length} 張・合計 ${fmt(sumT)}</span>${histNote}</div>
      ${periodBar(ui, p => base.filter(b => inPeriod(b, p.from, p.to)).length)}
      <div class="tw" style="margin-top:10px"><table><thead><tr><th>日期</th><th>單號</th><th>${types.some(t => TYPES[t].party === 'S') ? '廠商' : types.some(t => TYPES[t].party === 'C') ? '客戶' : '倉庫'}</th><th>內容</th>${opts.cols ? opts.cols.map(c => `<th class="${c.cls || ''}">${c.label}</th>`).join('') : ''}<th class="n">金額</th><th>狀態</th><th></th></tr></thead>
      <tbody>${list.length ? list.slice(s, e).map(b => billRow(b, opts, C)).join('') : `<tr><td colspan="9"><div class="empty"><b>沒有單據</b>${histNote ? '舊系統的單據載入中…' : ui.q || ui.from || ui.to ? '試試清除搜尋或期間' : '按右上角的按鈕新增'}</div></td></tr>`}</tbody></table></div>${pg}
    </div>`;
  const redraw = () => billList(el, opts, ui);
  bindSearch(el, ui, redraw);
  bindPeriod(el, ui, redraw);
  $('#bcsv', el).addEventListener('click', () => billsCsv(opts.title, list, C));
  el.addEventListener('tab', e2 => { ui.tab = e2.detail.val; ui.page = 0; redraw(); }, { once: true });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; redraw(); }));
  el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openBill(b.dataset.new, null, opts.onSaved)));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', e2 => { if (e2.target.closest('button,a')) return; if (tr.dataset.hist) return histView(byId.get(tr.dataset.id)); openBill(null, tr.dataset.id, opts.onSaved); }));
  el.querySelectorAll('[data-hprint]').forEach(b => b.addEventListener('click', () => printBill(byId.get(b.dataset.hprint))));
  opts.bind && opts.bind(el);
}
function billRow(b, opts, C) {
  const T = TYPES[b.type]; const t = C.tot[b.id] || totals(b);
  const lines = (b.lines || []).filter(l => l.txt === undefined);
  const content = T.lines ? `${lines.slice(0, 2).map(l => esc(l.gid ? gname(l.gid) : l.n || '')).join('、')}${lines.length > 2 ? `…等 ${lines.length} 項` : ''}` : esc(b.note || b.cat || '');
  let status = '';
  if (T.lines && T.party && !T.doc) { const due = t.total - (+b.paid || 0); status = due <= 0 ? '<span class="pill ok">已結清</span>' : +b.paid > 0 ? `<span class="pill warn">尚欠 ${fmt(due)}</span>` : '<span class="pill">未收付</span>'; }
  if (b.type === 'SALE' && b.invNo) status += ` <span class="pill blue">發票 ${esc(b.invNo)}</span>`;
  if (b.type === 'QUO' && b.toBill) status += ' <span class="pill ok">已轉銷貨</span>';
  if (b.type === 'PO' && b.received) status += ' <span class="pill ok">已進貨</span>';
  if (opts.status) status += opts.status(b);
  if (b.hist) status = '';
  return `<tr class="row" data-id="${b.id}" ${b.hist ? 'data-hist="1"' : ''}><td class="nowrap">${esc(slash(b.date))}</td><td class="mono nowrap">${esc(b.no)}${opts.tabList && opts.tabList.length > 2 ? `<span class="sub">${T.name}</span>` : ''}</td><td>${esc(T.party ? partyLabel(b) : T.transfer ? wname(b.wid) + ' → ' + wname(b.toWid) : wname(b.wid))}</td><td class="muted">${content}</td>${opts.cols ? opts.cols.map(c => `<td class="${c.cls || ''}">${c.cell(b)}</td>`).join('') : ''}<td class="n">${fmt(b.hist ? b.oamt : T.lines ? t.total : b.amount)}</td><td>${status}</td><td class="r nowrap">${b.hist ? `<button class="btn xs" data-hprint="${b.id}">列印</button>` : opts.actions ? opts.actions(b) : ''}</td></tr>`;
}

// ---------- 舊系統歷史單據（唯讀，存在伺服器另一個表，向伺服器查） ----------
const histCache = new Map(), histPending = new Map();
/** 整批載入這幾種單據的歷史資料（每次 1000 張，其餘並行抓），載過就留在記憶體 */
function histFetch(types) {
  const key = types.join(',');
  if (histCache.has(key)) return Promise.resolve(histCache.get(key));
  if (histPending.has(key)) return histPending.get(key);
  const p = (async () => {
    const out = [];
    // 伺服器一次只能處理一個查詢，所以逐批依序抓（同時抓會出錯）
    for (const type of types) {
      let offset = 0;
      for (;;) { const r = await api.hist({ type, limit: 1000, offset }); out.push(...r.rows); offset += r.rows.length; if (!r.rows.length || offset >= r.total) break; }
    }
    for (const b of out) b.hist = true;
    histCache.set(key, out); histPending.delete(key);
    return out;
  })();
  histPending.set(key, p);
  p.catch(() => histPending.delete(key));
  return p;
}
/** 歷史單據檢視（唯讀） */
export function histView(b) {
  const C = calc(); const T = TYPES[b.type] || {}; const c = C.ct[b.cid]; const lines = b.lines || [];
  const body = `<div class="banner">舊系統搬來的歷史單據，只能查看和列印，不計入現在的庫存與應收應付。</div>
    <div class="grid" style="margin-bottom:10px"><div><span class="muted small">${T.party === 'S' ? '廠商' : '客戶'}</span><div>${esc(c ? c.name : b.cn || '—')}</div></div><div><span class="muted small">日期</span><div>${esc(slash(b.date))}</div></div><div><span class="muted small">單號</span><div class="mono">${esc(b.no)}</div></div>${b.valid ? `<div><span class="muted small">有效期限</span><div>${esc(slash(b.valid))}</div></div>` : ''}${b.deliv ? `<div><span class="muted small">交期</span><div>${esc(slash(b.deliv))}</div></div>` : ''}</div>
    <div class="tw"><table><thead><tr><th>#</th><th>品名規格</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th class="n">金額</th></tr></thead><tbody>
    ${lines.map((l, i) => l.txt !== undefined ? `<tr><td></td><td colspan="5" class="muted">${esc(l.txt)}</td></tr>` : `<tr><td class="muted">${i + 1}</td><td>${esc(l.gid ? gname(l.gid) : l.n || '')}${l.memo ? `<span class="sub">${esc(l.memo)}</span>` : ''}</td><td class="n">${fmtQ(l.qty)}</td><td class="muted">${esc(l.u || C.g[l.gid]?.unit || '')}</td><td class="n">${fp4(l.price)}</td><td class="n">${fmt(lineAmt(l))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">沒有明細</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5" class="n">總計</td><td class="n"><b>${fmt(b.oamt != null ? b.oamt : totals(b).total)}</b></td></tr></tfoot></table></div>${b.note ? `<p class="muted small">備註：${esc(b.note)}</p>` : ''}`;
  modal({ title: `${T.name || b.type} ${b.no}`, width: 760, body, footer: '<button class="btn" data-print>列印</button><span class="sp"></span><button class="btn" data-close>關閉</button>', onOpen(m) { m.querySelector('[data-print]').onclick = () => printBill(b); } });
}

// ---------- 編輯器 ----------
let edit = null, dlg = null, onSavedCb = null;
export function openBill(type, id, onSaved, preset) {
  onSavedCb = onSaved;
  const C = calc();
  if (id) { const b = store.get('bills', id); if (!b) return toast('找不到這張單據'); edit = JSON.parse(JSON.stringify(b)); edit.lines = edit.lines || []; type = edit.type; }
  else {
    const T = TYPES[type]; const d = today();
    edit = { type, date: d, no: nextNo(type, d), cid: '', wid: defWh()?.id || '', toWid: store.list('warehouses').find(w => w.id !== defWh()?.id)?.id || '', aid: store.list('accounts')[0]?.id || '', lines: T.lines ? [{ gid: '', qty: '', price: '' }] : [], disc: 0, tax: false, paid: 0, amount: '', note: '', ...(preset || {}) };
    if (T.lines && preset?.lines?.length) edit.lines = preset.lines;
  }
  edit._err = '';
  drawBill();
}
function drawBill() {
  const e = edit, T = TYPES[e.type], C = calc();
  const party = T.party ? (T.party === 'C' ? customers() : suppliers()) : [];
  const whs = store.list('warehouses'), accts = store.list('accounts');
  const body = `
    ${e.hist ? '<div class="banner">這是舊系統搬來的歷史單據，不計入現在的庫存與應收應付。</div>' : ''}
    <div class="grid">
      <div class="f"><label for="b-date">日期</label><input type="date" id="b-date" value="${esc(e.date)}"></div>
      <div class="f"><label for="b-no">單號</label><input id="b-no" value="${esc(e.no)}" class="mono"></div>
      ${T.party ? `<div class="f" style="grid-column:span 2"><label for="b-cid">${T.party === 'C' ? '客戶' : '供應商'}</label><div class="combo"><input id="b-cid" placeholder="輸入編號、名稱或簡稱搜尋" value="${esc(partyLabel(e) === '—' ? '' : partyLabel(e))}"></div></div>` : ''}
      ${T.lines && !T.doc ? `<div class="f"><label for="b-wid">${T.transfer ? '調出倉庫' : '倉庫'}</label><select id="b-wid">${whs.map(w => `<option value="${w.id}" ${w.id === e.wid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>` : ''}
      ${T.transfer ? `<div class="f"><label for="b-toWid">調入倉庫</label><select id="b-toWid">${whs.map(w => `<option value="${w.id}" ${w.id === e.toWid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>` : ''}
      ${T.money && !T.lines ? `<div class="f"><label for="b-amount">金額</label><input id="b-amount" class="num" inputmode="decimal" value="${esc(e.amount)}"></div><div class="f"><label for="b-aid">結算帳戶</label><select id="b-aid">${accts.map(a => `<option value="${a.id}" ${a.id === e.aid ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      ${!T.lines && !T.party ? `<div class="f"><label for="b-cat">項目</label><input id="b-cat" value="${esc(e.cat || '')}" placeholder="例如：運費、水電"></div>` : ''}
      ${T.doc ? `<div class="f"><label for="b-valid">${e.type === 'PO' ? '交期' : '有效期限'}</label><input type="date" id="b-valid" value="${esc(e.valid || e.deliv || '')}"></div><div class="f"><label for="b-attn">聯絡人</label><input id="b-attn" value="${esc(e.attn || '')}"></div>` : ''}
    </div>
    ${T.lines ? `<div class="tw"><table class="lines" id="lines"><thead><tr><th style="width:38%">商品</th><th style="width:70px">單位</th><th style="width:110px" class="r">數量</th><th style="width:110px" class="r">單價</th><th style="width:110px" class="r">小計</th><th style="width:140px">備註</th><th style="width:30px"></th></tr></thead><tbody>${e.lines.map((l, i) => lineRow(l, i)).join('')}</tbody></table></div>
      <div class="tools"><button class="btn sm" id="addLine">＋ 加一行</button><button class="btn sm" id="addTxt">＋ 文字列</button><span class="sp"></span>${T.party ? `<label class="check"><input type="checkbox" id="b-tax" ${e.tax ? 'checked' : ''}> 加 5% 營業稅</label><div class="f" style="width:120px"><input id="b-disc" class="num" placeholder="折讓" value="${e.disc || ''}" title="整單折讓金額"></div>` : ''}</div>
      ${T.party ? `<div class="totals"><div><span>小計</span> <b id="t-sub"></b></div><div><span>稅額</span> <b id="t-tax"></b></div><div class="big"><span>總額</span> <b id="t-total"></b></div>${!T.doc ? `<div><span>${T.party === 'C' ? '已收' : '已付'}</span> <input id="b-paid" class="num" style="width:110px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;text-align:right" value="${e.paid || ''}"></div><div><span>結算帳戶</span> <select id="b-aid" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px">${accts.map(a => `<option value="${a.id}" ${a.id === e.aid ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div><div><span>尚欠</span> <b id="t-due"></b></div>` : ''}</div>` : ''}` : ''}
    <div class="f"><label for="b-note">備註</label><textarea id="b-note" style="min-height:48px">${esc(e.note || '')}</textarea></div>
    ${e._err ? `<div class="err">${esc(e._err)}</div>` : ''}`;
  const footer = `${e.id ? `<button class="btn danger" id="delBill">刪除</button>` : ''}${e.id && e.type === 'SALE' ? `<button class="btn" id="lblBill">標籤</button>` : ''}${e.id && T.doc ? `<button class="btn" id="faxBill">傳真</button>` : ''}${e.id && (e.type === 'SALE' || e.type === 'QUO' || e.type === 'PO' || e.type === 'PUR') ? `<button class="btn" id="printBill">列印</button>` : ''}${e.id && e.type === 'QUO' && !e.toBill ? `<button class="btn" id="toSale">轉成銷貨單</button>` : ''}${e.id && e.type === 'PO' && !e.received ? `<button class="btn" id="toPur">轉成進貨單</button>` : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="saveBill">儲存</button>`;
  if (dlg) dlg.close();
  dlg = modal({ title: `${T.name}${e.id ? ' ' + e.no : ''}`, width: 980, body, footer, closeOnBg: false, onOpen: bindBill, onClose: () => { dlg = null; } });
}
function lineRow(l, i) {
  const C = calc(); const g = C.g[l.gid];
  if (l.txt !== undefined) return `<tr data-i="${i}"><td colspan="6"><input data-f="txt" value="${esc(l.txt)}" placeholder="文字說明（不計價）"></td><td><button class="icon-btn" data-del="${i}" aria-label="刪除"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td></tr>`;
  const have = lineHave(l);
  const units = g ? [[g.unit || 'PCS', g.unit || 'PCS'], ...(g.aunit ? [['a', g.aunit]] : []), ['H', 'H（百支）'], ['K', 'K（千支）'], ['KG', 'KG']] : [];
  return `<tr data-i="${i}"><td><div class="combo"><input data-f="gid" value="${esc(g ? goodsLabel(g) : l.n || '')}" placeholder="輸入料號、品名、規格搜尋"></div>${have != null ? `<div class="have ${(TYPES[edit.type].stock === -1 || TYPES[edit.type].transfer) && bqty(l, g) > have ? 'bad' : ''}">庫存 ${fmtQ(have)} ${esc(g?.unit || '')}</div>` : ''}${l._lp ? `<div class="lp">${esc(l._lp)}</div>` : ''}</td>
    <td>${g ? `<select data-f="unit">${units.map(([v, lb]) => `<option value="${v}" ${(l.unit === 'a' ? 'a' : l.u || g.unit || 'PCS') === v ? 'selected' : ''}>${esc(lb)}</option>`).join('')}</select>` : `<input data-f="nu" value="${esc(l.unit || '')}" placeholder="單位">`}</td>
    <td><input data-f="qty" class="num" inputmode="decimal" value="${esc(l.qty)}"></td>
    <td><input data-f="price" class="num" inputmode="decimal" value="${esc(l.price)}"></td>
    <td class="n" id="ls-${i}">${fmt(lineAmt(l))}</td>
    <td><input data-f="memo" value="${esc(l.memo || '')}"></td>
    <td><button class="icon-btn" data-del="${i}" aria-label="刪除"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td></tr>`;
}
function lineHave(l) { if (!l.gid || !edit || !edit.wid || TYPES[edit.type].doc) return null; return qtyAt(l.gid, edit.wid); }
function bindBill(el, close) {
  const e = edit, T = TYPES[e.type], C = calc();
  const v = (id, f) => { const x = el.querySelector('#' + id); if (x) x.addEventListener('input', () => { f(x.value); updateTotals(el); }); };
  v('b-date', x => e.date = x); v('b-no', x => e.no = x); v('b-note', x => e.note = x); v('b-amount', x => e.amount = x); v('b-cat', x => e.cat = x); v('b-paid', x => e.paid = x); v('b-disc', x => e.disc = x); v('b-valid', x => { if (e.type === 'PO') e.deliv = x; else e.valid = x; }); v('b-attn', x => e.attn = x);
  ['b-wid', 'b-toWid', 'b-aid'].forEach(id => { const x = el.querySelector('#' + id); if (x) x.addEventListener('change', () => { e[id.slice(2)] = x.value; if (id === 'b-wid') redrawLines(el); }); });
  const tax = el.querySelector('#b-tax'); if (tax) tax.addEventListener('change', () => { e.tax = tax.checked; updateTotals(el); });
  const cid = el.querySelector('#b-cid');
  if (cid) combo(cid, { items: () => (T.party === 'C' ? customers() : suppliers()).map(c => ({ id: c.id, label: c.name, sub: [c.code, c.short].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { e.cid = it.id; e.lines.forEach((l, i) => { if (l.gid && !l.price && C.g[l.gid]) applyLast(l, C.g[l.gid]); }); redrawLines(el); }, onClear: () => { e.cid = ''; } });
  bindLines(el);
  el.querySelector('#addLine')?.addEventListener('click', () => { e.lines.push({ gid: '', qty: '', price: '' }); redrawLines(el); setTimeout(() => el.querySelector(`tr[data-i="${e.lines.length - 1}"] input`)?.focus(), 0); });
  el.querySelector('#addTxt')?.addEventListener('click', () => { e.lines.push({ txt: '' }); redrawLines(el); });
  el.querySelector('#saveBill').addEventListener('click', () => saveBill(close));
  el.querySelector('#delBill')?.addEventListener('click', async () => { if (await confirm(`確定刪除 ${T.name} ${e.no}？`, { danger: true, ok: '刪除' })) { await store.remove('bills', e.id); store.log('刪除', `${T.name} ${e.no}`); close(); toast('已刪除'); onSavedCb && onSavedCb(); } });
  el.querySelector('#printBill')?.addEventListener('click', () => printBill(e));
  el.querySelector('#lblBill')?.addEventListener('click', () => labelPicker(e));
  el.querySelector('#faxBill')?.addEventListener('click', () => faxDialog(e, () => drawBill()));
  el.querySelector('#toSale')?.addEventListener('click', () => convertBill(e, 'SALE', close));
  el.querySelector('#toPur')?.addEventListener('click', () => convertBill(e, 'PUR', close));
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.ctrlKey) saveBill(close); });
  updateTotals(el);
}
function redrawLines(el) { const tb = el.querySelector('#lines tbody'); if (!tb) return; tb.innerHTML = edit.lines.map((l, i) => lineRow(l, i)).join(''); bindLines(el); updateTotals(el); }
function applyLast(l, g) {
  if (!['SALE', 'SALE_RET', 'QUO'].includes(edit.type)) return false;
  const x = lastSale(edit.cid, g.id, edit.date, edit.id); if (!x) return false;
  if (x.unit === 'a' && g.aunit && +g.arate > 1) { l.unit = 'a'; l.rate = +g.arate; l.price = x.price; }
  else if (x.u) { const [c1, f1] = unitFactor(x.u); const [c2, f2] = unitFactor(g.unit || ''); l.unit = ''; l.u = x.u; l.price = x.price; }
  else { l.unit = ''; l.rate = 1; l.price = x.price; }
  l._lp = `上次 ${slash(x.date)} 單價 ${fp4(x.price)}${x.u ? ' / ' + x.u : x.unit === 'a' ? ' / ' + g.aunit : ''}（${x.no}）`; return true;
}
function bindLines(el) {
  const C = calc();
  el.querySelectorAll('#lines tbody tr').forEach(tr => {
    const i = +tr.dataset.i, l = edit.lines[i];
    tr.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (f === 'gid') {
        combo(inp, {
          items: () => store.list('goods').map(g => ({ id: g.id, label: goodsLabel(g), sub: g.unit || '', text: goodsLabel(g) + ' ' + (g.vcode || '') })), allowFree: TYPES[edit.type].doc,
          onPick: it => { const g = C.g[it.id]; l.gid = it.id; delete l.n; l.u = ''; l.unit = ''; delete l.rate; if (!applyLast(l, g)) { const p = unitPrice(g, edit.type); if (p !== '') l.price = p; } if (!l.qty) l.qty = ''; redrawLines(el); setTimeout(() => el.querySelector(`tr[data-i="${i}"] [data-f="qty"]`)?.focus(), 0); },
          onBlur: val => { if (!l.gid && TYPES[edit.type].doc) { l.n = val; } },
        });
      } else if (f === 'unit') inp.addEventListener('change', () => { const g = C.g[l.gid]; if (inp.value === 'a') { l.unit = 'a'; l.rate = +g.arate || 1; l.u = ''; } else { l.unit = ''; delete l.rate; l.u = inp.value === (g.unit || 'PCS') ? '' : inp.value; } redrawLines(el); });
      else inp.addEventListener('input', () => { l[f === 'nu' ? 'unit' : f] = inp.value; if (f === 'qty' || f === 'price') { delete l._lp; } updateTotals(el); });
    });
    tr.querySelector('[data-del]')?.addEventListener('click', () => { edit.lines.splice(i, 1); if (!edit.lines.length) edit.lines.push({ gid: '', qty: '', price: '' }); redrawLines(el); });
    tr.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.isComposing && inp.dataset.f !== 'gid') { ev.preventDefault(); if (i === edit.lines.length - 1 && inp.dataset.f === 'price') { el.querySelector('#addLine').click(); } else { const next = tr.nextElementSibling?.querySelector('input'); next?.focus(); } }
    }));
  });
}
function updateTotals(el) {
  const e = edit, T = TYPES[e.type]; if (!T.lines) return;
  e.lines.forEach((l, i) => { const s = el.querySelector('#ls-' + i); if (s) s.textContent = fmt(lineAmt(l)); });
  if (!T.party) return;
  const t = totals(e); const st = (id, v) => { const x = el.querySelector(id); if (x) x.textContent = v; };
  st('#t-sub', fmt(t.sub)); st('#t-tax', e.tax ? fmt(t.tax) : '—'); st('#t-total', fmt(t.total)); st('#t-due', fmt(t.total - (+e.paid || 0)));
}
async function saveBill(close) {
  const e = edit, T = TYPES[e.type]; let err = '';
  const C = calc();
  if (!e.date) err = '請填單據日期';
  else if (!String(e.no).trim()) err = '請填單號';
  else if (!e.hist && store.list('bills').some(b => b.no === e.no.trim() && b.id !== e.id && b.type === e.type && !b.hist)) err = '單號重複';
  else if (T.party && !e.cid) err = `請選擇${T.party === 'C' ? '客戶' : '供應商'}`;
  if (!err && T.lines && !T.doc && !e.wid) err = '請選擇倉庫';
  if (!err && T.transfer && (!e.toWid || e.toWid === e.wid)) err = '調入倉庫要和調出倉庫不同';
  if (!err && T.lines) {
    e.lines = e.lines.filter(l => l.gid || l.n || +l.qty || (l.txt !== undefined && String(l.txt).trim()));
    if (!e.lines.some(l => l.txt === undefined)) err = '請至少輸入一項商品';
    else if (e.lines.some(l => l.txt === undefined && !l.gid && !l.n)) err = '有商品沒有對到商品資料，請從清單選取';
    else if (!e.hist && e.lines.some(l => l.txt === undefined && !(+l.qty > 0))) err = '數量要大於 0';
  }
  if (!err && !T.lines && !(+e.amount > 0)) err = '請輸入金額';
  if (!err && T.money && !T.lines && !e.aid) err = '請選擇結算帳戶';
  if (err) { e._err = err; if (T.lines && !e.lines.length) e.lines.push({ gid: '', qty: '', price: '' }); drawBill(); toast('無法儲存：' + err); return; }
  const id = e.id || uid('b');
  const doc = { type: e.type, no: e.no.trim(), date: e.date, note: e.note || '', createdAt: e.createdAt || Date.now(), updatedAt: Date.now() };
  if (T.party) doc.cid = e.cid;
  if (T.lines) { doc.wid = e.wid; doc.lines = e.lines.map(l => { if (l.txt !== undefined) return { txt: String(l.txt).trim() }; const o = { gid: l.gid || '', qty: +l.qty || 0, price: +l.price || 0 }; if (!l.gid && l.n) { o.n = l.n; if (l.unit) o.unit = l.unit; } if (l.u) o.u = l.u; if (String(l.memo || '').trim()) o.memo = String(l.memo).trim(); if (l.unit === 'a' && +l.rate > 1) { o.unit = 'a'; o.rate = +l.rate; } else if (l.u && l.gid) { const r = uRate(l.u, C.g[l.gid]); if (r && r !== 1) o.rate = r; } if (l.batch) o.batch = l.batch; return o; }); }
  if (T.transfer) doc.toWid = e.toWid;
  if (T.doc) { doc.disc = +e.disc || 0; doc.tax = !!e.tax; for (const k of ['attn', 'valid', 'deliv', 'payterm', 'toBill', 'received', 'fromQuote', 'orderId']) if (e[k]) doc[k] = e[k]; delete doc.wid; }
  else if (T.lines && T.party) { doc.disc = +e.disc || 0; doc.tax = !!e.tax; doc.paid = +e.paid || 0; doc.aid = e.aid || ''; for (const k of ['invNo', 'fromQuote', 'fromPO']) if (e[k]) doc[k] = e[k]; }
  if (T.money && !T.lines) { doc.aid = e.aid || ''; doc.amount = +e.amount || 0; if (e.cat) doc.cat = e.cat; for (const k of ['ref', 'checkId']) if (e[k]) doc[k] = e[k]; }
  if (e.hist) { doc.hist = true; if (e.cn) doc.cn = e.cn; if (e.oamt != null) doc.oamt = e.oamt; }
  doc.createdBy = e.createdBy || store.user.id; if (e.id) doc.updatedBy = store.user.id;
  try { await store.save('bills', id, doc); } catch (err2) { toast('儲存失敗：' + err2.message); return; }
  store.log(e.id ? '修改' : '新增', `${T.name} ${doc.no}${T.party ? '｜' + cname(doc.cid) : ''}｜${fmt(T.lines ? totals(doc).total : doc.amount)} 元`);
  close(); toast(`${T.name} ${doc.no} 已儲存`);
  onSavedCb && onSavedCb({ ...doc, id });
}
// 報價單 → 銷貨單、採購單 → 進貨單
async function convertBill(src, type, close) {
  const d = today();
  const lines = (src.lines || []).map(l => ({ ...l }));
  const missing = lines.filter(l => l.txt === undefined && !l.gid);
  if (missing.length) {
    if (!await confirm(`有 ${missing.length} 項不在商品資料裡（${missing.map(l => l.n).slice(0, 3).join('、')}…）。\n要自動建立成商品嗎？`, { ok: '建立並轉單' })) return;
    const ops = [];
    for (const l of missing) { const gid = uid('g'); ops.push({ col: 'goods', id: gid, data: { code: '', name: l.n, spec: '', unit: l.unit || 'PCS', cat: '', purPrice: 0, salePrice: +l.price || 0, safety: 0, note: '由報價單建立' } }); l.gid = gid; delete l.n; }
    await store.batch(ops);
  }
  const preset = { cid: src.cid, lines, disc: src.disc || 0, tax: !!src.tax, note: `由${TYPES[src.type].name} ${src.no} 轉入`, [type === 'SALE' ? 'fromQuote' : 'fromPO']: src.id };
  close();
  openBill(type, null, async saved => {
    if (saved) { await store.save('bills', src.id, { ...src, [type === 'SALE' ? 'toBill' : 'received']: saved.id }); }
    onSavedCb && onSavedCb(saved);
  }, preset);
}

// ---------- 列印 ----------
export function printBill(b) { const d = billDoc(b); printHTML(`${d.title} ${b.no}`, d.css, d.html, { tip: '按 Ctrl+P 列印，紙張 A4。' }); }
export function billDoc(b) {
  const C = calc(); const T = TYPES[b.type]; const co = store.setting('company'); const c = C.ct[b.cid] || {};
  const t = totals(b);
  const title = { SALE: '出貨單', QUO: '報價單', PO: '採購單', PUR: '進貨單', SALE_RET: '銷貨退回單', PUR_RET: '進貨退出單' }[b.type] || T.name;
  const lines = (b.lines || []);
  const rows = lines.map((l, i) => l.txt !== undefined ? `<tr><td></td><td colspan="5">${esc(l.txt)}</td></tr>` : `<tr><td class="c">${i + 1}</td><td>${esc(l.gid ? gname(l.gid) : l.n || '')}${l.memo ? `<small> ${esc(l.memo)}</small>` : ''}</td><td class="n">${fmtQ(l.qty)}</td><td>${esc(l.unit === 'a' ? (C.g[l.gid]?.aunit || '') : l.u || C.g[l.gid]?.unit || l.unit || '')}</td><td class="n">${fp4(l.price)}</td><td class="n">${fmt(lineAmt(l))}</td></tr>`).join('');
  const css = `@page{size:A4;margin:12mm}body{font-family:"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif;font-size:11pt;color:#000;margin:0}h1{text-align:center;font-size:18pt;margin:0 0 2mm}.co{text-align:center;font-size:10pt;margin-bottom:4mm}.meta{display:grid;grid-template-columns:1fr 1fr;gap:1mm 10mm;margin-bottom:4mm;font-size:10.5pt}table{width:100%;border-collapse:collapse}th,td{border:.5pt solid #000;padding:1.5mm 2mm;text-align:left}th{background:#eee;font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}td.c{text-align:center}small{color:#555}tfoot td{font-weight:600}.sig{display:flex;justify-content:space-between;margin-top:12mm;font-size:10.5pt}.sig span{flex:1}`;
  const html = `<div class="co">${esc(co.name || '志瑞螺絲企業有限公司')}　統編 ${esc(co.taxId || '')}　電話 ${esc(co.phone || '')}　傳真 ${esc(co.fax || '')}<br>${esc(co.addr || '')}</div><h1>${esc(title)}</h1>
    <div class="meta"><div>${T.party === 'C' ? '客戶' : '廠商'}：${esc(c.name || b.cn || '')}</div><div>單號：${esc(b.no)}</div><div>電話：${esc(c.phone || '')}</div><div>日期：${esc(slash(b.date))}</div><div>地址：${esc(c.addr || '')}</div><div>${b.type === 'PO' && b.deliv ? '交期：' + esc(slash(b.deliv)) : b.type === 'QUO' && b.valid ? '有效期限：' + esc(slash(b.valid)) : ''}</div></div>
    <table><thead><tr><th style="width:8mm">#</th><th>品名規格</th><th class="n" style="width:22mm">數量</th><th style="width:14mm">單位</th><th class="n" style="width:22mm">單價</th><th class="n" style="width:26mm">金額</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5" class="n">小計</td><td class="n">${fmt(t.sub)}</td></tr>${b.disc ? `<tr><td colspan="5" class="n">折讓</td><td class="n">-${fmt(b.disc)}</td></tr>` : ''}${b.tax ? `<tr><td colspan="5" class="n">營業稅 5%</td><td class="n">${fmt(t.tax)}</td></tr>` : ''}<tr><td colspan="5" class="n">總計</td><td class="n">${fmt(t.total)}</td></tr></tfoot></table>
    ${b.note ? `<p>備註：${esc(b.note)}</p>` : ''}
    <div class="sig"><span>經辦：</span><span>${T.party === 'C' ? '客戶簽收' : '廠商確認'}：</span></div>`;
  return { title, css, html, lines: lines.length };
}
