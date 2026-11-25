// 盤點 ABC 分類：近一年（25 結的 12 個月）每個商品的銷貨金額（新平台＋舊系統，銷貨扣退回），金額由高到低累計：
//   前 80%＝A 類（每月盤）、80～95%＝B 類（每季盤）、其餘＝C 類（半年盤）；A 類裡出貨 6 次以上的打 ★（常出貨，最先盤）。
// 加工費、運費這類 Z 開頭的非實體品項不算，螺絲包（Z21）要算。電腦版「庫存 › 盤點表」跟 App 盤點表共用。
import { today, ym25, shiftMonth } from './util.js';
import { store } from './store.js';
import { api } from './api.js';

/** 各類多久要盤一次（天） */
export const ABC_DAYS = { A: 31, B: 92, C: 183 };
export const ABC_NAME = { A: 'A 類（每月盤）', B: 'B 類（每季盤）', C: 'C 類（半年盤）' };

let HIST = { key: '', rows: null, busy: null };
async function histSales(from) {
  const key = from + '|' + (store.histVer || '');
  if (HIST.key === key && HIST.rows) return HIST.rows;
  if (HIST.key === key && HIST.busy) return HIST.busy;
  HIST = { key, rows: null, busy: (async () => {
    const out = [];
    for (const type of ['SALE', 'SALE_RET']) {
      let offset = 0;
      for (;;) { const r = await api.hist({ type, from, limit: 1000, offset }); out.push(...r.rows); offset += r.rows.length; if (!r.rows.length || offset >= r.total) break; }
    }
    HIST.rows = out; return out;
  })() };
  return HIST.busy;
}

/** 回傳 { from, list, map }：list＝[{ gid, amt, n, last, cls, star, rank }]（金額由高到低），map＝gid → 同一筆 */
export async function abcList() {
  const from = shiftMonth(ym25(today()), -12) + '-26';
  let hist = []; try { hist = await histSales(from); } catch (e) { hist = []; }
  const S = new Map();
  const add = b => {
    if (b.type !== 'SALE' && b.type !== 'SALE_RET') return; const d = b.date || ''; if (d < from) return; const s = b.type === 'SALE' ? 1 : -1;
    for (const l of b.lines || []) {
      if (!l.gid) continue; const x = S.get(l.gid) || S.set(l.gid, { gid: l.gid, amt: 0, n: 0, last: '', cids: new Set() }).get(l.gid); if (b.cid) x.cids.add(b.cid);   // cids＝這一年買過這個商品的客戶（盤點表的客戶篩選用）
      x.amt += s * Math.round((+l.qty || 0) * (+l.price || 0)); x.n++; if (d > x.last) x.last = d;
    }
  };
  store.list('bills').forEach(add); hist.forEach(add);
  const ok = x => { const g = store.get('goods', x.gid); if (!g || g.nostock || !(x.amt > 0)) return false; const c = String(g.code || '').toUpperCase(); return !c.startsWith('Z') || c.startsWith('Z21'); };
  const list = [...S.values()].filter(ok).sort((a, b) => b.amt - a.amt);
  const tot = list.reduce((a, x) => a + x.amt, 0); let cum = 0;
  list.forEach((x, i) => { x.cls = cum < tot * 0.8 ? 'A' : cum < tot * 0.95 ? 'B' : 'C'; cum += x.amt; x.rank = i + 1; x.star = x.cls === 'A' && x.n >= 6; });
  return { from, list, map: new Map(list.map(x => [x.gid, x])) };
}

/** 盤點表的客戶選單：這一年有出貨的客戶，[{ cid, name, n }]，商品數多的排前面 */
export function abcCustomers(list) {
  const m = new Map(); for (const x of list) for (const c of x.cids || []) m.set(c, (m.get(c) || 0) + 1);
  return [...m].map(([cid, n]) => { const c = store.get('contacts', cid); return c ? { cid, name: c.short || c.name || '', full: c.name || '', n, text: [c.code, c.name, c.short, ...(c.aliases || [])].filter(Boolean).join(' ') } : null; }).filter(Boolean).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/** 這個商品這一輪盤過了沒：上次盤點日（goods.cntAt）在該類的週期內 */
export function countedOk(g, cls) {
  if (!g || !g.cntAt) return false;
  const days = (Date.parse(today()) - Date.parse(g.cntAt)) / 864e5;
  return days <= (ABC_DAYS[cls] || ABC_DAYS.C);
}
