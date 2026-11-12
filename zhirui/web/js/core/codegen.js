// 志瑞料號：解析與建議。
// 料號結構：材質(1) 大類(1) 表面處理(1) 牙別(1) 尺寸 _ 品項(2) [-變化款]，例如 A2AM5*45_2V = 鐵、機械牙、鍍鋅、公制、5*45、⊕Θ大扁螺絲。
// 對照表不寫死：從現有商品統計（品名開頭 → 大類＋品項、表面處理字 → 第 3 碼、材質字 → 第 1 碼），資料變了自動跟著變。
import { store } from './store.js';

const HEAD_RE = /^([A-Z])(\d)([A-Z])([A-Z])([^_]+)_/;
/** 料號拆解：[整段, 材質, 大類, 表面處理, 牙別, 尺寸, 品項]；品項取最後一段「_兩碼」（像 _Z03_33、_15_14、_39_1(Z03)） */
export function splitCode(code) {
  const c = String(code || '').toUpperCase(); const h = c.match(HEAD_RE); if (!h) return null;
  let t = null; for (const m of c.matchAll(/_([0-9A-Z]{2})(?=$|[-_(\s{.])/g)) t = m[1];
  if (!t) return null;
  const m = [h[0] + t, h[1], h[2], h[3], h[4], h[5], t]; return m;
}
// 商品「類別」→ 第 1 碼
const CAT1 = { '鐵': 'A', '不鏽鋼': 'B', '中碳鋼': 'C', '合金鋼': 'D', '彈簧鋼': 'E', '銅': 'F', '鋁': 'G', '壓鑄': 'H', '橡膠': 'J', '鈦': 'N' };
const CAT_OK = { '橡膠': 'IJ' };   // 類別對應不只一個第 1 碼
export const MAT_NAME = { A: '鐵', B: '白鐵', C: '中碳鋼', D: '合金鋼', E: '彈簧鋼', F: '銅', G: '鋁', H: '壓鑄', J: '橡膠', N: '鈦' };
export const CLS_NAME = { 1: '無牙零件', 2: '機械牙', 3: '自攻類' };
export const TH_NAME = { M: '公制', W: '英制', U: '美規號數' };
// 品名尾段的材質字（取最後出現的那個；「彈簧華司…鍍鋅鐵」是鐵）
const MATW = [['鋅合金', 'H'], ['鈦合金', 'N'], ['不鏽鋼', 'B'], ['不銹鋼', 'B'], ['白鐵', 'B'], ['SUS', 'B'], ['合金', 'D'], ['中碳', 'C'], ['彈簧', 'E'], ['彈鋼', 'E'], ['壓鑄', 'H'], ['黃銅', 'F'], ['銅', 'F'], ['鋁', 'G'], ['橡膠', 'J'], ['塑膠', 'J'], ['鈦', 'N'], ['鐵', 'A']];
// 表面處理字（長的先比）
const FINW = ['三價白鋅', '三價黑鋅', '三價鋅', '三價', '鍍錏黑', '錏黑', '黑鎳', '鍍鎳', '鍍鋅', '染黑', '五彩', '鍍鉻', '紅古銅', '青古銅', '古銅', '鍍青銅', '鍍銅', '磷酸', '達克羅', '黑身', '電黑', '鈍化', '黑鋅', '白鋅', '鍍黑', '烤'];
const NOT_MAT = /鍍青銅|鍍銅|紅古銅|青古銅|古銅|白鐵包\S*|白鐵頭/g;   // 這些不是本體材質

const norm = s => String(s || '').normalize('NFKC').toUpperCase().replace(/[×Ｘ]/g, '*');
/** 品名拆成：開頭（品項）、尺寸、牙別、尾段（表面處理、材質） */
export function parseName(name) {
  let n = norm(name).replace(/^線材\s*/, '');
  // 尺寸：第一段「數字開頭、由 數字 . # / - * " 組成」的字串；前面緊貼 M／W／U（且再前面不是英文字母）就是牙別
  const re = /(\d+(?:\.\d+)?#?(?:[\/\-]\d+(?:\.\d+)?)*(?:"|吋)?(?:\s*\*\s*\d+(?:\.\d+)?#?(?:[\/\-]\d+(?:\.\d+)?)*(?:"|吋)?)*)/g;
  let m, tok = '', at = -1, th = '';
  while ((m = re.exec(n))) {
    const pre = n.slice(0, m.index); const c1 = pre.slice(-1), c2 = pre.slice(-2, -1);
    // 跳過型號裡的數字（STW15、ETW3、BWW6200 這種）：前一個字是英文字母、而且不是單獨的 M／W／U
    if (/[A-Z]/.test(c1) && !(/[MWU]/.test(c1) && !/[A-Z]/.test(c2))) continue;
    tok = m[1].replace(/\s+/g, '').replace(/吋/g, '"'); at = m.index; th = /[MWU]/.test(c1) ? c1 : c1 === '#' ? 'U' : ''; break;
  }
  if (!tok) return { head: n.replace(/[\s]/g, ''), size: '', th: '', tail: n };
  if (th === 'U' && !tok.includes('#')) tok = tok.replace(/^(\d+)/, '$1#');   // 「#10*1/2」照料號寫法改成「10#*1/2」
  const sure = !!th || tok.includes('#') || /\/|"/.test(tok);   // 牙別有明確根據（M／W／U 字母、#、分數或吋）
  if (!th) th = tok.includes('#') ? 'U' : /\/|"/.test(tok) ? 'W' : 'M';
  const head = n.slice(0, at).replace(/[MWU#]$/, '').replace(/\s+/g, '');
  return { head, size: tok, th, thSure: sure, tail: n.slice(at + m[0].length) };
}
const finOf = s => FINW.find(f => s.includes(f)) || '';
// 取「結束位置最後」的材質字；同一個位置結束取長的（「白鐵」不會被當成「鐵」）
const matOf = s0 => { const s = s0.replace(NOT_MAT, ' '); let best = null; for (const [w, c] of MATW) { const i = s.lastIndexOf(w); if (i < 0) continue; const e = i + w.length; if (!best || e > best.e || (e === best.e && w.length > best.w.length)) best = { e, w, c }; } return best ? best.c : ''; };

// ---------- 從現有商品統計對照表 ----------
let IDX = null, IDXgen = -1;
const bump = (o, k, v) => { (o[k] ||= {})[v] = ((o[k] || {})[v] || 0) + 1; };
const top = o => { if (!o) return null; let b = null, n = 0, all = 0; for (const [k, v] of Object.entries(o)) { all += v; if (v > n) { b = k; n = v; } } return b ? { v: b, n, all, p: n / all } : null; };
export function codeIndex() {
  if (IDX && IDXgen === store.gen) return IDX;
  const head = {}, fin = {}, codes = new Set();
  for (const g of store.list('goods')) {
    const code = String(g.code || '').toUpperCase(); if (code) codes.add(code);
    const m = splitCode(code); if (!m) continue;
    const p = parseName(g.name);
    if (p.head) bump(head, p.head, m[2] + m[6]);
    const f = finOf(norm(g.name)); bump(fin, f || '無' + m[1], m[3]);
  }
  IDX = { head, fin, codes, heads: Object.keys(head).sort((a, b) => b.length - a.length) }; IDXgen = store.gen;
  return IDX;
}
/** 品名開頭 → 大類＋品項（完全相同優先；不然找「包含在品名開頭裡、最長」的已知開頭） */
function typeOf(head, I) {
  if (!head) return null;
  const tries = [head, head.replace(/[⊕Θ]/g, '')];
  for (const h of tries) { const t = top(I.head[h]); if (t) return { ...t, by: h, exact: true }; }
  for (const h of I.heads) { if (h.length < 2) break; if (head.includes(h) && Object.values(I.head[h]).reduce((a, b) => a + b, 0) >= 2) return { ...top(I.head[h]), by: h, exact: false }; }
  return null;
}

/**
 * 依品名（與類別）建議料號。回傳 { code, base, parts:[{k,v,why}], missing:[...] }；
 * 有缺的部分（例如認不出品項）code 為 ''。base 是還沒加變化款尾碼的料號。
 */
export function suggestCode(name, cat, selfId) {
  const I = codeIndex(); const p = parseName(name); const n = norm(name);
  const parts = []; const missing = [];
  const c1 = matOf(p.tail) || CAT1[String(cat || '').trim()] || matOf(n);   // 品名尾段寫的材質優先，其次商品類別
  if (c1) parts.push({ k: '材質', v: c1, why: MAT_NAME[c1] || '' }); else missing.push('材質');
  const t = typeOf(p.head, I);
  if (t) parts.push({ k: '大類', v: t.v[0], why: CLS_NAME[t.v[0]] || '' }); else missing.push('品項');
  const f = finOf(n); const fc = top(I.fin[f || '無' + c1]);
  // 品名沒寫表面處理時，要現有資料夠一致（6 成以上）才猜，不然請使用者在品名補上
  if (fc && (f || fc.p >= 0.6)) parts.push({ k: '表面處理', v: fc.v, why: f || '無處理' }); else missing.push('表面處理');
  if (p.th) parts.push({ k: '牙別', v: p.th, why: TH_NAME[p.th] }); else missing.push('牙別');
  if (p.size) parts.push({ k: '尺寸', v: p.size, why: '' }); else missing.push('尺寸');
  if (t) parts.push({ k: '品項', v: t.v.slice(1), why: t.by + (t.exact ? '' : '（相近）') });
  if (missing.length) return { code: '', base: '', parts, missing };
  const base = `${c1}${t.v[0]}${fc.v}${p.th}${p.size}_${t.v.slice(1)}`;
  const self = selfId ? String(store.get('goods', selfId)?.code || '').toUpperCase() : '';
  let code = base, k = 0;
  while (I.codes.has(code.toUpperCase()) && code.toUpperCase() !== self) code = `${base}-${++k}`;
  const same = code !== base ? store.list('goods').find(g => String(g.code || '').toUpperCase() === base.toUpperCase()) : null;
  const alt = Object.entries(I.head[t.by] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `_${k.slice(1)} ${v} 個`).join('、');
  const typeNote = !t.exact ? `品項是從相近的品名「${t.by}」推的，請確認` : t.p < 0.8 ? `這種品名現有料號用過不同品項碼（${alt}），請確認` : '';
  return { code, base, parts, missing, typeSure: !typeNote, typeNote, same };
}

/**
 * 檢查料號和品名／類別是否矛盾；回傳 [{k, code, expect, why}]（沒問題回傳空陣列）。
 * 只報有把握的：品項要「品名開頭完全相同、而且 8 成以上同一個品項碼、至少 5 筆」才比對。
 */
export function checkCode(g) {
  const m = splitCode(g.code); if (!m) return [];
  const I = codeIndex(); const p = parseName(g.name); const n = norm(g.name); const out = [];
  const cm = CAT1[String(g.cat || '').trim()]; const nm = matOf(p.tail) || matOf(n);
  if (cm && cm !== m[1] && !(CAT_OK[String(g.cat).trim()] || '').includes(m[1])) out.push({ k: '材質', code: `${m[1]} ${MAT_NAME[m[1]] || ''}`, expect: `${cm} ${MAT_NAME[cm]}`, why: `類別是「${g.cat}」` });
  else if (!cm && nm && nm !== m[1]) out.push({ k: '材質', code: `${m[1]} ${MAT_NAME[m[1]] || ''}`, expect: `${nm} ${MAT_NAME[nm]}`, why: '品名寫的材質' });
  const f = finOf(n); const fc = top(I.fin[f || '無' + m[1]]);
  // 只報少見的寫法（同樣品名裡這個碼不到 1 成）：常見的另一種寫法（例如三價鋅用 A 或 S）不算錯
  const rare = (o, v) => o && ((o[v] || 0) / Object.values(o).reduce((a, b) => a + b, 0)) < 0.1;
  if (fc && fc.p >= 0.8 && fc.all >= 5 && fc.v !== m[3] && rare(I.fin[f || '無' + m[1]], m[3])) out.push({ k: '表面處理', code: m[3], expect: fc.v, why: `品名${f ? `寫「${f}」` : '沒寫表面處理'}（其他 ${fc.n} 個商品用 ${fc.v}）` });
  if (p.th && p.thSure && /[MWU]/.test(m[4]) && p.th !== m[4]) out.push({ k: '牙別', code: `${m[4]} ${TH_NAME[m[4]]}`, expect: `${p.th} ${TH_NAME[p.th]}`, why: `品名尺寸「${p.size}」` });
  // 尺寸後面還有其他描述（附S華司、牙長、大量…）就不比品項：那些字會改變品項
  const extra = p.tail.replace(/[\d\s.*/#()\-"A-Z]/g, '').replace(new RegExp([...FINW, ...MATW.map(x => x[0]), '材質', '原色', '粗牙', '細牙', '半牙', '全牙', '級'].sort((a, b) => b.length - a.length).join('|'), 'g'), '');
  const t = extra ? null : top(I.head[p.head]);
  if (t && t.p >= 0.8 && t.all >= 5 && t.v !== m[2] + m[6] && rare(I.head[p.head], m[2] + m[6])) out.push({ k: '品項', code: `${m[2]}…_${m[6]}`, expect: `${t.v[0]}…_${t.v.slice(1)}`, why: `品名「${p.head}」（其他 ${t.n} 個商品用 _${t.v.slice(1)}）` });
  return out;
}

// ---------- 廠商品名 → 志瑞品名＋料號 ----------
// 志瑞品名規則：品項（頭型＋種類）＋尺寸（公制加 M、英制不加、番數 8#）＋描述（無字、耐落…）＋兩個空白＋表面處理＋材質，
// 例如「⊕圓頭鐵板螺絲M4*12  鍍鋅鐵」「CAP全牙內六角螺絲M6*20  染黑合金」「平華司3/8*19*1.5  白鐵」。
const SYN = [[/外六角/g, '六角'], [/十字/g, '⊕'], [/一字/g, 'Θ'], [/自攻/g, '鐵板'], [/TP牙/g, '快速牙'], [/有頭內六角|杯頭內六角/g, 'CAP全牙內六角'], [/六角頭螺絲|六角頭螺栓|六角螺栓/g, '六角全牙螺絲'], [/六角帽/g, '六角螺帽'], [/螺母/g, '螺帽'], [/墊圈|墊片/g, '華司'], [/沉頭/g, '皿頭'], [/膨脹/g, '壁虎'], [/皿\+喇叭頭|皿\+喇叭/g, '喇叭']];
const NOUNS = ['螺絲', '螺帽', '華司', '壁虎', '吊環', '牙條', '鉚釘', '拉釘', '拉帽', '扣環', '梢', '釘', '環', '帽'];
const NOISE = /標準|注意|特殊|以上|恕不退貨|退貨|代鍍|MOQ\S*|(?<!\d)(?:20[1-4]|30[1-4]|316|410|420)(?=白鐵|SUS|\s|$)/g;
const FIN_SUP = [[/黑鎳/, '黑鎳'], [/鎳/, '鍍鎳'], [/五彩/, '五彩'], [/三價/, '三價鋅'], [/錏黑/, '錏黑'], [/黑鋅/, '黑鋅'], [/白鋅|鍍鋅|電鋅|(?<!鋅)鋅(?!合金)/, '鍍鋅'], [/黑身|白皮/, '黑身'], [/染黑|發黑/, '染黑'], [/鉻/, '鍍鉻']];
const MAT_WORD = { A: '鐵', B: '白鐵', C: '中碳', D: '合金', E: '彈簧', F: '銅', G: '鋁', H: '壓鑄', J: '塑膠', N: '鈦' };
const MAT_CAT = { A: '鐵', B: '不鏽鋼', C: '中碳鋼', D: '合金鋼', E: '彈簧鋼', F: '銅', G: '鋁', H: '壓鑄', J: '橡膠', N: '鈦' };
const cnt = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
function charSim(a, b) { const m = {}; for (const c of b) m[c] = (m[c] || 0) + 1; let common = 0; for (const c of a) if (m[c]) { m[c]--; common++; } return common - 0.6 * (b.length - common) - 1.0 * (a.length - common); }
/** 廠商的品項寫法 → 現有的志瑞品項（同一種東西用最多人用的那個寫法）；找不到回傳 '' */
function bestHead(want) {
  const I = codeIndex();
  if (cnt(I.head[want]) >= 3) return want;
  const noun = NOUNS.find(n => want.includes(n)); if (!noun) return '';
  const cs = [];
  for (const k of I.heads) { const n = cnt(I.head[k]); if (n < 3 || !k.includes(noun) || /[0-9A-Z]{3,}/.test(k)) continue; cs.push({ k, s: charSim(want, k), n }); }
  if (!cs.length) return '';
  const top = Math.max(...cs.map(x => x.s)); if (top < want.length * 0.6) return '';
  return cs.filter(x => x.s >= top - 1.5).sort((a, b) => b.n - a.n || b.s - a.s)[0].k;
}
/**
 * 把廠商品名（可含材質、表面處理、規格）整理成志瑞品名並建議料號。
 * 回傳 { name, code, cat } ；認不出品項、尺寸、材質時回傳 null（那就用廠商料號和品名建立）。
 */
export function stdGoods(text) {
  let t = norm(text).replace(/[（]/g, '(').replace(/[）]/g, ')');
  for (const [re, v] of SYN) t = t.replace(re, v);
  // 括號：只有中文描述的留下（無字、皿頭…），其他（廠商儲位 J2、(8邊*4T)、(標準7邊)…）拿掉
  t = t.replace(/\(([^()]*)\)/g, (m0, x) => /^[一-鿿]+$/.test(x) && !/邊|標準|注意|特殊/.test(x) ? ' ' + x + ' ' : ' ');
  t = t.replace(NOISE, ' ').replace(/\bP\d+(\.\d+)?\b/g, ' ').replace(/\s[A-LN-TV-Z]\d{1,2}(?![*#.\d])/g, ' ').replace(/邊\*/g, '*').replace(/(\d)\s*(厚|邊)/g, '$1').replace(/[-－]$/, '');
  // 表面處理、材質
  const fin = (FIN_SUP.find(([re]) => re.test(t)) || [])[1] || '';
  const tm = t.replace(/彈簧(?=華司|梢|銷|墊|固定)/g, '');   // 彈簧華司的「彈簧」不是材質
  let mat = matOf(tm); if (!mat && /鋼-?|碳鋼/.test(t)) return null;
  if (!mat && fin) mat = 'A';   // 有電鍍、沒寫材質＝鐵
  if (!mat) return null;
  let core = t.replace(new RegExp([...FIN_SUP.map(x => x[0].source), '原色', '電(?=五彩|鍍)', '乳白', '鍍', ...MATW.map(x => x[0] === '彈簧' ? '彈簧(?!華司|梢|銷|墊|固定)' : x[0]), '不鏽|不銹'].join('|'), 'g'), ' ').replace(/^[\s\-]+/, '');
  const p = parseName(core); if (!p.size) return null;
  let head = p.head.replace(/[\s\-]/g, '');
  if (head.includes('⊕')) head = '⊕' + head.replace(/⊕/g, '');
  if (!NOUNS.some(n => head.includes(n))) head += '螺絲';
  const tailWords = p.tail.replace(/[\d\s.*/#()"\-]/g, ' ').split(/\s+/).filter(w => w && /[一-鿿]/.test(w));
  const half = /半牙/.test(t) && !head.includes('半牙');
  const want = half ? (head.includes('全牙') ? head.replace('全牙', '半牙') : head.replace(/(CAP|六角)/, '$1半牙')) : head;
  const H = bestHead(want); if (!H) return null;
  const desc = tailWords.filter(w => w !== '半牙' && w !== '全牙' && !H.includes(w)).join(' ');
  const finW = fin || (mat === 'D' ? '染黑' : '');
  const size = (p.th === 'M' ? 'M' : '') + p.size;
  const name = `${H}${size}${desc ? '  ' + desc : ''}  ${finW}${MAT_WORD[mat] || ''}`;
  const cat = MAT_CAT[mat] || '';
  const s = suggestCode(name, cat);
  if (!s.code || s.typeNote) return null;
  return { name, code: s.code, base: s.base, cat, parts: s.parts };
}
