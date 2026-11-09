// 共用小工具：格式化、日期、字串正規化
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = n => String(n).padStart(2, '0');
export const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const today = () => isoOf(new Date());
export const thisMonth = () => today().slice(0, 7);
export const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); };
export const roc = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return isNaN(y) ? iso : `${y - 1911}/${pad(m)}/${pad(d)}`; };
export const rocLong = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `民國 ${y - 1911} 年 ${m} 月 ${d} 日`; };
export const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${y - 1911} 年 ${m} 月`; };
export const slash = iso => iso ? String(iso).replace(/-/g, '/') : '—';
export const dayN = s => Math.floor(Date.parse(String(s || '').slice(0, 10) + 'T00:00:00Z') / 864e5) || 0;
export const daysLeft = iso => dayN(iso) - dayN(today());
export const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };

// 金額四捨五入到整數（和舊進銷存一致）
export const rnd0 = n => { n = +n || 0; const x = Math.round(Math.abs(n) * 1e6) / 1e6; return Math.sign(n) * Math.floor(x + 0.5); };
export const fmt = n => rnd0(n).toLocaleString('zh-TW');
export const fmtQ = n => (+n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
export const fp4 = n => (+n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
export const fmtD = (n, d) => isFinite(n) ? (+n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
export const money = n => Math.round(n || 0).toLocaleString('zh-TW');
export const parseNum = v => { if (typeof v === 'number') return v; const t = toHalf(v).replace(/[,\s$NT元＄]/gi, ''); if (t === '') return null; const n = Number(t); return isFinite(n) ? n : NaN; };
export const toHalf = s => String(s ?? '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
export const norm = s => toHalf(s).toLowerCase().replace(/\s*[x×*]\s*/g, '×').trim();

// 多關鍵字搜尋：空白或逗號隔開，每個字都要出現
export const qTerms = q => norm(q).split(/[\s,，]+/).filter(Boolean);
export const matchQ = (text, q) => { const ts = Array.isArray(q) ? q : qTerms(q); if (!ts.length) return true; const t = norm(text); return ts.every(x => t.includes(x)); };

// 國字金額（支票、發票）
export function cnMoney(n) {
  n = Math.floor(Number(n));
  if (!isFinite(n) || n <= 0) return '';
  const D = '零壹貳參肆伍陸柒捌玖', U = ['', '拾', '佰', '仟'], G = ['', '萬', '億', '兆'];
  const s = String(n); const groups = [];
  for (let i = s.length; i > 0; i -= 4) groups.unshift(s.slice(Math.max(0, i - 4), i));
  let out = '', zero = false;
  groups.forEach((g, gi) => {
    const gIdx = groups.length - 1 - gi; let part = '';
    g = g.padStart(4, '0');
    for (let i = 0; i < 4; i++) {
      const d = +g[i];
      if (d === 0) { zero = true; continue; }
      if (zero && (out || part)) part += '零';
      zero = false;
      part += D[d] + U[3 - i];
    }
    if (part) out += part + G[gIdx];
  });
  return out + '元整';
}
export const ubnOk = id => { const s = String(id || ''); if (!/^\d{8}$/.test(s)) return false; const w = [1, 2, 1, 2, 1, 2, 4, 1]; let sum = 0; for (let i = 0; i < 8; i++) { const p = +s[i] * w[i]; sum += Math.floor(p / 10) + p % 10; } return sum % 10 === 0 || (s[6] === '7' && (sum + 1) % 10 === 0); };

export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const sortBy = (arr, f, desc = false) => [...arr].sort((a, b) => { const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
export const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
export const groupBy = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export const downloadText = (name, text, type = 'text/plain') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
export const ls = { get: (k, d = null) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
