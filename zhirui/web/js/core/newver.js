// 新版本提醒：平台改版後，已經開著的分頁還在跑舊程式（要重新整理才換新）。
// 每 3 分鐘、以及分頁切回來時，問伺服器首頁現在的版本號；跟自己載入時的不一樣就在畫面下方顯示「有新版本」。
// 不會自動重新整理（可能有還沒存的內容），由使用者按。
const mine = (import.meta.url.match(/\/v([0-9a-f]+)\/js\//) || [])[1] || '';
let shown = false;

async function latest() {
  const r = await fetch(location.pathname.startsWith('/m') ? '/m/' : '/', { cache: 'no-store', credentials: 'same-origin' });
  if (!r.ok) return '';
  return ((await r.text()).match(/v([0-9a-f]+)\/js\//) || [])[1] || '';
}
function show() {
  if (shown) return; shown = true;
  const b = document.createElement('div');
  b.id = 'newVer';
  b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom, 0px));z-index:99999;background:#1e3a8a;color:#fff;border-radius:999px;padding:9px 8px 9px 16px;font:600 14px/1.2 system-ui,"Microsoft JhengHei",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center;max-width:calc(100vw - 24px)';
  b.innerHTML = '<span>平台有新版本</span><button type="button" style="border:0;border-radius:999px;background:#fff;color:#1e3a8a;font:inherit;padding:6px 14px;cursor:pointer">重新整理</button><button type="button" aria-label="先不要" style="border:0;background:transparent;color:#cbd5e1;font:inherit;padding:6px 8px;cursor:pointer">稍後</button>';
  const [go, later] = b.querySelectorAll('button');
  go.onclick = () => location.reload();
  later.onclick = () => { b.remove(); shown = false; setTimeout(check, 30 * 60 * 1000); };   // 半小時後再提醒
  document.body.append(b);
}
async function check() {
  if (!mine || shown || document.hidden) return;
  try { const v = await latest(); if (v && v !== mine) show(); } catch (e) { /* 連不到就下次再問 */ }
}
/** 開始監看（頁面載入後呼叫一次） */
export function watchVersion() {
  if (!mine) return;   // 不是用版本網址載入的（測試、舊頁面）就不監看
  setInterval(check, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
