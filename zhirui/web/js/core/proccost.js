// 加工品成本：成品沒有自己的進貨單時，用「原料（料號第 3 碼改成 D＝黑身／白皮、無處理）
// ＋熱處理（雙合鑫、金元達的 H_ 熱處理料號，對得到同尺寸同品項才算）＋表面處理加工費（Z04…）」
// 全部換算成每 KG，再乘單重。表面處理 → 加工料號的對照可在「設定 › 加工成本」改。
import { store } from './store.js';
import { netPrice } from './pricing.js';

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
// 華司內徑範圍大：M6、M6.1～M6.5、1/4 都算同一個內徑（公制小數 0.6 以內算同一號；英制換成對應的公制號數）；外徑、厚度要一樣
const WASHER = /華司|墊片/;
const INCH = { '1/8': 3, '5/32': 4, '3/16': 5, '1/4': 6, '5/16': 8, '3/8': 10, '7/16': 11, '1/2': 12, '9/16': 14, '5/8': 16, '3/4': 20, '7/8': 22, '1': 25 };
function idGroup(s) {
  s = String(s || '').replace(/["”]/g, '');
  if (/^W/.test(s)) { const v = INCH[s.slice(1)]; return v == null ? null : v; }
  if (/^M/.test(s)) { const n = parseFloat(s.slice(1)); if (!(n > 0)) return null; const fl = Math.floor(n); return n - fl <= 0.6 + 1e-9 ? fl : fl + 1; }
  return null;
}
const numS = s => { const n = parseFloat(s); return isNaN(n) ? String(s) : String(n); };
function washerKey(m) {
  const [sz, ...it] = m[4].split('_'); const parts = sz.split('*'); const gid = idGroup(parts[0]); if (gid == null) return null;
  return [m[1] + m[2], it.join('_'), gid, ...parts.slice(1).map(numS)].join('|');
}
// 阡阡華司牌價（螺絲查價）：平華司依內徑號數＋外徑＋厚度、材質（鐵／中碳）對應；沒有進價的華司拿來補成本。
// 牌價比我們實際進價低，乘「牌價倍數」（預設 1.24，設定 › 加工成本 可改）；牌價附「每 KG 幾個」可當單重。
export const qqMult = () => +store.setting('proccost')?.qqMult || 1.24;
let QQ = null, QQgen = -1;
function qqIdx() {
  if (QQ && QQgen === store.gen) return QQ; QQ = new Map(); QQgen = store.gen;
  for (const p of store.list('pricing')) {
    if (p.sup !== '阡阡' || !/^平華司/.test(p.name || '')) continue;
    const dd = String(p.dia || '').replace(/["”]/g, ''); const gi = INCH[dd] != null ? INCH[dd] : /^M\d/.test(dd) ? parseInt(dd.slice(1), 10) : null;
    const sp = String(p.spec || '').split(/[×xX*]/); if (gi == null || sp.length < 3) continue;
    const per = netPrice(p); if (!(per > 0)) continue;
    const mat = /中碳/.test(p.material || '') ? 'C' : 'A'; const kind = /鍍鋅/.test(p.finish || '') ? 'zn' : /光面/.test(p.finish || '') ? 'plain' : '';
    if (!kind) continue;
    const k = [mat, gi, numS(sp[1]), numS(sp[2])].join('|'); const o = QQ.get(k) || QQ.set(k, {}).get(k);
    if (!o[kind] || per < o[kind].per) o[kind] = { it: p, per, wt: +p.perKg > 0 ? 1000 / +p.perKg : 0 };
  }
  return QQ;
}
/** 這個平華司在阡阡牌價的對應（{zn, plain}），對不到回 null */
export function qqFor(g) {
  const m = CODE.exec(g?.code || ''); if (!m || m[2] !== '1' || !/^平華司/.test(g.name || '')) return null;
  const parts = m[4].split('_')[0].split('*'); if (parts.length < 3) return null; const gi = idGroup(parts[0]); if (gi == null) return null;
  return qqIdx().get([m[1] === 'C' ? 'C' : 'A', gi, numS(parts[1]), numS(parts[2])].join('|')) || null;
}
const IDX = new WeakMap();
function idx(gm) {
  let x = IDX.get(gm); if (x) return x;
  const code = new Map(), heat = new Map(), wsh = new Map(), sib = new Map();
  for (const g of Object.values(gm)) {
    if (!g || !g.code) continue; code.set(g.code, g);
    const m = CODE.exec(g.code);
    if (m) {
      const sk = m[1] + m[2] + '|' + m[4]; (sib.get(sk) || sib.set(sk, []).get(sk)).push(g);   // 同規格同材質、各種表面處理
      if (WASHER.test(g.name || '')) { const k = washerKey(m); if (k) (wsh.get(k) || wsh.set(k, []).get(k)).push(g); }
    }
    if (/^H_/.test(g.code) && /熱處理/.test(g.name || '')) { const k = bare(g.code.slice(2)); (heat.get(k) || heat.set(k, []).get(k)).push(g); }
  }
  x = { code, heat, wsh, sib }; IDX.set(gm, x); return x;
}
/** 品項文字（品名裡尺寸前面那段），比對熱處理料號用 */
const itemOf = (name, sz) => { const n = String(name || ''); const i = n.indexOf(sz); return (i > 0 ? n.slice(0, i) : '').replace(/熱處理|⊕|螺絲|螺|\s|[MWU]$/g, ''); };
const like = (a, b) => { if (!a || !b) return false; if (a.includes(b) || b.includes(a)) return true; const s = new Set(a); let n = 0; for (const ch of new Set(b)) if (s.has(ch)) n++; return n / Math.min(a.length, b.length) >= 0.6; };

/** 加工料號（Z04、H_…）每 KG 的價格：取最接近（優先不晚於）這個日期的進貨；這些料號的單價本來就是每 KG，
 *  不管商品單位設成什麼；max 用來排除批價（例如熱處理不足量 500 元一批） */
/** 量少時一批的低消（數量 1、單價 100 元以上，例如熱處理 500、鍍鋅 1000 一批）是特例，不當每 KG 單價 */
export const isLot = x => x.q > 0 && x.q <= 1 && x.per >= 100;
function kgPrice(li, d, max) {
  const c = (li || []).filter(x => x.per > 0 && !isLot(x) && (!max || x.per <= max));
  c.sort((a, b) => (a.d > d) - (b.d > d) || Math.abs(a.d - d) - Math.abs(b.d - d));
  return c[0] || null;
}
const MEDIAN = new WeakMap();
function heatMedian(purIdx, heatMap) {
  if (MEDIAN.has(purIdx)) return MEDIAN.get(purIdx);
  const ps = []; for (const arr of heatMap.values()) for (const h of arr) for (const x of purIdx[h.id] || []) if (x.per > 0 && !isLot(x) && x.per <= 30) ps.push(x);
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
export function procCost(g, cls, f, date, d, purIdx, gm, wtOf, sane) {
  const m = CODE.exec(g?.code || ''); if (!m) return null;
  if (cls !== 'p' && cls !== 'kg') return null;
  const I = idx(gm); const map = procMap(); const r1 = n => Math.round(n * 100) / 100, r4 = n => Math.round(n * 10000) / 10000;
  const washer = WASHER.test(g.name || '');
  const per2 = (pc, w) => cls === 'p' ? pc * f : w > 0 ? pc / (w / 1000) * f : 0;
  // 熱處理（成品和同規格的其他表面處理一樣：同尺寸同品項）
  const h = m[3] === 'D' ? null : heatFor(g, gm); let heatKg = 0, heatSrc = '';
  if (h) {
    const hk = h.id ? kgPrice(purIdx[h.id], d, 30) : null;
    heatKg = hk ? hk.per : heatMedian(purIdx, I.heat);
    heatSrc = hk ? `${h.code} ${hk.no}` : `${h.code || '手動指定'}（沒有單價，用近期熱處理中位數）`;
  }
  /** 某種表面處理的加工費（每 KG）：D＝0；對照表沒有或沒有進價回 null */
  const feeOf = (t, heat) => {
    if (t === 'D') return { kg: 0, key: 'D', code: '' };
    const key = heat && map[t + '-H'] ? t + '-H' : washer && map[t + '-PW'] ? t + '-PW' : t;
    const pg = map[key] ? I.code.get(map[key]) : null; if (!pg) return null;
    const pk = kgPrice(purIdx[pg.id], d, 200); return pk ? { kg: pk.per, key, code: pg.code, pk } : null;
  };
  // 原料每 KG：論 KG 買就直接用；論支買用單重換算；換算後每 KG 要在 8～400 元之間（論支的單價可能是每百支、每千支，依序試）
  function kgOf(r, w) {
    const ok = v => v >= 8 && v <= 400;
    const rl = (purIdx[r.id] || []).filter(x => x.per > 0 && !isLot(x)).sort((a, b) => (a.d > d) - (b.d > d) || Math.abs(a.d - d) - Math.abs(b.d - d));
    for (const x of rl) {
      if (x.cls === 'kg') { if (ok(x.per)) return { kg: x.per, src: `${x.no}（${x.date}）` }; continue; }
      if (x.cls !== 'p' || !(w > 0)) continue;
      const k = [1, 100, 1000].find(k => ok(x.per / k / (w / 1000)));
      if (k) return { kg: x.per / k / (w / 1000), src: `${x.no}（${x.date}，每${k === 1 ? '' : k === 100 ? '百' : '千'}支 ${x.per}）` };
    }
    return null;
  }
  // 原料候選，依序：同料號的黑身／白皮（第 3 碼 D）→ 華司同內徑範圍的黑身 → 同規格同材質、其他表面處理的進價（扣掉它的加工費）→ 華司同內徑範圍的其他處理
  const tOf = r => CODE.exec(r.code)?.[3];
  const sibs = (I.sib.get(m[1] + m[2] + '|' + m[4]) || []).filter(r => r.id !== g.id);
  const wsh = washer ? (I.wsh.get(washerKey(m)) || []).filter(r => r.id !== g.id && !sibs.includes(r)) : [];
  const cands = [...sibs.filter(r => tOf(r) === 'D'), ...wsh.filter(r => tOf(r) === 'D'), ...sibs.filter(r => tOf(r) !== 'D' && tOf(r) !== m[3]), ...wsh.filter(r => tOf(r) !== 'D' && tOf(r) !== m[3])];
  let raw = null, rawKg = 0, rawSrc = '', wt = 0;
  for (const r of cands) {
    const w = (+g.wt > 0 ? +g.wt : 0) || wtOf(g) || wtOf(r); const v = kgOf(r, w); if (!v) continue;
    const t = tOf(r); const fe = feeOf(t, !!h); if (!fe) continue;
    const k = v.kg - fe.kg - (t !== 'D' && h ? heatKg : 0); if (!(k >= 3)) continue;
    raw = r; rawKg = k; wt = w;
    rawSrc = t === 'D' ? `${r.code} ${r1(v.kg)}/KG` : `${r.code}（${PROC_NAMES[fe.key] || fe.key}）進價 ${r1(v.kg)}/KG 扣${PROC_NAMES[fe.key] || fe.key} ${r1(fe.kg)}/KG${h ? `、熱處理 ${r1(heatKg)}/KG` : ''}`;
    break;
  }
  // 估不出單重、成品又論支：直接用同規格其他處理的每支進價（加工費差額沒辦法換算，不計）
  if (!raw && cls === 'p') {
    for (const r of cands) {
      if ((+g.wt > 0) || wtOf(g) || wtOf(r)) continue;
      const x = (purIdx[r.id] || []).filter(x => x.cls === 'p' && x.per > 0 && !isLot(x)).sort((a, b) => (a.d > d) - (b.d > d) || Math.abs(a.d - d) - Math.abs(b.d - d))[0];
      const k = x && [1, 100, 1000].find(k => !sane || sane(x.per / k * f, 0.03, 3));   // 單價可能是每百支、每千支：跟售價比對
      if (x && k) return { c: x.per / k * f, src: `同規格其他處理的進價：${r.code} ${x.no}（${x.date}）每${k === 1 ? '' : k === 100 ? '百' : '千'}支 ${r4(x.per)}（估不出單重，加工費差額未計）` };
    }
  }
  // 都沒有進價的平華司：阡阡牌價（單重有實測用實測，沒有用牌價的每 KG 幾個）
  const qq = !raw ? qqFor(g) : null; const mult = qqMult();
  if (!raw && qq) {
    const w = (+g.wt > 0 ? +g.wt : 0) || qq.zn?.wt || qq.plain?.wt || wtOf(g);
    if (m[3] === 'A' && qq.zn) { const c = per2(qq.zn.per * mult, w); if (c > 0) return { c, src: `阡阡牌價：${qq.zn.it.name} ${qq.zn.it.spec} 鍍鋅 ${r4(qq.zn.per)}×${mult}${cls === 'p' ? '' : `，單重 ${r4(w)}g`}` }; }
    let pc = 0, src = '';
    if (qq.plain) { pc = qq.plain.per * mult; src = `阡阡 ${qq.plain.it.name} ${qq.plain.it.spec} 光面 ${r4(qq.plain.per)}×${mult}`; }
    else if (qq.zn && w > 0) { const z = feeOf('A', false)?.kg || 0; pc = qq.zn.per * mult - z * w / 1000; src = `阡阡 ${qq.zn.it.name} ${qq.zn.it.spec} 鍍鋅 ${r4(qq.zn.per)}×${mult} 扣鍍鋅 ${z}/KG`; }
    if (pc > 0 && w > 0) { raw = { id: '', code: '' }; rawKg = pc / (w / 1000); rawSrc = src; wt = w; }
  }
  if (!raw || (cls === 'p' && !(wt > 0))) return null;
  // 黑身／白皮本身：就是上面算出的原料
  if (m[3] === 'D') {
    const c = cls === 'kg' ? rawKg * f : rawKg * wt / 1000 * f; if (!(c > 0)) return null;
    return { c, src: `${raw.id ? '同規格其他處理推算' : '阡阡牌價'}：${rawSrc}${cls === 'p' ? `，單重 ${r4(wt)}g` : ''}`, proc: { raw: raw.id, rawKg, rawSrc, wt } };
  }
  // 成品：原料＋熱處理＋表面處理加工費
  const fe = feeOf(m[3], !!h); if (!fe) return null;
  const kg = rawKg + heatKg + fe.kg;
  const c = cls === 'kg' ? kg * f : kg * wt / 1000 * f;
  if (!(c > 0)) return null;
  const src = `加工成本：原料 ${rawSrc}${heatKg ? `＋熱處理 ${r1(heatKg)}/KG` : ''}＋${PROC_NAMES[fe.key] || fe.key} ${fe.code} ${r1(fe.kg)}/KG${cls === 'p' ? `，單重 ${r4(wt)}g` : ''}`;
  return { c, src, proc: { raw: raw.id, rawKg, rawSrc, heat: h ? (h.code || '手動') : '', heatKg, heatSrc, pg: fe.code, pgKg: fe.kg, pgSrc: fe.pk ? `${fe.pk.no}（${fe.pk.date}）` : '', wt } };
}
