// 特殊品估價：依牙徑、長度、材質、數量估久允／澤發的大概報價（2026-11-25，從 111～115 年報價單反推）
// 每家廠商報價自有一套，所以分開算；誤差約 ±20%，只當參考，正式還是要詢價。
// 方法：估重量（圓柱，頭部約 1.2 倍牙徑長）→ 查「每公斤單價」表（依重量內插）→ 數量、電鍍調整。
// 歷史報價明細在 settings 的 quoteRef（{rows:[...]}），列出相似的舊報價對照。

// 每公斤單價表：[每支重量 g（該段中位）, 元/kg]，資料是含電鍍、1～3 萬支的報價中位數
export const EST_BANDS = {
  久允: {
    鐵: [[1.07, 312], [2.47, 195], [3.88, 146], [9.37, 107], [18.65, 83], [30.91, 84]],
    1022: [[0.35, 780], [2.44, 185], [4.5, 114], [7.36, 105], [14.7, 86]],
    合金: [[0.87, 524], [2.09, 280], [4.1, 170], [8.71, 132], [17.6, 119]],
    白鐵: [[0.81, 657], [2.25, 234], [4.01, 200], [7.82, 191], [14.56, 206], [28.39, 134]],
  },
  澤發: {
    1022: [[0.81, 113], [2.31, 87], [3.39, 91]],
    白鐵: [[0.58, 469], [1.85, 235], [4.48, 246], [7.86, 159], [16.02, 154], [28.39, 134]],
  },
};
// 澤發資料不夠的地方，用「久允 × 比例」推估（同重量特殊品中位數的比）
export const EST_RATIO = { 澤發: { 鐵: 0.47, 1022: 0.55, 合金: 0.75, 白鐵: 0.85 } };
// 線材 元/kg（隆勝、星宇、幸利、澤發商品「線材」欄的中位數）
export const WIRE = { 鐵: 44, 1022: 38, 合金: 55, 白鐵: 108 };
export const EST_MATS = ['鐵', '1022', '合金', '白鐵'];
export const EST_VENDORS = ['久允', '澤發'];
const INCH = { '1/8': 3.18, '5/32': 3.97, '3/16': 4.76, '1/4': 6.35, '5/16': 7.94, '3/8': 9.53, '7/16': 11.11, '1/2': 12.7, '5/8': 15.88, '3/4': 19.05, '7/8': 22.23, '1': 25.4 };
const NUMS = { 2: 2.18, 3: 2.51, 4: 2.84, 5: 3.18, 6: 3.51, 7: 3.84, 8: 4.17, 9: 4.5, 10: 4.83, 12: 5.49, 14: 6.3 };

/** 牙徑文字 → mm：M4、4、4.8、1/4、1/4"、#8、8#、2分 */
export function parseDia(s) {
  s = String(s || '').trim().replace(/[＃]/g, '#').replace(/["”″吋]/g, '').replace(/\s+/g, '');
  if (!s) return 0;
  let m = s.match(/^[Mm]?(\d+(?:\.\d+)?)$/); if (m) return +m[1];
  m = s.match(/^(?:W)?(\d+\/\d+)$/i); if (m && INCH[m[1]]) return INCH[m[1]];
  m = s.match(/^#(\d+)$/) || s.match(/^(\d+)#$/); if (m && NUMS[m[1]]) return NUMS[m[1]];
  m = s.match(/^(\d)分(半)?$/); if (m) return 25.4 * (+m[1] + (m[2] ? 0.5 : 0)) / 8;
  return 0;
}
/** 長度文字 → mm：25、25mm、1"、1-1/2"、3/4"、1-1/2 */
export function parseLen(s) {
  s = String(s || '').trim().replace(/mm$/i, '').replace(/[”″吋]/g, '"').replace(/\s+/g, '');
  if (!s) return 0;
  let m = s.match(/^(\d+(?:\.\d+)?)$/); if (m) return +m[1];
  m = s.match(/^(\d+)"$/); if (m) return +m[1] * 25.4;
  m = s.match(/^(?:(\d+)-)?(\d+)\/(\d+)"?$/); if (m) return 25.4 * ((+m[1] || 0) + +m[2] / +m[3]);
  return 0;
}
/** 估重量 g／支：桿部圓柱＋頭部約 1.2 倍牙徑（跟建表時的算法一樣） */
export const estGram = (d, L) => d > 0 && L > 0 ? Math.PI / 4 * d * d * (L + 1.2 * d) * 7.85 / 1000 : 0;

// 在 [g, 元/kg] 表上用對數內插；超出範圍回 null
function interp(tab, w) {
  if (!tab || !tab.length || !(w > 0)) return null;
  if (w < tab[0][0] * 0.7 || w > tab[tab.length - 1][0] * 1.4) return null;
  if (w <= tab[0][0]) return tab[0][1];
  if (w >= tab[tab.length - 1][0]) return tab[tab.length - 1][1];
  for (let i = 1; i < tab.length; i++) if (w <= tab[i][0]) {
    const [w0, p0] = tab[i - 1], [w1, p1] = tab[i], t = Math.log(w / w0) / Math.log(w1 / w0);
    return Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)));
  }
  return null;
}
// 超出久允表的範圍：小的用最小一段、大的用最大一段（再大就用線材×2 當底）
function clampJy(tab, w) { return w < tab[0][0] ? tab[0][1] : tab[tab.length - 1][1]; }

/** 數量係數（以 1～2 萬支為 1） */
export function qtyFactor(q) {
  q = +q || 0; if (!q) return 1;
  return q < 3000 ? 1.35 : q < 8000 ? 1.15 : q < 15000 ? 1 : q < 40000 ? 0.95 : q < 80000 ? 0.9 : 0.85;
}

/**
 * 估價
 * @param {{d:number, L:number, mat:string, qty:number, plating:boolean, wt?:number}} o
 * @returns {{w:number, wire:number, rows:Array<{vendor, ppk, price, lo, hi, src}>}}
 */
export function estimate(o) {
  const w = +o.wt > 0 ? +o.wt : estGram(o.d, o.L);
  const mat = EST_MATS.includes(o.mat) ? o.mat : '鐵';
  const wire = w * (WIRE[mat] || 44) / 1000 / 0.9;   // 料損約一成
  const qf = qtyFactor(o.qty);
  const rows = [];
  if (!(w > 0)) return { w: 0, wire: 0, rows };
  const jyTab = EST_BANDS.久允[mat];
  let jy = interp(jyTab, w), jySrc = '久允報價表';
  if (jy == null) { jy = clampJy(jyTab, w); jySrc = '超出久允報價資料的重量範圍，用最接近的一段估（誤差較大）'; }
  for (const v of EST_VENDORS) {
    let ppk, src;
    if (v === '久允') { ppk = jy; src = jySrc; }
    else {
      const own = interp(EST_BANDS[v]?.[mat], w);
      if (own != null) { ppk = own; src = `${v}報價表`; }
      else { ppk = jy * (EST_RATIO[v]?.[mat] || 1); src = `${v}這個材質／重量的報價少，用久允 × ${EST_RATIO[v]?.[mat]} 推估`; }
    }
    let ppkAdj = ppk - (o.plating === false ? 20 : 0);   // 白皮（不電鍍）少約 20 元/kg
    let price = ppkAdj * w / 1000 * qf;
    const floor = wire * 1.3;                              // 不會低於料錢太多
    if (price < floor) { price = floor; src += '；低於線材成本，以線材×1.3 為底'; }
    rows.push({ vendor: v, ppk: Math.round(ppkAdj), price, lo: price * 0.8, hi: price * 1.2, src });
  }
  return { w, wire, qf, rows };
}

const specKey = s => String(s || '').toUpperCase().replace(/[*X]/g, '×').replace(/\s+/g, '');
/** 從歷史報價找相似的：同材質、重量差在 ±45% 內，越近、越新越前面 */
export function similarQuotes(rows, o, w, n = 10) {
  if (!Array.isArray(rows) || !(w > 0)) return [];
  const mat = o.mat;
  return rows.filter(r => r.m === mat && r.w > 0 && r.p > 0 && Math.abs(Math.log(r.w / w)) < Math.log(1.45))
    .map(r => ({ ...r, score: Math.abs(Math.log(r.w / w)) - (parseInt(r.dt) || 110) * 0.01 + (o.d && r.d ? Math.abs(r.d - o.d) / o.d * 0.6 : 0) }))
    .sort((a, b) => a.score - b.score)
    .filter((r, i, a) => a.findIndex(x => x.v === r.v && x.p === r.p && x.q === r.q && specKey(x.s) === specKey(r.s)) === i)   // 同一張報價掃了兩次
    .slice(0, n);
}
