// 加工品成本：成品沒有自己的進貨單時，用「原料（料號第 3 碼改成 D＝黑身／白皮、無處理）
// ＋熱處理（雙合鑫、金元達的 H_ 熱處理料號，對得到同尺寸同品項才算）＋表面處理加工費（Z04…）」
// 全部換算成每 KG，再乘單重。表面處理 → 加工料號的對照可在「設定 › 加工成本」改。
import { store } from './store.js';

/** 預設對照：表面處理字母（第 3 碼）→ 加工料號；-PW＝華司、墊片，-H＝有熱處理（宏悅鍍鎳會分 H） */
export const PROC_DEFAULT = {
  A: 'Z04_A', S: 'Z04_A-3', B: 'Z04_B', C: 'Z04_C', E: 'Z04_E', 'E-PW': 'Z04_E-PW', 'E-H': 'Z04_E-H',
  F: 'Z04_F', J: 'Z04_J', K: 'Z04_K',
};
export const PROC_NAMES = { A: '鍍鋅', S: '三價鋅', B: '染黑', C: '五彩', E: '鍍鎳', 'E-PW': '鍍鎳（華司）', 'E-H': '鍍鎳（有熱處理）', F: '鍍鉻', J: '古銅', K: '錏黑' };
export const procMap = () => ({ ...PROC_DEFAULT, ...(store.setting('proccost')?.map || {}) });

const CODE = /^([A-Z])(\d)([A-Z])(.+)$/;
const sizeOf = rest => rest.split('_')[0];
const bare = s => String(s || '').replace(/^[MWU]/, '');
const IDX = new WeakMap();
function idx(gm) {
  let x = IDX.get(gm); if (x) return x;
  const code = new Map(), heat = new Map();
  for (const g of Object.values(gm)) {
    if (!g || !g.code) continue; code.set(g.code, g);
    if (/^H_/.test(g.code) && /熱處理/.test(g.name || '')) { const k = bare(g.code.slice(2)); (heat.get(k) || heat.set(k, []).get(k)).push(g); }
  }
  x = { code, heat }; IDX.set(gm, x); return x;
}
/** 品項文字（品名裡尺寸前面那段），比對熱處理料號用 */
const itemOf = (name, sz) => { const n = String(name || ''); const i = n.indexOf(sz); return (i > 0 ? n.slice(0, i) : '').replace(/熱處理|⊕|螺絲|螺|\s|[MWU]$/g, ''); };
const like = (a, b) => { if (!a || !b) return false; if (a.includes(b) || b.includes(a)) return true; const s = new Set(a); let n = 0; for (const ch of new Set(b)) if (s.has(ch)) n++; return n / Math.min(a.length, b.length) >= 0.6; };

/** 加工料號（Z04、H_…）每 KG 的價格：取最接近（優先不晚於）這個日期的進貨；這些料號的單價本來就是每 KG，
 *  不管商品單位設成什麼；max 用來排除批價（例如熱處理不足量 500 元一批） */
function kgPrice(li, d, max) {
  const c = (li || []).filter(x => x.per > 0 && (!max || x.per <= max));
  c.sort((a, b) => (a.d > d) - (b.d > d) || Math.abs(a.d - d) - Math.abs(b.d - d));
  return c[0] || null;
}
const MEDIAN = new WeakMap();
function heatMedian(purIdx, heatMap) {
  if (MEDIAN.has(purIdx)) return MEDIAN.get(purIdx);
  const ps = []; for (const arr of heatMap.values()) for (const h of arr) for (const x of purIdx[h.id] || []) if (x.cls === 'kg' && x.per > 0 && x.per <= 30) ps.push(x);
  ps.sort((a, b) => b.d - a.d); const r = ps.slice(0, 15).map(x => x.per).sort((a, b) => a - b);
  const m = r.length ? r[Math.floor(r.length / 2)] : 0; MEDIAN.set(purIdx, m); return m;
}

/** 有沒有熱處理：商品可手動指定（heat: 'y'／'n'）；沒指定就看雙合鑫、金元達有沒有同尺寸、同品項的 H_ 熱處理料號 */
export function heatFor(g, gm) {
  const m = CODE.exec(g?.code || ''); if (!m) return null;
  if (g.heat === 'n') return null;
  const sz = sizeOf(m[4]); const list = idx(gm).heat.get(bare(sz)) || [];
  const it = itemOf(g.name, bare(sz)) || itemOf(g.name, sz);
  const hit = list.find(h => like(itemOf(h.name, bare(sz)), it));
  if (hit) return hit;
  return g.heat === 'y' ? { id: '', code: '', name: '熱處理（手動指定）' } : null;
}

/**
 * 加工成本（每 1 個 cls 單位 × f），對不到就回 null。
 * g：成品；wtOf(g)：單重 g／支；purIdx：進貨索引（per＝每基本單位）；gm：商品表
 */
export function procCost(g, cls, f, date, d, purIdx, gm, wtOf) {
  const m = CODE.exec(g?.code || ''); if (!m || m[3] === 'D') return null;
  const I = idx(gm); const raw = I.code.get(m[1] + m[2] + 'D' + m[4]); if (!raw || raw.id === g.id) return null;
  const wt = wtOf(g) || wtOf(raw); if (cls === 'p' && !(wt > 0)) return null;
  if (cls !== 'p' && cls !== 'kg') return null;
  // 原料每 KG：原料論 KG 買就直接用；論支買用單重換算
  // 換算後每 KG 要在 8～400 元之間才採用（論支的單價可能是每百支、每千支，依序試）；都不合理就當查不到
  let rawKg = 0, rawSrc = '';
  const ok = v => v >= 8 && v <= 400;
  const rl = (purIdx[raw.id] || []).filter(x => x.per > 0).sort((a, b) => (a.d > d) - (b.d > d) || Math.abs(a.d - d) - Math.abs(b.d - d));
  for (const x of rl) {
    if (x.cls === 'kg') { if (ok(x.per)) { rawKg = x.per; rawSrc = `${x.no}（${x.date}）`; break; } continue; }
    if (x.cls !== 'p' || !(wt > 0)) continue;
    const k = [1, 100, 1000].find(k => ok(x.per / k / (wt / 1000)));
    if (k) { rawKg = x.per / k / (wt / 1000); rawSrc = `${x.no}（${x.date}，每${k === 1 ? '' : k === 100 ? '百' : '千'}支 ${x.per}）`; break; }
  }
  if (!rawKg) return null;
  // 熱處理
  const h = heatFor(g, gm); let heatKg = 0, heatSrc = '';
  if (h) {
    const hk = h.id ? kgPrice(purIdx[h.id], d, 30) : null;
    heatKg = hk ? hk.per : heatMedian(purIdx, I.heat);
    heatSrc = hk ? `${h.code} ${hk.no}` : `${h.code || '手動指定'}（沒有單價，用近期熱處理中位數）`;
  }
  // 表面處理加工費
  const map = procMap(); const washer = /華司|墊片/.test(g.name || '');
  const key = h && map[m[3] + '-H'] ? m[3] + '-H' : washer && map[m[3] + '-PW'] ? m[3] + '-PW' : m[3];
  const pg = map[key] ? I.code.get(map[key]) : null; if (!pg) return null;
  const pk = kgPrice(purIdx[pg.id], d, 200); if (!pk) return null;
  const kg = rawKg + heatKg + pk.per;
  const c = cls === 'kg' ? kg * f : kg * wt / 1000 * f;
  if (!(c > 0)) return null;
  const r1 = n => Math.round(n * 100) / 100;
  const src = `加工成本：原料 ${raw.code} ${r1(rawKg)}/KG${heatKg ? `＋熱處理 ${r1(heatKg)}/KG` : ''}＋${PROC_NAMES[key] || key} ${pg.code} ${r1(pk.per)}/KG${cls === 'p' ? `，單重 ${wt}g` : ''}`;
  return { c, src, proc: { raw: raw.id, rawKg, rawSrc, heat: h ? (h.code || '手動') : '', heatKg, heatSrc, pg: pg.code, pgKg: pk.per, pgSrc: `${pk.no}（${pk.date}）`, wt } };
}
