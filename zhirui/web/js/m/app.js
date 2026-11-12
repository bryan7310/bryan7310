// 志瑞手機版（/m/）：老闆專用。和電腦版共用同一份資料（store）與計算（calc），數字算法跟電腦版總覽一致。
import { esc, fmt, today, thisMonth, roc, ls } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { calc } from '../core/calc.js';
import { arSummary } from '../modules/receivables.js';
import { preloadHist } from '../modules/_bills.js';
import { stockPage, goodsPage } from './stock.js';
import { billPage, onBillChange, draftCount } from './bill.js';
import { arPage } from './ar.js';
import { reportPage } from './report.js';
import { labelPage, onLabelChange } from './label.js';
import { poPage, onPOChange } from './po.js';
import { uploadPage, onUploadChange, uploadsWaiting } from './upload.js';
import { settingsPage, applyTheme, themeName } from './settings.js';
import { faxPage, faxUnread } from './fax.js';
import { emailPage, mailUnread } from './email.js';

const $ = s => document.querySelector(s);
const view = $('#view'), bar = $('#tabbar');
const SVG = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const IC = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  stock: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.3"/>',
  po: '<path d="M7 3h10v18H7z"/><path d="M10 7h4M10 11h4M10 15h2"/><path d="M4 8h3M4 12h3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  fax: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>',
};
// 底部選單（固定 5 項）；還沒做好的頁先顯示「第 N 階段」，並提供電腦版連結
const TABS = [
  ['home', '首頁', IC.home],
  ['stock', '庫存', IC.stock],
  ['bill', '開單', IC.bill],
  ['ar', '帳款', IC.money],
  ['up', '上傳', IC.cam],
];

// ---------- 啟動與登入 ----------
async function boot() {
  try { await store.boot(); }
  catch (e) { return e.status === 401 ? showLogin() : showLogin('載入資料失敗：' + (e.message || e)); }
  if (store.user.role !== 'admin') return notBoss();
  bar.hidden = false;
  window.addEventListener('zr-nav', () => { if (cur === 'home') route(); });   // 傳真未讀數更新
  store.subscribe(ch => { if (cur === 'home') route(); else if (cur === 'bill') onBillChange(view, ch); else if (cur === 'lbl') onLabelChange(view, ch); else if (cur === 'po') onPOChange(view, ch); else if (cur === 'up') onUploadChange(view, ch); else if (cur === 'ar' && ['receivables', 'checks_in', 'bills'].some(c => ch.has(c))) route(); });
  window.addEventListener('hashchange', route);
  route();
  // 舊系統進貨單會影響成本（毛利），載入後重算一次，跟電腦版一致
  setTimeout(() => preloadHist().then(() => { if (['home', 'g', 'rep', 'ar'].includes(cur)) route(); }), 800);
}
function showLogin(msg) {
  bar.hidden = true;
  view.innerHTML = `<form class="login" id="lf"><h1>志瑞</h1>${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <div class="f"><label for="lg">帳號</label><input id="lg" autocomplete="username" autocapitalize="off" autocorrect="off" required></div>
    <div class="f"><label for="pw">密碼</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <div class="err" id="le"></div><button class="btn" type="submit">登入</button></form>`;
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api.login($('#lg').value, $('#pw').value); await store.clearCache(); location.reload(); }
    catch (err) { $('#le').textContent = err.message; }
  });
}
function notBoss() {
  bar.hidden = true;
  view.innerHTML = `<div class="login"><h1>志瑞</h1><div class="card ph"><b>手機版只有老闆帳號能用</b><span class="muted">目前登入：${esc(store.user.name)}</span></div>
    <p><a class="btn ghost" href="/">打開電腦版</a></p><p><button class="btn ghost" id="lo">登出，換老闆帳號</button></p></div>`;
  $('#lo').onclick = async () => { try { await api.logout(); } catch (e) {} await store.clearCache(); location.reload(); };
}

// ---------- 路由 ----------
let cur = '';
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/'); const id = parts[0].split('?')[0] || 'home';
  const tabOf = { g: 'stock', rep: 'home', lbl: 'home', po: 'stock', set: 'home', fax: 'home', em: 'home' };
  const t = TABS.find(x => x[0] === (tabOf[id] || id)) || TABS[0]; cur = tabOf[id] ? id : t[0];
  bar.innerHTML = TABS.map(([k, n, ic]) => `<a href="#${k}" class="${k === t[0] ? 'on' : ''}">${SVG(ic)}<span>${n}</span></a>`).join('');
  if (cur === 'home') home();
  else if (cur === 'stock') stockPage(view);
  else if (cur === 'bill') billPage(view, parts[1]);
  else if (cur === 'ar') arPage(view, parts[1], parts.slice(2).join('/'));
  else if (cur === 'rep') { reportPage(view); window.scrollTo(0, 0); }
  else if (cur === 'lbl') labelPage(view, parts[1], parts.slice(2).join('/'));
  else if (cur === 'up') { uploadPage(view, parts.slice(1).join('/')); if (parts[1]) window.scrollTo(0, 0); }
  else if (cur === 'set') settingsPage(view);
  else if (cur === 'em') { emailPage(view, parts[1], parts.slice(2).join('/')); window.scrollTo(0, 0); }
  else if (cur === 'fax') { faxPage(view, parts[1], parts.slice(2).join('/')); window.scrollTo(0, 0); }
  else if (cur === 'po') { poPage(view, parts[1], parts.slice(2).join('/')); if (parts[1] === 'v') window.scrollTo(0, 0); }
  else if (cur === 'g') { goodsPage(view, decodeURIComponent(parts.slice(1).join('/'))); window.scrollTo(0, 0); }
  else placeholder(t);
}
function placeholder([, name, , stage, desk]) {
  view.innerHTML = `<div class="hd"><h1>${esc(name)}</h1></div><div class="card ph"><b>第 ${stage} 階段會做好</b>
    <span class="muted">${desk ? '現在可以先用電腦版的頁面。' : '這個功能還沒有電腦版頁面。'}</span></div>
    ${desk ? `<p><a class="btn ghost" href="${desk}">打開電腦版</a></p>` : ''}`;
}

// ---------- 首頁：今日出貨額、本月營收、本月毛利（毛利率）、逾期應收家數 ----------
/** 跟電腦版總覽同一套算法：銷貨單減銷貨退回，未稅金額；毛利＝未稅金額－成本 */
export function homeNums() {
  const C = calc(); const m = thisMonth(), t = today();
  let day = 0, dayN = 0, sales = 0, profit = 0, n = 0;
  for (const b of C.bills) {
    if (b.type !== 'SALE' && b.type !== 'SALE_RET') continue;
    const d = b.date || ''; if (!d.startsWith(m)) continue;
    const s = b.type === 'SALE' ? 1 : -1; const net = C.tot[b.id]?.net || 0;
    sales += s * net; profit += s * (net - (C.cogs[b.id] || 0)); n++;
    if (d === t) { day += s * net; dayN++; }
  }
  const ar = arSummary();
  return { day, dayN, sales, n, profit, rate: sales ? profit / sales : 0, lateCust: ar.lateCust, late: ar.late, open: ar.open, C };
}
function todos(C) {
  const t = today();
  const cin = store.list('checks_in').filter(c => !c.col); const late = cin.filter(c => c.due && c.due < t);
  const cout = store.list('checks_out').filter(c => !c.printedAt);
  const oLate = store.list('orders').filter(o => !(o.steps || {}).done && o.due && o.due < t);
  const low = store.list('goods').filter(g => +g.safety > 0 && Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0) < +g.safety);
  const pendInv = C.bills.filter(b => b.type === 'SALE' && !b.invNo && !b.noInv && (b.date || '') >= '2026-01-01');
  const dr = draftCount(), uw = uploadsWaiting();
  return [
    [faxUnread(), `${faxUnread()} 張傳真還沒看`, '#fax'],
    [mailUnread(), `${mailUnread()} 封新信還沒看`, '#em'],
    [uw, `${uw} 筆拍照上傳待確認`, '#up'],
    [dr, `${dr} 張出貨單草稿待確認`, '#bill/drafts'],
    [oLate.length, `訂貨排程有 ${oLate.length} 筆逾期`, '/#orders'],
    [late.length, `${late.length} 張客票已到期還沒送代收`, '/#checks-in'],
    [cout.length, `${cout.length} 張付款支票待列印`, '/#checks-out'],
    [pendInv.length, `${pendInv.length} 張銷貨單還沒開發票`, '/#invoices/pending'],
    [low.length, `${low.length} 項商品低於安全庫存`, '/#stock/low'],
  ].filter(x => x[0] > 0);
}
function home() {
  const k = homeNums(); const td = todos(k.C);
  const pct = (k.rate * 100).toFixed(1);
  view.innerHTML = `<div class="hd"><h1>${themeName() === 'pop' ? '嗨，老闆！' : '首頁'}</h1><span class="sub">${esc(roc(today()))}</span><span class="sp"></span><a class="gear" href="#set" aria-label="設定">${SVG('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>')}</a></div>
    <div class="kpis">
      <a class="card kpi" href="/#sales"><span>今日出貨額</span><b>${fmt(k.day)}</b><small>${k.dayN} 張・未稅</small></a>
      <a class="card kpi" href="#rep"><span>本月營收</span><b>${fmt(k.sales)}</b><small>${k.n} 張・未稅</small></a>
      <a class="card kpi good" href="#rep"><span>本月毛利</span><b>${fmt(k.profit)}</b><small>毛利率 ${k.sales ? pct + '%' : '—'}</small></a>
      <a class="card kpi ${k.lateCust ? 'alert' : ''}" href="#ar"><span>逾期應收</span><b>${k.lateCust} 家</b><small>${k.late} 筆・未收共 ${fmt(k.open)}</small></a>
    </div>
    <div class="sec">快捷</div>
    <div class="card quick">
      <a href="#stock"><i>${SVG(IC.stock)}</i>查庫存</a>
      <a href="#bill"><i>${SVG(IC.bill)}</i>開出貨單</a>
      <a href="#up"><i>${SVG(IC.cam)}</i>拍照上傳</a>
      <a href="#lbl"><i>${SVG(IC.tag)}</i>印標籤</a>
      <a href="#po"><i>${SVG(IC.po)}</i>採購單${(n => n ? `（${n}）` : '')((ls.get('zr.m.po', null)?.lines || []).length)}</a>
      <a href="#fax"><i>${SVG(IC.fax)}</i>收傳真${faxUnread() ? `（${faxUnread()}）` : ''}</a>
      <a href="#em"><i>${SVG(IC.mail)}</i>瀏覽信箱${mailUnread() ? `（${mailUnread()}）` : ''}</a>
    </div>
    <div class="sec">待處理</div>
    <div class="card list">${td.length ? td.map(([, txt, h]) => `<a href="${h}"><span class="dot"></span>${esc(txt)}<span class="go">›</span></a>`).join('') : '<div class="row muted">目前沒有需要處理的事 ✓</div>'}</div>
    <div class="note">連結到「電腦版」的頁面，之後的階段會換成手機版頁面。</div>`;
}

// 有新版就自動重新載入（主畫面 App 常常一直開著，不會自己更新）：切回 App 時、每 10 分鐘檢查一次；
// 正在填的出貨單、採購單、標籤都存在手機上，重新載入不會不見；有彈出視窗或正在打字時先不載入
const MYVER = (import.meta.url.match(/\/v([0-9a-f]+)\//) || [])[1];
async function checkVer() {
  if (!MYVER || document.visibilityState !== 'visible') return;
  try {
    const h = await (await fetch('/m/', { cache: 'no-store', credentials: 'same-origin' })).text();
    const v = (h.match(/\/v([0-9a-f]+)\/js\/m\/app\.js/) || [])[1];
    const busy = document.querySelector('.sheet, .scan') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
    if (v && v !== MYVER && !busy) location.reload();
  } catch (e) {}
}
document.addEventListener('visibilitychange', checkVer);
setInterval(checkVer, 10 * 60 * 1000);
applyTheme();
boot();
