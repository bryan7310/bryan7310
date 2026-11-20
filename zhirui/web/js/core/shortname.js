// 品名簡稱：排程這類清單只要看「是什麼＋尺寸」，例如
//   無頭內六角螺絲M4*23 防鬆 鍍鋅合金 AH2-00586 → 無頭 M4*23
//   ⊕喇叭快速牙螺絲6#*5分 鍍鋅鐵              → 快速牙 6#*5分
// 簡稱對照（原字 → 簡稱）可以在「訂貨排程 › 簡稱設定」改，存在設定 prod_abbr；沒設定過用下面的預設。
import { store } from './store.js';

export const ABBR_DEFAULT = [
  ['喇叭快速牙', '快速牙'], ['無頭內六角', '無頭'], ['止付內六角', '止付'], ['皿頭內六角', '皿頭'], ['半圓內六角', '半圓'],
  ['圓柱頭內六角', '圓柱頭'], ['華司面平尾', '華司面平尾'], ['六角全牙', '六角全牙'], ['六角半牙', '六角半牙'],
];
export const abbrList = () => { const l = store.setting('prod_abbr').list; return Array.isArray(l) && l.length ? l : ABBR_DEFAULT; };

// 尺寸：有「*」的那一段（M4*23、6#*5分、1/4*5/8、5/8*38*2.5、1"*1呎(300L)）；沒有 * 就取中文後面接的第一段數字（彈簧華司1/2）
const SIZE_STAR = /[MW]?\d[\d.\/\-]*["#]?(?:\s?\*\s?[^\s*]+)+/;
const SIZE_NUM = /(?<=[一-鿿)）])[MW]?\d[^\s]*/;

/** 回傳 { s: 簡稱, rest: 尺寸後面的說明（材質、表面處理；客料號拿掉）, full } */
export function shortProd(name) {
  const full = String(name || '').trim(); if (!full) return { s: '', rest: '', full };
  const n = full.replace(/[⊕Θ]/g, '');
  const m = SIZE_STAR.exec(n) || SIZE_NUM.exec(n);
  if (!m) return { s: n.split(/\s{2,}|\s(?=[A-Z]{1,4}\d?-\d{3,})/)[0].trim() || full, rest: '', full };   // 沒有尺寸：只留最前面那一段（材質、客料號不顯示）
  let head = n.slice(0, m.index).trim(); const size = m[0].replace(/\s/g, '');
  const rest = n.slice(m.index + m[0].length).replace(/\s[A-Z]{1,4}\d?-\d{3,}\S*/g, ' ').replace(/\s+/g, ' ').trim();   // 客料號（AH2-00586）不算說明
  const hit = abbrList().filter(x => x && x[0] && head.includes(x[0])).sort((a, b) => b[0].length - a[0].length)[0];
  if (hit) head = hit[1] || hit[0];
  else { const h1 = head.replace(/螺絲$/, ''); if (h1.length >= 3) head = h1; const h2 = head.replace(/內六角/, '').trim(); if (h2.length >= 2) head = h2; }   // 「基礎螺絲」這種去掉就看不懂的不去
  return { s: (head ? head + ' ' : '') + size, rest, full };
}
