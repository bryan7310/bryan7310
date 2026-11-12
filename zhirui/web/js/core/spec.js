// 規格與圖面：從品名解析品類／公稱徑／長度／材質，查標準尺寸，估算單重，畫側視圖＋頭部視圖（移植自舊進銷存）
import { esc } from './util.js';

export const SP_TYPES = [['pan', '圓頭（盤頭）螺絲'], ['flat', '皿頭（平頭）螺絲'], ['truss', '大扁頭螺絲'], ['oval', '喇叭頭螺絲'], ['wface', '華司面螺絲'], ['cap', '內六角圓柱頭（CAP）'], ['csk', '皿頭內六角螺絲'], ['btn', '半圓內六角螺絲'], ['set', '止付螺絲'], ['hex', '六角螺絲'], ['hexf', '六角華司面／突緣螺絲'], ['carriage', '馬車螺絲'], ['stud', '雙頭牙／牙條'], ['nut', '六角螺帽'], ['fw', '平華司'], ['sw', '彈簧華司'], ['other', '其他（不畫圖）']];
export const SP_DRIVES = [['cross', '十字 ⊕'], ['slot', '一字 Θ'], ['combo', '十字一字 ⊕Θ'], ['hexsock', '內六角'], ['torx', '星型'], ['pozi', '米字'], ['ext', '外六角'], ['none', '無']];
export const SP_TAILS = [['flat', '平尾'], ['point', '尖尾（自攻）'], ['drill', '鑽尾'], ['cut', '割尾']];
export const SP_TH = [['M', '公制 M'], ['W', '英制 W（UNC/BSW）'], ['U', '美規 #（U）'], ['ST', '自攻牙 ST']];
export const SP_FIELDS = [['type', '品類／頭型', SP_TYPES], ['drive', '起子孔', SP_DRIVES], ['th', '牙別', SP_TH], ['d', '公稱徑'], ['L', '長度 L (mm)'], ['p', '牙距'], ['b', '牙長 b (mm)'], ['tail', '尾型', SP_TAILS], ['mat', '材質'], ['grade', '強度／鋼種'], ['fin', '表面處理'], ['extra', '其他加工'], ['dk', '頭徑 dk／外徑'], ['k', '頭高 k／厚度'], ['s', '對邊 s'], ['std', '參考標準'], ['snote', '規格備註']];
// 標準尺寸表（公稱徑 mm → 尺寸）
const SP_TBL = {
  pan: { std: 'JIS B 1111／ISO 7045', c: ['dk', 'k'], r: { 1.6: [3.2, 1.3], 2: [4, 1.6], 2.5: [5, 2.1], 3: [5.6, 2.4], 3.5: [7, 2.6], 4: [8, 3.1], 5: [9.5, 3.7], 6: [12, 4.6], 8: [16, 6], 10: [20, 7.5] } },
  flat: { std: 'JIS B 1111／ISO 7046', c: ['dk', 'k'], r: { 1.6: [3, 1], 2: [3.8, 1.2], 2.5: [4.7, 1.5], 3: [5.5, 1.65], 3.5: [7.3, 2.35], 4: [8.4, 2.7], 5: [9.3, 2.7], 6: [11.3, 3.3], 8: [15.8, 4.65], 10: [18.3, 5] } },
  truss: { std: 'JIS B 1111（トラス）', c: ['dk', 'k'], r: { 2: [4, 1.2], 2.5: [5, 1.5], 3: [6, 1.8], 3.5: [7, 2.1], 4: [8, 2.4], 5: [10, 3], 6: [12, 3.6], 8: [16, 4.8] } },
  cap: { std: 'JIS B 1176／ISO 4762', c: ['dk', 'k', 's'], r: { 2: [3.8, 2, 1.5], 2.5: [4.5, 2.5, 2], 3: [5.5, 3, 2.5], 4: [7, 4, 3], 5: [8.5, 5, 4], 6: [10, 6, 5], 8: [13, 8, 6], 10: [16, 10, 8], 12: [18, 12, 10], 14: [21, 14, 12], 16: [24, 16, 14], 20: [30, 20, 17], 24: [36, 24, 19] } },
  csk: { std: 'ISO 10642', c: ['dk', 'k', 's'], r: { 3: [6.72, 1.86, 2], 4: [8.96, 2.48, 2.5], 5: [11.2, 3.1, 3], 6: [13.44, 3.72, 4], 8: [17.92, 4.96, 5], 10: [22.4, 6.2, 6], 12: [26.88, 7.44, 8], 16: [33.6, 8.8, 10], 20: [40.32, 10.16, 12] } },
  btn: { std: 'ISO 7380', c: ['dk', 'k', 's'], r: { 3: [5.7, 1.65, 2], 4: [7.6, 2.2, 2.5], 5: [9.5, 2.75, 3], 6: [10.5, 3.3, 4], 8: [14, 4.4, 5], 10: [17.5, 5.5, 6], 12: [21, 6.6, 8], 16: [28, 8.8, 10] } },
  set: { std: 'JIS B 1177／ISO 4026', c: ['s'], r: { 2: [0.9], 2.5: [1.3], 3: [1.5], 4: [2], 5: [2.5], 6: [3], 8: [4], 10: [5], 12: [6], 16: [8], 20: [10] } },
  hex: { std: 'JIS B 1180／ISO 4017・4014', c: ['s', 'k'], r: { 3: [5.5, 2], 4: [7, 2.8], 5: [8, 3.5], 6: [10, 4], 8: [13, 5.3], 10: [16, 6.4], 12: [18, 7.5], 14: [21, 8.8], 16: [24, 10], 20: [30, 12.5], 24: [36, 15] } },
  nut: { std: 'JIS B 1181／ISO 4032', c: ['s', 'm'], r: { 3: [5.5, 2.4], 4: [7, 3.2], 5: [8, 4.7], 6: [10, 5.2], 8: [13, 6.8], 10: [16, 8.4], 12: [18, 10.8], 14: [21, 12.8], 16: [24, 14.8], 20: [30, 18], 24: [36, 21.5] } },
  fw: { std: 'JIS B 1256／ISO 7089', c: ['d1', 'D', 't'], r: { 3: [3.2, 7, 0.5], 4: [4.3, 9, 0.8], 5: [5.3, 10, 1], 6: [6.4, 12, 1.6], 8: [8.4, 16, 1.6], 10: [10.5, 20, 2], 12: [13, 24, 2.5], 16: [17, 30, 3], 20: [21, 37, 3] } },
  sw: { std: 'JIS B 1251（一般用）', c: ['d1', 'b', 't'], r: { 3: [3.1, 1.1, 0.7], 4: [4.1, 1.4, 1], 5: [5.1, 1.7, 1.3], 6: [6.1, 2.7, 1.5], 8: [8.2, 3.2, 2], 10: [10.2, 3.7, 2.5], 12: [12.2, 4.2, 3.1], 16: [16.2, 5.2, 4], 20: [20.2, 6.1, 5.1], 24: [24.5, 7.1, 5.9] } },
};
SP_TBL.oval = { ...SP_TBL.flat, std: 'JIS B 1111（丸皿）參考' };
SP_TBL.carriage = { std: 'JIS B 1171（根角丸頭）參考', c: ['dk', 'k'], r: { 5: [11, 3], 6: [13, 3.5], 8: [17, 4.5], 10: [21, 5.5], 12: [25, 6.5] } };
SP_TBL.wface = { std: '比例示意（無統一標準）', c: ['dk', 'k'], r: { 3: [7, 2.4], 3.5: [8, 2.6], 4: [9, 3], 5: [11, 3.5], 6: [13, 4] } };
SP_TBL.hexf = { std: 'JIS B 1189 參考', c: ['s', 'k'], r: { 5: [8, 5.4], 6: [10, 6.6], 8: [12, 8.1], 10: [14, 9.2], 12: [17, 11.5] } };
const SP_PITCH = { 1.6: .35, 2: .4, 2.3: .4, 2.5: .45, 2.6: .45, 3: .5, 3.5: .6, 4: .7, 5: .8, 6: 1, 7: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3, 27: 3, 30: 3.5, 36: 4 };
const SP_TPI = { '1/8': 40, '5/32': 32, '3/16': 24, '7/32': 24, '1/4': 20, '5/16': 18, '3/8': 16, '7/16': 14, '1/2': 13, '9/16': 12, '5/8': 11, '3/4': 10, '7/8': 9, '1': 8 };
const SP_NUM = { 2: 2.18, 3: 2.51, 4: 2.84, 5: 3.18, 6: 3.51, 7: 3.84, 8: 4.17, 10: 4.83, 12: 5.48, 14: 6.3 };
const SP_NUMTPI = { 2: 56, 3: 48, 4: 40, 5: 40, 6: 32, 8: 32, 10: 24, 12: 24, 14: 20 };
const SP_STP = { 2.2: .8, 2.9: 1.1, 3.5: 1.3, 4.2: 1.4, 4.8: 1.6, 5.5: 1.8, 6.3: 1.8 };
export const spLab = (list, k) => (list.find(x => x[0] === k) || [, k || ''])[1];
const r2 = n => Math.round(n * 100) / 100;
function spFrac(s) {
  s = String(s).trim(); let m;
  if ((m = s.match(/^(\d+)-(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return +m[1];
  return NaN;
}
/** 從品名（＋料號、類別）解析規格 */
export function spParse(g) {
  const n = String(g.name || '').replace(/[　\s]+/g, ' ').replace(/[×xX＊]/g, '*'); const code = String(g.code || ''); const r = {};
  const has = re => re.test(n); const scr = /螺絲|螺栓|鑽尾|尖尾|釘螺|鐵板牙|快速牙|自攻|木牙/.test(n);
  const T = [[/尼龍螺帽|尼帽|螺帽|螺母/, 'nut'], [/平華司/, 'fw'], [/彈簧華司/, 'sw'], [/(皿頭|埋頭|平頭)(花齒)?內六角/, 'csk'], [/(半圓|圓頭|盤頭|鈕扣)內六角/, 'btn'], [/止付/, 'set'], [/CAP|內六角螺絲|內六角孔螺栓/, 'cap'], [/六角.*(突緣|華司面|法蘭)/, 'hexf'], [/六角.*(螺絲|螺栓|鑽尾|尖尾)/, 'hex'], [/雙頭牙|牙條|全牙螺桿/, 'stud'], [/馬車/, 'carriage'], [/大扁/, 'truss'], [/喇叭/, 'oval'], [/皿頭|平頭/, 'flat'], [/華司面/, 'wface'], [/圓頭|盤頭|圓平頭|胖頭/, 'pan']];
  for (const [re, k] of T) { if (!re.test(n)) continue; if (['truss', 'oval', 'flat', 'wface', 'pan', 'hex', 'hexf', 'carriage', 'cap', 'csk', 'btn'].includes(k) && !scr) continue; r.type = k; break; }
  if (!r.type) r.type = 'other';
  // 起子孔
  r.drive = ['hex', 'hexf', 'nut'].includes(r.type) ? (has(/十字/) ? 'combo' : 'ext') : ['cap', 'csk', 'btn', 'set'].includes(r.type) ? (has(/星型|T\d{1,2}\b/) ? 'torx' : 'hexsock') : ['fw', 'sw', 'stud', 'carriage', 'other'].includes(r.type) ? 'none' :
    has(/星型|T\d{1,2}螺絲|T\d{1,2}\b/) ? 'torx' : has(/米字/) ? 'pozi' : has(/⊕Θ|十字一字/) ? 'combo' : has(/Θ|一字/) && !has(/⊕|十字/) ? 'slot' : 'cross';
  if (r.type === 'hex' && has(/十字/)) r.drive = 'combo';
  // 牙別與公稱徑（料號第 4 碼 M／W／U 也參考）
  const cth = (code.match(/^[A-Z]\d[A-Z]([MWU])/) || [])[1];
  const n0 = n; let pos = -1; const end = x => x.index + x[0].length;
  const m = n.match(/(?:^|[^A-Za-z-])M(\d+(?:\.\d+)?)/);
  const mw = n.match(/W?\s?(\d+-\d+\/\d+|\d+\/\d+)(?=\s*[*"吋\s-]|$)/) || n.match(/W?(\d)(?=")/);
  const mu = n.match(/U?#?(\d{1,2})#|#(\d{1,2})\b/);
  if (m && (cth !== 'W' && cth !== 'U' || !mw && !mu)) { r.th = 'M'; r.d = m[1]; pos = end(m); }
  else if (mu && (cth === 'U' || !mw || cth !== 'W' && mu.index < mw.index)) { r.th = 'U'; r.d = '#' + (mu[1] || mu[2]); pos = end(mu); }
  else if (mw) { r.th = 'W'; r.d = mw[1]; pos = end(mw); }
  else if (m) { r.th = 'M'; r.d = m[1]; pos = end(m); }
  else { const re = /(?:^|[^\d.-])(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)/g; let q; while ((q = re.exec(n))) { if (+q[1] <= 30) { r.th = cth || 'M'; r.d = q[1]; pos = q.index + q[0].indexOf(q[1]) + q[1].length; break; } } }
  const tap = /鐵板|木螺絲|快速牙|尖尾|鑽尾|割尾|自攻/.test(n);
  r.tail = has(/鑽尾/) ? 'drill' : has(/割尾/) ? 'cut' : tap ? 'point' : 'flat';
  if (['nut', 'fw', 'sw', 'other'].includes(r.type)) delete r.tail;
  // 長度
  const after = pos >= 0 ? n0.slice(pos) : '';
  const mm = after.match(/\((\d+(?:\.\d+)?)\s*mm\)/i);
  if (!['nut', 'fw', 'sw'].includes(r.type)) {
    const lm = after.match(/^#?\s*(?:-\d+)?\s*(?:-?P?\d?\.?\d*)?\s*\*\s*(吋\d+|\d+(?:\.\d+)?吋|\d+分半?|\d+-\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(\s*(?:"|吋|L|mm|m\/m|M(?![\d.])))?/);
    if (lm) {
      const v = lm[1], unit = (lm[2] || '').trim(); r.Lraw = v + (unit === '"' || unit === '吋' ? '"' : '');
      if (mm) r.L = mm[1];
      else if (unit === 'M') r.L = String(+v * 1000);
      else if (/分/.test(v)) r.L = String(r2((parseInt(v) + (/半/.test(v) ? .5 : 0)) / 8 * 25.4));
      else if (/吋/.test(v)) { const x = parseFloat(v.replace('吋', '')); r.L = String(r2(x * 25.4)); }
      else if (unit === '"' || unit === '吋' || /\//.test(v) || (r.th !== 'M' && +v <= 6 && unit !== 'mm' && unit !== 'L' && unit !== 'm/m')) r.L = String(r2(spFrac(v) * 25.4));
      else r.L = v;
    }
  }
  // 牙距
  const pm = n.match(/P\s*-?\s*(\d+(?:\.\d+)?)/) || n.match(/M\d+(?:\.\d+)?-(\d(?:\.\d+)?)\b/);
  if (pm && r.th === 'M') r.p = pm[1];
  if (r.th === 'M' && tap && r.type !== 'other') r.th = 'ST';
  if (!r.p) {
    const dd = +r.d;
    if (r.th === 'M' && SP_PITCH[dd]) r.p = String(SP_PITCH[dd]);
    else if (r.th === 'ST') { const k = Object.keys(SP_STP).map(Number).reduce((a, b) => Math.abs(b - dd) < Math.abs(a - dd) ? b : a, 99); r.p = String(SP_STP[k]) + '（參考）'; }
    else if (r.th === 'W' && SP_TPI[r.d]) r.p = SP_TPI[r.d] + ' 牙/吋';
    else if (r.th === 'U') { const k = +String(r.d).replace('#', ''); if (SP_NUMTPI[k]) r.p = SP_NUMTPI[k] + ' 牙/吋'; }
  }
  if (/UNF|細牙/.test(n)) r.p = (r.p || '') + '（細牙）';
  // 牙長
  const bm = n.match(/牙(?:長)?\s*(\d+(?:\.\d+)?)\s*(?:mm|m\/m)?/); if (bm) r.b = bm[1];
  else if (/半牙/.test(n) && r.d && r.L) { const D = spDia(r); if (D) r.b = String(Math.round(+r.L <= 125 ? 2 * D + 6 : 2 * D + 12)); r.bRef = 1; }
  // 材質
  const mats = [[/SUS\s?316/, '不鏽鋼 SUS316'], [/SUS\s?410/, '不鏽鋼 SUS410'], [/SUS\s?420|白鐵420/, '不鏽鋼 SUS420'], [/SUS\s?304|白鐵304/, '不鏽鋼 SUS304'], [/白鐵|不鏽鋼|SUS/, '不鏽鋼'], [/青銅/, '青銅'], [/黃銅|銅/, '銅'], [/合金/, '合金鋼'], [/中碳/, '中碳鋼'], [/彈簧/, '彈簧鋼'], [/壓鑄/, '鋅合金壓鑄'], [/鋁/, '鋁'], [/塑膠|尼龍(?!螺帽)/, '塑膠'], [/鐵/, '低碳鋼（鐵）']];
  const nm = n.replace(/(紅|青)?古銅|鍍銅|電銅底|銅底/g, ''); for (const [re, v] of mats) if (re.test(nm)) { r.mat = v; break; }
  if (!r.mat && g.cat && g.cat !== '代工') r.mat = g.cat === '鐵' ? '低碳鋼（鐵）' : g.cat;
  const gm = n.match(/\b(12\.9|10\.9|8\.8|4\.8|1022|10B21|1018|SCM\s?435|435|40ACR|SWCH\w*)\b/); if (gm) r.grade = gm[1] === '435' ? 'SCM435' : gm[1];
  // 表面處理
  const fins = ['三價白鋅', '三價黑鋅', '三價鋅', '鍍錏黑', '錏黑', '鍍鋅', '染黑', '五彩', '黑鎳', '鍍鎳', '鍍鉻', '紅古銅', '青古銅', '古銅', '磷酸', '達克羅', '黑身', '白皮', '原色', '洗油'];
  for (const f of fins) if (n.includes(f)) { r.fin = f === '黑身' || f === '白皮' ? '黑身（無處理）' : f === '原色' ? '原色（無處理）' : f; break; }
  if (!r.fin && r.mat?.startsWith('不鏽鋼')) r.fin = '原色（無處理）';   // 品名「白鐵原色」已簡化成「白鐵」：白鐵沒寫表面處理＝原色
  const ex = []; if (/耐落/.test(n)) ex.push('耐落'); if (/防鬆/.test(n)) ex.push('防鬆'); if (/附S&平華司|附彈墊|S&平華司/.test(n)) ex.push('附彈簧墊圈＋平墊圈'); if (/穿.{0,2}墊片/.test(n)) ex.push((n.match(/穿.{0,2}墊片/) || [''])[0]); if (/熱處理/.test(n)) ex.push('熱處理'); if (ex.length) r.extra = ex.join('、');
  // 品名上的實際尺寸
  const hm = n.match(/(?:頭部?|外緣|T=)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/); if (hm && !['nut', 'fw', 'sw'].includes(r.type)) r.dk = hm[1];
  const sb = n.match(/(\d{1,2})B\b/); if (sb && ['hex', 'hexf', 'nut'].includes(r.type)) r.s = sb[1];
  if (r.type === 'nut') { const q = n.match(/M\d+(?:\.\d+)?(?:-[\d.]+)?\s*\*\s*(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)/); if (q) { r.s = q[1]; r.k = q[2]; } const t = n.match(/厚\s*(\d+(?:\.\d+)?)/); if (t) r.k = t[1]; }
  if (r.type === 'fw') { const q = n.match(/(?:M|W)?(\d+(?:\.\d+)?|\d+\/\d+)\s*\*\s*(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)/); if (q) { r.dk = q[2]; r.k = q[3]; r.d1 = q[1]; } }
  r.std = (SP_TBL[r.type] || {}).std || '';
  return r;
}
/** 公稱徑換成 mm */
export function spDia(sp) {
  const d = String(sp.d || '').trim(); if (!d) return 0;
  if (sp.th === 'U' || /^#/.test(d)) { const k = +d.replace(/#/g, ''); return SP_NUM[k] || 0; }
  if (sp.th === 'W' || /\//.test(d)) { const v = spFrac(d); return v ? r2(v * 25.4) : 0; }
  return parseFloat(d) || 0;
}
/** 自動解析值＋商品上手動修正的規格（g.sp） */
export function spGet(g) {
  const a = spParse(g), o = g.sp || {}; const r = { ...a, _wt: g.wt };
  for (const [k] of SP_FIELDS) if (o[k] != null && o[k] !== '') r[k] = o[k];
  if (o.type && o.type !== a.type && !o.std) r.std = (SP_TBL[o.type] || {}).std || '';
  return r;
}
// 查表：精確→標準；中間→內插；超出→比例
function spLook(type, D) {
  const t = SP_TBL[type]; if (!t || !D) return null; const ks = Object.keys(t.r).map(Number).sort((a, b) => a - b);
  if (t.r[D]) return { v: t.r[D], src: 'std' };
  let lo = null, hi = null; for (const k of ks) { if (k < D) lo = k; if (k > D && hi == null) hi = k; }
  if (lo != null && hi != null) { const f = (D - lo) / (hi - lo); return { v: t.r[lo].map((x, i) => r2(x + (t.r[hi][i] - x) * f)), src: 'interp' }; }
  const k = lo ?? hi; return { v: t.r[k].map(x => r2(x * D / k)), src: 'scale' };
}
export function spDims(sp) {
  const D = spDia(sp); const out = { D, src: {} }; const t = SP_TBL[sp.type]; const lk = spLook(sp.type, D);
  if (t && lk) t.c.forEach((c, i) => { out[c] = lk.v[i]; out.src[c] = lk.src; });
  if (sp.type === 'nut' && out.m != null) { out.k = out.m; out.src.k = out.src.m; }
  if (sp.type === 'fw') { out.dk = out.D; out.src.dk = out.src.D; out.k = out.t; out.src.k = out.src.t; out.D = D; }
  if (sp.type === 'sw') { out.bw = out.b; out.dk = out.d1 + 2 * out.b; out.k = out.t; out.src.dk = out.src.k = out.src.t; }
  for (const k of ['dk', 'k', 's']) if (sp[k] && +sp[k] > 0) { out[k] = +sp[k]; out.src[k] = 'name'; }
  if (sp.type === 'fw' && sp.d1) out.d1 = +sp.d1 || out.d1;
  out.L = parseFloat(sp.L) || 0; out.b = parseFloat(sp.b) || 0;
  const pm = parseFloat(sp.p); out.P = sp.th === 'M' && pm ? pm : sp.th === 'ST' && pm ? pm : /牙\/吋/.test(sp.p || '') ? r2(25.4 / parseFloat(sp.p)) : 0;
  if (!out.dk && ['pan', 'truss', 'wface', 'carriage'].includes(sp.type) && D) { out.dk = r2(D * 2); out.k = r2(D * .7); out.src.dk = out.src.k = 'scale'; }
  return out;
}
const SRC_TXT = { std: '標準值', interp: '內插估算', scale: '比例估算', name: '品名標示' };
// 單重估算（g／支）：依標準尺寸算體積 × 材質密度
function spDens(mat) { mat = String(mat || ''); return /不鏽鋼|SUS|白鐵/.test(mat) ? 7.93 : /青銅/.test(mat) ? 8.8 : /銅/.test(mat) ? 8.5 : /壓鑄|鋅合金/.test(mat) ? 6.6 : /鋁/.test(mat) ? 2.7 : /塑膠|尼龍/.test(mat) ? 1.15 : 7.85; }
export function spWeight(sp, dm) {
  dm = dm || spDims(sp); const ty = sp.type, D = dm.D; if (ty === 'other' || !D && !['fw', 'sw'].includes(ty)) return 0;
  const PI = Math.PI, cyl = (d, l) => PI / 4 * d * d * l, P = dm.P || D * .15, d2 = Math.max(D - 0.65 * P, D * .8); const dk = dm.dk || 0, k = dm.k || 0, s = dm.s || 0, L = dm.L || 0; let v = 0;
  if (ty === 'nut') v = 0.866 * s * s * k * 0.95 - cyl(D, k);
  else if (ty === 'fw') v = PI / 4 * ((dk || D * 2) ** 2 - (dm.d1 || D * 1.05) ** 2) * (k || D * .15);
  else if (ty === 'sw') v = PI / 4 * ((dm.d1 + 2 * dm.bw) ** 2 - dm.d1 ** 2) * dm.t;
  else {
    if (!L) return 0; const inHead = ['flat', 'csk', 'oval'].includes(ty); const shank = inHead ? Math.max(L - k, 0) : L;
    v += cyl(d2, shank); if (sp.tail === 'point' || sp.tail === 'drill') v -= cyl(d2, Math.min(D, shank)) * 0.6;
    if (ty === 'pan') v += cyl(dk, k) * .85; else if (ty === 'truss') v += cyl(dk, k) * .7; else if (ty === 'btn') v += cyl(dk, k) * .62 - 0.866 * s * s * k * .5;
    else if (inHead) v += PI * k / 12 * (dk * dk + dk * D + D * D) - (ty === 'csk' ? 0.866 * s * s * k * .6 : 0);
    else if (ty === 'cap') v += cyl(dk, k) * .98 - 0.866 * s * s * k * .55;
    else if (ty === 'hex') v += 0.866 * s * s * k * .95; else if (ty === 'hexf') v += 0.866 * s * s * k * .78 + cyl(s * 1.4, k * .22);
    else if (ty === 'wface') v += cyl(dk * .78, k * .82) * .85 + cyl(dk, k * .18);
    else if (ty === 'carriage') v += cyl(dk, k) * .62 + D * D * D * .6;
    else if (ty === 'set') v -= 0.866 * s * s * Math.min(D * .6, L * .5);
  }
  const g = Math.max(v, 0) * spDens(sp.mat) / 1000; return g >= 10 ? Math.round(g * 10) / 10 : g >= 1 ? Math.round(g * 100) / 100 : Math.round(g * 1000) / 1000;
}
/** 商品的估算單重（g／支），認不出規格回 0 */
export function estWeight(g) { try { return spWeight(spGet({ ...g, wt: 0 })); } catch (e) { return 0; } }

export function spDstr(sp) { const d = sp.d || ''; return sp.th === 'W' ? `W${d}` : sp.th === 'U' ? `${String(d).replace(/^#?/, '#')}` : sp.th === 'ST' ? `ST${d}` : `M${d}`; }

/* ---- SVG 線圖（側視圖＋頭部視圖），顏色跟著文字色（深色模式也看得到） ---- */
export function spSVG(sp, dm, opt = {}) {
  const W = opt.w || 560, H = opt.h || 250, ty = sp.type;
  if (!dm.D && !['fw', 'sw', 'nut'].includes(ty) || ty === 'other') return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="currentColor" opacity=".6">${ty === 'other' ? '此品類不自動畫圖' : '品名認不出尺寸，請在下面「修正規格」填公稱徑'}</text></svg>`;
  const D = dm.D || parseFloat(sp.d1) || 5, dk = dm.dk || D * 1.8, k = dm.k || D * .6, s = dm.s || D * 1.6, P = dm.P || D * .15;
  const L = dm.L || D * 3; const inHead = ['flat', 'csk', 'oval'].includes(ty);
  const parts = [], dims = []; const tw = w => `stroke="currentColor" stroke-width="${w}" fill="none"`;
  const W1 = W * 0.7, padL = 62, padR = 46, top = 36, bot = 40;
  const nutLike = ['nut', 'fw', 'sw'].includes(ty);
  const headL = nutLike ? 0 : ty === 'set' || ty === 'stud' ? 0 : inHead ? 0 : k + (ty === 'carriage' ? D * .6 : 0);
  let brk = false, Ld = L; const maxR = ty === 'stud' ? 16 : 11; if (!nutLike && L / D > maxR) { brk = true; Ld = D * maxR; }
  const totalX = nutLike ? (ty === 'nut' ? k : dm.k || 1) : headL + Ld; const totalY = nutLike ? (ty === 'nut' ? s * 1.155 : dk) : Math.max(dk || D, D, ty === 'hex' || ty === 'hexf' ? s * 1.155 : 0);
  const sc = Math.min((W1 - padL - padR) / (totalX || 1), (H - top - bot) / (totalY || 1));
  const cy = top + (H - top - bot) / 2; const x0 = padL + ((W1 - padL - padR) - totalX * sc) / 2;
  const X = v => r2(x0 + v * sc), Y = v => r2(cy + v * sc);
  const P2 = a => a.map((p, i) => (i ? 'L' : 'M') + X(p[0]) + ' ' + Y(p[1])).join(' ');
  const arrow = (x1, y1, x2, y2, lab, pos) => {
    const ang = Math.atan2(y2 - y1, x2 - x1), a = 6, b = 2.6; const ah = (x, y, t) => `<path d="M${x} ${y} L${r2(x - a * Math.cos(t) + b * Math.sin(t))} ${r2(y - a * Math.sin(t) - b * Math.cos(t))} L${r2(x - a * Math.cos(t) - b * Math.sin(t))} ${r2(y - a * Math.sin(t) + b * Math.cos(t))} Z" fill="currentColor"/>`;
    const tx = (x1 + x2) / 2, tyy = (y1 + y2) / 2;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${tw(.6)}/>${ah(x2, y2, ang)}${ah(x1, y1, ang + Math.PI)}${pos === 'v' ? `<text x="${r2(tx - 4)}" y="${r2(tyy)}" font-size="11" text-anchor="end" dominant-baseline="middle" fill="currentColor">${lab}</text>` : `<text x="${r2(tx)}" y="${r2(tyy - 4)}" font-size="11" text-anchor="middle" fill="currentColor">${lab}</text>`}`;
  };
  const ext = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width=".4" opacity=".7"/>`;
  const dimH = (a, b, yv, lab, off) => { const yy = r2(yv); dims.push(ext(X(a), Y(off < 0 ? -totalY / 2 : totalY / 2) + (off < 0 ? -2 : 2), X(a), yy) + ext(X(b), Y(off < 0 ? -totalY / 2 : totalY / 2) + (off < 0 ? -2 : 2), X(b), yy) + arrow(X(a), yy, X(b), yy, lab)); };
  const f = v => String(r2(v));
  if (!nutLike) {
    const hb = headL; const hk = k;
    if (ty === 'pan' || ty === 'wface') {
      const r = Math.min(hk * .55, dk * .25); const dk2 = ty === 'wface' ? dk * .78 : dk, kk = ty === 'wface' ? hk * .82 : hk;
      parts.push(`<path d="M${X(hk)} ${Y(-dk2 / 2)} L${X(hk - kk + r)} ${Y(-dk2 / 2)} Q${X(hk - kk)} ${Y(-dk2 / 2)} ${X(hk - kk)} ${Y(-dk2 / 2 + r)} L${X(hk - kk)} ${Y(dk2 / 2 - r)} Q${X(hk - kk)} ${Y(dk2 / 2)} ${X(hk - kk + r)} ${Y(dk2 / 2)} L${X(hk)} ${Y(dk2 / 2)} Z" ${tw(1.4)}/>`);
      if (ty === 'wface') parts.push(`<rect x="${X(hk - hk * .18)}" y="${Y(-dk / 2)}" width="${r2(hk * .18 * sc)}" height="${r2(dk * sc)}" ${tw(1.4)}/>`);
    } else if (ty === 'truss') parts.push(`<path d="M${X(hk)} ${Y(-dk / 2)} L${X(hk * .82)} ${Y(-dk / 2)} Q${X(-hk * .05)} ${Y(-dk * .36)} ${X(0)} ${Y(0)} Q${X(-hk * .05)} ${Y(dk * .36)} ${X(hk * .82)} ${Y(dk / 2)} L${X(hk)} ${Y(dk / 2)} Z" ${tw(1.4)}/>`);
    else if (ty === 'btn' || ty === 'carriage') {
      parts.push(`<path d="M${X(hk)} ${Y(-dk / 2)} C${X(hk * .25)} ${Y(-dk / 2)} ${X(0)} ${Y(-dk * .28)} ${X(0)} ${Y(0)} C${X(0)} ${Y(dk * .28)} ${X(hk * .25)} ${Y(dk / 2)} ${X(hk)} ${Y(dk / 2)} Z" ${tw(1.4)}/>`);
      if (ty === 'carriage') parts.push(`<rect x="${X(hk)}" y="${Y(-D / 2)}" width="${r2(D * .6 * sc)}" height="${r2(D * sc)}" ${tw(1.4)}/><line x1="${X(hk)}" y1="${Y(0)}" x2="${X(hk + D * .6)}" y2="${Y(0)}" stroke="currentColor" stroke-width=".5"/>`);
    } else if (ty === 'cap') {
      const c = Math.min(hk * .12, dk * .06); parts.push(`<path d="${P2([[hk, -dk / 2], [c, -dk / 2], [0, -dk / 2 + c], [0, dk / 2 - c], [c, dk / 2], [hk, dk / 2]])} Z" ${tw(1.4)}/>`);
      if (dm.s) parts.push(`<path d="M${X(0)} ${Y(-dm.s / 2)} L${X(hk * .6)} ${Y(-dm.s / 2)} L${X(hk * .75)} ${Y(0)} L${X(hk * .6)} ${Y(dm.s / 2)} L${X(0)} ${Y(dm.s / 2)}" stroke="currentColor" stroke-width=".7" stroke-dasharray="3 2" fill="none"/>`);
    } else if (inHead) {
      const kk = k;
      if (ty === 'oval') parts.push(`<path d="M${X(0)} ${Y(-dk / 2)} Q${X(-kk * .25)} ${Y(0)} ${X(0)} ${Y(dk / 2)} Q${X(kk * .55)} ${Y(D * .62)} ${X(kk)} ${Y(D / 2)} L${X(kk)} ${Y(-D / 2)} Q${X(kk * .55)} ${Y(-D * .62)} ${X(0)} ${Y(-dk / 2)} Z" ${tw(1.4)}/>`);
      else parts.push(`<path d="${P2([[0, -dk / 2], [0, dk / 2], [kk, D / 2], [kk, -D / 2]])} Z" ${tw(1.4)}/>`);
      if (ty === 'csk' && dm.s) parts.push(`<path d="M${X(0)} ${Y(-dm.s / 2)} L${X(kk * .7)} ${Y(-dm.s / 2)} L${X(kk * .85)} ${Y(0)} L${X(kk * .7)} ${Y(dm.s / 2)} L${X(0)} ${Y(dm.s / 2)}" stroke="currentColor" stroke-width=".7" stroke-dasharray="3 2" fill="none"/>`);
    } else if (ty === 'hex' || ty === 'hexf') {
      const e = s * 1.155; const fl = ty === 'hexf' ? hk * .22 : 0; const hk2 = hk - fl;
      parts.push(`<rect x="${X(0)}" y="${Y(-e / 2)}" width="${r2(hk2 * sc)}" height="${r2(e * sc)}" ${tw(1.4)}/><line x1="${X(0)}" y1="${Y(-e / 4)}" x2="${X(hk2)}" y2="${Y(-e / 4)}" ${tw(1)}/><line x1="${X(0)}" y1="${Y(e / 4)}" x2="${X(hk2)}" y2="${Y(e / 4)}" ${tw(1)}/>`);
      if (fl) parts.push(`<rect x="${X(hk2)}" y="${Y(-s * .7)}" width="${r2(fl * sc)}" height="${r2(s * 1.4 * sc)}" ${tw(1.4)}/>`);
    }
    // 桿部
    const xs = inHead ? k : hb, xe = inHead ? Ld : hb + Ld;
    const Dm = Math.max(D - 1.2269 * P, D * .72); const tail = sp.tail || 'flat';
    const tl = tail === 'point' ? Math.min(D * 1.1, Ld * .4) : tail === 'drill' ? Math.min(D * 1.4, Ld * .45) : Math.min(P * .6, D * .12);
    const full = !dm.b || dm.b >= L - .01 || ty === 'set' || ty === 'stud';
    const thS = full ? xs : Math.max(xs, xe - (brk ? Math.min(dm.b, Ld * .6) : dm.b));
    const brkX = brk ? (xs + (full ? xe - tl : thS)) / 2 : 0;
    let body;
    if (tail === 'point') body = `M${X(xs)} ${Y(-D / 2)} L${X(xe - tl)} ${Y(-D / 2)} L${X(xe)} ${Y(-D * .12)} L${X(xe)} ${Y(D * .12)} L${X(xe - tl)} ${Y(D / 2)} L${X(xs)} ${Y(D / 2)}`;
    else if (tail === 'drill') body = `M${X(xs)} ${Y(-D / 2)} L${X(xe - tl)} ${Y(-D / 2)} L${X(xe - tl * .35)} ${Y(-Dm * .42)} L${X(xe)} ${Y(0)} L${X(xe - tl * .35)} ${Y(Dm * .42)} L${X(xe - tl)} ${Y(D / 2)} L${X(xs)} ${Y(D / 2)}`;
    else body = `M${X(xs)} ${Y(-D / 2)} L${X(xe - tl)} ${Y(-D / 2)} L${X(xe)} ${Y(-Dm / 2)} L${X(xe)} ${Y(Dm / 2)} L${X(xe - tl)} ${Y(D / 2)} L${X(xs)} ${Y(D / 2)}`;
    if (ty === 'set' || ty === 'stud') body += ' Z';
    parts.push(`<path d="${body}" ${tw(1.4)}/>`);
    const te = xe - (tail === 'flat' ? tl : tl * .9);
    parts.push(`<line x1="${X(thS)}" y1="${Y(-Dm / 2)}" x2="${X(te)}" y2="${Y(-Dm / 2)}" ${tw(.6)}/><line x1="${X(thS)}" y1="${Y(Dm / 2)}" x2="${X(te)}" y2="${Y(Dm / 2)}" ${tw(.6)}/>`);
    if (!full) parts.push(`<line x1="${X(thS)}" y1="${Y(-D / 2)}" x2="${X(thS)}" y2="${Y(D / 2)}" ${tw(1)}/>`);
    if (tail === 'drill') parts.push(`<path d="M${X(xe - tl)} ${Y(-D * .2)} Q${X(xe - tl * .5)} ${Y(0)} ${X(xe - tl * .2)} ${Y(D * .25)}" ${tw(.7)}/>`);
    if (ty === 'set') parts.push(`<path d="M${X(0)} ${Y(-dm.s / 2 || -D * .3)} L${X(D * .6)} ${Y(-dm.s / 2 || -D * .3)} L${X(D * .75)} ${Y(0)} L${X(D * .6)} ${Y(dm.s / 2 || D * .3)} L${X(0)} ${Y(dm.s / 2 || D * .3)}" stroke="currentColor" stroke-width=".7" stroke-dasharray="3 2" fill="none"/>`);
    if (brk) { const bw = Math.max(D * .5, 6 / sc), yb = D / 2 + .8; parts.push(`<rect x="${X(brkX - bw / 2)}" y="${Y(-yb) - 1}" width="${r2(bw * sc)}" height="${r2(yb * 2 * sc) + 2}" fill="var(--surface,#fff)" stroke="none"/><path d="M${X(brkX - bw / 2)} ${Y(-yb)} q${r2(bw * sc * .3)} ${r2(yb * sc * .5)} 0 ${r2(yb * sc)} t0 ${r2(yb * sc)}" ${tw(.8)}/><path d="M${X(brkX + bw / 2)} ${Y(-yb)} q${r2(bw * sc * .3)} ${r2(yb * sc * .5)} 0 ${r2(yb * sc)} t0 ${r2(yb * sc)}" ${tw(.8)}/>`); }
    parts.push(`<line x1="${X(-1) - 6}" y1="${cy}" x2="${X(xe) + 8}" y2="${cy}" stroke="currentColor" stroke-width=".5" stroke-dasharray="10 3 2 3" opacity=".7"/>`);
    // 尺寸標註
    dimH(xs - (inHead ? k : 0) - (ty === 'carriage' ? D * .6 : 0), xe, Y(totalY / 2) + 22, 'L ' + f(L) + (sp.Lraw && /["\/]/.test(sp.Lraw) ? ` (${esc(sp.Lraw)})` : ''), 1);
    if (!full && dm.b) dimH(thS, xe, Y(-totalY / 2) - 12, 'b ' + f(dm.b) + (sp.bRef ? '≈' : ''), -1);
    if ((headL || inHead) && ty !== 'carriage') dimH(0, inHead ? k : hb, Y(-totalY / 2) - 12, 'k ' + f(k), -1);
    const lx = x0 - 10;
    if (dk && !['hex', 'hexf', 'set', 'stud'].includes(ty)) dims.push(arrow(r2(lx), Y(-dk / 2), r2(lx), Y(dk / 2), 'dk ' + f(dk), 'v') + ext(X(0), Y(-dk / 2), lx, Y(-dk / 2)) + ext(X(0), Y(dk / 2), lx, Y(dk / 2)));
    if (['hex', 'hexf'].includes(ty)) dims.push(arrow(r2(lx), Y(-s * 1.155 / 2), r2(lx), Y(s * 1.155 / 2), 'e ' + f(s * 1.155), 'v'));
    const dx = X(xe) + 16; dims.push(arrow(r2(dx), Y(-D / 2), r2(dx), Y(D / 2), '', 'v') + `<text x="${r2(dx + 4)}" y="${cy}" font-size="11" dominant-baseline="middle" fill="currentColor">${esc(spDstr(sp))}</text>` + ext(X(xe - tl), Y(-D / 2), dx, Y(-D / 2)) + ext(X(xe - tl), Y(D / 2), dx, Y(D / 2)));
  } else {
    // 螺帽／華司：側視
    const th = ty === 'nut' ? k : (dm.k || 1), ht = ty === 'nut' ? s * 1.155 : dk; const hole = ty === 'nut' ? D : (dm.d1 || D);
    parts.push(`<rect x="${X(0)}" y="${Y(-ht / 2)}" width="${r2(th * sc)}" height="${r2(ht * sc)}" ${tw(1.4)}/>`);
    if (ty === 'nut') parts.push(`<line x1="${X(0)}" y1="${Y(-ht / 4)}" x2="${X(th)}" y2="${Y(-ht / 4)}" ${tw(1)}/><line x1="${X(0)}" y1="${Y(ht / 4)}" x2="${X(th)}" y2="${Y(ht / 4)}" ${tw(1)}/>`);
    parts.push(`<line x1="${X(0)}" y1="${Y(-hole / 2)}" x2="${X(th)}" y2="${Y(-hole / 2)}" stroke="currentColor" stroke-width=".7" stroke-dasharray="3 2"/><line x1="${X(0)}" y1="${Y(hole / 2)}" x2="${X(th)}" y2="${Y(hole / 2)}" stroke="currentColor" stroke-width=".7" stroke-dasharray="3 2"/>`);
    parts.push(`<line x1="${X(0) - 8}" y1="${cy}" x2="${X(th) + 8}" y2="${cy}" stroke="currentColor" stroke-width=".5" stroke-dasharray="10 3 2 3" opacity=".7"/>`);
    dims.push(arrow(X(0), Y(ht / 2) + 18, X(th), Y(ht / 2) + 18, (ty === 'nut' ? 'm ' : 't ') + f(th)));
    dims.push(arrow(r2(x0 - 10), Y(-ht / 2), r2(x0 - 10), Y(ht / 2), (ty === 'nut' ? 'e ' : 'D ') + f(ht), 'v'));
  }
  // 頭部視圖／正視圖
  const cx = W1 + (W - W1) / 2, R = Math.min((W - W1) / 2 - 14, (H - top - bot) / 2); const big = ty === 'nut' || ty === 'hex' || ty === 'hexf' ? s * 1.155 : ty === 'set' || ty === 'stud' ? D : dk || D; const s2 = R * 2 / big;
  const tv = []; const Cc = (r, w = 1.4, da) => `<circle cx="${cx}" cy="${cy}" r="${r2(r)}" ${tw(w)}${da ? ` stroke-dasharray="${da}"` : ''}/>`;
  const hexP = (sAcross, rot = 0) => { const rr = sAcross / 2 / Math.cos(Math.PI / 6); let p = ''; for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + rot; p += (i ? 'L' : 'M') + r2(cx + rr * Math.cos(a)) + ' ' + r2(cy + rr * Math.sin(a)); } return p + 'Z'; };
  if (ty === 'nut' || ty === 'hex' || ty === 'hexf') {
    tv.push(`<path d="${hexP(s * s2)}" ${tw(1.4)}/>`); tv.push(Cc(s * s2 / 2, .6));
    if (ty === 'nut') { tv.push(Cc(D * s2 / 2, 1.2)); tv.push(Cc(Math.max(D - 1.0825 * P, D * .8) * s2 / 2, .6, '3 2')); }
    if (ty === 'hexf') tv.push(Cc(s * .7 * s2, 1));
    tv.push(arrow(r2(cx - s * s2 / 2), r2(cy + R + 12), r2(cx + s * s2 / 2), r2(cy + R + 12), 's ' + f(s)));
  } else if (ty === 'fw' || ty === 'sw') {
    tv.push(Cc(dk * s2 / 2)); tv.push(Cc((dm.d1 || D) * s2 / 2, 1.2)); if (ty === 'sw') tv.push(`<line x1="${cx}" y1="${r2(cy - dk * s2 / 2)}" x2="${r2(cx + 3)}" y2="${r2(cy - (dm.d1 || D) * s2 / 2)}" ${tw(1.2)}/>`);
    tv.push(arrow(r2(cx - (dm.d1 || D) * s2 / 2), r2(cy), r2(cx + (dm.d1 || D) * s2 / 2), r2(cy), 'd ' + f(dm.d1 || D)));
  } else if (ty === 'set' || ty === 'stud') {
    tv.push(Cc(D * s2 / 2)); tv.push(Cc(Math.max(D - 1.2269 * P, D * .72) * s2 / 2, .6, '3 2')); if (ty === 'set' && dm.s) tv.push(`<path d="${hexP(dm.s * s2)}" ${tw(1)}/>`);
  } else {
    tv.push(Cc(dk * s2 / 2)); if (ty === 'wface') tv.push(Cc(dk * .78 * s2 / 2, 1));
    const dv = sp.drive, rr = (ty === 'wface' ? dk * .78 : dk) * s2 / 2;
    const cross = w => `<path d="M${r2(cx - rr * .55)} ${r2(cy - w)} H${r2(cx - w)} V${r2(cy - rr * .55)} H${r2(cx + w)} V${r2(cy - w)} H${r2(cx + rr * .55)} V${r2(cy + w)} H${r2(cx + w)} V${r2(cy + rr * .55)} H${r2(cx - w)} V${r2(cy + w)} H${r2(cx - rr * .55)} Z" ${tw(1.1)}/>`;
    if (dv === 'cross' || dv === 'pozi' || dv === 'combo') tv.push(cross(Math.max(rr * .09, 1.5)));
    if (dv === 'combo' || dv === 'slot') tv.push(`<rect x="${r2(cx - rr * .85)}" y="${r2(cy - Math.max(rr * .08, 1.4))}" width="${r2(rr * 1.7)}" height="${r2(Math.max(rr * .16, 2.8))}" ${tw(1.1)}/>`);
    if (dv === 'pozi') tv.push(`<path d="M${r2(cx - rr * .3)} ${r2(cy - rr * .3)} L${r2(cx + rr * .3)} ${r2(cy + rr * .3)} M${r2(cx + rr * .3)} ${r2(cy - rr * .3)} L${r2(cx - rr * .3)} ${r2(cy + rr * .3)}" ${tw(.6)}/>`);
    if (dv === 'hexsock') tv.push(`<path d="${hexP((dm.s || D * .5) * s2, Math.PI / 6)}" ${tw(1.1)}/>`);
    if (dv === 'torx') { const ro = (dm.s || D * .55) * s2 * .62, ri = ro * .62; let p = ''; for (let i = 0; i < 12; i++) { const a = Math.PI / 6 * i - Math.PI / 2, r = i % 2 ? ri : ro; p += (i ? 'L' : 'M') + r2(cx + r * Math.cos(a)) + ' ' + r2(cy + r * Math.sin(a)); } tv.push(`<path d="${p}Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" fill="none"/>`); }
    if (dm.s && ['cap', 'csk', 'btn'].includes(ty)) tv.push(arrow(r2(cx - dm.s * s2 / 2), r2(cy + R + 12), r2(cx + dm.s * s2 / 2), r2(cy + R + 12), 's ' + f(dm.s)));
  }
  const ttl = `<text x="${r2(W1 / 2)}" y="14" font-size="11" text-anchor="middle" fill="currentColor" opacity=".7">側視圖</text><text x="${r2(cx)}" y="14" font-size="11" text-anchor="middle" fill="currentColor" opacity=".7">${nutLike ? '正視圖' : '頭部視圖'}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;color:inherit" font-family="Arial, 'Microsoft JhengHei', sans-serif">${ttl}${parts.join('')}${dims.join('')}${tv.join('')}${brk ? `<text x="${r2(W1 / 2)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".7">長度過長，圖中以斷線縮短表示</text>` : ''}</svg>`;
}
/** 規格表格列 [標籤, 值] */
export function spRows(sp, dm) {
  const rows = []; const add = (l, v) => { if (v !== '' && v != null) rows.push([l, v]); };
  add('品類', spLab(SP_TYPES, sp.type)); if (sp.drive && sp.drive !== 'none') add('起子孔', spLab(SP_DRIVES, sp.drive));
  if (sp.d) add('公稱徑', spDstr(sp) + (sp.th === 'W' || sp.th === 'U' ? `（≈${dm.D} mm）` : ''));
  if (sp.L) add('長度 L', `${sp.L} mm${sp.Lraw && /["\/吋分]/.test(sp.Lraw) ? `（${sp.Lraw}）` : ''}`);
  if (sp.p) add('牙距', String(sp.p).match(/^[\d.]+$/) ? `P${sp.p}` : sp.p);
  if (dm.b && dm.b < dm.L) add('牙長 b', `${dm.b} mm${sp.bRef ? '（參考）' : ''}`); else if (dm.L && !['nut', 'fw', 'sw', 'other'].includes(sp.type)) add('牙長', '全牙');
  if (sp.tail) add('尾型', spLab(SP_TAILS, sp.tail));
  add('材質', sp.mat); add('強度／鋼種', sp.grade); add('表面處理', sp.fin); add('其他加工', sp.extra);
  const dl = { dk: sp.type === 'fw' || sp.type === 'sw' ? '外徑 D' : '頭徑 dk', k: sp.type === 'nut' ? '厚度 m' : sp.type === 'fw' || sp.type === 'sw' ? '厚度 t' : '頭高 k', s: '對邊 s' };
  for (const kk of ['dk', 'k', 's']) if (dm[kk]) add(dl[kk], `${dm[kk]} mm（${SRC_TXT[dm.src[kk]] || '參考'}）`);
  if (sp.type === 'fw' && dm.d1) add('內徑 d1', `${dm.d1} mm`);
  const w = +sp._wt > 0 ? +sp._wt : spWeight(sp, dm); if (w) add('單重', `${w} g／支　千支約 ${r2(w) >= 1 ? r2(w) : Math.round(w * 1000) / 1000} kg（${+sp._wt > 0 ? '實測／登錄值' : '依標準尺寸估算'}）`);
  add('參考標準', sp.std); add('備註', sp.snote); return rows;
}
/** 標準尺寸表（附近 7 個尺寸，標出本品） */
export function spTable(sp, dm) {
  const t = SP_TBL[sp.type]; if (!t) return ''; const ks = Object.keys(t.r).map(Number).sort((a, b) => a - b); const D = dm.D;
  let i = ks.findIndex(k => k >= D); if (i < 0) i = ks.length - 1; const from = Math.max(0, Math.min(i - 3, ks.length - 7)); const sel = ks.slice(from, from + 7);
  return `<table class="sptbl"><thead><tr><th>公稱</th>${sel.map(k => `<th class="${Math.abs(k - D) < .01 ? 'on' : ''}">M${k}</th>`).join('')}</tr></thead><tbody>${t.c.map((c, ci) => `<tr><th>${c}</th>${sel.map(k => `<td class="${Math.abs(k - D) < .01 ? 'on' : ''}">${t.r[k][ci]}</td>`).join('')}</tr>`).join('')}</tbody></table><div class="muted small" style="margin-top:2px">${esc(t.std)}，單位 mm，標準值為參考上限／基本尺寸</div>`;
}
