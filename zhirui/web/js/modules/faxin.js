// 接收傳真：瀏覽伺服器電腦 C:\zhirui\fax 資料夾裡收到的傳真（JPG／PDF；TIF 由伺服器轉成 PNG）。
// 看過的記在設定 faxin（大家共用），左側選單顯示未讀張數。
import { esc, fmt, qTerms, matchQ } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { printHTML, toast, confirm } from '../core/ui.js';
import { cdisp } from '../core/calc.js';

let FILES = [], LOADED = 0, LAST_ERR = '', INDEX = null;
// 辨識出的寄件公司 → 客戶／廠商（名稱、簡稱、別名互相包含；或傳真號碼相同）
const normCo = s => String(s || '').replace(/\s+/g, '').replace(/股份有限公司|有限公司|企業社|實業|企業|工業|公司|行號|商行|\(股\)|（股）/g, '').toUpperCase();
const digits = s => String(s || '').replace(/\D/g, '').replace(/^886/, '0').slice(-8);
let CO = null, COgen = -1;
function coIndex() {
  if (CO && COgen === store.gen) return CO;
  CO = store.list('contacts').filter(c => !c.inactive || true).map(c => ({ c, keys: [c.name, c.short, ...(c.aliases || [])].map(normCo).filter(k => k.length >= 2), fax: digits(c.fax), tel: digits(c.phone) }));
  COgen = store.gen; return CO;
}
function matchCo(name, fax) {
  const n = normCo(name); const fx = digits(fax); let best = null;
  for (const x of coIndex()) {
    let sc = 0;
    if (n) for (const k of x.keys) if (n === k) sc = Math.max(sc, 100 + k.length); else if (n.includes(k) || k.includes(n)) sc = Math.max(sc, Math.min(k.length, n.length));
    if (fx && fx.length >= 7 && (x.fax === fx || x.tel === fx)) sc = Math.max(sc, 90);
    if (sc >= 2 && (!best || sc > best.sc)) best = { c: x.c, sc };
  }
  return best ? best.c : null;
}
export const coOf = f => f.idx && !f.idx.err ? matchCo(f.idx.sender, f.idx.fax_no) : null;
export const searchText = f => { const i = f.idx || {}; const c = coOf(f); return [f.name, when(f.mtime), i.sender, i.recipient, i.doc_type, i.doc_no, i.date, i.fax_no, i.summary, c && cdisp(c), c && c.name, c && c.code, ...(c?.aliases || [])].filter(Boolean).join(' '); };
const ui = { sel: '', q: '', rot: 0, zoom: 1, page: 0, pages: 1 };
const readMap = () => store.setting('faxin').read || {};
export const isRead = f => readMap()[f.name] === f.mtime;
export const url = (f, extra = '') => `/api/faxin/file?name=${encodeURIComponent(f.name)}${extra}&v=${f.mtime}`;
export const when = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const size = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
export const faxFiles = () => FILES;
export const faxInfo = () => ({ loaded: LOADED, err: LAST_ERR, index: INDEX });
export async function load() {
  try { const r = await api.get('/api/faxin/list'); FILES = r.files || []; INDEX = r.index || null; LOADED = Date.now(); LAST_ERR = r.exists ? '' : `找不到資料夾 ${r.dir}`; }
  catch (e) { LAST_ERR = e.message || String(e); }
  window.dispatchEvent(new Event('zr-nav'));
}
// 每 2 分鐘更新一次未讀張數（登入後才會成功）
setInterval(() => { if (store.user) load(); }, 120000);
setTimeout(() => { if (store.user) load(); }, 3000);

export default {
  id: 'faxin', name: '接收傳真', icon: 'fax', group: '管理',
  badge() { const r = readMap(); return { cnt: FILES.filter(f => r[f.name] !== f.mtime).length }; },
  async render(el) { this.el = el; draw(el); await load(); if (el.isConnected) draw(el); clearInterval(this.tm); this.tm = setInterval(async () => { if (!el.isConnected) return clearInterval(this.tm); if (INDEX?.running || INDEX?.auto) { const n0 = (INDEX && INDEX.done) || 0; await load(); if (el.isConnected && (INDEX?.done || 0) !== n0) { drawList(el); drawIdx(el); } } }, 15000); },
  onChange(ch) { if (this.el?.isConnected && ch.has('settings')) drawList(this.el); },
};
export async function markRead(f, on = true) {
  const s = store.setting('faxin'); const read = { ...(s.read || {}) };
  if (on) read[f.name] = f.mtime; else delete read[f.name];
  for (const k of Object.keys(read)) if (!FILES.some(x => x.name === k)) delete read[k];   // 資料夾裡已經沒有的就清掉
  await store.saveSetting('faxin', { ...s, read });
  window.dispatchEvent(new Event('zr-nav'));
}
function shown() { const ts = qTerms(ui.q); return ts.length ? FILES.filter(f => matchQ(searchText(f), ts)) : FILES; }
function draw(el) {
  el.innerHTML = `<div class="head"><h1>接收傳真</h1><span class="sub">伺服器電腦的傳真資料夾，收到的傳真（JPG、PDF）會出現在這裡</span><span class="sp"></span><button class="btn" id="fiReload">重新整理</button></div>
    <div class="panel" style="display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:14px;align-items:start">
      <div><input type="search" id="fiQ" placeholder="搜尋客戶、廠商、單號或日期，例如 元貝、2026/11/12" value="${esc(ui.q)}" style="width:100%;margin-bottom:8px"><div id="fiIdx" class="small" style="margin-bottom:6px"></div>
        <div class="muted small" id="fiInfo" style="margin-bottom:6px"></div>
        <div id="fiList" style="max-height:72vh;overflow:auto;border:1px solid var(--line);border-radius:8px"></div></div>
      <div id="fiView"></div>
    </div>`;
  el.querySelector('#fiReload').onclick = async () => { await load(); draw(el); };
  el.querySelector('#fiQ').addEventListener('input', ev => { ui.q = ev.target.value; drawList(el); });
  el.onkeydown = ev => {
    if (ev.target.closest('input,textarea,select')) return;
    const L = shown(); const i = L.findIndex(f => f.name === ui.sel);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') { ev.preventDefault(); if (L[i + 1]) pick(el, L[i + 1]); }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') { ev.preventDefault(); if (i > 0) pick(el, L[i - 1]); }
  };
  el.tabIndex = -1;
  drawList(el); drawIdx(el);
  const f = FILES.find(x => x.name === ui.sel) || FILES[0];
  if (f) pick(el, f, true); else el.querySelector('#fiView').innerHTML = `<div class="empty"><b>${LOADED ? (LAST_ERR ? esc(LAST_ERR) : '資料夾裡還沒有傳真') : '載入中…'}</b>${LOADED && !LAST_ERR ? '收到的傳真存進伺服器電腦的傳真資料夾後，按「重新整理」就會出現。' : ''}</div>`;
}
function drawList(el) {
  const box = el.querySelector('#fiList'); if (!box) return;
  const L = shown(); const unread = FILES.filter(f => !isRead(f)).length;
  el.querySelector('#fiInfo').textContent = LAST_ERR ? LAST_ERR : `共 ${FILES.length} 張${unread ? `，未讀 ${unread} 張` : ''}${ui.q ? `，符合 ${L.length} 張` : ''}`;
  box.innerHTML = L.map(f => `<a href="#" data-fi="${esc(f.name)}" style="display:block;padding:8px 10px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;${f.name === ui.sel ? 'background:var(--sel,rgba(0,122,255,.12));' : ''}">
      <div style="display:flex;gap:6px;align-items:center">${isRead(f) ? '' : '<span title="未讀" style="width:8px;height:8px;border-radius:50%;background:#e53935;flex:none"></span>'}<b style="${isRead(f) ? 'font-weight:400' : ''}">${esc(when(f.mtime))}</b><span class="sp"></span><span class="pill">${esc(f.ext.toUpperCase())}</span></div>
      ${f.idx && !f.idx.err ? `<div style="margin-top:2px">${(c => c ? `<b>${esc(cdisp(c))}</b> <span class="muted small">${c.kind === 'S' ? '廠商' : '客戶'}</span>` : `<span>${esc(f.idx.sender || '（寄件公司看不出來）')}</span>`)(coOf(f))}${f.idx.doc_type ? ` <span class="pill">${esc(f.idx.doc_type)}</span>` : ''}</div>${f.idx.doc_no || f.idx.summary ? `<div class="muted small">${esc([f.idx.doc_no, f.idx.summary].filter(Boolean).join('・'))}</div>` : ''}` : ''}
      <div class="muted small" style="word-break:break-all">${esc(f.name)}・${size(f.size)}</div></a>`).join('') || '<div class="muted" style="padding:12px">沒有符合的傳真</div>';
  box.querySelectorAll('[data-fi]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); const f = FILES.find(x => x.name === a.dataset.fi); if (f) pick(el, f); }));
}
async function pick(el, f, first) {
  if (ui.sel !== f.name) { ui.rot = 0; ui.zoom = 1; ui.page = 0; ui.pages = 1; }
  ui.sel = f.name; drawList(el);
  const v = el.querySelector('#fiView'); const pdf = f.ext === 'pdf'; const conv = ['tif', 'tiff', 'bmp'].includes(f.ext);
  if (conv) { try { ui.pages = (await api.get('/api/faxin/info?name=' + encodeURIComponent(f.name))).pages || 1; } catch (e) { v.innerHTML = `<div class="banner">${esc(e.message)}</div>`; return; } }
  const src = url(f, conv ? `&page=${ui.page}` : '');
  v.innerHTML = `<div class="tools" style="margin-bottom:8px;align-items:center;flex-wrap:wrap;gap:6px"><b style="word-break:break-all">${esc(f.name)}</b><span class="muted small">${esc(when(f.mtime))}</span><span class="sp"></span>
      ${pdf ? '' : '<button class="btn sm" data-rot="-90" title="向左轉">⟲</button><button class="btn sm" data-rot="90" title="向右轉">⟳</button><button class="btn sm" data-zoom="-1">－</button><button class="btn sm" data-zoom="0">符合寬度</button><button class="btn sm" data-zoom="1">＋</button>'}
      ${ui.pages > 1 ? `<button class="btn sm" data-pg="-1" ${ui.page ? '' : 'disabled'}>上一頁</button><span class="small">${ui.page + 1}／${ui.pages}</span><button class="btn sm" data-pg="1" ${ui.page < ui.pages - 1 ? '' : 'disabled'}>下一頁</button>` : ''}
      <button class="btn sm" id="fiPrint">列印</button><a class="btn sm" href="${url(f, '&dl=1')}">下載</a><a class="btn sm" href="${src}" target="_blank" rel="noopener">新分頁開啟</a>
      <button class="btn sm" id="fiRead">${isRead(f) ? '標成未讀' : '標成已讀'}</button></div>
    ${f.idx && !f.idx.err ? `<div class="small" style="margin:-2px 0 8px">${(c => `寄件：<b>${esc(f.idx.sender || '—')}</b>${c ? `（${c.kind === 'S' ? '廠商' : '客戶'}「${esc(cdisp(c))}」）` : f.idx.sender ? '<span class="muted">（客戶、廠商資料裡沒對到）</span>' : ''}`)(coOf(f))}${['doc_type', 'doc_no', 'date', 'fax_no', 'summary'].filter(k => f.idx[k]).map(k => `　${{ doc_type: '', doc_no: '單號 ', date: '日期 ', fax_no: '傳真 ', summary: '' }[k]}${esc(f.idx[k])}`).join('')}</div>` : f.idx?.err ? `<div class="small" style="margin:-2px 0 8px;color:var(--warn)">內容辨識失敗：${esc(f.idx.err)}</div>` : ''}
    <div style="overflow:auto;max-height:76vh;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:center">
      ${pdf ? `<iframe src="${src}" style="width:100%;height:75vh;border:0" title="${esc(f.name)}"></iframe>` : `<img id="fiImg" src="${src}" alt="${esc(f.name)}" style="width:${Math.round(ui.zoom * 100)}%;transform:rotate(${ui.rot}deg);transform-origin:center;${ui.rot % 180 ? 'margin:20% 0;' : ''}">`}</div>`;
  v.querySelectorAll('[data-rot]').forEach(b => b.onclick = () => { ui.rot = (ui.rot + +b.dataset.rot + 360) % 360; pick(el, f); });
  v.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { const d = +b.dataset.zoom; ui.zoom = d ? Math.min(4, Math.max(0.25, ui.zoom + d * 0.25)) : 1; pick(el, f); });
  v.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { ui.page = Math.min(ui.pages - 1, Math.max(0, ui.page + +b.dataset.pg)); pick(el, f); });
  v.querySelector('#fiRead').onclick = async () => { await markRead(f, !isRead(f)); pick(el, f); };
  v.querySelector('#fiPrint').onclick = () => {
    if (pdf) { window.open(src, '_blank'); return; }
    const imgs = Array.from({ length: ui.pages }, (_, i) => `<img src="${location.origin}${url(f, conv ? `&page=${i}` : '')}" style="width:100%;${ui.rot ? `transform:rotate(${ui.rot}deg);` : ''}page-break-after:always">`).join('');
    printHTML(`傳真 ${f.name}`, '@page{size:A4;margin:8mm}body{margin:0}img{display:block;max-height:281mm;object-fit:contain}', imgs, { tip: '按 Ctrl+P 列印，紙張 A4。' });
  };
  if (!isRead(f) && !first) markRead(f, true);   // 點開就算看過（第一次進頁面自動帶出的不算）
  else if (!isRead(f) && first) setTimeout(() => { if (ui.sel === f.name && el.isConnected) markRead(f, true); }, 1500);
  el.focus({ preventScroll: true });
}

// 內容辨識（寄件公司、單號…）的狀態與開關：用 Claude Haiku 讀，每張約 NT$0.02；預設關閉
function drawIdx(el) {
  const box = el.querySelector('#fiIdx'); if (!box || !INDEX) return;
  const I = INDEX; const admin = (store.user?.role || 'admin') === 'admin';
  const left = I.total - I.done;
  box.innerHTML = !I.ai ? '<span class="muted">要用客戶、廠商名稱搜尋傳真內容，需要先在「設定備份 → AI 辨識」設定 Claude 金鑰。</span>'
    : I.auto ? `<span class="pill ok">自動辨識中</span> 已讀 ${I.done}／${I.total} 張${I.running && I.current ? `（正在讀 ${esc(I.current)}）` : left ? '（每分鐘檢查一次）' : ''}${I.err ? `<div style="color:var(--warn)">${esc(I.err)}</div>` : ''}${admin ? ' <a href="#" id="fiAuto" data-v="0">關閉</a>' : ''}`
    : `<span class="muted">傳真內容還沒辨識（已讀 ${I.done}／${I.total} 張），只能用檔名、日期搜尋。</span>${admin ? ` <a href="#" id="fiAuto" data-v="1">開啟內容辨識</a>` : ''}`;
  box.querySelector('#fiAuto')?.addEventListener('click', async ev => {
    ev.preventDefault(); const on = ev.target.dataset.v === '1';
    if (on && !await confirm(`開啟後，伺服器會用 Claude Haiku 讀每張傳真的寄件公司、單號、日期（每張約 NT$0.02）。\n現在有 ${left} 張還沒讀，全部讀完約 NT$${Math.max(1, Math.ceil(left * 0.02))}，之後新收到的傳真會自動讀。\n要開啟嗎？`, { ok: '開啟' })) return;
    try { await api.get('/api/faxin/index?auto=' + (on ? 1 : 0)); toast(on ? '已開啟，伺服器一分鐘內會開始讀' : '已關閉內容辨識'); await load(); drawIdx(el); }
    catch (e) { toast(e.message || String(e)); }
  });
}
