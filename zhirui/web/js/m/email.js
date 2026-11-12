// 手機版：電子信箱（跟電腦版同一份已讀紀錄、分類、草稿）。#em 列表、#em/v/<id> 看信、#em/c/<mode>[/<id>] 寫信
import { esc } from '../core/util.js';
import { api } from '../core/api.js';
import { toast } from '../core/ui.js';
const ask = async (msg, o) => window.confirm(msg);
import { cdisp } from '../core/calc.js';
import { mailLoad, mailList, mailRead, mailMark, isMailRead, mailWhen, mailFrame, attUrl, kb, classify, catName, CATS, FOLDERS, mailCo, setCat, mailDelete, mailPurge, composeInit, composeForm } from '../modules/email.js';

const ui = { q: '', folder: 'inbox', cat: '' };
let SHOWN = [];
export const mailUnread = () => { const r = mailRead(); return mailList().items.filter(m => !r[m.id]).length; };

export async function emailPage(view, sub, id, id2) {
  if (sub === 'v' && id) return readPage(view, id);
  if (sub === 'c') return composePage(view, id || 'new', id2);
  let cur = ui.folder === 'inbox' && !ui.q ? mailList() : { items: [], counts: mailList().counts };
  const paint = () => {
    const r = mailRead(); const L = mailList(); const st = L.state || {}; const inbox = ui.folder === 'inbox';
    const byCat = {}; if (inbox) for (const m of cur.items) { const k = classify(m); byCat[k] = (byCat[k] || 0) + (r[m.id] ? 0 : 1); }
    SHOWN = inbox && ui.cat ? cur.items.filter(m => classify(m) === ui.cat) : cur.items;
    const cnt = L.counts || {};
    view.innerHTML = `<div class="hd"><a class="back" href="#home">‹ 首頁</a></div><div class="hd" style="margin-top:0"><h1>信箱</h1><span class="sp"></span><a class="chip" href="#em/c/new">＋ 寫信</a><button class="chip" id="ef">收信</button></div>
      <div class="chips" style="display:flex;gap:6px;overflow-x:auto;margin-bottom:6px">${FOLDERS.map(([k, n]) => `<button class="chip ${ui.folder === k ? 'on' : ''}" data-fd="${k}">${n}${k !== 'inbox' && cnt[k] ? ' ' + cnt[k] : ''}</button>`).join('')}</div>
      ${inbox ? `<div class="chips" style="display:flex;gap:6px;overflow-x:auto;margin-bottom:6px"><button class="chip ${!ui.cat ? 'on' : ''}" data-ct="">全部</button>${CATS.map(([k, n]) => `<button class="chip ${ui.cat === k ? 'on' : ''}" data-ct="${k}">${n}${byCat[k] ? ` <b style="color:#1e88e5">${byCat[k]}</b>` : ''}</button>`).join('')}</div>` : ''}
      <div class="search"><input type="search" id="eq" placeholder="寄件人、主旨、內容" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="note" style="text-align:left;margin:0 0 8px">${!L.cfg?.pass_set ? '還沒設定收信帳號，請在電腦版「電子信箱 → 收信設定」設定。' : `${st.running ? '收信中…' : st.last ? '上次收信 ' + esc(mailWhen(st.last)) : ''}${st.err ? `<br><span class="bad">${esc(st.err)}</span>` : ''}`}</div>
      <div class="card list">${SHOWN.slice(0, 150).map(m => { const u = inbox && !r[m.id]; const c = inbox ? mailCo(m) : null; const who = inbox || ui.folder === 'trash' ? (c ? cdisp(c) : m.from_name) : '給 ' + (m.to || '（沒有收件人）');
        return `<a href="#em/v/${m.id}"><div class="gm"><b style="${u ? '' : 'font-weight:500'}">${esc(who)}</b><small style="${u ? 'color:var(--text);font-weight:600' : ''}">${esc(m.subject)}</small><small>${inbox ? `<span class="pill">${esc(catName(classify(m)))}</span> ` : ''}${m.att ? '📎 ' : ''}${esc(String(m.snippet || '').slice(0, 50))}</small></div><span class="go"><small>${esc(mailWhen(m.date))}</small>${u ? '<span class="dot"></span>' : ''}</span></a>`; }).join('') || `<div class="row muted">${ui.q ? '沒有符合的信' : '沒有信'}</div>`}</div>`;
    const q = view.querySelector('#eq'); let tm = 0;
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(async () => { ui.q = q.value.trim(); await reload(); const pos = q.selectionStart; paint(); const q2 = view.querySelector('#eq'); q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }, 350); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
    view.querySelectorAll('[data-fd]').forEach(b => b.onclick = async () => { ui.folder = b.dataset.fd; ui.cat = ''; await reload(); paint(); });
    view.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { ui.cat = b.dataset.ct; paint(); });
    view.querySelector('#ef').onclick = async () => { try { await api.post('/api/email/fetch', {}); toast('開始收信…'); } catch (e) {} setTimeout(async () => { await reload(); if (view.isConnected) paint(); }, 4000); };
  };
  const reload = async () => { cur = ui.folder === 'inbox' && !ui.q ? (await mailLoad(), mailList()) : await mailLoad(ui.q, ui.folder); };
  paint();
  await reload();
  if (view.isConnected && location.hash.startsWith('#em') && !/^#em\/(v|c)/.test(location.hash)) paint();
}

async function readPage(view, id) {
  view.innerHTML = '<div class="hd"><a class="back" href="#em">‹ 信箱</a></div><div class="note">載入中…</div>';
  let m; try { m = await api.get('/api/email/msg?id=' + encodeURIComponent(id)); } catch (e) { view.innerHTML = `<div class="hd"><a class="back" href="#em">‹ 信箱</a></div><div class="card ph"><b>${esc(e.message)}</b></div>`; return; }
  const L = SHOWN.length ? SHOWN : mailList().items; const i = L.findIndex(x => x.id === id);
  const head = L[i] || m; const fd = ui.folder; const inbox = fd === 'inbox', trash = fd === 'trash', draft = fd === 'draft';
  const c = inbox ? mailCo(head) : null; const cat = inbox ? classify(head) : '';
  view.innerHTML = `<div class="hd"><a class="back" href="#em">‹ 信箱</a><span class="sp"></span>${L[i - 1] ? `<a class="chip" href="#em/v/${L[i - 1].id}">‹ 較新</a>` : ''}${L[i + 1] ? `<a class="chip" href="#em/v/${L[i + 1].id}">較舊 ›</a>` : ''}</div>
    <div class="card"><b style="font-size:17px">${esc(m.subject)}</b>
      <div class="small">${esc(m.from_name)} <span class="muted">${esc(m.from)}</span>${c ? ` <span class="pill">${c.kind === 'S' ? '廠商' : '客戶'}：${esc(cdisp(c))}</span>` : ''}</div>
      ${m.to ? `<div class="muted small">收件：${esc(m.to)}</div>` : ''}
      <div class="muted small">${esc(new Date(m.date).toLocaleString('zh-TW'))}</div>
      ${(m.atts || []).map(a => `<div class="small">📎 <a href="${attUrl(m, a)}" target="_blank" rel="noopener">${esc(a.name)}</a> <span class="muted">${kb(a.size)}</span></div>`).join('')}
      ${inbox ? `<div class="small" style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">分類 <select id="ecat">${CATS.map(([k, n]) => `<option value="${k}" ${k === cat ? 'selected' : ''}>${n}</option>`).join('')}</select><label><input type="checkbox" id="erule"> 以後這個寄件人都放這類</label></div>` : ''}</div>
    <div class="em-acts" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${trash ? '<button class="btn" data-a="restore">復原</button><button class="btn ghost" data-a="purge">永久刪除</button>'
      : draft ? `<a class="btn" href="#em/c/draft/${m.id}">編輯草稿</a><button class="btn ghost" data-a="del">刪除</button>`
      : `<a class="btn" href="#em/c/reply/${m.id}">回覆</a><a class="btn ghost" href="#em/c/all/${m.id}">全部回覆</a><a class="btn ghost" href="#em/c/fwd/${m.id}">轉寄</a><button class="btn ghost" data-a="del">刪除</button>${inbox ? '<button class="btn ghost" data-a="unread">未讀</button>' : ''}`}</div>
    <div class="card" style="padding:0;overflow:hidden;background:#fff">${mailFrame(m, '65vh')}</div>`;
  view.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'unread') { await mailMark(m, false); location.hash = '#em'; return; }
    if (a === 'del') { await mailDelete([m.id], true); toast('已移到垃圾桶'); }
    if (a === 'restore') { await mailDelete([m.id], false); toast('已復原'); }
    if (a === 'purge') { if (!await ask('永久刪除這封信？\n只刪志瑞平台上的這一份，HiNet 信箱裡的信不會動；刪了不能復原。', { danger: true, ok: '永久刪除' })) return; await mailPurge([m.id]); toast('已永久刪除'); }
    location.hash = '#em';
  });
  view.querySelector('#ecat')?.addEventListener('change', async ev => { await setCat(head, ev.target.value, view.querySelector('#erule').checked); toast(`已改成「${catName(ev.target.value)}」`); });
  view.querySelector('#erule')?.addEventListener('change', async ev => { if (ev.target.checked) { await setCat(head, view.querySelector('#ecat').value, true); toast('以後這個寄件人都放這類'); } });
  if (inbox && !isMailRead(m)) mailMark(m, true);
}

async function composePage(view, mode, id) {
  const T = { new: '寫信', reply: '回覆', all: '全部回覆', fwd: '轉寄', draft: '編輯草稿' }[mode] || '寫信';
  const back = id ? `#em/v/${id}` : '#em';
  view.innerHTML = `<div class="hd"><a class="back" href="${back}">‹ 返回</a></div><div class="hd" style="margin-top:0"><h1>${T}</h1></div><div class="card" id="cmBox"><div class="note">載入中…</div></div>`;
  let src = null;
  if (id) { try { src = await api.get('/api/email/msg?id=' + encodeURIComponent(id)); } catch (e) { view.querySelector('#cmBox').innerHTML = `<b>${esc(e.message)}</b>`; return; } }
  if (!view.isConnected) return;
  composeForm(view.querySelector('#cmBox'), composeInit(mode, src), r => { if (r.kind === 'send' && mode === 'draft') ui.folder = 'sent'; location.hash = '#em'; }, ask);
}
