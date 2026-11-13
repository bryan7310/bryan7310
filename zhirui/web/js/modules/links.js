// 常用網站：客戶、廠商的 B2B 網站等，一鍵開新分頁。
// 密碼不存在平台裡：第一次登入時讓瀏覽器（Chrome／Edge）記住密碼，之後打開會自動帶入。帳號可以記在這裡備查。
import { esc } from '../core/util.js';
import { store } from '../core/store.js';
import { modal, toast, confirm } from '../core/ui.js';

const DEFAULT = [{ id: 'dscb2b', name: 'DSCB2B', url: 'http://211.20.149.149/DSCB2B/Login.aspx', user: '', note: '' }];
const list = () => { const s = store.setting('links'); return Array.isArray(s.list) ? s.list : DEFAULT; };
const save = L => store.saveSetting('links', { ...store.setting('links'), list: L });

export default {
  id: 'links', name: '常用網站', group: '管理', icon: 'link',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && ch.has('settings')) draw(this.el); },
};
function draw(el) {
  const L = list();
  el.innerHTML = `<div class="head"><h1>常用網站</h1><span class="sub">點一下開新分頁</span><span class="sp"></span><button class="btn pri" id="lkAdd">＋ 新增網站</button></div>
    <div class="panel" style="display:grid;gap:10px">
      ${L.map((x, i) => `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--line);border-radius:10px">
        <div style="min-width:0;flex:1"><a href="${esc(x.url)}" target="_blank" rel="noopener" style="font-size:17px;font-weight:700">${esc(x.name)}</a>
          <div class="muted small" style="word-break:break-all">${esc(x.url)}</div>
          ${x.user ? `<div class="small">帳號：<b class="mono">${esc(x.user)}</b> <button class="btn xs" data-cp="${i}">複製帳號</button></div>` : ''}${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ''}</div>
        <a class="btn pri" href="${esc(x.url)}" target="_blank" rel="noopener">開啟</a><button class="btn sm" data-ed="${i}">修改</button><button class="btn sm danger" data-rm="${i}">刪除</button></div>`).join('') || '<div class="empty"><b>還沒有常用網站</b>按右上「新增網站」</div>'}
      <div class="banner info"><b>不用每次輸入帳密：</b>第一次在那個網站登入時，瀏覽器（Chrome／Edge）右上角會問「要儲存密碼嗎？」，按「儲存」。之後從這裡打開，帳號密碼會自動帶入，直接按登入就好。<br>密碼只存在這台電腦的瀏覽器裡，不會存到志瑞平台，也不會被同事看到。換電腦要再存一次。</div>
    </div>`;
  el.querySelector('#lkAdd').onclick = () => edit(-1);
  el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => edit(+b.dataset.ed));
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { const x = L[+b.dataset.rm]; if (!await confirm(`刪除「${x.name}」？`, { danger: true, ok: '刪除' })) return; await save(L.filter((_, k) => k !== +b.dataset.rm)); toast('已刪除'); });
  el.querySelectorAll('[data-cp]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(L[+b.dataset.cp].user); toast('已複製帳號'); } catch (e) { toast('瀏覽器不允許複製'); } });
}
function edit(i) {
  const L = list(); const x = i >= 0 ? L[i] : { name: '', url: 'https://', user: '', note: '' };
  modal({
    title: i >= 0 ? '修改網站' : '新增網站', width: 520,
    body: `<div class="f"><label for="lk-name">名稱</label><input id="lk-name" value="${esc(x.name)}" placeholder="例如 崧泉 B2B"></div>
      <div class="f"><label for="lk-url">網址</label><input id="lk-url" value="${esc(x.url)}" inputmode="url"></div>
      <div class="f"><label for="lk-user">帳號（選填，備查用）</label><input id="lk-user" value="${esc(x.user || '')}" autocomplete="off"></div>
      <div class="f"><label for="lk-note">備註（選填）</label><input id="lk-note" value="${esc(x.note || '')}"></div>
      <p class="muted small" style="margin:0">密碼請不要填在這裡，讓瀏覽器記住就好（這裡的資料同事都看得到）。</p><div class="err" id="lk-err"></div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="lk-save">儲存</button>',
    onOpen(m, close) {
      m.querySelector('#lk-save').onclick = async () => {
        const v = k => m.querySelector('#lk-' + k).value.trim(); const name = v('name'), url = v('url');
        if (!name) { m.querySelector('#lk-err').textContent = '請填名稱'; return; }
        if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) { m.querySelector('#lk-err').textContent = '網址要以 http:// 或 https:// 開頭'; return; }
        const o = { id: x.id || 'l' + Date.now().toString(36), name, url, user: v('user'), note: v('note') };
        const N = L.slice(); if (i >= 0) N[i] = o; else N.push(o);
        await save(N); close(); toast('已儲存');
      };
    },
  });
}
