// 手機版：設定。外觀四選一（預設／暗色／活潑／iOS 風），記在這支手機（localStorage）；可跟著 iPhone 深色模式自動切換成暗色。
import { esc, ls } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';

const KEY = 'zr.m.theme';
export const THEMES = [
  ['default', '預設', '深藍按鈕、簡潔', { bg: '#F4F5F7', card: '#FFFFFF', acc: '#1F4E79' }],
  ['dark', '暗色', '深底亮藍，晚上不刺眼', { bg: '#0E1116', card: '#1A1F27', acc: '#4DA3FF' }],
  ['pop', '活潑', '粗黑框、四色數據卡', { bg: '#FFF7EC', card: '#FFFFFF', acc: '#FFB547', sh: '3px 3px 0 #1A1A1A', bd: '2px solid #1A1A1A' }],
  ['ios', 'iOS 風', '大標題、彩色小圖示', { bg: '#F2F2F7', card: '#FFFFFF', acc: '#007AFF' }],
];
const pref = () => { const p = ls.get(KEY, null) || {}; return { t: THEMES.some(x => x[0] === p.t) ? p.t : 'default', auto: p.auto !== false }; };
const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
/** 目前實際用的外觀（開了「跟著 iPhone」且手機是深色模式 → 暗色） */
export const themeName = () => { const p = pref(); return p.auto && dark?.matches ? 'dark' : p.t; };
export function applyTheme() {
  const t = themeName(); const r = document.documentElement;
  if (t === 'default') delete r.dataset.theme; else r.dataset.theme = t;
  const bg = THEMES.find(x => x[0] === t)[3].bg;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', bg));
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', t === 'dark' ? 'black' : 'default');
}
if (dark && !applyTheme.bound) { applyTheme.bound = true; dark.addEventListener?.('change', () => { applyTheme(); window.dispatchEvent(new HashChangeEvent('hashchange')); }); }

export function settingsPage(view) {
  const p = pref(); const cur = themeName();
  view.innerHTML = `<div class="hd"><a class="back" href="#home">‹ 首頁</a></div><div class="hd" style="margin-top:0"><h1>設定</h1></div>
    <div class="sec">外觀</div>
    <div class="themes">${THEMES.map(([k, n, d, s]) => `<button class="th ${p.t === k ? 'on' : ''}" data-t="${k}" style="--sw-card:${s.card};--sw-acc:${s.acc};--sw-sh:${s.sh || 'none'};--sw-bd:${s.bd || '0'}"><i style="background:${s.bg}"></i><b>${n}</b><br><small class="muted">${d}</small></button>`).join('')}</div>
    <div class="card list" style="margin-top:10px"><label class="row"><span>跟著 iPhone 深色模式<br><small class="muted">手機切到深色模式時自動用暗色</small></span><span class="go"><input type="checkbox" id="auto" ${p.auto ? 'checked' : ''}></span></label>
      ${cur !== p.t ? `<div class="row src">現在手機是深色模式，所以先用「暗色」</div>` : ''}</div>
    <div class="note" style="text-align:left">外觀記在這支手機上，關掉重開也會保留；不影響別人。</div>
    <div class="sec">帳號</div>
    <div class="card list"><div class="row"><span>登入</span><span class="go">${esc(store.user.name)}（${esc(store.user.login || '')}）</span></div>
      <a href="/"><span>打開電腦版</span><span class="go">›</span></a>
      <a href="#lbl/check"><span>標籤拆字檢查</span><span class="go">›</span></a>
      <a href="#po"><span>採購單</span><span class="go">›</span></a>
      <a href="#rep"><span>經營報表</span><span class="go">›</span></a></div>
    <p><button class="btn ghost danger" id="lo">登出</button></p>
    <div class="note">志瑞手機版</div>`;
  const save = x => { ls.set(KEY, { ...pref(), ...x }); applyTheme(); settingsPage(view); };
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => save({ t: b.dataset.t }));
  view.querySelector('#auto').onchange = ev => save({ auto: ev.target.checked });
  view.querySelector('#lo').onclick = async () => { if (!window.confirm('登出？')) return; try { await api.logout(); } catch (e) {} await store.clearCache(); location.href = '/m/'; };
}
