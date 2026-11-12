// 手機版：接收傳真（跟電腦版「接收傳真」同一個資料夾、同一份已讀紀錄與內容辨識）
import { esc, qTerms, matchQ } from '../core/util.js';
import { cdisp } from '../core/calc.js';
import { load, faxFiles, faxInfo, isRead, markRead, url, when, size, coOf, searchText } from '../modules/faxin.js';

const ui = { q: '', rot: 0 };
export const faxUnread = () => faxFiles().filter(f => !isRead(f)).length;
const shown = () => { const ts = qTerms(ui.q); return ts.length ? faxFiles().filter(f => matchQ(searchText(f), ts)) : faxFiles(); };
const who = f => { const c = coOf(f); return c ? `<b>${esc(cdisp(c))}</b> <small class="muted">${c.kind === 'S' ? '廠商' : '客戶'}</small>` : f.idx?.sender ? `<b>${esc(f.idx.sender)}</b>` : '<span class="muted">寄件公司還沒辨識</span>'; };
const enc = n => encodeURIComponent(n).replace(/%2F/g, '/');

export async function faxPage(view, sub, name) {
  if (sub === 'v' && name) return viewPage(view, decodeURIComponent(name));
  const paint = () => {
    const L = shown(); const I = faxInfo();
    view.innerHTML = `<div class="hd"><a class="back" href="#home">‹ 首頁</a></div><div class="hd" style="margin-top:0"><h1>接收傳真</h1><span class="sp"></span><button class="chip" id="fr">重新整理</button></div>
      <div class="search"><input type="search" id="fq" placeholder="客戶、廠商、單號、日期" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="note" style="text-align:left;margin:0 0 8px">${I.err ? esc(I.err) : `共 ${faxFiles().length} 張${faxUnread() ? `，未讀 ${faxUnread()} 張` : ''}${ui.q ? `，符合 ${L.length} 張` : ''}${I.index?.auto && I.index.done < I.index.total ? `・內容辨識中 ${I.index.done}／${I.index.total}` : ''}`}</div>
      <div class="card list" id="fl">${L.slice(0, 150).map(f => `<a href="#fax/v/${enc(f.name)}"><div class="gm">${who(f)}${f.idx?.doc_type ? ` <span class="tag">${esc(f.idx.doc_type)}</span>` : ''}<small>${esc(when(f.mtime))}${f.idx?.doc_no ? '・' + esc(f.idx.doc_no) : ''}${f.idx?.summary ? '・' + esc(f.idx.summary) : ''}</small></div><span class="go">${isRead(f) ? '' : '<span class="dot"></span>'}›</span></a>`).join('') || `<div class="row muted">${faxInfo().loaded ? '沒有符合的傳真' : '載入中…'}</div>`}</div>
      ${L.length > 150 ? '<div class="note">只列前 150 張，請用搜尋縮小範圍。</div>' : ''}`;
    const q = view.querySelector('#fq'); let tm = 0;
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { ui.q = q.value; const pos = q.selectionStart; paint(); const q2 = view.querySelector('#fq'); q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }, 250); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
    view.querySelector('#fr').onclick = async () => { await load(); paint(); };
  };
  paint();
  if (!faxInfo().loaded || Date.now() - faxInfo().loaded > 30000) { await load(); if (view.isConnected && location.hash.startsWith('#fax') && !location.hash.startsWith('#fax/v')) paint(); }
}

async function viewPage(view, name) {
  if (!faxInfo().loaded) await load();
  const L = shown(); const i = L.findIndex(f => f.name === name); const f = L[i] || faxFiles().find(x => x.name === name);
  if (!f) { view.innerHTML = '<div class="hd"><a class="back" href="#fax">‹ 傳真</a></div><div class="card ph"><b>找不到這張傳真</b></div>'; return; }
  const pdf = f.ext === 'pdf'; const src = url(f);
  const prev = L[i - 1], next = L[i + 1]; const c = coOf(f);
  view.innerHTML = `<div class="hd"><a class="back" href="#fax">‹ 傳真</a><span class="sp"></span>${prev ? `<a class="chip" href="#fax/v/${enc(prev.name)}">‹ 上一張</a>` : ''}${next ? `<a class="chip" href="#fax/v/${enc(next.name)}">下一張 ›</a>` : ''}</div>
    <div class="card"><div>${who(f)}${f.idx?.doc_type ? ` <span class="tag">${esc(f.idx.doc_type)}</span>` : ''}</div>
      <div class="muted small">${esc(when(f.mtime))}${f.idx?.doc_no ? '・單號 ' + esc(f.idx.doc_no) : ''}${f.idx?.date ? '・日期 ' + esc(f.idx.date) : ''}</div>
      ${f.idx?.summary ? `<div class="small">${esc(f.idx.summary)}</div>` : ''}${f.idx?.sender && c && c.name !== f.idx.sender ? `<div class="muted small">傳真上寫：${esc(f.idx.sender)}</div>` : ''}
      <div class="muted small" style="word-break:break-all">${esc(f.name)}・${size(f.size)}</div></div>
    <div class="btn2"><a class="btn ghost" href="${src}" target="_blank" rel="noopener">${pdf ? '打開 PDF' : '開新視窗看大圖'}</a>${pdf ? `<a class="btn ghost" href="${url(f, '&dl=1')}">下載</a>` : '<button class="btn ghost" id="rot">轉 90°</button>'}</div>
    <div class="card" style="padding:4px;overflow:auto;background:#fff">${pdf ? `<iframe src="${src}" style="width:100%;height:70vh;border:0" title="傳真"></iframe><div class="note">iPhone 這裡可能只顯示第一頁，按「打開 PDF」可以看全部、放大。</div>` : `<img id="fimg" src="${src}" alt="傳真" style="width:100%;display:block;transform:rotate(${ui.rot}deg);${ui.rot % 180 ? 'margin:18% 0;' : ''}">`}</div>
    <p><button class="btn ghost" id="unread">標成未讀</button></p>`;
  view.querySelector('#rot')?.addEventListener('click', () => { ui.rot = (ui.rot + 90) % 360; viewPage(view, name); });
  view.querySelector('#unread').onclick = async () => { await markRead(f, false); location.hash = '#fax'; };
  if (!isRead(f)) markRead(f, true);
}
