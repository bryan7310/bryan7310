// 電子信箱：伺服器定時向郵件主機（HiNet）收信，這裡看信、搜尋、看附件；收信設定（帳號密碼）只有管理者能改。
// 看過的記在設定 mailread（大家共用），左側選單顯示未讀封數。
import { esc } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { modal, toast } from '../core/ui.js';

const WEBMAIL = 'https://webmail.hinet.net/';
let LIST = { items: [], total: 0, state: {}, cfg: {} }, LOADED = 0;
const ui = { sel: '', q: '' };
export const mailRead = () => store.setting('mailread').read || {};
export const isMailRead = m => !!mailRead()[m.id];
export const mailWhen = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); const t = new Date(); return d.toDateString() === t.toDateString() ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getFullYear() === t.getFullYear() ? '' : d.getFullYear() + '/'}${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const mailList = () => LIST;
export async function mailLoad(q = '') {
  try { const r = await api.get('/api/email/list?q=' + encodeURIComponent(q)); if (!q) { LIST = r; LOADED = Date.now(); } window.dispatchEvent(new Event('zr-nav')); return r; }
  catch (e) { return { items: [], total: 0, state: { err: e.message }, cfg: {} }; }
}
export async function mailMark(m, on = true) {
  const s = store.setting('mailread'); const read = { ...(s.read || {}) };
  if (on) read[m.id] = 1; else delete read[m.id];
  const ids = Object.keys(read); if (ids.length > 3000) for (const k of ids.slice(0, ids.length - 3000)) delete read[k];
  await store.saveSetting('mailread', { ...s, read }); window.dispatchEvent(new Event('zr-nav'));
}
/** 信件內容放在沒有腳本、沒有同源權限的 iframe 裡（信裡的程式不會執行），連結開新分頁 */
export const mailFrame = (m, h = '70vh') => m.html
  ? `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" style="width:100%;height:${h};border:0;background:#fff" srcdoc="${esc('<base target="_blank"><meta charset="utf-8"><style>body{font-family:-apple-system,"Microsoft JhengHei",sans-serif;font-size:15px;margin:10px;word-break:break-word}img{max-width:100%;height:auto}</style>' + m.html)}"></iframe>`
  : `<pre style="white-space:pre-wrap;word-break:break-word;font:inherit;margin:10px">${esc(m.text || '')}</pre>`;
export const attUrl = (m, a, dl) => `/api/email/att?id=${m.id}&n=${a.n}${dl ? '&dl=1' : ''}`;
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
setInterval(() => { if (store.user) mailLoad(); }, 120000);
setTimeout(() => { if (store.user) mailLoad(); }, 4000);

export default {
  id: 'email', name: '電子信箱', icon: 'mail', group: '管理',
  badge() { const r = mailRead(); return { cnt: LIST.items.filter(m => !r[m.id]).length }; },
  async render(el) { this.el = el; draw(el); await mailLoad(); if (el.isConnected) draw(el); },
  onChange(ch) { if (this.el?.isConnected && ch.has('settings')) drawList(this.el); },
};
let shown = [];
function stateText() {
  const s = LIST.state || {}; const c = LIST.cfg || {};
  if (!c.pass_set) return '還沒設定收信帳號，請按「收信設定」。';
  return `${s.running ? '收信中…' : s.last ? `上次收信 ${mailWhen(s.last)}${s.new ? `，收到 ${s.new} 封新信` : ''}` : '還沒收過信'}${c.auto ? `・每 ${c.interval} 分鐘自動收信` : '・自動收信關閉'}${s.err ? `<div style="color:var(--warn)">${esc(s.err)}</div>` : ''}`;
}
function draw(el) {
  const admin = (store.user?.role || 'admin') === 'admin';
  el.innerHTML = `<div class="head"><h1>電子信箱</h1><span class="sub" id="emState">${stateText()}</span><span class="sp"></span>
      <button class="btn" id="emFetch">立即收信</button>${admin ? '<button class="btn" id="emCfg">收信設定</button>' : ''}<a class="btn" href="${WEBMAIL}" target="_blank" rel="noopener">HiNet 網頁信箱</a></div>
    <div class="panel" style="display:grid;grid-template-columns:minmax(280px,380px) 1fr;gap:14px;align-items:start">
      <div><input type="search" id="emQ" placeholder="搜尋寄件人、主旨、內容" value="${esc(ui.q)}" style="width:100%;margin-bottom:8px">
        <div class="muted small" id="emInfo" style="margin-bottom:6px"></div>
        <div id="emList" style="max-height:74vh;overflow:auto;border:1px solid var(--line);border-radius:8px"></div></div>
      <div id="emView"><div class="empty"><b>點左邊的信來看</b></div></div></div>`;
  el.querySelector('#emFetch').onclick = async () => { try { await api.post('/api/email/fetch', {}); toast('開始收信…'); setTimeout(async () => { await mailLoad(); if (el.isConnected) draw(el); }, 4000); } catch (e) { toast(e.message); } };
  el.querySelector('#emCfg')?.addEventListener('click', () => cfgDialog(() => draw(el)));
  let tm = 0; el.querySelector('#emQ').addEventListener('input', ev => { clearTimeout(tm); tm = setTimeout(async () => { ui.q = ev.target.value; await drawList(el, true); }, 300); });
  drawList(el, !!ui.q);
  if (ui.sel) openMsg(el, ui.sel);
}
async function drawList(el, search) {
  const box = el.querySelector('#emList'); if (!box) return;
  if (search && ui.q.trim()) shown = (await mailLoad(ui.q.trim())).items; else if (!ui.q.trim()) shown = LIST.items;
  const r = mailRead(); const unread = LIST.items.filter(m => !r[m.id]).length;
  el.querySelector('#emInfo').textContent = `共 ${LIST.total} 封${unread ? `，最近的信未讀 ${unread} 封` : ''}${ui.q ? `，符合 ${shown.length} 封` : ''}`;
  box.innerHTML = shown.map(m => `<a href="#" data-em="${m.id}" style="display:block;padding:8px 10px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;${m.id === ui.sel ? 'background:var(--sel,rgba(0,122,255,.12));' : ''}">
      <div style="display:flex;gap:6px;align-items:center">${r[m.id] ? '' : '<span style="width:8px;height:8px;border-radius:50%;background:#1e88e5;flex:none"></span>'}<b style="${r[m.id] ? 'font-weight:400' : ''};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.from_name)}</b><span class="sp"></span><span class="muted small nowrap">${m.att ? '📎 ' : ''}${esc(mailWhen(m.date))}</span></div>
      <div style="${r[m.id] ? '' : 'font-weight:600'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.subject)}</div>
      <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.snippet)}</div></a>`).join('') || `<div class="muted" style="padding:12px">${LOADED ? (ui.q ? '沒有符合的信' : '還沒有信') : '載入中…'}</div>`;
  box.querySelectorAll('[data-em]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openMsg(el, a.dataset.em); }));
}
async function openMsg(el, id) {
  ui.sel = id; drawList(el); const v = el.querySelector('#emView'); v.innerHTML = '<div class="muted">載入中…</div>';
  let m; try { m = await api.get('/api/email/msg?id=' + id); } catch (e) { v.innerHTML = `<div class="banner">${esc(e.message)}</div>`; return; }
  if (!v.isConnected || ui.sel !== id) return;
  v.innerHTML = `<div style="margin-bottom:8px"><h2 style="margin:0 0 4px;font-size:18px">${esc(m.subject)}</h2>
      <div class="small"><b>${esc(m.from_name)}</b> <span class="muted">&lt;${esc(m.from)}&gt;</span>　<span class="muted">${esc(new Date(m.date).toLocaleString('zh-TW'))}</span></div>
      ${m.to ? `<div class="muted small">收件：${esc(m.to)}</div>` : ''}
      ${(m.atts || []).length ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">${m.atts.map(a => `<span class="pill">📎 <a href="${attUrl(m, a)}" target="_blank" rel="noopener">${esc(a.name)}</a> <span class="muted">${kb(a.size)}</span> <a href="${attUrl(m, a, 1)}" title="下載">⬇</a></span>`).join('')}</div>` : ''}
      <div style="margin-top:6px"><button class="btn sm" id="emUnread">標成未讀</button></div></div>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff">${mailFrame(m)}</div>`;
  v.querySelector('#emUnread').onclick = async () => { await mailMark(m, false); drawList(el); };
  if (!isMailRead(m)) mailMark(m, true);
}
function cfgDialog(after) {
  api.get('/api/email/cfg').then(c => modal({
    title: '收信設定', width: 560,
    body: `<div class="grid">
      <div class="f"><label for="ec-proto">收信方式</label><select id="ec-proto"><option value="imap" ${c.proto === 'imap' ? 'selected' : ''}>IMAP（建議）</option><option value="pop3" ${c.proto === 'pop3' ? 'selected' : ''}>POP3</option></select></div>
      <div class="f"><label for="ec-host">收信伺服器</label><input id="ec-host" value="${esc(c.host)}"></div>
      <div class="f"><label for="ec-port">埠號</label><input id="ec-port" class="num" value="${esc(c.port)}"></div>
      <label class="check" style="align-self:end"><input type="checkbox" id="ec-ssl" ${c.ssl ? 'checked' : ''}> SSL 加密</label>
      <div class="f"><label for="ec-user">帳號（信箱 @ 前面那段）</label><input id="ec-user" value="${esc(c.user)}" autocomplete="off"></div>
      <div class="f"><label for="ec-pass">密碼</label><input id="ec-pass" type="password" autocomplete="new-password" placeholder="${c.pass_set ? '已設定，不改就留空' : '請輸入'}"></div>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" id="ec-auto" ${c.auto ? 'checked' : ''}> 自動收信，每 <input id="ec-int" class="num" value="${esc(c.interval)}" style="width:50px"> 分鐘一次</label></div>
      <p class="muted small">HiNet：IMAP 伺服器 msa.hinet.net、埠號 993、SSL；POP3 一樣是 msa.hinet.net、埠號 995。帳號密碼只存在伺服器電腦，不會傳回網頁。第一次收信會收最近 ${esc(c.first)} 封，信不會從 HiNet 刪掉，也不會被標成已讀。</p>
      <div id="ec-msg" class="small"></div>`,
    footer: '<button class="btn" id="ec-test">測試連線</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ec-save">儲存</button>',
    onOpen(el, close) {
      el.querySelector('#ec-proto').onchange = ev => { const p = el.querySelector('#ec-port'); if (ev.target.value === 'pop3' && p.value === '993') p.value = '995'; if (ev.target.value === 'imap' && p.value === '995') p.value = '993'; };
      const val = () => ({ proto: el.querySelector('#ec-proto').value, host: el.querySelector('#ec-host').value.trim(), port: +el.querySelector('#ec-port').value || 993, ssl: el.querySelector('#ec-ssl').checked, user: el.querySelector('#ec-user').value.trim(), pass: el.querySelector('#ec-pass').value, auto: el.querySelector('#ec-auto').checked, interval: +el.querySelector('#ec-int').value || 5 });
      const msg = (t, ok) => { const m = el.querySelector('#ec-msg'); m.textContent = t; m.style.color = ok ? 'var(--ok,#1a7f37)' : 'var(--bad,#c62828)'; };
      el.querySelector('#ec-test').onclick = async ev => { ev.target.disabled = true; msg('連線中…', true); try { const r = await api.post('/api/email/test', val()); msg(r.msg, r.ok); } catch (e) { msg(e.message); } ev.target.disabled = false; };
      el.querySelector('#ec-save').onclick = async () => { try { await api.post('/api/email/cfg', val()); store.log('修改', '電子信箱收信設定'); close(); toast('已儲存收信設定'); await api.post('/api/email/fetch', {}); setTimeout(async () => { await mailLoad(); after && after(); }, 5000); } catch (e) { msg(e.message); } };
    },
  })).catch(e => toast(e.message));
}
