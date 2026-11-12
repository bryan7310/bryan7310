// 手機版：電子信箱（伺服器收下來的信；跟電腦版「電子信箱」同一份已讀紀錄）
import { esc } from '../core/util.js';
import { api } from '../core/api.js';
import { mailLoad, mailList, mailRead, mailMark, isMailRead, mailWhen, mailFrame, attUrl } from '../modules/email.js';

const ui = { q: '' };
export const mailUnread = () => { const r = mailRead(); return mailList().items.filter(m => !r[m.id]).length; };

export async function emailPage(view, sub, id) {
  if (sub === 'v' && id) return readPage(view, id);
  let items = mailList().items;
  const paint = () => {
    const r = mailRead(); const L = mailList(); const st = L.state || {};
    view.innerHTML = `<div class="hd"><a class="back" href="#home">‹ 首頁</a></div><div class="hd" style="margin-top:0"><h1>信箱</h1><span class="sp"></span><button class="chip" id="ef">收信</button><a class="chip" href="https://webmail.hinet.net/" target="_blank" rel="noopener">HiNet</a></div>
      <div class="search"><input type="search" id="eq" placeholder="寄件人、主旨、內容" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="note" style="text-align:left;margin:0 0 8px">${!L.cfg?.pass_set ? '還沒設定收信帳號，請在電腦版「電子信箱 → 收信設定」設定。' : `${st.running ? '收信中…' : st.last ? '上次收信 ' + esc(mailWhen(st.last)) : ''}${st.err ? `<br><span class="bad">${esc(st.err)}</span>` : ''}`}</div>
      <div class="card list">${items.slice(0, 150).map(m => `<a href="#em/v/${m.id}"><div class="gm"><b style="${r[m.id] ? 'font-weight:500' : ''}">${esc(m.from_name)}</b><small style="${r[m.id] ? '' : 'color:var(--text);font-weight:600'}">${esc(m.subject)}</small><small>${m.att ? '📎 ' : ''}${esc(m.snippet.slice(0, 60))}</small></div><span class="go"><small>${esc(mailWhen(m.date))}</small>${r[m.id] ? '' : '<span class="dot"></span>'}</span></a>`).join('') || `<div class="row muted">${ui.q ? '沒有符合的信' : '還沒有信'}</div>`}</div>`;
    const q = view.querySelector('#eq'); let tm = 0;
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(async () => { ui.q = q.value.trim(); items = ui.q ? (await mailLoad(ui.q)).items : mailList().items; const pos = q.selectionStart; paint(); const q2 = view.querySelector('#eq'); q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }, 350); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
    view.querySelector('#ef').onclick = async () => { try { await api.post('/api/email/fetch', {}); } catch (e) {} setTimeout(async () => { await mailLoad(); items = mailList().items; if (view.isConnected) paint(); }, 4000); };
  };
  paint();
  await mailLoad(); if (!ui.q) items = mailList().items;
  if (view.isConnected && location.hash.startsWith('#em') && !location.hash.startsWith('#em/v')) paint();
}

async function readPage(view, id) {
  view.innerHTML = '<div class="hd"><a class="back" href="#em">‹ 信箱</a></div><div class="note">載入中…</div>';
  let m; try { m = await api.get('/api/email/msg?id=' + encodeURIComponent(id)); } catch (e) { view.innerHTML = `<div class="hd"><a class="back" href="#em">‹ 信箱</a></div><div class="card ph"><b>${esc(e.message)}</b></div>`; return; }
  const L = mailList().items; const i = L.findIndex(x => x.id === id);
  view.innerHTML = `<div class="hd"><a class="back" href="#em">‹ 信箱</a><span class="sp"></span>${L[i - 1] ? `<a class="chip" href="#em/v/${L[i - 1].id}">‹ 較新</a>` : ''}${L[i + 1] ? `<a class="chip" href="#em/v/${L[i + 1].id}">較舊 ›</a>` : ''}</div>
    <div class="card"><b style="font-size:17px">${esc(m.subject)}</b>
      <div class="small">${esc(m.from_name)} <span class="muted">${esc(m.from)}</span></div>
      <div class="muted small">${esc(new Date(m.date).toLocaleString('zh-TW'))}</div>
      ${(m.atts || []).map(a => `<div class="small">📎 <a href="${attUrl(m, a)}" target="_blank" rel="noopener">${esc(a.name)}</a></div>`).join('')}</div>
    <div class="card" style="padding:0;overflow:hidden;background:#fff">${mailFrame(m, '65vh')}</div>
    <p><button class="btn ghost" id="eu">標成未讀</button></p>`;
  view.querySelector('#eu').onclick = async () => { await mailMark(m, false); location.hash = '#em'; };
  if (!isMailRead(m)) mailMark(m, true);
}
