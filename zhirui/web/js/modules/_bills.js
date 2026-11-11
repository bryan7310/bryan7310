// 單據共用：清單、編輯器、列印（銷貨、進貨、報價、採購、出入庫、調撥、收付款）
import { $, $$, esc, fmt, fmtQ, fp4, today, uid, matchQ, qTerms, roc, slash, thisMonth, money, isoOf, downloadText, ls, dayN, lineSeq } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, combo, pager, tabs, printHTML, keepWhile } from '../core/ui.js';
import { TYPES, totals, lineAmt, calc, nextNo, cname, cshort, cdisp, wname, gname, goodsLabel, customers, suppliers, defWh, qtyAt, bqty, uRate, lastSale, unitPrice, unitFactor, setHistPur, setHistSale, histSaleReady, costOf, lineUnit } from '../core/calc.js';
import { api } from '../core/api.js';
import { printName } from '../core/names.js';
import { labelPicker } from './labels.js';
import { faxDialog } from './faxes.js';
import { openMaster } from './master.js';
import { openAsm, asmContent } from './assembly.js';
import { printShip, shipFormat, shipImportLines, shipTemplateXlsx, stockAdjust, specView, billKg, kgText, songquanParse, songquanLines, printSongquan } from './ship.js';

export const billText = b => { const C = calc(); const c = C.ct[b.cid]; return [b.no, c?.code, c?.name, c?.short, b.cn, b.note, ...(b.lines || []).flatMap(l => { const g = C.g[l.gid]; return [g?.code, g?.name, g?.spec, l.n, l.memo]; })].filter(Boolean).join(' '); };
export const partyLabel = b => { const C = calc(); const c = C.ct[b.cid]; return c ? cdisp(c) : (b.cn || '—'); };

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
  const inp = $('#bq', el); if (!inp) return;
  if (inp._zrBind) { inp._zrBind.redraw = redraw; return; }   // 重畫後保留下來的同一個搜尋框：不重複綁
  const box = inp._zrBind = { redraw }; let timer = null;
  const go = () => { ui.q = inp.value; ui.page = 0; clearTimeout(timer); timer = setTimeout(() => { if (!el.isConnected) return; keepWhile(inp, () => box.redraw()); const i = $('#bq', el); if (i && document.activeElement !== i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, delay); };
  inp.addEventListener('input', e2 => { if (e2.isComposing) return; go(); });
  inp.addEventListener('compositionend', go);
}
const csvOf = (name, head, rows) => downloadText(name + '.csv', '﻿' + [head, ...rows].map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n'), 'text/csv');
function billsCsv(title, list, C) {
  const rows = list.map(b => { const T = TYPES[b.type] || {}; const t = C ? (C.tot[b.id] || totals(b)) : totals(b); const ls = (b.lines || []).filter(l => l.txt === undefined); return [slash(b.date), T.name || b.type, b.no, partyLabel(b), ls.map(l => `${l.gid ? gname(l.gid, b.type) : l.n || ''} ×${fmtQ(l.qty)}`).join('；'), b.hist && b.oamt != null ? Math.round(b.oamt) : (T.lines ? Math.round(t.total) : +b.amount || 0), T.lines && T.party && !T.doc && !b.hist ? +b.paid || 0 : '', b.note || '']; });
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
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', e2 => { if (e2.target.closest('button,a')) return; if (tr.dataset.hist) return histView(byId.get(tr.dataset.id), () => { if (el.isConnected) billList(el, opts, ui); }); openBill(null, tr.dataset.id, opts.onSaved); }));
  el.querySelectorAll('[data-hprint]').forEach(b => b.addEventListener('click', () => printBill(byId.get(b.dataset.hprint))));
  el.querySelectorAll('[data-hfax]').forEach(b => b.addEventListener('click', () => faxDialog(byId.get(b.dataset.hfax), () => { if (el.isConnected) billList(el, opts, ui); })));
  opts.bind && opts.bind(el);
}
function billRow(b, opts, C) {
  const T = TYPES[b.type]; const t = C.tot[b.id] || totals(b);
  const lines = (b.lines || []).filter(l => l.txt === undefined);
  const content = b.type === 'ASM' ? asmContent(b) : T.lines ? `${lines.slice(0, 2).map(l => esc(l.gid ? gname(l.gid, b.type) : l.n || '')).join('、')}${lines.length > 2 ? `…等 ${lines.length} 項` : ''}` : esc(b.note || b.cat || '');
  let status = '';
  if (T.lines && T.party && !T.doc) { const due = t.total - (+b.paid || 0); status = due <= 0 ? '<span class="pill ok">已結清</span>' : +b.paid > 0 ? `<span class="pill warn">尚欠 ${fmt(due)}</span>` : '<span class="pill">未收付</span>'; }
  if (b.type === 'SALE' && b.invNo) status += ` <span class="pill blue">發票 ${esc(b.invNo)}</span>`;
  if (b.type === 'QUO' && b.toBill) status += ' <span class="pill ok">已轉銷貨</span>';
  if (b.type === 'PO' && b.received) status += ' <span class="pill ok">已進貨</span>';
  if (b.type === 'PUR' && !b.hist) {   // 進貨單：有單價高於上次進價的行就標出來
    const ws = lines.map(l => { const w = purWarn(b, l, C.g[l.gid], C); return w ? `${gname(l.gid, b.type)} ${fp4(+l.price)}：${w}` : ''; }).filter(Boolean);
    if (ws.length) status += ` <span class="pill bad" title="${esc(ws.join('\n'))}">單價偏高 ${ws.length} 項</span>`;
  }
  if (opts.status) status += opts.status(b);
  if (b.hist) status = '';
  return `<tr class="row" data-id="${b.id}" ${b.hist ? 'data-hist="1"' : ''}><td class="nowrap">${esc(slash(b.date))}</td><td class="mono nowrap">${esc(b.no)}${opts.tabList && opts.tabList.length > 2 ? `<span class="sub">${T.name}</span>` : ''}</td><td class="nowrap">${esc(T.party ? partyLabel(b) : T.transfer ? wname(b.wid) + ' → ' + wname(b.toWid) : wname(b.wid))}</td><td class="muted">${content}</td>${opts.cols ? opts.cols.map(c => `<td class="${c.cls || ''}">${c.cell(b)}</td>`).join('') : ''}<td class="n">${fmt(b.hist ? b.oamt : T.lines ? t.total : b.amount)}</td><td>${status}</td><td class="r nowrap">${b.hist ? (b.type === 'PO' && b.cid ? `<button class="btn xs" data-hfax="${b.id}">傳真</button>` : `<button class="btn xs" data-hprint="${b.id}">列印</button>`) : opts.actions ? opts.actions(b) : ''}</td></tr>`;
}

// ---------- 舊系統歷史單據（唯讀，存在伺服器另一個表，向伺服器查） ----------
const histCache = new Map(), histPending = new Map();
/** 舊系統歷史單據改過（例如合併客戶／供應商）後清掉記憶體快取，下次用新版本重抓 */
export function resetHistCache(stamp) { histCache.clear(); histPending.clear(); if (stamp) store.histVer = stamp; }
/** 整批載入這幾種單據的歷史資料：先看這台瀏覽器的快取（版本相同就直接用），否則向伺服器一次抓 10000 張；載過留在記憶體與快取 */
function histFetch(types) {
  const key = types.join(',');
  if (histCache.has(key)) return Promise.resolve(histCache.get(key));
  if (histPending.has(key)) return histPending.get(key);
  const p = (async () => {
    const stamp = store.histVer || ''; let out = null;
    const c = await store.cacheGet('hist:' + key);
    if (c && c.stamp === stamp && Array.isArray(c.rows)) out = c.rows;
    if (!out) {
      out = [];
      // 伺服器一次只能處理一個查詢，所以逐批依序抓
      for (const type of types) {
        let offset = 0;
        for (;;) { const r = await api.get(`/api/hist/all?type=${encodeURIComponent(type)}&limit=10000&offset=${offset}`); out.push(...r.rows); offset += r.rows.length; if (!r.rows.length || offset >= r.total) break; }
      }
      store.cachePut('hist:' + key, { stamp, rows: out });
    }
    for (const b of out) b.hist = true;
    histCache.set(key, out); histPending.delete(key);
    if (types.includes('PUR')) setHistPur(out.filter(b => b.type === 'PUR'));   // 成本推算也用舊系統進貨單
    if (types.includes('SALE')) setHistSale(out.filter(b => b.type === 'SALE'));   // 上次單價也查舊系統銷貨單
    return out;
  })();
  histPending.set(key, p);
  p.catch(() => histPending.delete(key));
  return p;
}
/** 登入後在背景先把各種歷史單據載好，打開清單時就不用等 */
export const loadHistPur = () => histFetch(['PUR', 'PUR_RET', 'PO']);
export async function preloadHist() {
  for (const types of [['PUR', 'PUR_RET', 'PO'], ['SALE', 'SALE_RET'], ['QUO', 'RFQ']]) {
    try { await histFetch(types); } catch (e) { break; }
    await new Promise(r => setTimeout(r, 300));
  }
}
/** 歷史單據檢視；按「修改」用單據編輯器改，存回舊系統歷史資料（onSaved：存好後通知清單重畫） */
export function histView(b, onSaved) {
  const C = calc(); const T = TYPES[b.type] || {}; const c = C.ct[b.cid]; const lines = b.lines || [];
  const body = `<div class="banner">舊系統搬來的歷史單據，不計入現在的庫存與應付；銷貨單會接在舊系統應收資料之後計入應收帳款。按「修改」可以更正內容。</div>
    <div class="grid" style="margin-bottom:10px"><div><span class="muted small">${T.party === 'S' ? '廠商' : '客戶'}</span><div>${esc(c ? c.name : b.cn || '—')}</div></div><div><span class="muted small">日期</span><div>${esc(slash(b.date))}</div></div><div><span class="muted small">單號</span><div class="mono">${esc(b.no)}</div></div>${b.valid ? `<div><span class="muted small">有效期限</span><div>${esc(slash(b.valid))}</div></div>` : ''}${b.deliv ? `<div><span class="muted small">交期</span><div>${esc(slash(b.deliv))}</div></div>` : ''}</div>
    <div class="tw"><table><thead><tr><th>#</th><th>品名規格</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th class="n">金額</th></tr></thead><tbody>
    ${(seq => lines.map((l, i) => l.txt !== undefined ? `<tr><td></td><td colspan="5" class="muted">${esc(l.txt)}</td></tr>` : `<tr><td class="muted">${seq[i]}</td><td>${esc(l.gid ? gname(l.gid, b.type) : l.n || '')}${l.memo ? `<span class="sub">${esc(l.memo)}</span>` : ''}</td><td class="n">${fmtQ(l.qty)}</td><td class="muted">${esc(l.u || C.g[l.gid]?.unit || '')}</td><td class="n">${fp4(l.price)}</td><td class="n">${fmt(lineAmt(l))}</td></tr>`).join(''))(lineSeq(lines)) || '<tr><td colspan="6" class="muted">沒有明細</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5" class="n">總計</td><td class="n"><b>${fmt(b.oamt != null ? b.oamt : totals(b).total)}</b></td></tr></tfoot></table></div>${b.note ? `<p class="muted small">備註：${esc(b.note)}</p>` : ''}`;
  modal({ title: `${T.name || b.type} ${b.no}`, width: 760, body, footer: '<button class="btn" data-print>列印</button><span class="sp"></span><button class="btn" data-close>關閉</button><button class="btn pri" data-hedit>修改</button>', onOpen(m, close) { m.querySelector('[data-print]').onclick = () => printBill(b); m.querySelector('[data-hedit]').onclick = () => { close(); openHistBill(b, onSaved); }; } });
}

// ---------- 編輯器 ----------
let edit = null, dlg = null, onSavedCb = null;
/** 用單據編輯器修改舊系統歷史單據：存檔寫回伺服器的歷史資料（不變成一般單據，不計庫存帳款） */
export function openHistBill(b, onSaved) {
  onSavedCb = onSaved;
  edit = JSON.parse(JSON.stringify(b)); edit.lines = edit.lines || []; edit.hist = true;
  edit._orig = JSON.parse(JSON.stringify(b)); edit._o0 = b.oamt != null ? +b.oamt : null; edit._s0 = totals({ ...b, hist: false }).total;
  delete edit.oamt;   // 編輯時總額依明細計算；存檔時再換算回舊系統總額
  edit._err = '';
  drawBill();
}
/** 歷史單據改過：更新記憶體與瀏覽器快取，不必整批重抓 */
function histPatch(b, stamp) {
  for (const [key, arr] of histCache) {
    const i = arr.findIndex(x => x.id === b.id); if (i < 0) continue;
    arr[i] = b;
    if (stamp) store.cachePut('hist:' + key, { stamp, rows: arr });
    if (key.split(',').includes('PUR')) setHistPur(arr.filter(x => x.type === 'PUR'));
    if (key.split(',').includes('SALE')) setHistSale(arr.filter(x => x.type === 'SALE'));
  }
  if (stamp) store.histVer = stamp;
}
export function openBill(type, id, onSaved, preset) {
  if (type === 'ASM' || (id && store.get('bills', id)?.type === 'ASM')) return openAsm(id);   // 組包單有自己的畫面
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
  // 舊系統歷史銷貨單還沒載入時先載，載好後幫還沒有單價的明細補上「上次單價」
  if (['SALE', 'SALE_RET', 'QUO'].includes(edit.type) && !histSaleReady()) {
    const cur = edit;
    histFetch(['SALE', 'SALE_RET']).then(() => {
      if (edit !== cur || !dlg) return; const C = calc(); let n = 0;
      cur.lines.forEach(l => { if (l.gid && !(+l.price) && C.g[l.gid] && applyLast(l, C.g[l.gid])) n++; });
      if (n) redrawLines(dlg.el);
    }).catch(() => {});
  }
}
function drawBill() {
  const e = edit, T = TYPES[e.type], C = calc();
  const ship = e.type === 'SALE' || e.type === 'SALE_RET';
  const priced = !T.transfer && e.type !== 'OUT';
  const showCost = ['SALE', 'SALE_RET', 'QUO'].includes(e.type);
  const whs = store.list('warehouses'), accts = store.list('accounts');
  const balHint = T.party && e.cid && C.bal[e.cid] != null && !T.doc ? `<div class="hint muted small">目前${T.party === 'C' ? '應收' : '應付'} ${fmt(C.bal[e.cid])} 元</div>` : '';
  const body = `
    ${e.hist ? '<div class="banner">修改舊系統搬來的歷史單據：存檔只更正這張歷史單據，不計入現在的庫存與應付；銷貨單的金額會反映到應收帳款。</div>' : ''}
    <div class="grid">
      <div class="f"><label for="b-date">單據日期</label><input type="date" id="b-date" value="${esc(e.date)}"></div>
      <div class="f"><label for="b-no">單號</label><input id="b-no" value="${esc(e.no)}" class="mono"></div>
      ${T.party ? `<div class="f" style="grid-column:span 2"><label for="b-cid">${T.party === 'C' ? '客戶' : '供應商'}</label><div class="combo"><input id="b-cid" placeholder="打代號、名稱或簡稱的任何字" value="${esc(partyLabel(e) === '—' ? '' : partyLabel(e))}"></div>${balHint}</div>` : ''}
      ${T.lines && !T.doc && !(ship && whs.length <= 1) ? `<div class="f"><label for="b-wid">${T.transfer ? '調出倉庫' : '倉庫'}</label><select id="b-wid">${whs.map(w => `<option value="${w.id}" ${w.id === e.wid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>` : ''}
      ${T.transfer ? `<div class="f"><label for="b-toWid">調入倉庫</label><select id="b-toWid">${whs.map(w => `<option value="${w.id}" ${w.id === e.toWid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>` : ''}
      ${T.money && !T.lines ? `<div class="f"><label for="b-amount">金額</label><input id="b-amount" class="num" inputmode="decimal" value="${esc(e.amount)}"></div><div class="f"><label for="b-aid">結算帳戶</label><select id="b-aid">${accts.map(a => `<option value="${a.id}" ${a.id === e.aid ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      ${!T.lines && !T.party ? `<div class="f"><label for="b-cat">項目</label><input id="b-cat" value="${esc(e.cat || '')}" placeholder="例如：運費、水電"></div>` : ''}
      ${T.doc ? `<div class="f"><label for="b-valid">${e.type === 'PO' ? '交期' : '有效期限'}</label><input type="date" id="b-valid" value="${esc(e.valid || e.deliv || '')}"></div><div class="f"><label for="b-attn">聯絡人</label><input id="b-attn" value="${esc(e.attn || '')}"></div>` : ''}
    </div>
    ${T.lines ? `<div class="tw"><table class="lines" id="lines"><thead><tr><th style="width:44px" class="c">項次</th><th style="min-width:260px">商品</th><th style="width:100px" class="r">數量</th><th style="width:96px">單位</th>${priced ? '<th style="width:100px" class="r">單價</th><th style="width:90px" class="r">小計</th>' : ''}<th style="width:170px">${ship ? '備註（印在出貨單最後一欄）' : '備註'}</th>${showCost ? '<th style="width:90px" class="r">成本單價</th><th style="width:170px">成本來源</th>' : ''}<th style="width:30px"></th></tr></thead><tbody>${e.lines.map((l, i) => lineRow(l, i)).join('')}</tbody></table></div>
      <div class="tools"><button class="btn sm" id="addLine">＋ 加一行</button><button class="btn sm" id="addTxt">＋ 加備註</button><button class="btn sm" id="newGoods">＋ 新增商品</button>${ship ? '<button class="btn sm" id="xlLines">從 Excel 匯入明細</button><button class="btn sm" id="xlTpl">下載匯入範本</button><span class="muted small">Excel 欄位：客料號、數量、採購單號</span>' : ''}${ship && e.type === 'SALE' ? '<button class="btn sm" id="sqPdf" title="匯入崧泉 ERP 的「訂單出貨憑證」PDF：明細加進這張單，出貨單號、日期等資訊一起記下">匯入崧泉出貨單 PDF</button>' : ''}</div>
      ${ship ? `<div class="sumbox"><div><span>總重（約）</span><b id="t-wt" title="依商品單重計算；沒填單重的用規格估算"></b></div><div><span>商品小計</span><b id="t-sub"></b></div><div><label class="check"><input type="checkbox" id="b-tax" ${e.tax ? 'checked' : ''}> 加 5% 營業稅</label><b id="t-tax"></b></div><div class="big"><span>合計</span><b id="t-total"></b></div></div>`
      : T.party ? `<div class="tools" style="justify-content:flex-end"><label class="check"><input type="checkbox" id="b-tax" ${e.tax ? 'checked' : ''}> 加 5% 營業稅</label><div class="f" style="width:120px"><input id="b-disc" class="num" placeholder="折讓" value="${e.disc || ''}" title="整單折讓金額"></div></div>
        <div class="totals"><div><span>總重（約）</span> <b id="t-wt"></b></div><div><span>小計</span> <b id="t-sub"></b></div><div><span>稅額</span> <b id="t-tax"></b></div><div class="big"><span>總額</span> <b id="t-total"></b></div>${!T.doc ? `<div><span>${T.party === 'C' ? '已收' : '已付'}</span> <input id="b-paid" class="num" style="width:110px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;text-align:right" value="${e.paid || ''}"></div><div><span>結算帳戶</span> <select id="b-aid" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px">${accts.map(a => `<option value="${a.id}" ${a.id === e.aid ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div><div><span>尚欠</span> <b id="t-due"></b></div>` : ''}</div>` : ''}` : ''}
    <div class="f"><label for="b-note">${ship ? '整張單備註（各行都沒填備註時，印在出貨單第一行最後一欄）' : '備註'}</label><textarea id="b-note" style="min-height:44px">${esc(e.note || '')}</textarea></div>
    ${e._err ? `<div class="err">${esc(e._err)}</div>` : ''}`;
  let footer = ship
    ? `<div class="dd" id="prDD"><button class="btn" id="prMenu" aria-haspopup="true" aria-expanded="false">列印 ▾</button><div class="dd-menu" hidden><button class="btn" id="printShip">列印出貨單</button><button class="btn" id="printShipPn" title="品名前加印客料號">料號列印</button><button class="btn" id="printShipNa">列印（不含金額）</button><button class="btn" id="printShipPnNa" title="品名前加印客料號，不印單價、金額">豐餘列印</button>${e.type === 'SALE' ? '<button class="btn" id="printSq" title="照崧泉「訂單出貨憑證」的欄位重印">崧泉列印</button>' : ''}</div></div><button class="btn sm" id="shipFmt" title="調整出貨單格式">格式</button><button class="btn" id="lblBill" ${e.id ? '' : 'title="會先儲存這張單"'}>標籤</button>${e.type === 'SALE' ? `<button class="btn" id="stkAdj" ${e.id ? '' : 'title="會先儲存這張單"'}>調整即時庫存</button>` : ''}<button class="btn danger" id="delBill" ${e.id ? '' : 'disabled title="還沒儲存的單據不用刪除"'}>刪除單據</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="saveBill">儲存</button>`
    : `${e.id ? `<button class="btn danger" id="delBill">刪除</button>` : ''}${e.id && T.doc ? `<button class="btn" id="faxBill">傳真</button>` : ''}${e.id && (e.type === 'QUO' || e.type === 'PO' || e.type === 'PUR') ? `<button class="btn" id="printBill">列印</button>` : ''}${e.id && e.type === 'QUO' && !e.toBill ? `<button class="btn" id="toSale">轉成銷貨單</button>` : ''}${e.id && e.type === 'PO' && !e.received ? `<button class="btn" id="toPur">轉成進貨單</button>` : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="saveBill">儲存</button>`;
  const nav = navList(e.type); const pos = e.id ? nav.findIndex(b => b.id === e.id) : nav.length;
  let headExtra = T.lines ? `<button class="btn sm" id="navPrev" ${pos > 0 ? '' : 'disabled'} title="Alt+←">◀ 上一張</button><button class="btn sm" id="navNext" ${e.id && pos < nav.length - 1 ? '' : 'disabled'} title="Alt+→">下一張 ▶</button><button class="btn sm pri" id="saveBill2" title="Ctrl+S">儲存</button><button class="btn sm" id="dlgMax">${ls.get('zr.billMax', false) ? '還原' : '放大'}</button>` : '';
  if (dlg) dlg.close();
  if (e.hist) footer = footer.replace(/<button[^>]*id="(delBill|stkAdj|faxBill|toSale|toPur)"[^>]*>[^<]*<\/button>/g, '');   // 歷史單據：不能刪除、調庫存、轉單
  if (e.hist) headExtra = headExtra.replace(/<button[^>]*id="nav(Prev|Next)"[^>]*>[^<]*<\/button>/g, '');
  dlg = modal({ title: `${e.id ? '' : '新增'}${T.name}${e.id ? ' ' + e.no : ''}${e.hist ? '（舊系統）' : ''}`, width: T.lines ? 1240 : 760, body, footer, headExtra, closeOnBg: false, onOpen: bindBill, onClose: () => { dlg = null; } });
  if (T.lines && ls.get('zr.billMax', false)) dlg.el.classList.add('max');
}
function navList(type) { return store.list('bills').filter(b => b.type === type && !b.hist).sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.no).localeCompare(String(b.no))); }
function lineRow(l, i) {
  const C = calc(); const g = C.g[l.gid]; const T = TYPES[edit.type];
  const priced = !T.transfer && edit.type !== 'OUT'; const showCost = ['SALE', 'SALE_RET', 'QUO'].includes(edit.type);
  const span = 3 + (priced ? 2 : 0) + 1 + (showCost ? 2 : 0);
  const del = `<td class="c-del"><button class="icon-btn" data-del="${i}" aria-label="刪除這行"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td>`;
  if (l.txt !== undefined) return `<tr data-i="${i}" class="noteln"><td class="c-no"></td><td colspan="${span}"><div style="display:flex;align-items:center;gap:6px"><span class="pill" style="flex:none">備註</span><input data-f="txt" value="${esc(l.txt)}" placeholder="這一行備註，會印在單據上（例如：以上請分兩包裝、急件）"></div></td>${del}</tr>`;
  const have = lineHave(l);
  const units = g ? [[g.unit || 'PCS', g.unit || 'PCS'], ...(g.aunit ? [['a', `${g.aunit}（${fmtQ(g.arate || 1)}）`]] : []), ['H', 'H（百支）'], ['K', 'K（千支）'], ['KG', 'KG'], ['盒', '盒'], ['箱', '箱'], ['件', '件'], ['SET', 'SET']].filter((x, k, a) => a.findIndex(y => y[0] === x[0]) === k) : [];
  let cost = '';
  if (showCost) {
    const r = l.gid ? costOf(l, edit.date) : null; const base = !l.u && l.unit !== 'a';
    cost = `<td class="n small c-c">${l.gid && (!r || r.manual) && base ? `<input class="num" data-gcost="${i}" inputmode="decimal" value="${r ? Math.round(r.c * 10000) / 10000 : ''}" placeholder="填成本" title="查無成本時可自行填入，會存到商品資料的手動成本">` : r ? fp4(r.c) : ''}</td><td class="muted small csrc c-src" title="${r ? esc(r.src) : '查無成本'}">${r ? esc(r.src) : l.gid ? '—' : ''}</td>`;
  }
  const no = lineSeq(edit.lines)[i];
  return `<tr data-i="${i}"><td class="c-no">${no}</td><td class="c-g"><div class="combo"><input data-f="gid" value="${esc(g ? goodsLabel(g, edit.type) : l.n || '')}" placeholder="打料號、品名、客料號搜尋"></div>${have != null ? `<div class="have ${(T.stock === -1 || T.transfer) && bqty(l, g) > have ? 'bad' : ''}">${esc(wname(edit.wid))}庫存 ${fmtQ(have)} ${esc(g?.unit || '')}</div>` : ''}${l._lp ? `<div class="lp">${esc(l._lp)}</div>` : ''}${g ? `<div class="glinks"><a href="#" data-spec="${i}">規格・圖面${g.dwg ? '（附客戶圖）' : ''}</a><a href="#" data-gedit="${i}">修改商品</a>${edit.cid ? `<a href="#" data-ghist="${i}" title="這個${T.party === 'S' ? '廠商' : '客戶'}、這個商品的歷史交易">歷史明細</a>` : ''}</div>` : ''}</td>
    <td class="c-q"><input data-f="qty" class="num" inputmode="decimal" value="${esc(l.qty)}"></td>
    <td class="c-u">${g ? `<select data-f="unit">${units.map(([v, lb]) => `<option value="${v}" ${(l.unit === 'a' ? 'a' : l.u || g.unit || 'PCS') === v ? 'selected' : ''}>${esc(lb)}</option>`).join('')}</select>` : `<input data-f="nu" value="${esc(l.unit || '')}" placeholder="單位">`}</td>
    ${priced ? `<td class="c-p"><input data-f="price" class="num" inputmode="decimal" value="${esc(l.price)}">${(w => w ? `<div class="pwarn">${esc(w)}</div>` : '')(priceWarn(l, g))}</td><td class="n c-s" id="ls-${i}">${fmt(lineAmt(l))}</td>` : ''}
    <td class="c-m"><input data-f="memo" value="${esc(l.memo || '')}" placeholder="${edit.type === 'SALE' || edit.type === 'SALE_RET' ? '例如採購單號' : ''}"></td>
    ${cost}${del}</tr>`;
}
/** 歷史明細：某客戶／廠商與某商品的全部交易（新平台單據＋舊系統歷史單據） */
/** 商品的歷史銷貨（kind='S'）或進貨（kind='P'）明細：所有客戶／廠商，新平台＋舊系統 */
export async function goodsHistory(gid, kind) {
  const C = calc(); const g = C.g[gid]; if (!g) return;
  const sale = kind === 'S'; const types = sale ? ['SALE', 'SALE_RET'] : ['PUR', 'PUR_RET'];
  const unitOf = l => l.unit === 'a' ? (g.aunit || '') : (l.u || g.unit || '');
  const live = store.list('bills').filter(b => types.includes(b.type)).flatMap(b => (b.lines || []).filter(l => l.gid === gid).map(l => ({ date: b.date || '', type: b.type, no: b.no, id: b.id, cid: b.cid, qty: +l.qty || 0, unit: unitOf(l), price: +l.price || 0, amt: lineAmt(l) })));
  const m = modal({ title: `歷史${sale ? '銷貨' : '進貨'}明細｜${g.name}`, width: 860, body: '<div class="muted">載入中…</div>', footer: '<span class="muted small" id="ghSum"></span><span class="sp"></span><button class="btn" data-close>關閉</button>' });
  let hist = [];
  try { const r = await api.histPrices(gid, 2000); hist = (r.rows || []).filter(x => types.includes(x.type)).map(x => ({ date: x.date || '', type: x.type, no: x.no, hist: true, cid: x.cid, qty: +x.qty || 0, unit: x.u || g.unit || '', price: +x.price || 0, amt: lineAmt({ qty: x.qty, price: x.price, u: x.u }) })); } catch (e) { /* 舊單據載入失敗就只顯示新平台的 */ }
  const all = [...live, ...hist].sort((a, b) => b.date.localeCompare(a.date) || String(b.no).localeCompare(String(a.no)));
  const mb = m.el.querySelector('.mb'); const who = sale ? '客戶' : '廠商';
  mb.innerHTML = all.length ? `<div class="tw"><table><thead><tr><th>日期</th><th>單據</th><th>單號</th><th>${who}</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th class="n">金額</th></tr></thead><tbody>${all.map(x => `<tr ${x.id ? `class="row" data-open="${x.id}"` : ''}><td class="nowrap">${esc(slash(x.date))}</td><td class="nowrap">${esc(TYPES[x.type]?.name || x.type)}${x.hist ? '<span class="muted small">（舊）</span>' : ''}</td><td class="mono">${esc(x.no || '')}</td><td>${esc(cdisp(C.ct[x.cid]) || '')}</td><td class="n">${fmtQ(x.qty)}</td><td>${esc(x.unit)}</td><td class="n">${fp4(x.price)}</td><td class="n">${fmt(x.amt)}</td></tr>`).join('')}</tbody></table></div><p class="muted small" style="margin:8px 0 0">點新平台的單據可以打開；（舊）是舊系統搬來的，單價 0 的明細不列。</p>`
    : `<div class="empty"><b>沒有${sale ? '銷貨' : '進貨'}紀錄</b>新平台和舊系統都查不到這個商品的${sale ? '銷貨' : '進貨'}單</div>`;
  const tq = all.reduce((s, x) => s + (x.type.endsWith('_RET') ? -x.qty : x.qty), 0); const last = all.find(x => x.price > 0);
  m.el.querySelector('#ghSum').textContent = all.length ? `共 ${all.length} 筆・${new Set(all.map(x => x.cid).filter(Boolean)).size} 家${who}・數量合計 ${fmtQ(tq)}${last ? `・最近單價 ${fp4(last.price)}（${slash(last.date)}）` : ''}` : '';
  mb.querySelectorAll('[data-open]').forEach(tr => tr.addEventListener('click', () => { const b = store.get('bills', tr.dataset.open); if (b) { m.close(); openBill(b.type, b.id); } }));
}
export async function lineHistory(gid, cid) {
  const C = calc(); const g = C.g[gid]; const c = C.ct[cid]; if (!g || !c) return;
  const sale = c.kind === 'C';
  const types = sale ? ['SALE', 'SALE_RET', 'QUO'] : ['PUR', 'PUR_RET', 'PO', 'RFQ'];
  const unitOf = (l, gg) => l.unit === 'a' ? (gg?.aunit || '') : (l.u || gg?.unit || '');
  const live = store.list('bills').filter(b => b.cid === cid && types.includes(b.type)).flatMap(b => (b.lines || []).filter(l => l.gid === gid).map(l => ({ date: b.date || '', type: b.type, no: b.no, id: b.id, qty: +l.qty || 0, unit: unitOf(l, g), price: +l.price || 0, amt: lineAmt(l) })));
  const m = modal({ title: `歷史明細｜${cdisp(c)}・${g.name}`, width: 760, body: '<div class="muted">載入中…</div>', footer: '<span class="muted small" id="lhSum"></span><span class="sp"></span><button class="btn" data-close>關閉</button>' });
  let hist = [];
  try { const r = await api.histPrices(gid, 200, cid); hist = (r.rows || []).filter(x => x.cid === cid).map(x => ({ date: x.date || '', type: x.type, no: x.no, hist: true, qty: +x.qty || 0, unit: x.u || g.unit || '', price: +x.price || 0, amt: Math.round((+x.qty || 0) * (+x.price || 0)) })); } catch (e) { /* 舊單據載入失敗就只顯示新平台的 */ }
  const all = [...live, ...hist].sort((a, b) => b.date.localeCompare(a.date) || String(b.no).localeCompare(String(a.no)));
  const mb = m.el.querySelector('.mb');
  mb.innerHTML = all.length ? `<div class="tw"><table><thead><tr><th>日期</th><th>單據</th><th>單號</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th class="n">金額</th></tr></thead><tbody>${all.map(x => `<tr ${x.id ? `class="row" data-open="${x.id}"` : ''}><td class="nowrap">${esc(slash(x.date))}</td><td>${esc(TYPES[x.type]?.name || x.type)}${x.hist ? '<span class="muted small">（舊）</span>' : ''}</td><td class="mono">${esc(x.no || '')}</td><td class="n">${fmtQ(x.qty)}</td><td>${esc(x.unit)}</td><td class="n">${fp4(x.price)}</td><td class="n">${fmt(x.amt)}</td></tr>`).join('')}</tbody></table></div><p class="muted small" style="margin:8px 0 0">點新平台的單據可直接打開；「舊」是舊系統匯入的歷史單據。</p>` : '<div class="empty"><b>沒有交易紀錄</b>這個商品還沒跟這個對象交易過</div>';
  const tq = all.reduce((s, x) => s + x.qty, 0); const last = all.find(x => x.price > 0);
  m.el.querySelector('#lhSum').textContent = all.length ? `共 ${all.length} 筆・數量合計 ${fmtQ(tq)}${last ? `・最近單價 ${fp4(last.price)}（${slash(last.date)}）` : ''}` : '';
  mb.querySelectorAll('[data-open]').forEach(tr => tr.addEventListener('click', () => { const b = store.get('bills', tr.dataset.open); if (b) { m.close(); openBill(b.type, b.id); } }));
}
function lineHave(l) { if (!l.gid || !edit || !edit.wid || TYPES[edit.type].doc) return null; return qtyAt(l.gid, edit.wid); }
function bindBill(el, close) {
  const e = edit, T = TYPES[e.type], C = calc();
  const v = (id, f) => { const x = el.querySelector('#' + id); if (x) x.addEventListener('input', () => { f(x.value); e._dirty = true; updateTotals(el); }); };
  v('b-date', x => e.date = x); v('b-no', x => e.no = x); v('b-note', x => e.note = x); v('b-amount', x => e.amount = x); v('b-cat', x => e.cat = x); v('b-paid', x => e.paid = x); v('b-disc', x => e.disc = x); v('b-valid', x => { if (e.type === 'PO') e.deliv = x; else e.valid = x; }); v('b-attn', x => e.attn = x);
  ['b-wid', 'b-toWid', 'b-aid'].forEach(id => { const x = el.querySelector('#' + id); if (x) x.addEventListener('change', () => { e[id.slice(2)] = x.value; if (id === 'b-wid') redrawLines(el); }); });
  const tax = el.querySelector('#b-tax'); if (tax) tax.addEventListener('change', () => { e.tax = tax.checked; updateTotals(el); });
  const cid = el.querySelector('#b-cid');
  if (cid) combo(cid, { items: () => (T.party === 'C' ? customers() : suppliers()).map(c => ({ id: c.id, label: c.short || c.name, sub: [c.code, c.short ? c.name : ''].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { e.cid = it.id; e._dirty = true; e.lines.forEach((l, i) => { if (l.gid && !l.price && C.g[l.gid]) applyLast(l, C.g[l.gid]); }); redrawLines(el); const h = el.querySelector('#b-cid').closest('.f').querySelector('.hint'); const bal = calc().bal[e.cid]; if (!T.doc && bal != null) { const t = `目前${T.party === 'C' ? '應收' : '應付'} ${fmt(bal)} 元`; if (h) h.textContent = t; else el.querySelector('#b-cid').closest('.f').insertAdjacentHTML('beforeend', `<div class="hint muted small">${esc(t)}</div>`); } }, onClear: () => { e.cid = ''; } });
  bindLines(el);
  el.querySelector('#addLine')?.addEventListener('click', () => { e.lines.push({ gid: '', qty: '', price: '' }); redrawLines(el); setTimeout(() => el.querySelector(`tr[data-i="${e.lines.length - 1}"] input`)?.focus(), 0); });
  el.querySelector('#addTxt')?.addEventListener('click', () => { e.lines.push({ txt: '' }); redrawLines(el); setTimeout(() => el.querySelector(`tr[data-i="${e.lines.length - 1}"] input`)?.focus(), 0); });
  el.querySelector('#newGoods')?.addEventListener('click', () => openMaster('goods', null, null, gid => {
    // 新商品放到最後一個空白行，沒有就加一行
    let l = e.lines.find(x => x.txt === undefined && !x.gid && !x.n && !+x.qty); if (!l) { l = { gid: '', qty: '', price: '' }; e.lines.push(l); }
    const g = calc().g[gid]; l.gid = gid; if (g) { const p = unitPrice(g, e.type); if (p !== '') l.price = p; } redrawLines(el);
  }));
  const xf = document.createElement('input'); xf.type = 'file'; xf.accept = '.xlsx,.xls,.csv';
  xf.onchange = async () => {
    const f = xf.files[0]; xf.value = ''; if (!f) return;
    try {
      const r = await shipImportLines(f, e);
      e.lines = e.lines.filter(l => l.gid || +l.qty || (l.txt !== undefined && String(l.txt).trim())).concat(r.add); e.lines.push({ gid: '', qty: '', price: '' });
      redrawLines(el);
      toast(`已加入 ${r.add.length} 項${r.miss.length ? `；找不到 ${r.miss.length} 個客料號：${r.miss.slice(0, 5).join('、')}${r.miss.length > 5 ? '…' : ''}` : ''}${r.multi.length ? `；${r.multi.length} 個客料號對到多個商品，已選上次賣過的` : ''}`);
    } catch (err) { toast('匯入失敗：' + (err.message || err)); }
  };
  el.querySelector('#xlLines')?.addEventListener('click', () => { if (!e.cid) toast('建議先選客戶，才能帶入上次單價'); xf.click(); });
  el.querySelector('#xlTpl')?.addEventListener('click', () => shipTemplateXlsx().catch(err => toast('下載失敗：' + (err.message || err))));
  el.querySelector('#saveBill').addEventListener('click', () => saveBill(close));
  el.querySelector('#saveBill2')?.addEventListener('click', () => saveBill(close));
  el.querySelector('#delBill')?.addEventListener('click', async () => { if (await confirm(`確定刪除 ${T.name} ${e.no}？`, { danger: true, ok: '刪除' })) { await store.remove('bills', e.id); store.log('刪除', `${T.name} ${e.no}`); close(); toast('已刪除'); onSavedCb && onSavedCb(); } });
  el.querySelector('#printBill')?.addEventListener('click', () => printBill(e));
  // 還沒儲存的單：列印直接用畫面上的內容；標籤、調整即時庫存要先儲存
  const hasLines = () => e.lines.some(l => l.txt === undefined && (l.gid || l.n) && +l.qty > 0) || (toast('請先輸入商品和數量'), false);
  const afterSave = fn => () => e.id ? fn(e) : saveBill(close, fn);
  el.querySelector('#printShip')?.addEventListener('click', () => hasLines() && printShip(e));
  el.querySelector('#printShipPn')?.addEventListener('click', () => hasLines() && printShip(e, { pn: true }));
  el.querySelector('#printShipNa')?.addEventListener('click', () => hasLines() && printShip(e, { noAmt: true }));
  el.querySelector('#printShipPnNa')?.addEventListener('click', () => hasLines() && printShip(e, { pn: true, noAmt: true }));
  el.querySelector('#printSq')?.addEventListener('click', () => hasLines() && printSongquan(e));
  // 列印下拉選單
  const prDD = el.querySelector('#prDD');
  if (prDD) {
    const menu = prDD.querySelector('.dd-menu'), btn = prDD.querySelector('#prMenu');
    const show = v => { menu.hidden = !v; btn.setAttribute('aria-expanded', String(v)); };
    btn.addEventListener('click', ev => { ev.stopPropagation(); show(menu.hidden); });
    menu.addEventListener('click', () => show(false));
    el.addEventListener('click', ev => { if (!prDD.contains(ev.target)) show(false); });
  }
  // 匯入崧泉 ERP 出貨單 PDF
  const sqf = document.createElement('input'); sqf.type = 'file'; sqf.accept = '.pdf,application/pdf';
  sqf.onchange = async () => {
    const f = sqf.files[0]; sqf.value = ''; if (!f) return;
    try {
      const P = await songquanParse(f);
      if ((e.sq || []).some(s => s.sn === P.head.sn) && !await confirm(`崧泉出貨單 ${P.head.sn} 已經匯入過這張單，還要再匯入一次嗎？`, { ok: '再匯入' })) return;
      if (!e.cid) { const cs = customers(); const c = cs.find(x => /崧泉/.test(x.name) && !/分公司/.test(x.name)) || cs.find(x => /崧泉/.test(x.name)); if (c) e.cid = c.id; }
      else if (!/崧泉/.test(store.get('contacts', e.cid)?.name || '')) toast('提醒：這張單的客戶不是崧泉');
      const fresh = !e.id && !e.lines.some(l => l.gid || l.n || (l.txt !== undefined && String(l.txt).trim()));
      if (fresh && /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(P.head.date)) { const [y, m, d] = P.head.date.split('/'); e.date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; }
      const r = songquanLines(P, e);
      e.sq = [...(e.sq || []).filter(s => s.sn !== P.head.sn), P.head];
      const tag = `崧泉出貨單 ${P.head.sn}（出貨日 ${P.head.date}${P.head.inv ? `、發票 ${P.head.inv}` : ''}）`;
      if (!String(e.note || '').includes(P.head.sn)) e.note = [String(e.note || '').trim(), tag].filter(Boolean).join('\n');
      e.lines = e.lines.filter(l => l.gid || l.n || +l.qty || (l.txt !== undefined && String(l.txt).trim())).concat(r.add); e.lines.push({ gid: '', qty: '', price: '' });
      drawBill();
      toast(`已匯入崧泉出貨單 ${P.head.sn}：${r.add.length} 項${r.miss.length ? `；${r.miss.length} 項找不到商品（已用品名先填，請從清單選商品）：${r.miss.slice(0, 4).join('、')}` : ''}${r.multi.length ? `；${r.multi.length} 個品號對到多個商品，已選上次賣過的` : ''}`);
    } catch (err) { toast('匯入失敗：' + (err.message || err)); }
  };
  el.querySelector('#sqPdf')?.addEventListener('click', () => sqf.click());
  el.querySelector('#shipFmt')?.addEventListener('click', () => shipFormat(e));
  el.querySelector('#stkAdj')?.addEventListener('click', afterSave(b => stockAdjust(b)));
  el.querySelector('#lblBill')?.addEventListener('click', afterSave(b => labelPicker(b)));
  el.querySelector('#faxBill')?.addEventListener('click', () => faxDialog(e, () => drawBill()));
  el.querySelector('#toSale')?.addEventListener('click', () => convertBill(e, 'SALE', close));
  el.querySelector('#toPur')?.addEventListener('click', () => convertBill(e, 'PUR', close));
  // 上一張／下一張、放大
  const go = async d => {
    if (e.hist) return;
    const nav = navList(e.type); const i = e.id ? nav.findIndex(b => b.id === e.id) : nav.length; const j = i + d;
    if (j < 0 || j >= nav.length) return toast(d < 0 ? '已經是第一張' : '已經是最後一張');
    if (e._dirty && !await confirm('這張單有修改還沒儲存，要放棄修改嗎？', { ok: '放棄修改' })) return;
    openBill(null, nav[j].id, onSavedCb);
  };
  el.querySelector('#navPrev')?.addEventListener('click', () => go(-1));
  el.querySelector('#navNext')?.addEventListener('click', () => go(1));
  el.querySelector('#dlgMax')?.addEventListener('click', ev => { const on = el.classList.toggle('max'); ev.target.textContent = on ? '還原' : '放大'; ls.set('zr.billMax', on); });
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.ctrlKey) saveBill(close);
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) { ev.preventDefault(); document.activeElement?.blur?.(); setTimeout(() => saveBill(close), 0); }
    if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); go(ev.key === 'ArrowLeft' ? -1 : 1); }
  });
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
/** 單價提醒：進貨單高於上次進價（優先同一廠商）；出貨單低於同客戶上次單價或低於成本 */
/** 進貨單某一行的單價是否高於上次進價（同廠商優先）；回傳提醒文字或空字串。編輯畫面與進貨單列表共用 */
function purWarn(b, l, g, C) {
  if (!g || !l.gid) return ''; const p = +l.price; if (!(p > 0)) return '';
  const [cls, f] = lineUnit(l, g);
  const d0 = dayN(b.date || today());
  const li = (C.purIdx[g.id] || []).filter(x => x.cls === cls && x.d <= d0 && x.no !== b.no).sort((a, c) => c.d - a.d);
  const x = li.find(y => y.cid && y.cid === b.cid) || li[0]; if (!x) return '';
  const last = x.per * f;
  // 高出 0.5% 以上才算（上次進價常只記到小數 3 位，0.2223 對 0.222 這種是四捨五入差，不提醒）
  return p > last * 1.005 ? `高於上次進價 ${fp4(last)}（${slash(x.date)} ${x.no}${x.cid && x.cid !== b.cid ? '・' + cdisp(C.ct[x.cid]) : ''}）` : '';
}
function priceWarn(l, g) {
  if (!g || !l.gid) return ''; const p = +l.price; if (!(p > 0)) return '';
  const C = calc(); const [cls, f] = lineUnit(l, g);
  if (edit.type === 'PUR') return purWarn(edit, l, g, C);
  if (edit.type === 'SALE') {
    const out = [];
    const x = lastSale(edit.cid, g.id, edit.date, edit.id);
    if (x) {
      let c2, perBase;
      if (x.u) { const [c, f2] = unitFactor(x.u); c2 = c; perBase = x.price / f2; }
      else if (x.unit === 'a' && g.aunit) { c2 = unitFactor(g.unit || '')[0]; perBase = x.price / (+x.rate || +g.arate || 1); }
      else { c2 = unitFactor(g.unit || '')[0]; perBase = x.price; }
      if (c2 === cls) { const last = perBase * f; if (p < last * 0.9999) out.push(`低於上次單價 ${fp4(last)}（${slash(x.date)}）`); }
    }
    const r = costOf(l, edit.date) || costOf(l, edit.date, null, null, null, true);
    if (r && p < r.c * 0.9999) out.push(`低於成本 ${fp4(r.c)}`);
    return out.join('；');
  }
  return '';
}
function showWarn(tr, l) {
  const td = tr.querySelector('[data-f="price"]')?.closest('td'); if (!td) return;
  const w = priceWarn(l, calc().g[l.gid]); let d = td.querySelector('.pwarn');
  if (!w) { d?.remove(); return; }
  if (!d) { d = document.createElement('div'); d.className = 'pwarn'; td.appendChild(d); }
  d.textContent = w;
}
function bindLines(el) {
  const C = calc();
  el.querySelectorAll('#lines tbody tr').forEach(tr => {
    const i = +tr.dataset.i, l = edit.lines[i];
    tr.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (f === 'gid') {
        combo(inp, {
          items: () => store.list('goods').map(g => ({ id: g.id, label: goodsLabel(g, edit.type), sub: g.unit || '', text: goodsLabel(g) + ' ' + (g.vcode || '') })), allowFree: TYPES[edit.type].doc,
          onPick: it => { const g = C.g[it.id]; l.gid = it.id; delete l.n; l.u = ''; l.unit = ''; delete l.rate; if (!applyLast(l, g)) { const p = unitPrice(g, edit.type); if (p !== '') l.price = p; } if (!l.qty) l.qty = ''; redrawLines(el); setTimeout(() => el.querySelector(`tr[data-i="${i}"] [data-f="qty"]`)?.focus(), 0); },
          onBlur: val => { if (!l.gid && TYPES[edit.type].doc) { l.n = val; } },
        });
      } else if (f === 'unit') inp.addEventListener('change', () => { const g = C.g[l.gid]; if (inp.value === 'a') { l.unit = 'a'; l.rate = +g.arate || 1; l.u = ''; } else { l.unit = ''; delete l.rate; l.u = inp.value === (g.unit || 'PCS') ? '' : inp.value; } redrawLines(el); });
      else inp.addEventListener('input', () => { edit._dirty = true; l[f === 'nu' ? 'unit' : f] = inp.value; if (f === 'qty' || f === 'price') { delete l._lp; showWarn(tr, l); } updateTotals(el); });
    });
    tr.querySelector('[data-spec]')?.addEventListener('click', ev => { ev.preventDefault(); const g = calc().g[l.gid]; if (g) specView(g); });
    tr.querySelector('[data-gedit]')?.addEventListener('click', ev => { ev.preventDefault(); const g = store.get('goods', l.gid); if (g) openMaster('goods', g, null, (id, info) => { if (info?.created) { l.gid = id; edit._dirty = true; } redrawLines(el); }, null, { fromBill: true }); });
    tr.querySelector('[data-ghist]')?.addEventListener('click', ev => { ev.preventDefault(); if (l.gid && edit.cid) lineHistory(l.gid, edit.cid); });
    tr.querySelector('[data-gcost]')?.addEventListener('change', async ev => { const v = +String(ev.target.value).replace(/,/g, ''); const g = store.get('goods', l.gid); if (!g || !(v > 0)) return; const { id, ...rest } = g; await store.save('goods', id, { ...rest, cost: v }); toast(`已存到商品「${g.name}」的手動成本`); redrawLines(el); });
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
  st('#t-wt', kgText(billKg(e)));
  st('#t-sub', fmt(t.sub)); st('#t-tax', e.tax ? fmt(t.tax) : '—'); st('#t-total', fmt(t.total)); st('#t-due', fmt(t.total - (+e.paid || 0)));
}
async function saveBill(close, then) {
  const e = edit, T = TYPES[e.type]; let err = '';
  const C = calc();
  if (!e.date) err = '請填單據日期';
  else if (!String(e.no).trim()) err = '請填單號';
  else if (!e.hist && store.list('bills').some(b => b.no === e.no.trim() && b.id !== e.id && b.type === e.type && !b.hist)) err = '單號重複';
  else if (T.party && !e.cid && !(e.hist && e.cn)) err = `請選擇${T.party === 'C' ? '客戶' : '供應商'}`;
  if (!err && T.lines && !T.doc && !e.wid && !e.hist) err = '請選擇倉庫';
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
  if (T.lines) { doc.wid = e.wid; doc.lines = e.lines.map(l => { if (l.txt !== undefined) return { txt: String(l.txt).trim() }; const o = { gid: l.gid || '', qty: +l.qty || 0, price: +l.price || 0 }; if (!l.gid && l.n) { o.n = l.n; if (l.unit) o.unit = l.unit; } if (l.u) o.u = l.u; if (l.sq) o.sq = l.sq; if (String(l.memo || '').trim()) o.memo = String(l.memo).trim(); if (l.unit === 'a' && +l.rate > 1) { o.unit = 'a'; o.rate = +l.rate; } else if (l.u && l.gid) { const r = uRate(l.u, C.g[l.gid]); if (r && r !== 1) o.rate = r; } if (l.batch) o.batch = l.batch; return o; }); }
  if (T.transfer) doc.toWid = e.toWid;
  if (T.doc) { doc.disc = +e.disc || 0; doc.tax = !!e.tax; for (const k of ['attn', 'valid', 'deliv', 'payterm', 'toBill', 'received', 'fromQuote', 'orderId']) if (e[k]) doc[k] = e[k]; delete doc.wid; }
  else if (T.lines && T.party) { doc.disc = +e.disc || 0; doc.tax = !!e.tax; doc.paid = +e.paid || 0; doc.aid = e.aid || ''; for (const k of ['invNo', 'fromQuote', 'fromPO', 'sq']) if (e[k]) doc[k] = e[k]; }
  if (T.money && !T.lines) { doc.aid = e.aid || ''; doc.amount = +e.amount || 0; if (e.cat) doc.cat = e.cat; for (const k of ['ref', 'checkId']) if (e[k]) doc[k] = e[k]; }
  if (e.hist) { doc.hist = true; if (e.cn) doc.cn = e.cn; if (e.oamt != null) doc.oamt = e.oamt; }
  doc.createdBy = e.createdBy || store.user.id; if (e.id) doc.updatedBy = store.user.id;
  if (e.hist) return saveHist(e, T, { ...e._orig, ...doc, id }, close);
  try { await store.save('bills', id, doc); } catch (err2) { toast('儲存失敗：' + err2.message); return; }
  store.log(e.id ? '修改' : '新增', `${T.name} ${doc.no}${T.party ? '｜' + cname(doc.cid) : ''}｜${fmt(T.lines ? totals(doc).total : doc.amount)} 元`);
  close(); toast(`${T.name} ${doc.no} 已儲存`);
  onSavedCb && onSavedCb({ ...doc, id });
  if (then) { openBill(null, id, onSavedCb); setTimeout(() => edit && edit.id === id && then(edit), 50); }   // 儲存後重新打開這張單，再做標籤／調整庫存
}
// 歷史單據存檔：總額依明細重算（舊系統總額含稅或另有差額時，照原本的差距換算）
async function saveHist(e, T, doc, close) {
  if (!doc.wid) delete doc.wid;
  const sub = totals({ ...doc, hist: false }).total, o0 = e._o0, s0 = e._s0;
  doc.oamt = o0 == null || Math.abs(o0 - s0) < 1.5 ? sub : Math.abs(o0 - Math.round(s0 * 1.05)) < 2 ? Math.round(sub * 1.05) : Math.round(o0 + sub - s0);
  doc.hist = true;
  let r; try { r = await api.post('/api/hist/save', doc); } catch (err2) { toast('儲存失敗：' + err2.message); return; }
  histPatch(doc, r.stamp);
  store.log('修改', `舊系統${T.name} ${doc.no}${T.party ? '｜' + (doc.cid ? cname(doc.cid) : doc.cn || '') : ''}｜${fmt(doc.oamt)} 元`);
  close(); toast(`舊系統${T.name} ${doc.no} 已更正`);
  onSavedCb && onSavedCb(doc);
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
  const seq = lineSeq(lines);
  const rows = lines.map((l, i) => l.txt !== undefined ? `<tr><td></td><td colspan="5">${esc(l.txt)}</td></tr>` : `<tr><td class="c">${seq[i]}</td><td>${esc(l.gid ? gname(l.gid, b.type) : l.n || '')}${l.memo ? `<small> ${esc(l.memo)}</small>` : ''}</td><td class="n">${fmtQ(l.qty)}</td><td>${esc(l.unit === 'a' ? (C.g[l.gid]?.aunit || '') : l.u || C.g[l.gid]?.unit || l.unit || '')}</td><td class="n">${fp4(l.price)}</td><td class="n">${fmt(lineAmt(l))}</td></tr>`).join('');
  const css = `@page{size:A4;margin:12mm}body{font-family:"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif;font-size:11pt;color:#000;margin:0}h1{text-align:center;font-size:18pt;margin:0 0 2mm}.co{text-align:center;font-size:10pt;margin-bottom:4mm}.meta{display:grid;grid-template-columns:1fr 1fr;gap:1mm 10mm;margin-bottom:4mm;font-size:10.5pt}table{width:100%;border-collapse:collapse}th,td{border:.5pt solid #000;padding:1.5mm 2mm;text-align:left}th{background:#eee;font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}td.c{text-align:center}small{color:#555}tfoot td{font-weight:600}.sig{display:flex;justify-content:space-between;margin-top:12mm;font-size:10.5pt}.sig span{flex:1}`;
  const html = `<div class="co">${esc(co.name || '志瑞螺絲企業有限公司')}　統編 ${esc(co.taxId || '')}　電話 ${esc(co.phone || '')}　傳真 ${esc(co.fax || '')}<br>${esc(co.addr || '')}</div><h1>${esc(title)}</h1>
    <div class="meta"><div>${T.party === 'C' ? '客戶' : '廠商'}：${esc(c.name ? printName(c.name) : (b.cn || ''))}</div><div>單號：${esc(b.no)}</div><div>電話：${esc(c.phone || '')}</div><div>日期：${esc(slash(b.date))}</div><div>地址：${esc(c.addr || '')}</div><div>${b.type === 'PO' && b.deliv ? '交期：' + esc(slash(b.deliv)) : b.type === 'QUO' && b.valid ? '有效期限：' + esc(slash(b.valid)) : ''}</div></div>
    <table><thead><tr><th style="width:8mm">#</th><th>品名規格</th><th class="n" style="width:22mm">數量</th><th style="width:14mm">單位</th><th class="n" style="width:22mm">單價</th><th class="n" style="width:26mm">金額</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5" class="n">小計</td><td class="n">${fmt(t.sub)}</td></tr>${b.disc ? `<tr><td colspan="5" class="n">折讓</td><td class="n">-${fmt(b.disc)}</td></tr>` : ''}${b.tax ? `<tr><td colspan="5" class="n">營業稅 5%</td><td class="n">${fmt(t.tax)}</td></tr>` : ''}<tr><td colspan="5" class="n">總計</td><td class="n">${fmt(t.total)}</td></tr></tfoot></table>
    ${b.note ? `<p>備註：${esc(b.note)}</p>` : ''}
    <div class="sig"><span>經辦：</span><span>${T.party === 'C' ? '客戶簽收' : '廠商確認'}：</span></div>`;
  return { title, css, html, lines: lines.length };
}
