// 外框：登入、導覽、路由、全站搜尋、同步狀態
import { $, $$, esc, ls, debounce, money, qTerms, matchQ } from './core/util.js';
import { api } from './core/api.js';
import { store } from './core/store.js';
import { toast, icon, ICONS, modal } from './core/ui.js';
import { MODULES } from './modules/index.js';
import { calc, goodsLabel } from './core/calc.js';

const view = $('#view');
let current = null, currentMod = null, unsub = null;

// ---------- 主題 ----------
const theme = ls.get('zr.theme', 'auto');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

// ---------- 啟動 ----------
async function boot() {
  let st;
  try { st = await api.status(); } catch (e) { return showLogin('連不到伺服器，請確認伺服器程式有開著。'); }
  if (st.needSetup) return showSetup();
  try { await store.boot(); } catch (e) { if (e.status === 401) return showLogin(); return showLogin('載入資料失敗：' + e.message); }
  $('#app').hidden = false;
  renderNav(); renderMe(); paintSync();
  store.subscribe(onChange);
  window.addEventListener('hashchange', route);
  route();
}
function showLogin(msg) {
  $('#app').hidden = true;
  const el = document.createElement('div'); el.className = 'login'; el.id = 'login';
  el.innerHTML = `<form class="card" id="loginForm"><h1><span class="logo"></span>志瑞螺絲作業平台</h1>
    ${msg ? `<div class="banner">${esc(msg)}</div>` : ''}
    <div class="f"><label for="lg">帳號</label><input id="lg" name="login" autocomplete="username" autofocus required></div>
    <div class="f"><label for="pw">密碼</label><input id="pw" name="pw" type="password" autocomplete="current-password" required></div>
    <div id="lgErr" class="muted" style="color:var(--bad)"></div>
    <button class="btn pri" type="submit" style="justify-content:center;padding:10px">登入</button></form>`;
  document.body.prepend(el);
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api.login($('#lg').value, $('#pw').value); el.remove(); await store.clearCache(); boot(); }
    catch (err) { $('#lgErr').textContent = err.message; }
  });
}
function showSetup() {
  $('#app').hidden = true;
  const el = document.createElement('div'); el.className = 'login'; el.id = 'login';
  el.innerHTML = `<form class="card" id="setupForm"><h1><span class="logo"></span>第一次使用</h1>
    <p class="muted" style="margin:0">伺服器還沒有任何帳號。請建立第一個帳號（管理者），之後可在「設定 → 帳號」新增其他人。</p>
    <div class="f"><label for="sn">姓名</label><input id="sn" name="name" required autofocus></div>
    <div class="f"><label for="sl">帳號（登入用，英數字）</label><input id="sl" name="login" autocomplete="username" required></div>
    <div class="f"><label for="sp">密碼（至少 4 碼）</label><input id="sp" name="pw" type="password" autocomplete="new-password" required minlength="4"></div>
    <div id="suErr" style="color:var(--bad)"></div>
    <button class="btn pri" type="submit" style="justify-content:center;padding:10px">建立並登入</button></form>`;
  document.body.prepend(el);
  $('#setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api.setup($('#sn').value, $('#sl').value, $('#sp').value); el.remove(); boot(); }
    catch (err) { $('#suErr').textContent = err.message; }
  });
}

// ---------- 導覽 ----------
function renderNav() {
  let g = null, h = '';
  for (const m of MODULES) {
    if (m.hidden) continue;
    if (m.group && m.group !== g) { g = m.group; h += `<div class="grp">${esc(g)}</div>`; }
    h += `<a href="#${m.id}" data-m="${m.id}">${icon(ICONS[m.icon] || ICONS.plus)}<span>${esc(m.name)}</span></a>`;
  }
  $('#nav').innerHTML = h;
  refreshNav();
}
function refreshNav() {
  for (const m of MODULES) {
    const a = $(`#nav a[data-m="${m.id}"]`); if (!a) continue;
    a.toggleAttribute('aria-current', false); a.removeAttribute('aria-current');
    if (current === m.id) a.setAttribute('aria-current', 'page');
    let s = null; if (m.badge) { try { s = m.badge(); } catch (e) {} }
    let el = a.querySelector('.cnt');
    if (s && s.cnt) { if (!el) { el = document.createElement('span'); el.className = 'cnt'; a.append(el); } el.textContent = s.cnt; el.classList.toggle('alert', !!s.alert); }
    else if (el) el.remove();
  }
}
function renderMe() {
  $('#me').innerHTML = `<span>${esc(store.user.name)}</span><button type="button" id="logoutBtn">登出</button>`;
  $('#logoutBtn').onclick = async () => { await api.logout().catch(() => {}); await store.clearCache(); location.reload(); };
}
export function paintSync() {
  const s = $('#sync'); const st = store.state;
  s.className = 'sync ' + (st === 'live' ? (store.pending ? 'busy' : 'ok') : st === 'error' ? 'err' : '');
  s.querySelector('span').textContent = st === 'live' ? (store.pending ? '儲存中…' : '已同步') : st === 'error' ? store.msg : '連線中…';
}
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('open'));
$('#nav').addEventListener('click', () => document.body.classList.remove('open'));

// ---------- 路由：#module/sub?params ----------
export function parseHash() {
  const raw = (location.hash || '#home').slice(1);
  const [path, qs] = raw.split('?');
  const [id, ...rest] = path.split('/');
  return { id: id || 'home', sub: rest.join('/'), params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const go = (id, sub, params) => { location.hash = '#' + id + (sub ? '/' + sub : '') + (params ? '?' + new URLSearchParams(params) : ''); };
function route() {
  const { id, sub, params } = parseHash();
  const m = MODULES.find(x => x.id === id) || MODULES[0];
  if (unsub) { unsub(); unsub = null; }
  if (currentMod && currentMod.destroy) { try { currentMod.destroy(); } catch (e) {} }
  current = m.id; currentMod = m;
  document.body.classList.remove('open');
  $('#modals').innerHTML = '';
  $('#crumb').innerHTML = `${esc(m.name)}${m.sub ? `<small>${esc(m.sub)}</small>` : ''}`;
  document.title = m.name + '｜志瑞螺絲作業平台';
  $('#topActions').innerHTML = '';
  view.innerHTML = '';
  view.scrollTop = 0; window.scrollTo(0, 0);
  try { m.render(view, { sub, params, go }); }
  catch (e) { console.error(e); view.innerHTML = `<div class="banner">這個頁面發生錯誤：${esc(e.message)}</div>`; }
  refreshNav();
}
function onChange(changed) {
  paintSync();
  refreshNav();
  if (currentMod && currentMod.onChange) { try { currentMod.onChange(changed); } catch (e) { console.error(e); } }
}
// 畫面內的分頁按鈕、tabs 等共用事件
view.addEventListener('click', e => {
  const t = e.target.closest('[data-tabs] button');
  if (t) { const box = t.closest('[data-tabs]'); box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); box.dispatchEvent(new CustomEvent('tab', { bubbles: true, detail: { key: box.dataset.tabs, val: t.dataset.val } })); }
});

// ---------- 全站搜尋 ----------
const gq = $('#gq'), gres = $('#gres');
function gsearch() {
  const q = qTerms(gq.value);
  if (!q.length) { gres.hidden = true; return; }
  const C = calc();
  const out = [];
  const cs = store.list('contacts').filter(c => matchQ([c.code, c.name, c.short, ...(c.aliases || []), c.phone].join(' '), q)).slice(0, 6);
  if (cs.length) out.push(['客戶／供應商', cs.map(c => ({ href: `#master/${c.kind === 'S' ? 'suppliers' : 'customers'}?id=${c.id}`, label: c.name, sub: (c.kind === 'S' ? '供應商' : '客戶') + (c.code ? ' ' + c.code : '') }))]);
  const gs = store.list('goods').filter(g => matchQ(goodsLabel(g), q)).slice(0, 8);
  if (gs.length) out.push(['商品', gs.map(g => ({ href: `#master/goods?id=${g.id}`, label: goodsLabel(g), sub: money(Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0)) + ' ' + (g.unit || '') }))]);
  const bs = store.list('bills').filter(b => matchQ(b.no + ' ' + (C.ct[b.cid]?.name || '') + ' ' + (b.note || ''), q)).slice(0, 6);
  if (bs.length) out.push(['單據', bs.map(b => ({ href: `#${b.type === 'SALE' || b.type === 'SALE_RET' ? 'sales' : b.type === 'PUR' || b.type === 'PUR_RET' || b.type === 'PO' ? 'purchase' : b.type === 'QUO' || b.type === 'RFQ' ? 'quotes' : 'stock'}?open=${b.id}`, label: `${b.no}`, sub: `${b.date} ${C.ct[b.cid]?.short || C.ct[b.cid]?.name || ''}` }))]);
  const ps = store.list('pricing').filter(p => matchQ([p.name, p.spec, p.sup, p.code].join(' '), q)).slice(0, 6);
  if (ps.length) out.push(['查價', ps.map(p => ({ href: `#pricing?q=${encodeURIComponent(gq.value)}`, label: `${p.name} ${p.spec || ''}`, sub: p.sup }))]);
  gres.innerHTML = out.length ? out.map(([h, items]) => `<div class="gh">${h}</div>` + items.map(i => `<a href="${i.href}">${esc(i.label)}<small>${esc(i.sub || '')}</small></a>`).join('')).join('') : '<div class="gh">找不到</div>';
  gres.hidden = false;
}
gq.addEventListener('input', debounce(gsearch, 150));
gq.addEventListener('focus', () => { if (gq.value) gsearch(); });
gq.addEventListener('blur', () => setTimeout(() => { gres.hidden = true; }, 150));
gq.addEventListener('keydown', e => { if (e.key === 'Escape') { gres.hidden = true; gq.blur(); } if (e.key === 'Enter') { const a = gres.querySelector('a'); if (a) { location.hash = a.getAttribute('href'); gres.hidden = true; gq.blur(); } } });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); gq.focus(); gq.select(); } });

// 主題切換（設定頁會呼叫）
export function setTheme(v) { ls.set('zr.theme', v); if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; }
export const getTheme = () => ls.get('zr.theme', 'auto');

boot();
