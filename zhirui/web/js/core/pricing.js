// 查價牌價：折扣、規格屬性判斷、篩選、搜尋（移植自原查價系統）
import { store } from './store.js';
import { norm } from './util.js';

// "65" / "6.5" / "0.65" / "65折" / "65 95"（多段）→ 0.65 / 0.6175
export function parseDisc(s) {
  if (s == null) return null;
  const str = String(s).trim(); if (!str) return null;
  const parts = str.replace(/折|%/g, ' ').split(/[\s×xX*,+、\/]+/).filter(Boolean);
  if (!parts.length) return null;
  let f = 1;
  for (const p of parts) { const n = parseFloat(p); if (!isFinite(n) || n <= 0) return NaN; if (n <= 1) f *= n; else if (n <= 10) f *= n / 10; else if (n <= 100) f *= n / 100; else return NaN; }
  return f;
}
export function fmtDisc(f) {
  if (f == null || isNaN(f)) return '—';
  if (Math.abs(f - 1) < 1e-9) return '原價';
  const v = +(f * 100).toFixed(2);
  return (Number.isInteger(v) && v % 10 === 0 ? v / 10 : v) + '折';
}
export const catById = id => store.get('pricing_cats', id);
// 折數管理的修改：key = cat|name|原本的個別折扣 → 新折數
let DISC = null, DISCgen = -1;
function discMap() { if (!DISC || DISCgen !== store.gen) { DISC = new Map(); DISCgen = store.gen; for (const d of store.list('discounts')) DISC.set(d.key, d.disc); } return DISC; }
export const discKey = it => it.cat + '|' + it.name + '|' + String(it.disc ?? '').trim();
export function itemDisc(it) { const o = discMap().get(discKey(it)); return o != null ? o : it.disc; }
export function itemFactor(it) {
  const own = parseDisc(itemDisc(it));
  if (own != null && !isNaN(own)) return { f: own, own: true };
  const c = catById(it.cat); const f = c ? parseDisc(c.discount) : null;
  return { f: f == null || isNaN(f) ? 1 : f, own: false };
}
export const decimals = () => +store.setting('pricing').decimals || 2;
export const decFor = n => { const a = Math.abs(n); return a && a < 0.1 ? Math.max(decimals(), 4) : a && a < 1 ? Math.max(decimals(), 3) : decimals(); };
export const round = (n, d = decFor(n)) => { const p = Math.pow(10, d); return Math.round((n + Number.EPSILON) * p) / p; };
export const fmtP = (n, d = decFor(n)) => isFinite(n) ? n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
export const fmtList = n => isFinite(n) ? n.toLocaleString('zh-TW', { maximumFractionDigits: 4 }) : '—';
export const netPrice = it => round(it.price * itemFactor(it).f);

// ---------- 規格屬性 ----------
const HEAD_ALIAS = { '圓頭': '丸頭', '平頭': '皿頭' };
const HEAD_ALIAS_RE = /(?<!半)圓頭|平頭/g;
export const headName = h => String(h || '').trim().replace(HEAD_ALIAS_RE, m => HEAD_ALIAS[m]);
export const pnorm = s => norm(s).replace(HEAD_ALIAS_RE, m => HEAD_ALIAS[m]);
const abbr = it => { const t = [it.name, it.thread].join(' '); return [/鐵板牙/.test(t) ? 'tp t/p' : '', /機械牙/.test(t) ? 'ms m/s' : ''].join(' '); };
const ST = new WeakMap();
export function searchText(it) { let t = ST.get(it); if (!t) { t = pnorm([abbr(it), it.code, it.name, it.spec, it.material, it.finish, it.head, it.thread, it.sup, noteOf(it), catById(it.cat)?.name].join(' ')); ST.set(it, t); } return t; }
export const HEADS = ['內六角', '六角', '半圓頭', '圓頭', '盤頭', '大扁頭', '扁頭', '平頭', '沉頭', '丸頭', '蝶頭', '華司頭', '喇叭頭', '截頭', '無頭', '圓柱頭', '方頭'];
export function specParts(spec) { const p = String(spec || '').replace(/\s+/g, '').split(/[×xX*]/).filter(Boolean); return { dia: p[0] || '', pitch: p.length >= 3 ? p[1] : '', len: p.length >= 2 ? p[p.length - 1] : '' }; }
const SUP_NOTE = { '久允': '久允牌價 115/06/26' };
export const noteOf = it => (it.note || SUP_NOTE[it.sup] || '').trim();
export const origText = it => it.origUnit ? `原牌價 ${fmtList(it.origPrice)}/${it.origUnit}` : '';
export const perKgText = it => { const pk = +it.perKg; return pk > 0 ? `約 ${pk.toLocaleString('zh-TW')} 個/kg` : ''; };
const FINISH_RE = /五彩|彩鋅|白鋅|黑鋅|藍白鋅|鍍鋅|鍍鎳|鍍鉻|鍍銅|鍍黃|染黑|發黑|黑色|電鍍|白皮|達克羅|熱浸鋅|磷酸皮膜/;
export const GROUPS = ['螺絲', '內六角螺絲', '螺帽', '華司', '彈簧扣環', '馬車', '壁虎', '鑽尾', '其他'];
const WASHER_CATS = ['qq-wsh', 'dr-wsh', 'cj-sw', 'ft-wsh'];
export function groupOf(it) {
  const n = it.name || '', c = it.cat || '';
  if (((/彈簧|扣環/.test(n)) || it.material === '彈簧鋼') && !/螺絲/.test(n)) return '彈簧扣環';
  if (it.group) return it.group;
  if (/壁虎|膨脹/.test(n) || c === 'dr-anc') return '壁虎';
  if (/馬車/.test(n)) return '馬車';
  if (/鑽尾/.test(n) || c === 'jt-roof') return '鑽尾';
  if (/T帽/.test(n)) return '螺帽';
  if (/^六角釘/.test(n)) return '螺絲';
  if (/吊環|吊帽|鬆緊|下古|鋼索|塞頭|開口銷|R型銷|牙條|U型螺絲|釘/.test(n) && !/螺釘/.test(n)) return '其他';
  if (/內六角|等高套筒/.test(n) || /^cap-(shcs|set|csk|btn|shd)$/.test(c)) return '內六角螺絲';
  if (WASHER_CATS.includes(c) || (/華司/.test(n) && !/螺絲|頭|面|附|SWS/.test(n))) return '華司';
  if (/帽/.test(n)) return '螺帽';
  if (/螺絲|螺栓|螺釘|牙|SWS/.test(n)) return '螺絲';
  return '其他';
}
const WD = new WeakMap();
function washerDims(it) {
  if (WD.has(it)) return WD.get(it);
  const sp = String(it.spec || '').replace(/^[\d\/#M.]+\s+(?=[\d外])/, '');
  let m, od = '', t = '';
  if ((m = sp.match(/外([\d.]+)×厚([\d.]+)/))) { od = m[1]; t = m[2]; }
  else if ((m = sp.match(/^[\d.]+×([\d.]+)(?:×[\d.]+)?×([\d.]+)(?:\/[\d.]+)?$/))) { od = m[1]; t = m[2]; }
  else if ((m = sp.match(/^([\d.]+)×([\d.]+)T$/))) { od = m[1]; t = m[2]; }
  const n = v => v ? String(+v) : '';
  const r = { od: n(od), thick: n(t) }; WD.set(it, r); return r;
}
export function attr(it, key) {
  if (key === 'sup') return it.sup || '自行新增';
  if (key === 'od' || key === 'thick') return /華司|彈簧扣環/.test(groupOf(it)) ? washerDims(it)[key] : '';
  if (key === 'head') return headName(it.head || (it.nut ? '' : HEADS.find(h => (it.name || '').includes(h)) || ''));
  if (key === 'cat') return it.cat;
  if (key === 'group') return groupOf(it);
  if (key === 'material' || key === 'finish') {
    const m = (it.material || '').trim();
    if (it.finish != null && it.finish !== '') return key === 'finish' ? String(it.finish).trim() : m;
    const hit = m.match(FINISH_RE);
    if (key === 'finish') return hit ? hit[0] : '';
    return hit ? (m.replace(hit[0], '').trim() || m) : m;
  }
  if (key === 'system') { const d = attr(it, 'dia'); if (/#/.test(d) || (!d && /^\s*(#\d|\d+#)/.test(it.spec || ''))) return '番數牙'; }
  if (it[key]) return String(it[key]).trim();
  if (it.nut && (key === 'length' || key === 'head')) return '';
  const sp = specParts(it.spec);
  if (key === 'system' || key === 'dia') return diaInfo(it)[key];
  if (key === 'length') return sp.len.replace(/mm$/i, '');
  if (key === 'thread') {
    const d = sp.dia, n = it.name || '';
    if (/自攻|鑽尾|木螺絲/.test(n) || /^(#|ST)/i.test(d)) return '自攻牙';
    if (/UNC/i.test(d + n)) return 'UNC 英制粗牙';
    if (/UNF/i.test(d + n)) return 'UNF 英制細牙';
    if (/^M\d/i.test(d)) return sp.pitch || /細牙/.test(n) ? '公制細牙' : '公制粗牙';
    if (/["\/]/.test(d)) return '英制';
    return '';
  }
  return '';
}
export function diaInfo(it) {
  const tok = String(it.spec || '').trim().split(/[×xX*\s]/)[0]; let m;
  if ((m = tok.match(/^M(\d+(?:\.\d+)?)/i))) return { system: '公制', dia: 'M' + m[1] };
  if ((m = tok.match(/^ST(\d+(?:\.\d+)?)/i))) return { system: '公制', dia: 'ST' + m[1] };
  if ((m = tok.match(/^#(\d+)|^(\d+)#/))) return { system: '英制', dia: (m[1] || m[2]) + '#' };
  if ((m = tok.match(/^(\d+\/\d+)/))) return { system: '英制', dia: m[1] };
  const t = (it.thread || '') + (it.name || '');
  return { system: /英制|UNC|UNF|SAE|W粗牙/i.test(t) ? '英制' : /公制/.test(t) ? '公制' : '', dia: '' };
}
export function diaValue(v) {
  let m;
  if ((m = String(v).match(/^(?:M|ST)(\d+(?:\.\d+)?)/i))) return +m[1];
  if ((m = String(v).match(/^(\d+)#$/))) return (0.06 + 0.013 * m[1]) * 25.4;
  if ((m = String(v).replace(/"$/, '').match(/^(?:(\d+)-)?(\d+)(?:\/(\d+))?$/))) return ((m[3] ? m[2] / m[3] : +m[2]) + (+m[1] || 0)) * 25.4;
  return Infinity;
}
export function lenValue(v) {
  const s = String(v).replace(/mm|L/gi, ''); const inch = /["\/]/.test(s);
  const m = s.replace(/"/g, '').match(/^(?:(\d+)-)?(\d+(?:\.\d+)?)(?:\/(\d+))?$/); if (!m) return Infinity;
  let n = m[3] ? +m[2] / +m[3] : +m[2]; if (m[1]) n += +m[1];
  return inch ? n * 25.4 : n;
}
export const FACETS = [['sup', '廠商'], ['material', '材質'], ['finish', '電鍍'], ['group', '螺絲類別'], ['head', '頭型'], ['system', '牙系'], ['dia', '直徑'], ['length', '長度'], ['od', '外徑'], ['thick', '厚度']];
const MAT_GROUP = m => /^SUS|白鐵|不鏽鋼/i.test(m) ? '不鏽鋼' : m === '低碳鋼' || /^鐵\(SP[CH]C/.test(m) || /^1022/.test(m) ? '鐵' : /^合金鋼/.test(m) ? '合金鋼' : /^中碳鋼/.test(m) ? '中碳鋼' : m;
const FIN_GROUP = f => /^(鍍鋅|電鍍|電鋅|鋅)$/.test(f) ? '電鍍／鍍鋅' : /^(六價鍍鋅|三價鍍鋅|三價鉻鍍鋅／鍍鋅／五彩)$/.test(f) ? '六價／三價鍍鋅' : /^(五彩|五彩鋅|六價五彩|電鋅／五彩)$/.test(f) ? '五彩' : /^(鍍鎳|鎳)$/.test(f) ? '鍍鎳' : /CR3\+R/i.test(f) ? '三價處理（CR3+R）' : /^(白皮|黑身)$/.test(f) ? '白皮／黑身' : f;
export const facetVal = (it, k) => k === 'dia' ? attr(it, k).replace(/^#(\d+)$/, '$1#') : k === 'material' ? MAT_GROUP(attr(it, k)) : k === 'finish' && attr(it, k) ? FIN_GROUP(attr(it, k)) : attr(it, k) || (k === 'finish' ? '未標示' : '');
export const matchFacets = (it, flt, skip) => FACETS.every(([k]) => k === skip || (skip === 'group' && (k === 'od' || k === 'thick')) || !flt[k] || facetVal(it, k) === flt[k]);
export function sortFacetVals(k, vals) {
  if (k === 'group') return GROUPS.filter(g => vals.includes(g));
  if (k === 'length') return vals.sort((a, b) => lenValue(a) - lenValue(b) || a.localeCompare(b));
  if (k === 'od' || k === 'thick') return vals.sort((a, b) => a - b);
  if (k === 'dia') return vals.sort((a, b) => diaValue(a) - diaValue(b) || a.localeCompare(b));
  if (k === 'system') { const o = ['公制', '英制', '番數牙']; return vals.sort((a, b) => o.indexOf(a) - o.indexOf(b)); }
  return vals.sort((a, b) => (a === '未標示') - (b === '未標示') || a.localeCompare(b, 'zh-Hant'));
}

// 重複品項：品名規格材質電鍍頭型都相同；或不同供應商同類別規格材質電鍍頭型相同
let DUP = null, DUPgen = -1;
const nk = v => pnorm(v).replace(/[\s（）()]/g, '');
const specKey = it => [nk(it.spec), attr(it, 'material'), attr(it, 'finish'), attr(it, 'head')].join('|');
const dupKey = it => nk(it.name) + '|' + specKey(it);
export const supName = it => it.sup || '未標示供應商';
export function dupGroup(it) {
  if (!DUP || DUPgen !== store.gen) {
    DUP = { byName: new Map(), byCat: new Map() }; DUPgen = store.gen;
    const push = (m, k, x) => (m.get(k) || m.set(k, []).get(k)).push(x);
    for (const x of store.list('pricing')) { push(DUP.byName, dupKey(x), x); if (nk(x.spec)) push(DUP.byCat, x.cat + '|' + specKey(x), x); }
  }
  const g = new Set(DUP.byName.get(dupKey(it)) || [it]);
  if (nk(it.spec)) (DUP.byCat.get(it.cat + '|' + specKey(it)) || []).forEach(x => { if (supName(x) !== supName(it)) g.add(x); });
  return [...g];
}

// ---------- 進銷存商品 → 查價牌價（成本估算用，移植自舊進銷存 parseGoods/platCost 的簡化版） ----------
const HEADS2 = ['內六角', '六角', '半圓頭', '圓頭', '盤頭', '大扁頭', '大扁', '扁頭', '平頭', '沉頭', '丸頭', '蝶頭', '華司頭', '喇叭頭', '截頭', '皿頭', '蓋頭'];
const headN = h => h === '圓頭' ? '丸頭' : h === '平頭' ? '皿頭' : h === '大扁' ? '大扁頭' : h;
const matClass = t => { t = String(t || ''); if (/SUS|不銹|不鏽|白鐵/i.test(t)) return 'S'; if (/銅/.test(t)) return 'C'; if (/合金|SCM/i.test(t)) return 'A'; if (/鐵|鋼/.test(t)) return 'F'; return ''; };
const lenN = s => String(s || '').replace(/["”吋]|mm/g, '').trim();
// 華司種類：平、彈簧、盤型彈簧、齒型、波浪、弓形、碗型、四角（不同種類不互配）
const wKind = t => /盤型/.test(t) ? 'disc' : /彈簧/.test(t) ? 'spring' : /齒/.test(t) ? 'tooth' : /波浪/.test(t) ? 'wave' : /弓/.test(t) ? 'bow' : /碗/.test(t) ? 'cup' : /四角/.test(t) ? 'sq' : 'flat';
const isWasher = t => /華司|墊圈/.test(t) && !/螺絲|螺栓/.test(t);
function parseGoods(g) {
  const t = String(g.name || '').replace(/[＊×xX]/g, '*').replace(/／/g, '/');
  const m = t.match(/(M\d+(?:\.\d+)?|\d+\/\d+|#?\d+#|\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?(?:\/\d+)?(?:-\d+\/\d+)?)/i);
  const dia = m ? m[1].toUpperCase().replace(/^(\d+)#$/, '$1#') : '', len = m ? lenN(m[2]) : '';
  const head = headN(HEADS2.find(h => t.includes(h)) || '');
  const mat = matClass(t), nut = /螺帽|螺母|帽/.test(t) && !/螺絲/.test(t), washer = isWasher(t);
  const tap = /鐵板|自攻|TP|T\/P/i.test(t), ms = /機械|MS|M\/S/i.test(t), cap = /內六角|CAP/i.test(t);
  const thread = tap ? 'tap' : cap ? 'cap' : ms ? 'ms' : '';
  return { dia, len, head, mat, nut, washer, wk: washer ? wKind(t) : '', thread, t };
}
let PIDX = null, PIDXgen = -1;
function priceIdx() {
  if (PIDX && PIDXgen === store.gen) return PIDX;
  PIDXgen = store.gen; PIDX = new Map();
  for (const it of store.list('pricing')) {
    const dia = attr(it, 'dia').toUpperCase().replace(/^#(\d+)$/, '$1#'); if (!dia) continue;
    const len = lenN(attr(it, 'length'));
    const key = dia + '|' + len;
    (PIDX.get(key) || PIDX.set(key, []).get(key)).push(it);
  }
  return PIDX;
}
const pmemo = new Map(); let pmemoGen = -1;
export function platCost(g) {
  if (pmemoGen !== store.gen) { pmemo.clear(); pmemoGen = store.gen; }
  if (pmemo.has(g.id)) return pmemo.get(g.id);
  let res = null;
  const p = parseGoods(g);
  if (p.dia) {
    const cands = priceIdx().get(p.dia + '|' + (p.nut || p.washer ? '' : p.len)) || [];
    let best = null;
    for (const it of cands) {
      const n = String(it.name || '');
      let score = 0;
      if (p.head && attr(it, 'head') === p.head) score += 3; else if (p.head) continue;
      if (p.mat && matClass(it.material + n) === p.mat) score += 2; else if (p.mat) continue;
      if (p.nut !== /帽/.test(n)) continue;
      if (p.washer !== isWasher(n)) continue;
      if (p.washer && p.wk !== wKind(n)) continue;   // 平華司、彈簧華司、齒型、波浪…不互配
      if (p.washer && +p.len > 0) { const q = String(it.spec || '').match(/[×x*]\s*(\d+(?:\.\d+)?)/); if (q) score += Math.max(-3, 2 - Math.abs(+q[1] - +p.len) / 2); }   // 平華司外徑越接近越好
      if (p.thread === 'tap' && !/鐵板|自攻/.test(n + (it.thread || ''))) continue;
      if (p.thread === 'ms' && !/機械/.test(n + (it.thread || ''))) continue;
      if (p.thread === 'cap' && !/內六角/.test(n)) continue;
      const per = netPrice(it);
      if (!(per > 0)) continue;
      if (!best || score > best.score || (score === best.score && per < best.per)) best = { it, per, score };
    }
    if (best) res = { per: best.per, cls: 'p', src: `查價：${best.it.sup || ''} ${best.it.name} ${best.it.spec || ''}${best.it.disc ? '（' + best.it.disc + '折）' : ''}` };
  }
  pmemo.set(g.id, res);
  return res;
}
