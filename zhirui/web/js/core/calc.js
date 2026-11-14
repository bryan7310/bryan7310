// 進銷存計算：單據種類、金額、庫存、應收應付餘額、單位換算、成本推算
import { store } from './store.js';
import { rnd0, dayN } from './util.js';
import { platCost } from './pricing.js';
import { procCost } from './proccost.js';
import { estWeight } from './spec.js';
import { printName, shortName } from './names.js';

export const TYPES = {
  SALE: { name: '銷貨單', pre: 'XS', party: 'C', stock: -1, money: 1, ps: 1, lines: true },
  SALE_RET: { name: '銷貨退回', pre: 'XT', party: 'C', stock: 1, money: -1, ps: -1, lines: true },
  PUR: { name: '進貨單', pre: 'JH', party: 'S', stock: 1, money: -1, ps: 1, lines: true },
  PUR_RET: { name: '進貨退出', pre: 'JT', party: 'S', stock: -1, money: 1, ps: -1, lines: true },
  IN: { name: '其他入庫', pre: 'QR', stock: 1, lines: true },
  OUT: { name: '其他出庫', pre: 'QC', stock: -1, lines: true },
  TRANSFER: { name: '調撥單', pre: 'DB', lines: true, transfer: true },
  ASM: { name: '組包單', pre: 'ZB', lines: true, asm: true },   // 螺絲包：依配方扣零件（客供件扣客供倉），成品加庫存
  RCV: { name: '收款單', pre: 'SK', party: 'C', money: 1 },
  PAY: { name: '付款單', pre: 'FK', party: 'S', money: -1 },
  INC: { name: '其他收入', pre: 'QS', money: 1 },
  EXP: { name: '其他支出', pre: 'QZ', money: -1 },
  QUO: { name: '報價單', pre: 'BJ', party: 'C', lines: true, doc: true },
  RFQ: { name: '詢價單', pre: 'XJ', party: 'S', lines: true, doc: true },
  PO: { name: '採購單', pre: 'PO', party: 'S', lines: true, doc: true },
  PRC: { name: '加工單', pre: 'JG', party: 'S', lines: true, doc: true },
  SO: { name: '客戶訂單', pre: 'DD', party: 'C', lines: true, doc: true },   // 客戶下的訂單（傳真、Email 轉入）：不動庫存、不進應收；出貨時轉成銷貨單   // 委託加工：送電鍍、熱處理、耐落給廠商的單子（不動庫存、不進應付）
};

export const lineAmt = l => rnd0((+l.qty || 0) * (+l.price || 0));
export function totals(b) {
  let sub = 0; for (const l of b.lines || []) sub += lineAmt(l);
  if (b.hist && b.oamt != null) { const a = rnd0(b.oamt); return { sub, net: a, tax: 0, total: a }; }
  const net = rnd0(sub - rnd0(b.disc)); const tax = b.tax ? rnd0(net * 0.05) : 0;
  return { sub, net, tax, total: net + tax };
}

// ---------- 單位 ----------
const PIECE = /^(pcs|只|支|個|顆|粒|件|pc|)$/i;
/** 填手動成本用的單位：最近出貨的單位跟商品單位不同類（例如 PCS 對 KG）就用出貨單位，否則用商品單位 */
export const costUnitFor = (g, saleU) => saleU && unitFactor(saleU)[0] !== unitFactor(g?.unit || '')[0] ? saleU : (g?.unit || '');
/** 存手動成本：單位跟商品單位同類就不記 costUnit */
export const withCost = (g, v, u) => { const { id, ...d } = g; d.cost = v; if (u && unitFactor(u)[0] !== unitFactor(g.unit || '')[0]) d.costUnit = u; else delete d.costUnit; return d; };
export function unitFactor(u) { // [類別, 每單位幾個基本件]
  u = String(u ?? '').trim();
  if (/^h$/i.test(u) || /^100(pcs|支|個)$/i.test(u)) return ['p', 100];
  if (/^(k|千)$/i.test(u) || /^1000(pcs|支|個)$/i.test(u)) return ['p', 1000];
  if (/籮/.test(u)) return ['p', 144];
  if (PIECE.test(u)) return ['p', 1];
  if (/kg|公斤/i.test(u)) return ['kg', 1];
  return ['u:' + u, 1];
}
// 單重 g／支：有填用實測值，沒填用品名規格依標準尺寸估算（同舊進銷存）
const WTM = new Map(); let WTMgen = -1;
export const goodsWt = g => {
  if (!g) return 0; if (+g.wt > 0) return +g.wt;
  if (WTMgen !== store.gen) { WTM.clear(); WTMgen = store.gen; }
  if (!WTM.has(g.id)) WTM.set(g.id, estWeight(g));
  return WTM.get(g.id);
};
// 舊系統的進貨單（歷史單據載入後放進來），成本推算也會用到
let HIST_PUR = [];
export function setHistPur(bills) { HIST_PUR = bills || []; C = null; QH = null; }
export function uRate(u, g) {
  if (!g) return null;
  const [c1, f1] = unitFactor(u), [c2, f2] = unitFactor(g.unit || '');
  if (c1 === c2 && f2) return f1 / f2;
  if (c1 === 'kg' && c2 === 'p' && f2) { const w = goodsWt(g); return w > 0 ? Math.round(1000 / w / f2 * 10000) / 10000 : null; }
  if (c1 === 'p' && c2 === 'kg') { const w = goodsWt(g); return w > 0 ? Math.round(f1 * w / 1000 * 1e6) / 1e6 : null; }
  return null;
}
export function lineUnit(l, g) {
  if (l.u) return unitFactor(l.u);
  if (l.unit === 'a' && g?.aunit) { const [c, f] = unitFactor(g.unit); return [c, f * (+g.arate || 1)]; }
  return unitFactor(g?.unit || '');
}
export const bqty = (l, g) => (+l.qty || 0) * (+l.rate || (l.u && g ? uRate(l.u, g) || 1 : 1));
/** 一行明細的重量 kg（單位是 KG 就是數量；支數 × 單重，沒填單重用規格估算） */
export function lineKg(l, g) {
  if (!g) return 0;
  if (l.u && unitFactor(l.u)[0] === 'kg') return +l.qty || 0;
  const [c, f] = unitFactor(g.unit || 'PCS');
  if (c === 'kg') return bqty(l, g);
  if (c !== 'p') return 0;
  return bqty(l, g) * f * (+l.wt > 0 ? +l.wt : goodsWt(g)) / 1000;   // 單據上有填單重（g）就用它
}

// ---------- 單號 ----------
export function nextNo(type, date, bills) {
  bills = bills || store.list('bills');
  if (type === 'SALE') { // 出貨單號：西元年後兩碼＋月＋日＋四位流水號，例如 2611040001
    const p = date.replace(/-/g, '').slice(2, 8); let max = 0;
    for (const b of bills) { const n = String(b.no || ''); if (n.length === 10 && n.startsWith(p) && /^\d{10}$/.test(n)) max = Math.max(max, +n.slice(6)); }
    return p + String(max + 1).padStart(4, '0');
  }
  const p = TYPES[type].pre + date.replace(/-/g, ''); const used = new Set(bills.map(b => b.no));
  let i = bills.filter(b => b.type === type && (b.no || '').startsWith(p)).length + 1;
  while (used.has(p + String(i).padStart(3, '0'))) i++;
  return p + String(i).padStart(3, '0');
}

// ---------- 全部重算：庫存、成本、應收應付、帳戶餘額 ----------
let C = null, Cgen = -1;
export function calc() {
  if (C && Cgen === store.gen) return C;
  Cgen = store.gen;
  const g = {}, ct = {}, wh = {}, ac = {};
  store.list('goods').forEach(x => g[x.id] = x);
  store.list('contacts').forEach(x => ct[x.id] = x);
  store.list('warehouses').forEach(x => wh[x.id] = x);
  store.list('accounts').forEach(x => ac[x.id] = x);
  const stock = {}, cost = {}, cogs = {}, lineCogs = {}, tot = {}, bal = {}, accBal = {}, eff = {}, bstock = {};
  const addB = (gid, wid, bn, q) => { if (!gid || !wid || !bn) return; const a = ((bstock[gid] ??= {})[wid] ??= {}); a[bn] = (a[bn] || 0) + q; };
  Object.values(ct).forEach(c => bal[c.id] = +c.init || 0);
  Object.values(ac).forEach(a => accBal[a.id] = +a.init || 0);
  const bills = store.list('bills').sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
  const purIdx = {}, poIdx = {};
  for (const b of bills) { if (b.type !== 'PO') continue; for (const l of b.lines || []) { if (!l.gid || !(+l.price > 0)) continue; const [cls, f] = lineUnit(l, g[l.gid]); (poIdx[l.gid] ??= []).push({ d: dayN(b.date), date: b.date, no: b.no, cls, per: (+l.price) / f }); } }
  for (const b of [...bills, ...HIST_PUR]) { if (b.type !== 'PUR') continue; for (const l of b.lines || []) { if (!l.gid || !(+l.price > 0) || !g[l.gid]) continue; const [cls, f] = lineUnit(l, g[l.gid]); (purIdx[l.gid] ??= []).push({ d: dayN(b.date), date: b.date, no: b.no, cls, per: (+l.price) / f, cid: b.cid, hist: !!b.hist }); } }
  const costMiss = {}, costLn = {};
  const saleCost = (b, l, i) => { if (!l.gid) return 0; const r = costOf(l, b.date, purIdx, g, poIdx); (costLn[b.id] ??= [])[i] = r; if (!r) { costMiss[b.id] = (costMiss[b.id] || 0) + 1; return 0; } return r.c * (+l.qty || 0); };
  const add = (gid, wid, q) => { if (!gid || !wid) return; (stock[gid] ??= {}); stock[gid][wid] = (stock[gid][wid] || 0) + q; };
  for (const b of bills) {
    const T = TYPES[b.type]; if (!T) continue;
    const t = totals(b); tot[b.id] = t; let cg = 0; const lc = [];
    if (T.doc) { cogs[b.id] = 0; lineCogs[b.id] = []; continue; }
    if (T.asm) {   // 組包單：零件出庫（客供件從客供倉），成品入庫；成品成本＝自備零件成本＋工錢
      const k = b.kit || {}; const kq = +k.qty || 0; let own = 0;
      for (const l of b.lines || []) {
        if (!l.gid || g[l.gid]?.nostock) continue; const q = +l.qty || 0;
        add(l.gid, l.cust ? (b.cwid || b.wid) : b.wid, -q);
        const c = cost[l.gid] ??= { q: 0, avg: +(g[l.gid]?.purPrice) || 0 }; c.q -= q;
        if (!l.cust) own += q * (costOf({ gid: l.gid, qty: 1 }, b.date, purIdx, g, poIdx, true)?.c || c.avg || 0);
      }
      if (k.gid && kq) {
        add(k.gid, b.wid, kq); const c = cost[k.gid] ??= { q: 0, avg: 0 };
        if (kq > 0) { const u = (own + (+b.labor || 0) * kq) / kq; const base = Math.max(c.q, 0); c.avg = (base * c.avg + kq * u) / (base + kq); }
        c.q += kq;
      }
      cogs[b.id] = 0; lineCogs[b.id] = []; continue;
    }
    if (T.lines) (b.lines || []).forEach((l, i) => {
      if (l.txt !== undefined) return;
      const r = +l.rate || (l.u && l.gid ? uRate(l.u, g[l.gid]) || 1 : 1), q = (+l.qty || 0) * r, p = (+l.price || 0) / r, gid = l.gid; const c = cost[gid] ??= { q: 0, avg: +(g[gid]?.purPrice) || 0 }; lc[i] = 0;
      if (g[gid]?.nostock) { if (b.type === 'SALE' || b.type === 'SALE_RET') { lc[i] = saleCost(b, l, i); cg += lc[i]; } return; }   // 不管庫存的商品（例如門市銷售螺絲）
      if (T.transfer) { add(gid, b.wid, -q); add(gid, b.toWid, q); addB(gid, b.wid, l.batch, -q); addB(gid, b.toWid, l.batch, q); return; }
      add(gid, b.wid, T.stock * q); addB(gid, b.wid, l.batch, T.stock * q);
      if (b.type === 'PUR' || b.type === 'IN') { const u = (b.type === 'IN' && !p) ? c.avg : p; const base = Math.max(c.q, 0); c.avg = base + q > 0 ? (base * c.avg + q * u) / (base + q) : u; c.q += q; }
      else if (b.type === 'SALE') { lc[i] = saleCost(b, l, i); c.q -= q; }
      else if (b.type === 'SALE_RET') { lc[i] = saleCost(b, l, i); c.q += q; }
      else c.q -= q;
      cg += lc[i];
    });
    cogs[b.id] = cg; lineCogs[b.id] = lc;
    if (T.party && b.cid && !T.doc) { const e = T.lines ? T.ps * (t.total - (+b.paid || 0)) : -(+b.amount || 0); eff[b.id] = e; if (bal[b.cid] !== undefined) bal[b.cid] += e; }
    if (T.money && b.aid && accBal[b.aid] !== undefined) accBal[b.aid] += T.money * (T.lines ? (+b.paid || 0) : (+b.amount || 0));
  }
  C = { g, ct, wh, ac, stock, cost, cogs, lineCogs, tot, bal, accBal, eff, bills, bstock, purIdx, poIdx, costMiss, costLn };
  return C;
}
export const qtyAt = (gid, wid) => ((calc().stock[gid] || {})[wid] || 0);
export const qtyAll = gid => Object.values(calc().stock[gid] || {}).reduce((a, b) => a + b, 0);
export const cname = id => calc().ct[id]?.name || '—';
export const cdisp = c => c ? (String(c.short || '').trim() || shortName(c.name, c.aliases) || c.name) : '';
export const cshort = id => { const c = calc().ct[id]; return c ? cdisp(c) : '—'; };
// 列印用全名（單據、對帳單、支票、發票、郵寄一律用這個）
export const cprint = id => { const c = calc().ct[id]; return c ? printName(c.name) : ''; };
export const wname = id => calc().wh[id]?.name || '—';
export const gname = (id, type) => { const x = calc().g[id]; if (!x) return '（已刪除商品）'; const ext = type === 'PO' ? x.vcode : x.spec; return `${x.name}${ext ? ' ' + ext : ''}`; };  // 採購單給廠商看：品名＋廠商料號，不印客料號
export const goodsLabel = (x, type) => [x.code, x.name, type === 'PO' ? x.vcode : x.spec].filter(Boolean).join(' ');
export const billAmt = b => TYPES[b.type]?.lines ? (calc().tot[b.id]?.total || 0) : +b.amount || 0;
// 客戶／供應商清單：預設不含「停用」的（開單、挑選用）；all=true 含停用（基本資料、報表、名稱比對用）
export const customers = all => store.list('contacts').filter(c => c.kind === 'C' && (all || !c.inactive)).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));
export const suppliers = all => store.list('contacts').filter(c => c.kind === 'S' && (all || !c.inactive)).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));
export const defWh = () => { const id = store.setting('prefs').defaultWh; const ws = store.list('warehouses'); return ws.find(w => w.id === id) || ws[0] || null; };

// ---------- 每件成本：最接近日期的進貨單 → 採購單 → 查價牌價 → 手動 ----------
/** 配方成本（每 1 個成品基本單位）：自備零件成本 × 數量加總 ＋ 工錢；客供件不算 */
let bomDepth = 0;
export function bomCost(g, date, purIdx, gm, poIdx) {
  const r = { c: +g?.labor || 0, n: 0, miss: 0 };
  if (!g?.bom?.length || bomDepth > 2) return r;
  bomDepth++;
  try {
    for (const x of g.bom) {
      if (x.cust || !x.gid) continue; r.n++;
      const k = costOf({ gid: x.gid, qty: 1 }, date, purIdx, gm, poIdx, true);
      if (k) r.c += k.c * (+x.qty || 0); else r.miss++;
    }
  } finally { bomDepth--; }
  return r;
}
function costG(g, gid, cls, f, date, purIdx, poIdx, sane, gm) {
  const d = dayN(date);
  const pick = (li, lab) => {
    if (!li || !li.length) return null;
    const cands = li.filter(x => x.cls === cls).map(x => ({ x, dd: Math.abs(x.d - d) })).sort((a, b) => a.dd - b.dd || (b.x.d <= d) - (a.x.d <= d));
    for (const { x } of cands) { for (const [k, lb] of [[1, ''], [100, '，單價視為每百支'], [1000, '，單價視為每千支']]) { const c = x.per * f / k; if (sane(c, 0.03, 3)) return { c, src: `${lab} ${x.no}（${x.date}）${lb}` }; } }
    return null;
  };
  let r;
  if (gid && (r = pick(purIdx[gid], '進貨單'))) return r;
  if (gid && (r = pick(poIdx[gid], '採購單'))) return r;
  if (g?.bom?.length) {   // 螺絲包：用配方算
    const [bc, bf] = unitFactor(g.unit || '');
    if (bc === cls) { const b = bomCost(g, date, purIdx, gm, poIdx); if (b.c > 0) return { c: b.c / bf * f, src: `配方成本（自備零件 ${b.n} 項${b.miss ? `，其中 ${b.miss} 項查不到成本` : ''}${+g.labor ? '＋工錢' : ''}）` }; }
  }
  // 加工品（黑身／白皮＋熱處理＋電鍍）：成品自己沒有進貨單時，用原料＋加工費每 KG 乘單重
  if (g && gm) { const pr = procCost(g, cls, f, date, d, purIdx, gm, goodsWt); if (pr) return pr; }
  if (g && cls === 'p') { const pc = platCost(g); if (pc && sane(pc.per * f, 0.01, 5)) return { c: pc.per * f, src: pc.src }; }
  // 手動成本：預設是每 1 個商品單位；costUnit 有填（例如商品是 PCS、卻論 KG 賣）就是每 1 個 costUnit
  if (g && +g.cost > 0) { const [bc, bf] = unitFactor(g.costUnit || g.unit || ''); if (bc === cls) return { c: (+g.cost) / bf * f, src: `商品成本（手動${g.costUnit ? '，每 ' + g.costUnit : ''}）`, manual: true }; }
  return null;
}
/** loose：不拿單價或牌價檢查合理性（商品資料上看「目前成本」用，進貨單一律優先） */
export function costOf(l, date, purIdx, gm, poIdx, loose) {
  if (!l.gid) return null; const g = (gm || calc().g)[l.gid];
  purIdx = purIdx || calc().purIdx; poIdx = poIdx || calc().poIdx;
  const [cls, f] = lineUnit(l, g);
  const sp = +l.price || 0;
  let ref = null; if (!sp && !loose && g && cls === 'p') { const pc = platCost(g); if (pc) ref = pc.per * f; }
  const sane = (c, lo, hi) => loose ? c > 0 : sp ? (c >= sp * lo && c <= sp * hi) : ref ? (c >= ref * 0.2 && c <= ref * 5) : true;
  return costG(g, l.gid, cls, f, date, purIdx, poIdx, sane, gm || calc().g);
}

// 同一客戶上一次銷貨單價（新平台＋舊系統歷史銷貨單）
let LSP = null, LSPgen = -1, HIST_SALE = [];
export function setHistSale(bills) { HIST_SALE = bills || []; LSP = null; QH = null; }
export const histSaleReady = () => HIST_SALE.length > 0;
export function lastSale(cid, gid, date, exclude) {
  if (!cid || !gid) return null;
  if (!LSP || LSPgen !== store.gen) {
    LSP = new Map(); LSPgen = store.gen;
    for (const b of [...store.list('bills'), ...HIST_SALE]) { if (b.type !== 'SALE' || !b.cid) continue; (b.lines || []).forEach(l => { if (!l.gid || !(+l.price > 0)) return; const k = b.cid + '|' + l.gid; let a = LSP.get(k); if (!a) LSP.set(k, a = []); a.push({ date: b.date || '', no: b.no, id: b.id, price: +l.price, u: l.u, unit: l.unit, rate: l.rate }); }); }
    for (const a of LSP.values()) a.sort((x, y) => y.date.localeCompare(x.date) || String(y.no).localeCompare(String(x.no)));
  }
  const a = LSP.get(cid + '|' + gid) || []; return a.find(x => x.id !== exclude && (!date || x.date <= date)) || a.find(x => x.id !== exclude) || null;
}
// 數量歷史（開單防呆用）：同一對象、同一商品過去每行的數量（換成商品基本單位）。kind：S＝銷貨、P＝進貨
let QH = null, QHgen = -1;
export function qtyHist(kind, cid, gid, exclude) {
  if (!QH || QHgen !== store.gen) {
    QH = new Map(); QHgen = store.gen; const gm = {}; store.list('goods').forEach(x => gm[x.id] = x);
    const put = (k, v) => { let a = QH.get(k); if (!a) QH.set(k, a = []); a.push(v); };
    for (const b of [...store.list('bills'), ...HIST_SALE, ...HIST_PUR]) {
      const kd = b.type === 'SALE' ? 'S' : b.type === 'PUR' ? 'P' : ''; if (!kd) continue;
      for (const l of b.lines || []) { if (!l.gid || !(+l.qty > 0)) continue; const q = bqty(l, gm[l.gid]); if (!(q > 0)) continue; const v = { q, id: b.id, cid: b.cid }; put(kd + '|' + l.gid, v); if (b.cid) put(kd + '|' + b.cid + '|' + l.gid, v); }
    }
  }
  const pick = k => (QH.get(k) || []).filter(x => !exclude || x.id !== exclude).map(x => x.q);
  return { mine: cid ? pick(kind + '|' + cid + '|' + gid) : [], all: pick(kind + '|' + gid) };
}
export function unitPrice(g, type, unit) {
  const sale = type === 'SALE' || type === 'SALE_RET' || type === 'QUO' || type === 'SO'; if (type === 'TRANSFER' || type === 'OUT') return '';
  const base = +(sale ? g.salePrice : g.purPrice) || 0;
  if (unit === 'a') { const ap = +(sale ? g.asale : g.apur) || 0; return ap || (base ? Math.round(base * (+g.arate || 1) * 100) / 100 : ''); }
  return base || '';
}
