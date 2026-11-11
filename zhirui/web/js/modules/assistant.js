// AI 助理：用中文問平台資料、請它擬單據草稿（存檔一定要使用者自己按）
// 工具都在瀏覽器執行（直接用平台現有的庫存、應收應付、上次單價計算），伺服器 /api/agent 只負責呼叫 Claude
import { $, esc, fmt, fmtQ, fp4, today, thisMonth, shiftMonth, qTerms, matchQ, ls, uid, money, toHalf } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, isTouch } from '../core/ui.js';
import { calc, TYPES, totals, goodsLabel, cdisp, lastSale, costOf, nextNo, wname, unitFactor } from '../core/calc.js';
import { api } from '../core/api.js';
import { openBill, billText } from './_bills.js';
import { arRows } from './receivables.js';
import { queueFax, faxDial, faxPill } from './faxes.js';
import { editPurch } from './invoices.js';
import { preOf, reviewChecks } from './checks_in.js';
import { addrDialog } from './labels.js';
import { apRows } from './payables.js';

const ui = { conv: [], busy: false, stop: false, err: '', usd: 0, steps: 0 };
const DRAFTS = new Map();   // tool_use_id → 草稿
const FAXES = new Map();    // tool_use_id → 待確認的傳真 { billId, to, cover, job }
const CARDS = new Map();    // tool_use_id → 其他確認卡：{ kind: 'pinv'|'checks'|'addr', ... }
export default {
  id: 'assistant', name: 'AI 助理', group: '業務', icon: 'ai',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && ch.has('faxjobs') && FAXES.size && !ui.busy) draw(this.el); },
};

// ---------- 工具定義（給 Claude 看的說明） ----------
const S = (props, req = []) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const str = d => ({ type: 'string', description: d }), int = d => ({ type: 'integer', description: d });
const BILL_T = ['QUO', 'SALE', 'SALE_RET', 'PO', 'PUR', 'PUR_RET', 'RFQ', 'IN', 'OUT', 'TRANSFER', 'ASM'];
const TOOLS = [
  { name: 'find_goods', description: '用料號、品名、規格、客料號搜尋商品，回傳候選商品（含 id、庫存、售價、進價）。多個關鍵字用空白隔開，全部都要符合。', input_schema: S({ query: str('關鍵字，例如「M6*20 三價」或「A2AM6」'), limit: int('最多幾筆，預設 15') }, ['query']) },
  { name: 'goods_detail', description: '一個商品的完整資料：各倉庫存、目前成本、配方（螺絲包）與最多可組包數、最近的進銷紀錄（含舊系統）。', input_schema: S({ goods_id: str('商品 id（find_goods 回傳的 id）') }, ['goods_id']) },
  { name: 'find_contacts', description: '搜尋客戶或供應商（名稱、簡稱、編號、別名），回傳 id 與基本資料。', input_schema: S({ query: str('關鍵字'), kind: { type: 'string', enum: ['customer', 'supplier', 'any'], description: '客戶、供應商或不限，預設不限' } }, ['query']) },
  { name: 'contact_detail', description: '一個客戶／供應商的資料、未收（應收）或未付（應付）月份與金額、最近單據。', input_schema: S({ contact_id: str('客戶或供應商 id') }, ['contact_id']) },
  { name: 'price_history', description: '某商品的歷史單價（銷貨、報價、進貨、採購，含舊系統）；給 contact_id 就只看那個客戶或供應商，並附上「上次單價」。', input_schema: S({ goods_id: str('商品 id'), contact_id: str('客戶或供應商 id，可省略') }, ['goods_id']) },
  { name: 'search_bills', description: '搜尋單據（新平台＋舊系統），可依種類、對象、商品、日期、關鍵字篩選，回傳摘要（最新的在前）。', input_schema: S({ type: { type: 'string', enum: BILL_T, description: 'QUO 報價單、SALE 銷貨單、SALE_RET 銷貨退回、PO 採購單、PUR 進貨單、PUR_RET 進貨退出、RFQ 詢價單、IN 其他入庫、OUT 其他出庫、TRANSFER 調撥、ASM 組包單' }, contact_id: str('客戶或供應商 id'), goods_id: str('商品 id'), date_from: str('起日 YYYY-MM-DD'), date_to: str('迄日 YYYY-MM-DD'), keyword: str('單號、備註等關鍵字'), limit: int('最多幾張，預設 15') }) },
  { name: 'bill_detail', description: '用單號查一張單據的完整明細。', input_schema: S({ bill_no: str('單號') }, ['bill_no']) },
  { name: 'receivables', description: '應收帳款。給 month 看那個月各客戶的應收；不給 month 就列出所有未收款（含逾期）。月份以 25 日結帳。', input_schema: S({ month: str('YYYY-MM，可省略'), contact_id: str('只看某客戶，可省略') }) },
  { name: 'payables', description: '應付帳款。給 month 看那個月各供應商的應付；不給 month 就列出所有還沒付款的。月份以 25 日結帳。', input_schema: S({ month: str('YYYY-MM，可省略'), contact_id: str('只看某供應商，可省略') }) },
  { name: 'stock_alerts', description: '低於安全庫存、或庫存是負數的商品。', input_schema: S({}) },
  { name: 'checks', description: '支票：out＝開給供應商的支票（待列印、待兌現），in＝收到的客票（依到期日）。', input_schema: S({ kind: { type: 'string', enum: ['out', 'in'] }, date_from: str('到期日起 YYYY-MM-DD，可省略'), date_to: str('到期日迄 YYYY-MM-DD，可省略') }, ['kind']) },
  { name: 'fax_bill', description: '準備傳真一張報價單、採購單或詢價單給對方。只會顯示確認卡（對象、號碼），使用者按「確認傳真」後由傳真小幫手自動印到 PC-FAX 送出；這個工具本身不會送出。fax_number 省略就用對方資料上的傳真號碼。', input_schema: S({ bill_no: str('單號'), fax_number: str('傳真號碼，可省略'), cover: { type: 'boolean', description: '要不要加傳真封面頁，預設不加' } }, ['bill_no']) },
  { name: 'purchase_invoice_draft', description: '把辨識到的進項發票（廠商開給志瑞的發票，可一次多張）整理成登記卡。卡片顯示在畫面上，使用者按「全部登記」或逐張「開啟」後才會存進「發票作業 → 進項發票」。期別（申報月）預設用發票日期的月份。', input_schema: S({ invoices: { type: 'array', items: S({ date: str('發票日期 YYYY-MM-DD'), no: str('發票號碼，例如 AB12345678'), seller: str('賣方（廠商）名稱'), seller_tax_id: str('賣方統一編號'), untaxed: { type: 'number', description: '未稅金額（銷售額）' }, tax: { type: 'number', description: '稅額' }, period: str('申報月 YYYY-MM，可省略'), kind: { type: 'string', enum: ['進項', '固定資產', '不可扣抵', '其他'] }, note: str('備註，可省略') }, ['date', 'no', 'seller', 'untaxed', 'tax']) } }, ['invoices']) },
  { name: 'checks_in_draft', description: '把辨識到的客票（客戶開給志瑞的支票，可一次多張）整理成登記卡。使用者按「逐張登記」後會打開「登記客票」逐張核對再存。', input_schema: S({ checks: { type: 'array', items: S({ drawer: str('發票人（印章或抬頭上的公司名）'), bank: str('付款銀行'), branch: str('分行'), checkNo: str('支票號碼'), account: str('帳號'), amount: { type: 'number', description: '金額' }, dueDate: str('到期日 YYYY-MM-DD（民國年要換成西元）'), notes: str('看不清楚或要注意的地方') }, ['amount']) } }, ['checks']) },
  { name: 'address_label', description: '幫使用者印某個客戶或供應商的地址標籤（5×4 cm）：顯示一張卡，使用者按「地址列印」會打開地址標籤視窗（自動查 3+3 郵遞區號），再按列印。', input_schema: S({ contact_id: str('客戶或供應商 id（先用 find_contacts 查）'), copies: int('張數，預設 1') }, ['contact_id']) },
  { name: 'draft_bill', description: '擬一張單據草稿（報價單 QUO、銷貨單 SALE、採購單 PO、進貨單 PUR）。草稿只顯示在畫面上，使用者按「開啟草稿」檢查後自己存檔；這個工具不會存檔。price 省略時：QUO／SALE 用該客戶上次單價，PO／PUR 用該廠商上次進價。', input_schema: S({ type: { type: 'string', enum: ['QUO', 'SALE', 'PO', 'PUR'] }, contact_id: str('客戶（QUO、SALE）或供應商（PO、PUR）id'), date: str('日期 YYYY-MM-DD，省略＝今天'), note: str('備註，可省略'), lines: { type: 'array', items: S({ goods_id: str('商品 id；系統裡找不到這個商品時省略，改填 name'), name: str('找不到商品時的品名（照單據寫）'), qty: { type: 'number', description: '數量（商品的基本單位）' }, price: { type: 'number', description: '單價，可省略' }, memo: str('這一行的備註，例如客戶採購單號，可省略') }, ['qty']) } }, ['type', 'contact_id', 'lines']) },
];
const LABEL = {
  find_goods: i => `查商品「${i.query}」`, goods_detail: i => `看商品 ${gcode(i.goods_id)}`, find_contacts: i => `查客戶／廠商「${i.query}」`,
  contact_detail: i => `看 ${cname(i.contact_id)} 的資料`, price_history: i => `查 ${gcode(i.goods_id)} 的歷史單價${i.contact_id ? `（${cname(i.contact_id)}）` : ''}`,
  search_bills: i => `搜尋單據${[i.type && TYPES[i.type]?.name, i.contact_id && cname(i.contact_id), i.goods_id && gcode(i.goods_id), i.keyword].filter(Boolean).map(x => '・' + x).join('')}`,
  bill_detail: i => `看單據 ${i.bill_no}`, receivables: i => `看應收帳款${i.month ? ' ' + i.month : '（未收）'}`, payables: i => `看應付帳款${i.month ? ' ' + i.month : '（未付）'}`,
  stock_alerts: () => '看低庫存商品', fax_bill: i => `準備傳真 ${i.bill_no}`, purchase_invoice_draft: i => `整理 ${(i.invoices || []).length} 張進項發票`, checks_in_draft: i => `整理 ${(i.checks || []).length} 張客票`, address_label: i => `準備 ${cname(i.contact_id)} 的地址標籤`, checks: i => i.kind === 'out' ? '看開出的支票' : '看收到的客票', draft_bill: i => `擬 ${TYPES[i.type]?.name || '單據'} 草稿`,
};
const gcode = id => store.get('goods', id)?.code || id;
const cname = id => { const c = store.get('contacts', id); return c ? cdisp(c) : id; };

// ---------- 工具實作 ----------
const r2 = n => Math.round((+n || 0) * 100) / 100;
function gInfo(g, C) {
  const st = C.stock[g.id] || {}; const tot = Object.values(st).reduce((a, b) => a + b, 0);
  const o = { id: g.id, 料號: g.code || '', 品名: g.name, 單位: g.unit || '', 庫存合計: r2(tot) };
  if (g.spec) o.客料號 = g.spec; if (g.spec2) o.第二客料號 = g.spec2; if (g.custName) o.客戶品名 = g.custName;
  const byWh = Object.entries(st).filter(([, q]) => q).map(([w, q]) => `${wname(w)} ${r2(q)}`); if (byWh.length > 1 || (byWh.length && !st[Object.keys(st)[0]])) o.各倉 = byWh.join('、');
  if (+g.salePrice) o.售價 = +g.salePrice; if (+g.purPrice) o.進價 = +g.purPrice; if (+g.safety) o.安全庫存 = +g.safety;
  if ((g.bom || []).length) o.螺絲包 = `配方 ${g.bom.length} 種零件`;
  return o;
}
const kind = c => c.kind === 'S' ? '供應商' : '客戶';
const lineTxt = l => { const g = calc().g[l.gid]; return `${g ? g.code || g.name : l.n || ''}×${fmtQ(l.qty)}${l.u ? l.u : ''}${+l.price ? '@' + fp4(+l.price) : ''}`; };
function billSum(b) {
  const T = TYPES[b.type] || {}; const t = b.hist ? totals(b) : (calc().tot[b.id] || totals(b));
  const ls = (b.lines || []).filter(l => l.txt === undefined && (l.gid || l.n));
  const o = { 單號: b.no, 種類: T.name || b.type, 日期: b.date, 對象: b.cid ? cname(b.cid) : (b.cn || '') };
  if (T.lines) { o.金額 = Math.round(t.total); o.明細 = ls.slice(0, 4).map(lineTxt).join('、') + (ls.length > 4 ? ` 等 ${ls.length} 項` : ''); } else o.金額 = +b.amount || 0;
  if (b.type === 'ASM' && b.kit) o.明細 = `${gcode(b.kit.gid)} × ${b.kit.qty}`;
  if (b.note) o.備註 = String(b.note).slice(0, 60);
  if (b.hist) o.舊系統 = true;
  return o;
}
function arOpenRows(cid) {
  const out = []; let ym = thisMonth();
  for (let k = 0; k < 24; k++, ym = shiftMonth(ym, -1)) for (const r of arRows(ym)) if (!r.rec && r.total > 0 && (!cid || r.cid === cid)) out.push(r);
  return out;
}
function apOpenRows(cid) {
  const out = []; let ym = shiftMonth(thisMonth(), 1);
  for (let k = 0; k < 24; k++, ym = shiftMonth(ym, -1)) for (const r of apRows(ym)) if (r.pay == null && r.total > 0 && (!cid || r.cid === cid)) out.push(r);
  return out;
}
const arOut = r => ({ 月份: r.ym, 客戶: r.name, 貨款: Math.round(r.amt), 稅: Math.round(r.tax), 總額: Math.round(r.total), ...(r.rec ? { 已收: true, 收款日: r.recDate || '' } : {}), ...(r.due ? { 預計收款: r.due } : {}), ...(r.method ? { 方式: r.method } : {}) });
const apOut = r => ({ 月份: r.ym, 廠商: r.name, 貨款: Math.round(r.amt), 稅: Math.round(r.tax), 總額: Math.round(r.total), ...(r.pay != null ? { 已付: true, 付款日: r.payDate || '' } : {}), ...(r.dueDate ? { 兌現日: r.dueDate } : {}), ...(r.checkId ? { 已開支票: true } : {}) });

export async function runTool(name, input, id) {   // export：方便測試
  const C = calc(); input = input || {};
  switch (name) {
    case 'find_goods': {
      const q = qTerms(input.query || ''); if (!q.length) return { 錯誤: '請給關鍵字' };
      const lim = Math.min(Math.max(+input.limit || 15, 1), 40);
      const exact = String(input.query).trim().toUpperCase();
      const hits = store.list('goods').filter(g => matchQ([g.code, g.name, g.spec, g.spec2, g.custName, g.vcode].filter(Boolean).join(' '), q));
      hits.sort((a, b) => (String(b.code).toUpperCase() === exact) - (String(a.code).toUpperCase() === exact) || Object.values(C.stock[b.id] || {}).reduce((x, y) => x + y, 0) - Object.values(C.stock[a.id] || {}).reduce((x, y) => x + y, 0));
      return { 共: hits.length, 商品: hits.slice(0, lim).map(g => gInfo(g, C)) };
    }
    case 'goods_detail': {
      const g = C.g[input.goods_id]; if (!g) return { 錯誤: '找不到這個商品 id' };
      const o = gInfo(g, C); const st = C.stock[g.id] || {};
      o.各倉 = Object.entries(st).map(([w, q]) => `${wname(w)} ${r2(q)}`).join('、') || '沒有庫存紀錄';
      const ck = costOf({ gid: g.id, qty: 1 }, today(), null, null, null, true); if (ck) o.目前成本 = { 每單位: r2(ck.c), 來源: ck.src };
      if (g.note) o.備註 = g.note;
      if ((g.bom || []).length) {
        let maxN = Infinity;
        o.配方 = g.bom.map(x => { const cg = C.g[x.gid]; const have = x.cust ? ((C.stock[x.gid] || {})[g.cwid] || 0) : Object.entries(C.stock[x.gid] || {}).filter(([wid]) => wid !== g.cwid).reduce((a, [, q]) => a + q, 0); if (+x.qty > 0) maxN = Math.min(maxN, Math.floor(have / x.qty)); return { 零件: cg ? `${cg.code} ${cg.name}` : x.gid, 每包: x.qty, 來源: x.cust ? '客供' : '自備', 現有: r2(have) }; });
        o.最多可組 = maxN === Infinity ? 0 : Math.max(0, maxN); if (+g.labor) o.每包工錢 = +g.labor;
      }
      const live = C.bills.filter(b => !TYPES[b.type]?.doc || b.type === 'QUO').flatMap(b => (b.lines || []).filter(l => l.gid === g.id).map(l => ({ 日期: b.date, 單號: b.no, 種類: TYPES[b.type]?.name, 對象: b.cid ? cname(b.cid) : '', 數量: l.qty, 單價: +l.price || 0 })));
      const h = await api.histPrices(g.id, 15).catch(() => ({ rows: [] }));
      o.最近進銷 = [...live, ...(h.rows || []).map(x => ({ 日期: x.date, 單號: x.no, 種類: TYPES[x.type]?.name || x.type, 對象: x.cid ? cname(x.cid) : '', 數量: x.qty, 單價: x.price, 舊系統: true }))].sort((a, b) => String(b.日期).localeCompare(String(a.日期))).slice(0, 15);
      return o;
    }
    case 'find_contacts': {
      const q = qTerms(input.query || ''); const k = input.kind === 'customer' ? 'C' : input.kind === 'supplier' ? 'S' : '';
      const hits = store.list('contacts').filter(c => (!k || c.kind === k) && matchQ([c.code, c.name, c.short, ...(c.aliases || [])].join(' '), q));
      hits.sort((a, b) => !!a.inactive - !!b.inactive);
      return { 共: hits.length, 對象: hits.slice(0, 20).map(c => ({ id: c.id, 種類: kind(c), 編號: c.code || '', 簡稱: cdisp(c), 全名: c.name, ...(c.inactive ? { 停用: true } : {}), ...(c.phone ? { 電話: c.phone } : {}) })) };
    }
    case 'contact_detail': {
      const c = C.ct[input.contact_id]; if (!c) return { 錯誤: '找不到這個 id' };
      const o = { id: c.id, 種類: kind(c), 編號: c.code || '', 簡稱: cdisp(c), 全名: c.name };
      for (const [k, l] of [['taxId', '統編'], ['person', '聯絡人'], ['phone', '電話'], ['fax', '傳真'], ['addr', '地址'], ['payMethod', '付款方式'], ['note', '備註']]) if (c[k]) o[l] = c[k];
      if (c.kind === 'S') { const rows = apOpenRows(c.id); o.未付 = rows.map(apOut); o.未付合計 = Math.round(rows.reduce((s, r) => s + r.total, 0)); }
      else { const rows = arOpenRows(c.id); o.未收 = rows.map(arOut); o.未收合計 = Math.round(rows.reduce((s, r) => s + r.total, 0)); }
      const live = C.bills.filter(b => b.cid === c.id).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8).map(billSum);
      const h = await api.hist({ cid: c.id, limit: 8 }).catch(() => ({ rows: [] }));
      o.最近單據 = [...live, ...(h.rows || []).map(b => billSum({ ...b, hist: true }))].sort((a, b) => String(b.日期).localeCompare(String(a.日期))).slice(0, 10);
      return o;
    }
    case 'price_history': {
      const g = C.g[input.goods_id]; if (!g) return { 錯誤: '找不到這個商品 id' };
      const cid = input.contact_id || '';
      const live = C.bills.filter(b => ['SALE', 'QUO', 'PUR', 'PO'].includes(b.type) && (!cid || b.cid === cid)).flatMap(b => (b.lines || []).filter(l => l.gid === g.id && +l.price > 0).map(l => ({ 日期: b.date, 單號: b.no, 種類: TYPES[b.type].name, 對象: b.cid ? cname(b.cid) : '', 數量: l.qty, 單位: l.u || g.unit || '', 單價: +l.price })));
      const h = await api.histPrices(g.id, 30, cid).catch(() => ({ rows: [] }));
      const rows = [...live, ...(h.rows || []).map(x => ({ 日期: x.date, 單號: x.no, 種類: TYPES[x.type]?.name || x.type, 對象: x.cid ? cname(x.cid) : '', 數量: x.qty, 單位: x.u || g.unit || '', 單價: x.price, 舊系統: true }))].sort((a, b) => String(b.日期).localeCompare(String(a.日期))).slice(0, 20);
      const o = { 商品: `${g.code} ${g.name}`, 單位: g.unit || '', 紀錄: rows };
      if (cid && C.ct[cid]?.kind === 'C') { const ls = lastSale(cid, g.id); if (ls) o.上次銷貨單價 = { 單價: ls.price, 日期: ls.date, 單號: ls.no, ...(ls.u ? { 單位: ls.u } : {}) }; }
      return o;
    }
    case 'search_bills': {
      const lim = Math.min(Math.max(+input.limit || 15, 1), 40);
      const f = b => (!input.type || b.type === input.type) && (!input.contact_id || b.cid === input.contact_id) && (!input.goods_id || (b.lines || []).some(l => l.gid === input.goods_id) || b.kit?.gid === input.goods_id) && (!input.date_from || b.date >= input.date_from) && (!input.date_to || b.date <= input.date_to) && (!input.keyword || matchQ(billText(b), input.keyword));
      const live = C.bills.filter(f);
      const p = { limit: lim }; if (input.contact_id) p.cid = input.contact_id; if (input.goods_id) p.gid = input.goods_id; if (input.type) p.type = input.type; if (input.keyword) p.q = input.keyword; if (input.date_from) p.from = input.date_from; if (input.date_to) p.to = input.date_to;
      const h = ['IN', 'OUT', 'TRANSFER', 'ASM'].includes(input.type) ? { rows: [], total: 0 } : await api.hist(p).catch(() => ({ rows: [], total: 0 }));
      const all = [...live, ...(h.rows || []).map(b => ({ ...b, hist: true }))].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no)));
      return { 新平台: live.length, 舊系統: h.total || 0, 單據: all.slice(0, lim).map(billSum) };
    }
    case 'bill_detail': {
      const no = String(input.bill_no || '').trim(); if (!no) return { 錯誤: '請給單號' };
      const same = C.bills.filter(x => x.no === no); let b = same.find(x => TYPES[x.type]?.lines && !['IN', 'OUT'].includes(x.type)) || same[0];
      if (!b) { const h = await api.hist({ q: no, limit: 10 }).catch(() => ({ rows: [] })); b = (h.rows || []).find(x => x.no === no); if (b) b = { ...b, hist: true }; }
      if (!b) return { 錯誤: `找不到單號 ${no}` };
      const o = billSum(b); delete o.明細;
      o.明細 = (b.lines || []).filter(l => l.txt === undefined).map(l => { const g = C.g[l.gid]; return { 料號: g?.code || '', 品名: g ? g.name : l.n || '', 數量: l.qty, 單位: l.u || g?.unit || '', 單價: +l.price || 0, 金額: Math.round((+l.qty || 0) * (+l.price || 0)), ...(l.memo ? { 備註: l.memo } : {}) }; });
      if (TYPES[b.type]?.lines) { const t = b.hist ? totals(b) : C.tot[b.id] || totals(b); o.未稅 = Math.round(t.net); o.稅 = Math.round(t.tax); o.總額 = Math.round(t.total); }
      return o;
    }
    case 'receivables': {
      const rows = input.month ? arRows(input.month).filter(r => !input.contact_id || r.cid === input.contact_id) : arOpenRows(input.contact_id);
      const late = r => !r.rec && ((r.due && r.due < today()) || (!r.due && shiftMonth(r.ym, 2) + '-15' < today()));
      return { 範圍: input.month ? `${input.month}（${shiftMonth(input.month, -1)}-26 ～ ${input.month}-25）` : '所有未收款', 筆數: rows.length, 總額: Math.round(rows.reduce((s, r) => s + r.total, 0)), 未收: Math.round(rows.filter(r => !r.rec).reduce((s, r) => s + r.total, 0)), 明細: rows.slice(0, 60).map(r => ({ ...arOut(r), ...(late(r) ? { 逾期: true } : {}) })) };
    }
    case 'payables': {
      const rows = input.month ? apRows(input.month).filter(r => !input.contact_id || r.cid === input.contact_id) : apOpenRows(input.contact_id);
      return { 範圍: input.month ? `${input.month}（${shiftMonth(input.month, -1)}-26 ～ ${input.month}-25）` : '所有未付款', 筆數: rows.length, 總額: Math.round(rows.reduce((s, r) => s + r.total, 0)), 明細: rows.slice(0, 60).map(apOut) };
    }
    case 'stock_alerts': {
      const all = g => Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0);
      const low = store.list('goods').filter(g => +g.safety > 0 && all(g) < +g.safety).map(g => ({ ...gInfo(g, C), 缺: r2(+g.safety - all(g)) }));
      const neg = store.list('goods').filter(g => all(g) < 0 && !(+g.safety > 0 && all(g) < +g.safety)).map(g => gInfo(g, C));
      return { 低於安全庫存: low.slice(0, 50), 庫存負數: neg.slice(0, 30), 低於安全庫存筆數: low.length, 負數筆數: neg.length };
    }
    case 'checks': {
      const inR = d => (!input.date_from || d >= input.date_from) && (!input.date_to || d <= input.date_to);
      if (input.kind === 'out') {
        const rows = store.list('checks_out').filter(c => inR(c.date || '')).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return { 筆數: rows.length, 合計: Math.round(rows.reduce((s, c) => s + (+c.amount || 0), 0)), 支票: rows.slice(0, 60).map(c => ({ 兌現日: c.date, 抬頭: c.payee || '', 廠商: c.cid ? cname(c.cid) : '', 金額: +c.amount || 0, 票號: c.no || '', 狀態: c.printedAt ? (c.date < today() ? '已兌現' : '已列印') : '待列印', ...(c.note ? { 備註: c.note } : {}) })) };
      }
      const rows = store.list('checks_in').filter(c => inR(c.due || '')).sort((a, b) => String(a.due).localeCompare(String(b.due)));
      return { 筆數: rows.length, 合計: Math.round(rows.reduce((s, c) => s + (+c.amt || 0), 0)), 支票: rows.slice(-60).map(c => ({ 到期日: c.due, 發票人: c.name || '', 客戶: c.cid ? cname(c.cid) : '', 銀行: c.bank || '', 票號: c.no || '', 金額: +c.amt || 0, ...(c.recv ? { 收票日: c.recv } : {}) })) };
    }
    case 'fax_bill': {
      const no = String(input.bill_no || '').trim(); const b = C.bills.find(x => x.no === no && ['QUO', 'PO', 'RFQ'].includes(x.type)) || C.bills.find(x => x.no === no);
      if (!b) return { 錯誤: `新平台找不到單號 ${no}（舊系統的單據不能傳真；草稿要先存檔才有單號）` };
      const T = TYPES[b.type]; if (!['QUO', 'PO', 'RFQ'].includes(b.type)) return { 錯誤: `${T?.name || b.type} 不能用傳真，只有報價單、採購單、詢價單可以` };
      const c = C.ct[b.cid]; if (!c) return { 錯誤: '這張單沒有客戶／廠商' };
      const to = String(input.fax_number || b.faxTo || c.fax || '').trim();
      if (!to) return { 錯誤: `${cdisp(c)} 的資料沒有傳真號碼，請問使用者號碼` };
      FAXES.set(id, { billId: b.id, to, cover: !!input.cover });
      return { 狀態: '確認卡已顯示，使用者按「確認傳真」才會送出', 單據: `${T.name} ${b.no}`, 對象: cdisp(c), 傳真號碼: to, 撥號: faxDial(c, to), ...((b.faxLog || []).length ? { 之前傳過: b.faxLog.slice(-2).map(x => `${String(x.at).slice(0, 10)} → ${x.to}`) } : {}) };
    }
    case 'purchase_invoice_draft': {
      const list = (input.invoices || []).map(v => {
        const tid = String(v.seller_tax_id || '').replace(/\D/g, '');
        const sup = (tid && store.list('contacts').find(c => c.kind === 'S' && String(c.taxId || '').replace(/\D/g, '') === tid)) || store.list('contacts').find(c => c.kind === 'S' && matchQ([c.name, c.short, ...(c.aliases || [])].join(' '), String(v.seller || '').replace(/(股份)?有限公司|企業社|工業|實業/g, ' ').trim()));
        const no = toHalf(String(v.no || '')).replace(/[\s-]/g, '').toUpperCase();
        const dup = store.list('purch_invoices').find(x => x.no === no);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date || '') ? v.date : today();
        return { date, period: /^\d{4}-\d{2}$/.test(v.period || '') ? v.period : date.slice(0, 7), no, name: sup ? sup.name : String(v.seller || ''), cid: sup?.id, taxId: tid, untaxed: Math.round(+v.untaxed || 0), tax: Math.round(+v.tax || 0), kind: v.kind || '進項', note: String(v.note || ''), dup: dup ? dup.id : '' };
      });
      if (!list.length) return { 錯誤: '沒有發票' };
      CARDS.set(id, { kind: 'pinv', list });
      return { 狀態: '登記卡已顯示，使用者按「全部登記」或逐張開啟後才會存檔', 發票: list.map(v => ({ 號碼: v.no, 日期: v.date, 期別: v.period, 廠商: v.name, 對到廠商資料: !!v.cid, 未稅: v.untaxed, 稅: v.tax, ...(v.dup ? { 已經登記過: true } : {}), ...(Math.abs(Math.round(v.untaxed * 0.05) - v.tax) > 1 ? { 注意: '稅額不是未稅的 5%' } : {}) })) };
    }
    case 'checks_in_draft': {
      const list = (input.checks || []).filter(c => +c.amount > 0).map(c => preOf(c));
      if (!list.length) return { 錯誤: '沒有支票（金額要大於 0）' };
      CARDS.set(id, { kind: 'checks', list });
      return { 狀態: '登記卡已顯示，使用者按「逐張登記」核對後才會存', 支票: list.map(c => ({ 發票人: c._ocr.drawer, 對到客戶: c.cid ? cname(c.cid) : '（沒對到）', 銀行: c.bank, 票號: c.no, 金額: c.amt, 到期日: c.due, ...(store.list('checks_in').some(x => x.no && x.no === c.no) ? { 已經登記過: true } : {}) })) };
    }
    case 'address_label': {
      const c = C.ct[input.contact_id]; if (!c) return { 錯誤: '找不到這個 id，請先用 find_contacts 查' };
      CARDS.set(id, { kind: 'addr', cid: c.id, copies: Math.max(1, +input.copies || 1) });
      return { 狀態: '已顯示「地址列印」按鈕，使用者按下去會打開地址標籤視窗並自動查郵遞區號，再按列印', 對象: cdisp(c), 地址: c.addr || '（資料上沒有地址，視窗裡要先填；填了會預設勾選「存回資料」，下次就有）' };
    }
    case 'draft_bill': {
      const T = TYPES[input.type]; if (!T || !['QUO', 'SALE', 'PO', 'PUR'].includes(input.type)) return { 錯誤: '只能擬報價單、銷貨單、採購單、進貨單' };
      const c = C.ct[input.contact_id]; if (!c) return { 錯誤: '找不到客戶／供應商 id，請先用 find_contacts 查' };
      const sale = input.type === 'QUO' || input.type === 'SALE';
      if (sale && c.kind !== 'C') return { 錯誤: `${cdisp(c)} 是供應商，報價單、銷貨單要給客戶` };
      if (!sale && c.kind !== 'S') return { 錯誤: `${cdisp(c)} 是客戶，採購單、進貨單要給供應商` };
      const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : today();
      const errs = [], lines = [], notes = [];
      for (const [i, l] of (input.lines || []).entries()) {
        if (!(+l.qty > 0)) { errs.push(`第 ${i + 1} 行數量不對`); continue; }
        const g = l.goods_id ? C.g[l.goods_id] : null;
        if (!g) { if (l.goods_id || !l.name) { errs.push(`第 ${i + 1} 行找不到商品${l.goods_id ? ' id ' + l.goods_id : ''}（找不到的請省略 goods_id、填 name）`); continue; } const fl = { n: String(l.name), qty: +l.qty, price: l.price != null && +l.price >= 0 ? +l.price : '' }; if (l.memo) fl.memo = String(l.memo); lines.push(fl); notes.push(`「${l.name}」系統裡沒有這個商品，先用文字行，存檔前請選商品或新增商品`); continue; }
        const line = { gid: g.id, qty: +l.qty, price: '' }; if (l.memo) line.memo = String(l.memo);
        if (l.price != null && +l.price >= 0) line.price = +l.price;
        else if (sale) { const ls = lastSale(c.id, g.id, date); if (ls) { line.price = ls.price; if (ls.u) line.u = ls.u; if (ls.unit) line.unit = ls.unit; if (ls.rate) line.rate = ls.rate; notes.push(`${g.code} 用上次單價 ${fp4(ls.price)}（${ls.date} ${ls.no}）`); } else { notes.push(`${g.code} 沒有這個客戶的上次單價，單價留空`); } }
        else { const px = (C.purIdx[g.id] || []).filter(x => x.cid === c.id && x.cls === unitFactor(g.unit || '')[0]).sort((a, b) => b.d - a.d)[0]; if (px) { line.price = r2(px.per * unitFactor(g.unit || '')[1] * 10000) / 10000; notes.push(`${g.code} 用上次進價 ${fp4(line.price)}（${px.date} ${px.no}）`); } else if (+g.purPrice) { line.price = +g.purPrice; notes.push(`${g.code} 用商品進價 ${fp4(g.purPrice)}`); } else notes.push(`${g.code} 沒有進價，單價留空`); }
        lines.push(line);
      }
      if (errs.length) return { 錯誤: errs.join('；') };
      if (!lines.length) return { 錯誤: '沒有明細' };
      const d = { type: input.type, cid: c.id, date, note: String(input.note || ''), lines };
      DRAFTS.set(id, d);
      const amt = Math.round(lines.reduce((s, l) => s + (+l.qty || 0) * (+l.price || 0), 0));
      return { 狀態: '草稿已顯示在畫面上，還沒存檔；請使用者按「開啟草稿」檢查後自己存檔', 單據: T.name, 對象: cdisp(c), 日期: date, 未稅合計: amt, 明細: lines.map(lineTxt), 單價說明: notes };
    }
  }
  return { 錯誤: '沒有這個工具' };
}

// ---------- 對話流程（瀏覽器跑工具迴圈） ----------
const WEEK = '日一二三四五六';
const datePrefix = () => { const d = new Date(); return `[今天 ${today()}（星期${WEEK[d.getDay()]}）]\n`; };
const PRICE = { in: 4, out: 20, cr: 0.2, cw: 5 };   // Claude Opus 5.5 每百萬 token 美元
function addCost(u) { if (!u) return; ui.usd += ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out + (u.cache_read_input_tokens || 0) * PRICE.cr + (u.cache_creation_input_tokens || 0) * PRICE.cw) / 1e6; }
function save() { try { sessionStorage.setItem('zr.ai', JSON.stringify({ conv: ui.conv, usd: ui.usd, drafts: [...DRAFTS], faxes: [...FAXES], cards: [...CARDS] })); } catch (e) { /* 太大或不能存就算了 */ } }
function load() { try { const s = JSON.parse(sessionStorage.getItem('zr.ai') || 'null'); if (s && !ui.conv.length) { ui.conv = s.conv || []; ui.usd = s.usd || 0; for (const [k, v] of s.drafts || []) DRAFTS.set(k, v); for (const [k, v] of s.faxes || []) FAXES.set(k, v); for (const [k, v] of s.cards || []) CARDS.set(k, v); } } catch (e) { /* 忽略 */ } }
load();

async function loop(el) {
  ui.busy = true; ui.stop = false; ui.err = ''; draw(el);
  try {
    for (let step = 0; step < 20; step++) {
      const r = await api.post('/api/agent', { messages: ui.conv, tools: TOOLS });
      addCost(r.usage);
      ui.conv.push({ role: 'assistant', content: r.content || [] }); save(); draw(el);
      if (r.stop_reason === 'pause_turn') continue;
      if (r.stop_reason === 'refusal') { ui.err = 'AI 拒絕回答這個問題，請換個說法。'; break; }
      if (r.stop_reason === 'max_tokens') { ui.err = '回答太長被截斷了，可以請它「接著說」或縮小範圍。'; }
      const uses = (r.content || []).filter(b => b.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !uses.length) break;
      const results = [];
      for (const u of uses) {
        if (ui.stop) { results.push({ type: 'tool_result', tool_use_id: u.id, content: '使用者按了停止，沒有執行。', is_error: true }); continue; }
        let out, bad = false;
        try { out = await runTool(u.name, u.input, u.id); bad = !!(out && out.錯誤); } catch (e) { out = { 錯誤: String(e.message || e) }; bad = true; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), ...(bad ? { is_error: true } : {}) });
      }
      ui.conv.push({ role: 'user', content: results }); save();
      if (ui.stop) break;
    }
  } catch (e) { ui.err = e.status === 404 || /not found/i.test(e.message || '') ? '伺服器還沒更新，請到「設定備份」重新啟動伺服器後再試。' : (e.message || String(e)); }
  ui.busy = false; save(); draw(el);
  if (ui.speak && !ui.err) { const last = ui.conv.at(-1); if (last?.role === 'assistant') speak((last.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')); }
}
function send(el, text) {
  text = String(text || '').trim(); if ((!text && !ui.att.length) || ui.busy) return;
  const att = ui.att.map(a => a.kind === 'pdf' ? { type: 'document', title: a.name, source: { type: 'base64', media_type: 'application/pdf', data: a.data } } : { type: 'image', source: { type: 'base64', media_type: a.media, data: a.data } });
  ui.att = [];
  ui.conv.push({ role: 'user', content: [...att, { type: 'text', text: datePrefix() + (text || '請看附件是什麼文件，幫我辨識並處理（發票→進項發票、廠商出貨單→進貨單、支票→支票登記）。') }] });
  save(); loop(el);
}
ui.att = [];
function shrink(file, max = 2000, q = 0.85) {
  return new Promise((ok, bad) => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src); ok(cv.toDataURL('image/jpeg', q)); }; img.onerror = () => bad(new Error('讀不了這張圖片')); img.src = URL.createObjectURL(file); });
}
const b64 = file => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(r.error); r.readAsDataURL(file); });
async function addFiles(el, files) {
  for (const f of files) {
    try {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { if (f.size > 20 * 1024 * 1024) { toast(`${f.name} 太大（上限 20 MB）`); continue; } ui.att.push({ kind: 'pdf', name: f.name, data: await b64(f) }); }
      else if (f.type.startsWith('image/')) { const u = await shrink(f); ui.att.push({ kind: 'image', name: f.name, media: 'image/jpeg', data: u.split(',')[1] }); }
      else toast(`${f.name} 不是圖片或 PDF`);
    } catch (e) { toast(`${f.name}：${e.message || e}`); }
  }
  draw(el);
}

// ---------- 畫面 ----------
function md(s) {   // 簡易 Markdown：標題、粗體、程式碼、清單、表格
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = String(s || '').split('\n'); let html = '', list = '', i = 0;
  const flush = () => { if (list) { html += `</${list}>`; list = ''; } };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush(); const row = x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(ln); i += 2; const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      html += `<div class="tw"><table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td${/^[-\d,.%NT$ ]+$/.test(c) ? ' class="n"' : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    let m;
    if ((m = ln.match(/^\s*#{1,4}\s+(.*)$/))) { flush(); html += `<p><b>${inline(m[1])}</b></p>`; }
    else if ((m = ln.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { flush(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { flush(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!ln.trim()) flush();
    else { flush(); html += `<p>${inline(ln)}</p>`; }
    i++;
  }
  flush(); return html;
}
function draftCard(id, d) {
  const T = TYPES[d.type]; const C = calc(); const amt = Math.round(d.lines.reduce((s, l) => s + (+l.qty || 0) * (+l.price || 0), 0));
  return `<div class="ai-draft"><div class="ai-dh"><b>${esc(T.name)}草稿</b>　${esc(cname(d.cid))}　${esc(d.date)}<span class="sp"></span><button class="btn pri sm" data-draft="${esc(id)}">開啟草稿</button></div>
    <div class="tw"><table><thead><tr><th>商品</th><th class="n">數量</th><th class="n">單價</th><th class="n">金額</th></tr></thead><tbody>${d.lines.map(l => { const g = C.g[l.gid]; return `<tr><td>${esc(g ? goodsLabel(g) : l.gid)}${l.memo ? `<div class="muted small">${esc(l.memo)}</div>` : ''}</td><td class="n">${fmtQ(l.qty)} ${esc(l.u || g?.unit || '')}</td><td class="n">${l.price === '' ? '<span class="muted">未填</span>' : fp4(l.price)}</td><td class="n">${fmt(Math.round((+l.qty || 0) * (+l.price || 0)))}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="muted small">未稅合計 ${fmt(amt)} 元${d.note ? `・備註：${esc(d.note)}` : ''}・還沒存檔，請開啟檢查後自己按儲存。</div></div>`;
}
function faxCard(id, f) {
  const b = store.get('bills', f.billId); if (!b) return '';
  const T = TYPES[b.type]; const j = f.job && store.get('faxjobs', f.job);
  return `<div class="ai-draft"><div class="ai-dh"><b>傳真${esc(T.name)} ${esc(b.no)}</b>　${esc(cname(b.cid))}　號碼 <b>${esc(f.to)}</b>${f.cover ? '・加封面' : ''}<span class="sp"></span>${f.job ? (j ? faxPill(j) : '<span class="pill">已排入</span>') : `<button class="btn pri sm" data-fax="${esc(id)}">確認傳真</button>`}</div>
    <div class="muted small">${f.job ? (j?.msg ? esc(j.msg) : '傳真小幫手會自動印到 PC-FAX、填號碼、按開始。') : '按「確認傳真」才會送出；送出後不能收回，請先確認號碼。'}</div></div>`;
}
function cardHTML(id, k) {
  if (k.kind === 'pinv') return `<div class="ai-draft"><div class="ai-dh"><b>進項發票 ${k.list.length} 張</b><span class="sp"></span>${k.saved ? '<span class="pill ok">已登記</span>' : `<button class="btn pri sm" data-pinv-all="${esc(id)}">全部登記</button>`}</div>
    <div class="tw"><table><thead><tr><th>期別</th><th>日期</th><th>號碼</th><th>廠商</th><th class="n">未稅</th><th class="n">稅</th><th class="n">合計</th><th></th></tr></thead><tbody>${k.list.map((v, i) => `<tr><td>${esc(v.period)}</td><td>${esc(v.date)}</td><td class="mono">${esc(v.no)}</td><td>${esc(v.name)}${v.cid ? '' : ' <span class="pill warn">沒對到廠商</span>'}${v.dup ? ' <span class="pill bad">已登記過</span>' : ''}</td><td class="n">${money(v.untaxed)}</td><td class="n">${money(v.tax)}</td><td class="n">${money(v.untaxed + v.tax)}</td><td><button class="btn sm" data-pinv="${esc(id)}" data-i="${i}">開啟</button></td></tr>`).join('')}</tbody></table></div>
    <div class="muted small">請對照原始發票確認號碼和金額；「全部登記」會跳過已登記過的號碼。</div></div>`;
  if (k.kind === 'checks') return `<div class="ai-draft"><div class="ai-dh"><b>客票 ${k.list.length} 張</b><span class="sp"></span><button class="btn pri sm" data-ck="${esc(id)}">逐張登記</button></div>
    <div class="tw"><table><thead><tr><th>發票人 → 客戶</th><th>銀行</th><th>票號</th><th class="n">金額</th><th>到期日</th></tr></thead><tbody>${k.list.map(c => `<tr><td>${esc(c._ocr.drawer)} → ${c.cid ? esc(cname(c.cid)) : '<span class="pill warn">沒對到</span>'}</td><td>${esc(c.bank)}</td><td class="mono">${esc(c.no)}</td><td class="n">${c.amt ? money(c.amt) : ''}</td><td>${esc(c.due)}</td></tr>`).join('')}</tbody></table></div>
    <div class="muted small">按「逐張登記」會打開登記客票，每一張都要核對後按儲存。</div></div>`;
  if (k.kind === 'addr') return `<div class="ai-draft"><div class="ai-dh"><b>地址標籤</b>　${esc(cname(k.cid))}<span class="sp"></span><button class="btn pri sm" data-addr="${esc(id)}">地址列印</button></div></div>`;
  return '';
}
function attHTML(b) {
  if (b.type === 'image' && b.source?.data) return `<img class="ai-att" src="data:${esc(b.source.media_type)};base64,${b.source.data}" alt="">`;
  if (b.type === 'document') return `<span class="ai-att pdf">📄 ${esc(b.title || 'PDF')}</span>`;
  return '';
}
function convHTML() {
  let h = '';
  for (const m of ui.conv) {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }];
    if (m.role === 'user') {
      const t = blocks.filter(b => b.type === 'text').map(b => b.text.replace(/^\[今天[^\]]*\]\n/, '')).join('\n');
      const att = blocks.map(attHTML).join('');
      if (t || att) h += `<div class="ai-msg me"><div class="ai-b">${att ? `<div class="ai-atts">${att}</div>` : ''}${esc(t).replace(/\n/g, '<br>')}</div></div>`;
      continue;
    }
    for (const b of blocks) {
      if (b.type === 'text' && b.text.trim()) h += `<div class="ai-msg bot"><div class="ai-b">${md(b.text)}</div></div>`;
      else if (b.type === 'tool_use') { h += `<div class="ai-act">· ${esc((LABEL[b.name] || (() => b.name))(b.input || {}))}</div>`; if (b.name === 'draft_bill' && DRAFTS.has(b.id)) h += draftCard(b.id, DRAFTS.get(b.id)); if (b.name === 'fax_bill' && FAXES.has(b.id)) h += faxCard(b.id, FAXES.get(b.id)); if (CARDS.has(b.id)) h += cardHTML(b.id, CARDS.get(b.id)); }
    }
  }
  return h;
}
const SUGGEST = ['幫我印澤發的地址標籤', '新能這個月的應收是多少？', '哪些商品低於安全庫存？', 'A2AM6*20_18 還有多少庫存？上次賣新能多少錢？', '幫我擬一張給新能的報價單：M6*20 六角十字螺絲 10000 支'];
function draw(el) {
  if (!el?.isConnected) return;
  const keep = $('#aiIn', el)?.value || '';
  el.innerHTML = `<div class="head"><h1>AI 助理</h1><span class="sp"></span><span class="muted small">本頁對話約 NT$${(ui.usd * 32).toFixed(1)}</span><button class="btn" id="aiNew" ${ui.busy || !ui.conv.length ? 'disabled' : ''}>新對話</button></div>
    <div class="panel ai-wrap"><div class="ai-log" id="aiLog">${ui.conv.length ? convHTML() : `<div class="empty"><b>用中文問平台的資料，或請它幫你擬單據草稿</b>它會自己查商品、庫存、客戶、單據、應收應付；擬好的單據要你按「開啟草稿」檢查後自己存檔。<div class="ai-sug">${SUGGEST.map(s => `<button class="btn sm" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`}
      ${ui.busy ? '<div class="ai-act ai-wait">思考中…</div>' : ''}${ui.err ? `<div class="banner" style="margin-top:8px">${esc(ui.err)}${ui.conv.at(-1)?.role === 'user' ? ' <button class="btn sm" id="aiRetry">重試</button>' : ''}</div>` : ''}</div>
      ${ui.att.length ? `<div class="ai-atts pend">${ui.att.map((a, i) => `<span class="ai-pend">${a.kind === 'pdf' ? `📄 ${esc(a.name)}` : `<img src="data:${a.media};base64,${a.data}" alt="">`}<button class="icon-btn" data-rmatt="${i}" title="拿掉">✕</button></span>`).join('')}</div>` : ''}
      <div class="ai-in"><input type="file" id="aiFile" accept="image/*,application/pdf" multiple hidden><button class="btn" id="aiClip" title="傳發票、出貨單、支票的照片或 PDF" ${ui.busy ? 'disabled' : ''}>📎</button><button class="btn ai-mic ${rec.on ? 'on' : ''}" id="aiMic" title="${rec.on ? '再按一次結束錄音' : '按一下開始講（國語、台語都可以），講完再按一次'}" ${ui.busy || rec.busy ? 'disabled' : ''}>${rec.busy ? '辨識中…' : rec.on ? '● 停止錄音' : '🎤 講話'}</button><textarea id="aiIn" rows="2" placeholder="打字或按「🎤 講話」，例如：幫我開報價單給新能，二分一吋半馬車螺絲五千支（Enter 送出）" ${ui.busy ? 'disabled' : ''}>${esc(keep)}</textarea>${ui.busy ? '<button class="btn" id="aiStop">停止</button>' : '<button class="btn pri" id="aiSend">送出</button>'}</div>
      <div class="tools" style="gap:14px"><label class="check small"><input type="checkbox" id="aiSpeak" ${ui.speak ? 'checked' : ''}> 朗讀回答</label><label class="check small"><input type="checkbox" id="aiAuto" ${ui.autoSend ? 'checked' : ''}> 講完直接送出</label>${rec.msg ? `<span class="small" style="color:var(--bad)">${esc(rec.msg)}</span>` : ''}</div>
      <div class="muted small">AI 會出錯，金額、數量請以平台資料為準。每問一題大約 NT$1～3。</div></div>`;
  const log = $('#aiLog', el); log.scrollTop = log.scrollHeight;
  const inp = $('#aiIn', el);
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); const t = inp.value; inp.value = ''; send(el, t); } });
  $('#aiSend', el)?.addEventListener('click', () => { const t = inp.value; inp.value = ''; send(el, t); });
  $('#aiStop', el)?.addEventListener('click', () => { ui.stop = true; toast('會在這一步做完後停止'); });
  $('#aiRetry', el)?.addEventListener('click', () => loop(el));
  $('#aiNew', el)?.addEventListener('click', () => { ui.conv = []; ui.usd = 0; ui.err = ''; DRAFTS.clear(); save(); draw(el); });
  el.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => send(el, b.dataset.sug)));
  $('#aiMic', el)?.addEventListener('click', () => rec.on ? stopRec(el) : startRec(el));
  $('#aiClip', el)?.addEventListener('click', () => $('#aiFile', el).click());
  $('#aiFile', el)?.addEventListener('change', ev => { addFiles(el, [...ev.target.files]); ev.target.value = ''; });
  el.querySelectorAll('[data-rmatt]').forEach(b => b.addEventListener('click', () => { ui.att.splice(+b.dataset.rmatt, 1); draw(el); }));
  const wrap = $('.ai-wrap', el);
  wrap?.addEventListener('dragover', ev => { ev.preventDefault(); });
  wrap?.addEventListener('drop', ev => { ev.preventDefault(); if (ev.dataTransfer?.files?.length) addFiles(el, [...ev.dataTransfer.files]); });
  inp.addEventListener('paste', ev => { const fs = [...(ev.clipboardData?.files || [])]; if (fs.length) { ev.preventDefault(); addFiles(el, fs); } });
  el.querySelectorAll('[data-pinv]').forEach(b => b.addEventListener('click', () => { const k = CARDS.get(b.dataset.pinv); const v = k?.list[+b.dataset.i]; if (!v) return; const { dup, taxId, ...pre } = v; editPurch(dup ? store.get('purch_invoices', dup) : pre); }));
  el.querySelectorAll('[data-pinv-all]').forEach(b => b.addEventListener('click', async () => {
    const k = CARDS.get(b.dataset.pinvAll); if (!k) return;
    const have = new Set(store.list('purch_invoices').map(x => x.no));
    const todo = k.list.filter(v => v.no && !have.has(v.no));
    if (!todo.length) return toast('這些發票都已經登記過了');
    b.disabled = true;
    await store.batch(todo.map(v => ({ col: 'purch_invoices', id: uid('pi'), data: { cid: v.cid, period: v.period, date: v.date, name: v.name, no: v.no, kind: v.kind, untaxed: v.untaxed, tax: v.tax, total: v.untaxed + v.tax, note: [v.note, 'AI 助理辨識'].filter(Boolean).join('；') } })));
    store.log('新增', `進項發票 ${todo.length} 張（AI 助理辨識）：${todo.map(v => v.no).join('、')}`);
    k.saved = true; save(); toast(`已登記 ${todo.length} 張進項發票${k.list.length > todo.length ? `（${k.list.length - todo.length} 張已登記過，跳過）` : ''}`); draw(el);
  }));
  el.querySelectorAll('[data-ck]').forEach(b => b.addEventListener('click', () => { const k = CARDS.get(b.dataset.ck); if (k) reviewChecks(k.list.map(c => ({ ...c }))); }));
  el.querySelectorAll('[data-addr]').forEach(b => b.addEventListener('click', () => { const k = CARDS.get(b.dataset.addr); const c = k && store.get('contacts', k.cid); if (c) addrDialog(c); else toast('找不到這個客戶／供應商'); }));
  $('#aiSpeak', el)?.addEventListener('change', ev => { ui.speak = ev.target.checked; ls.set('zr.ai.speak', ui.speak); if (!ui.speak) speechSynthesis.cancel(); });
  $('#aiAuto', el)?.addEventListener('change', ev => { ui.autoSend = ev.target.checked; ls.set('zr.ai.auto', ui.autoSend); });
  el.querySelectorAll('[data-fax]').forEach(b => b.addEventListener('click', async () => {
    const f = FAXES.get(b.dataset.fax); const bill = f && store.get('bills', f.billId); if (!bill) return toast('找不到這張單');
    const c = calc().ct[bill.cid]; const T = TYPES[bill.type];
    b.disabled = true;
    try {
      f.job = await queueFax(bill, c, { to: f.to, attn: bill.attn || c.person || '', subj: `${T.name} ${bill.no}`, msg: bill.type === 'PO' ? '敬請依採購單內容安排交貨，收到後請簽回確認，謝謝。' : bill.type === 'RFQ' ? '敬請報價並回傳，謝謝。' : '報價如上，敬請參考，謝謝。', cover: f.cover });
      save(); toast(`已排入自動傳真：${f.to}`); draw(el);
      api.get('/api/fax/helper').then(r => { if (!r.online) toast('注意：傳真小幫手目前沒有在執行，傳真會等它開啟後才送出'); }).catch(() => {});
    } catch (e) { b.disabled = false; toast('排入傳真失敗：' + (e.message || e)); }
  }));
  el.querySelectorAll('[data-draft]').forEach(b => b.addEventListener('click', () => {
    const d = DRAFTS.get(b.dataset.draft); if (!d) return;
    openBill(d.type, null, null, { cid: d.cid, date: d.date, no: nextNo(d.type, d.date), note: d.note, lines: d.lines.map(l => ({ ...l })) });
  }));
  if (!ui.busy && !isTouch()) setTimeout(() => inp.focus(), 0);   // 手機不自動聚焦（iPhone 會叫不出鍵盤）
}

// ---------- 語音：錄音 → 伺服器 Breeze-ASR-26（國語、台語 → 華語文字）；回答可朗讀 ----------
ui.speak = !!ls.get('zr.ai.speak', false); ui.autoSend = ls.get('zr.ai.auto', true) !== false;
const rec = { on: false, busy: false, msg: '', mr: null, chunks: [], stream: null };
async function startRec(el) {
  rec.msg = '';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { rec.msg = '這個網址不能用麥克風：請改用 https://zhirui.tailabeaf1.ts.net，或在伺服器電腦上開 http://localhost:8080'; draw(el); return; }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    rec.chunks = []; rec.mr = new MediaRecorder(rec.stream);
    rec.mr.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
    rec.mr.onstop = () => transcribe(el);
    rec.mr.start(); rec.on = true; speechSynthesis.cancel();
    rec.timer = setTimeout(() => { if (rec.on) stopRec(el); }, 60000);   // 最長 1 分鐘
  } catch (e) { rec.msg = '開不了麥克風：' + (e.message || e.name); }
  draw(el);
}
function stopRec(el) { clearTimeout(rec.timer); rec.on = false; rec.busy = true; try { rec.mr.stop(); } catch (e) { rec.busy = false; } rec.stream?.getTracks().forEach(t => t.stop()); draw(el); }
async function transcribe(el) {
  try {
    const blob = new Blob(rec.chunks, { type: rec.mr.mimeType || 'audio/webm' });
    const buf = await blob.arrayBuffer();
    const ctx = new AudioContext(); const audio = await ctx.decodeAudioData(buf); ctx.close();
    if (audio.duration < 0.4) throw new Error('沒有錄到聲音');
    const off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const i16 = new Int16Array(pcm.length); for (let i = 0; i < pcm.length; i++) i16[i] = Math.max(-1, Math.min(1, pcm[i])) * 32767;
    const r = await fetch('/api/asr', { method: 'POST', body: i16.buffer, credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 404 ? '伺服器還沒更新，請重新啟動伺服器' : (j.error || 'HTTP ' + r.status));
    const text = String(j.text || '').trim();
    rec.busy = false;
    if (!text) { rec.msg = '沒有聽清楚，請再講一次'; draw(el); return; }
    if (ui.autoSend) { draw(el); send(el, text); }
    else { draw(el); const inp = $('#aiIn', el); inp.value = (inp.value ? inp.value + ' ' : '') + text; inp.focus(); }
  } catch (e) { rec.busy = false; rec.msg = '語音辨識失敗：' + (e.message || e); draw(el); }
}
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const plain = String(text).split('\n').filter(l => !/^\s*\|/.test(l)).join('。').replace(/\*\*|`|#+\s|^[-*•]\s/gm, '').replace(/。{2,}/g, '。').slice(0, 600);
  const u = new SpeechSynthesisUtterance(plain); u.lang = 'zh-TW';
  const v = speechSynthesis.getVoices().find(x => x.lang === 'zh-TW') || speechSynthesis.getVoices().find(x => /zh/i.test(x.lang)); if (v) u.voice = v;
  u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u);
}
