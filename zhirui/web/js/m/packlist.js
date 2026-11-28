// 「包裝排程」（員工版 App、打包區平板共用）：看電腦版「包裝螺絲」排程（packs 集合）要包什麼。
//   螺絲包不會一次包完：每次包多少就「登記」一筆（logs：數量、時間、誰登記的），累計到排程數量就自動算完成。
//   新增、修改、刪除排程在電腦版「包裝螺絲」（modules/packs.js）；這裡只看、登記數量、把商品加到印標籤清單。
import { esc, today, daysLeft, slash, fmtQ, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, cshort } from '../core/calc.js';
import { addStaffLabel } from './staff.js';
import { adjustStock } from './stock.js';
import { packBom } from '../core/packbom.js';

const SOON = 3;
const ui = { tab: 'active', q: '', open: new Set() };   // open：展開看登記紀錄的排程
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); };
const num = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
const isDone = o => !!(o.steps || {}).done;
const cn = o => o.cid ? cshort(o.cid) : (o.cust || '');
const g = o => o.gid ? store.get('goods', o.gid) : null;
const pname = o => g(o)?.name || o.prod || '';
/** 已經包了多少（登記紀錄加總） */
export const packedQty = o => (o.logs || []).reduce((a, l) => a + num(l.qty), 0);
/** 登記時間顯示：11/28 14:05 */
export const logTime = l => { const d = new Date(l.at); return isNaN(d) ? esc(l.date || '') : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const nowIso = () => new Date().toISOString();
/** 加一筆登記；累計到排程數量就算完成 */
export function withLog(o, qty, who) {
  const logs = [...(o.logs || []), { qty: +(+qty).toPrecision(10), at: nowIso(), date: today(), by: who || '' }];
  const steps = { ...(o.steps || {}), pack: true }; const need = num(o.qty);
  if (need > 0 && logs.reduce((a, l) => a + num(l.qty), 0) >= need) { steps.done = true; steps.doneAt = today(); steps.doneTime = nowIso(); }
  return { ...o, logs, steps };
}

function rows() {
  const all = store.list('packs'); const q = qTerms(ui.q);
  const list = all.filter(o => (ui.tab === 'active') === !isDone(o) && (!q.length || matchQ([cn(o), o.cust, pname(o), g(o)?.code, g(o)?.alias, o.note].join(' '), q)));
  if (ui.tab === 'active') list.sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || (a.date || '').localeCompare(b.date || ''));
  else list.sort((a, b) => ((b.steps || {}).doneTime || (b.steps || {}).doneAt || '').localeCompare((a.steps || {}).doneTime || (a.steps || {}).doneAt || ''));
  return ui.tab === 'active' ? list : list.slice(0, 40);
}
function listHtml(list) {
  const C = calc();
  return list.map(o => {
    const st = o.steps || {}; const dl = o.due ? daysLeft(o.due) : null; const need = num(o.qty); const got = packedQty(o); const left = Math.max(0, +(need - got).toPrecision(10));
    const tag = st.done ? `<span class="pktag ok">${st.doneAt ? esc(slash(st.doneAt).slice(5)) + ' ' : ''}完成</span>` : dl === null ? '' : dl < 0 ? `<span class="pktag late">逾期 ${-dl} 天</span>` : dl <= SOON ? `<span class="pktag soon">${dl === 0 ? '今天要交' : dl + ' 天後'}</span>` : '';
    const sq = o.gid ? Object.values(C.stock[o.gid] || {}).reduce((a, b) => a + b, 0) : null;
    const pct = need > 0 ? Math.min(100, Math.round(got / need * 100)) : 0; const logs = o.logs || []; const todayQ = logs.filter(l => l.date === today()).reduce((a, l) => a + num(l.qty), 0);
    const u = esc(o.unit || '');
    return `<div class="card pkcard ${st.done ? 'done' : got > 0 || st.pack ? 'doing' : ''}" data-id="${esc(o.id)}">
      <div class="pkdue"><b>${o.due ? esc(slash(o.due).slice(5)) : '—'}</b><small>預交</small>${tag}</div>
      <div class="pkmain">${o.gid ? `<button type="button" class="pkname" data-a="bom">${esc(pname(o))}<i>${(g(o)?.bom || []).length ? `配方 ${g(o).bom.length} 種 ›` : '看配方 ›'}</i></button>` : `<b>${esc(pname(o))}</b>`}<small>${esc(g(o)?.code || '')}${cn(o) ? `${g(o)?.code ? '・' : ''}客戶 ${esc(cn(o))}` : ''}</small>
        <div class="pkqty"><b>${esc(need ? fmtQ(need) : o.qty || '')}</b> ${u}${sq === null ? '' : `<button type="button" class="pkstk ${!st.done && left > 0 && sq < left ? 'bad' : ''}" data-a="stk" aria-label="調整庫存">庫存 ${fmtQ(sq)}${!st.done && left > 0 && sq < left ? '（不夠）' : ''} ›</button>`}</div>
        ${o.note ? `<div class="pknote">${esc(o.note)}</div>` : ''}</div>
      <div class="pkprog"><div class="pkbarr"><i style="width:${pct}%"></i></div>
        <div class="pkpt"><span>已包 <b>${fmtQ(got)}</b>${need ? `／${fmtQ(need)}` : ''} ${u}${todayQ ? `（今天 ${fmtQ(todayQ)}）` : ''}</span>${st.done ? '' : `<span>還剩 <b>${fmtQ(left)}</b></span>`}${logs.length ? `<button type="button" class="link" data-a="logs">${ui.open.has(o.id) ? '收起紀錄' : `紀錄 ${logs.length} 筆`}</button>` : ''}</div>
        ${ui.open.has(o.id) && logs.length ? `<div class="pklogs">${logs.map((l, i) => `<div><span>${logTime(l)}</span><b>${fmtQ(num(l.qty))} ${u}</b><span class="muted">${esc(l.by || '')}</span><button type="button" class="link" data-a="dellog" data-li="${i}" aria-label="刪除這筆紀錄">×</button></div>`).join('')}</div>` : ''}</div>
      ${st.done ? '' : `<div class="pkadd"><input data-n inputmode="decimal" enterkeyhint="done" placeholder="這次包好幾${u || '個'}" aria-label="這次包好的數量"><button type="button" class="pkb go" data-a="add">登記</button></div>`}
      <div class="pkact">${st.done ? '<button type="button" class="pkb" data-a="undo">取消完成</button>' : `<button type="button" class="pkb" data-a="done">剩下的全部完成</button>`}${o.gid ? '<button type="button" class="pkb" data-a="lbl">🏷 印標籤</button>' : ''}</div></div>`;
  }).join('') || `<div class="card ph"><b>${ui.q.trim() ? '找不到符合的排程' : ui.tab === 'active' ? '目前沒有要包裝的排程' : '還沒有完成的排程'}</b><span class="muted">排程在電腦版「包裝螺絲」新增。</span></div>`;
}

let BACK = '';
export function packPage(view, opt = {}) {
  if (opt.back !== undefined) BACK = opt.back;
  const all = store.list('packs'); const act = all.filter(o => !isDone(o)); const t = today();
  const late = act.filter(o => o.due && o.due < t).length, soon = act.filter(o => o.due && o.due >= t && daysLeft(o.due) <= SOON).length;
  const y = window.scrollY;
  view.innerHTML = `${BACK ? `<div class="hd"><a class="chip" href="${BACK}">‹ 返回</a><h1>包裝排程</h1></div>` : ''}<div class="pkbar"><div class="chips seg" style="margin:0"><button class="chip ${ui.tab === 'active' ? 'on' : ''}" data-t="active">要包裝 ${act.length}</button><button class="chip ${ui.tab === 'done' ? 'on' : ''}" data-t="done">已完成</button></div>
      <input id="pkq" type="search" placeholder="打字找商品、客戶" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search" aria-label="搜尋排程">
      <span class="pksum">${late ? `<b class="late">逾期 ${late}</b>` : ''}${soon ? `<b>${SOON} 天內 ${soon}</b>` : ''}</span></div>
    <div id="pkl" class="pklist">${listHtml(rows())}</div>`;
  window.scrollTo(0, y);
  const $ = q => view.querySelector(q); const redraw = () => packPage(view);
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { ui.tab = b.dataset.t; window.scrollTo(0, 0); redraw(); });
  let tm = 0; $('#pkq').oninput = ev => { ui.q = ev.target.value; clearTimeout(tm); tm = setTimeout(() => { $('#pkl').innerHTML = listHtml(rows()); }, 200); };
  $('#pkq').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } };
  const save = async (o, data, okMsg) => {
    const d = { ...data }; delete d.id;
    try { await store.save('packs', o.id, d); if (okMsg) toast(okMsg); } catch (e) { toast(/不認識/.test(e.message || '') ? '存不進去：伺服器還是舊版，請管理者重新啟動伺服器' : '儲存失敗：' + (e.message || e)); }
    redraw();
  };
  const act1 = async (b, a) => {
    const card = b.closest('[data-id]'); const o = store.get('packs', card.dataset.id); if (!o) return;
    const need = num(o.qty), got = packedQty(o), left = Math.max(0, +(need - got).toPrecision(10)); const u = o.unit || ''; const who = store.user?.name || '';
    if (a === 'lbl') { addStaffLabel(o.gid); toast('已加到「印標籤」清單'); return; }
    if (a === 'bom') return bomSheet(o);
    if (a === 'stk') { const gg = g(o); if (gg) adjustStock(gg, redraw); return; }
    if (a === 'logs') { ui.open.has(o.id) ? ui.open.delete(o.id) : ui.open.add(o.id); redraw(); return; }
    if (a === 'add') {
      const inp = card.querySelector('[data-n]'); const v = num(inp.value);
      if (!(v > 0)) { toast('先填這次包好的數量'); inp.focus(); return; }
      if (need > 0 && v > left && !window.confirm(`這次 ${fmtQ(v)} ${u}，比還剩的 ${fmtQ(left)} ${u} 多，確定嗎？`)) return;
      const out = withLog(o, v, who); b.disabled = true;
      return save(o, out, out.steps.done && !isDone(o) ? `已登記 ${fmtQ(v)} ${u}，這筆包完了` : `已登記 ${fmtQ(v)} ${u}`);
    }
    if (a === 'done') {
      if (!window.confirm(left > 0 ? `「${pname(o)}」還剩 ${fmtQ(left)} ${u}，都包完了嗎？\n會登記一筆 ${fmtQ(left)} ${u}，並算完成。` : `「${pname(o)}」算完成嗎？`)) return;
      const out = left > 0 ? withLog(o, left, who) : { ...o, steps: { ...(o.steps || {}) } };
      out.steps = { ...out.steps, pack: true, done: true, doneAt: today(), doneTime: nowIso() };
      return save(o, out, '已完成，移到「已完成」');
    }
    if (a === 'undo') { const steps = { ...(o.steps || {}) }; steps.done = false; delete steps.doneAt; delete steps.doneTime; return save(o, { ...o, steps }, '已改回要包裝'); }
    if (a === 'dellog') {
      const i = +b.dataset.li; const l = (o.logs || [])[i]; if (!l) return;
      if (!window.confirm(`刪除這筆紀錄？\n${logTime(l)}　${fmtQ(num(l.qty))} ${u}　${l.by || ''}`)) return;
      return save(o, { ...o, logs: o.logs.filter((_, k) => k !== i) }, '已刪除這筆紀錄');
    }
  };
  $('#pkl').addEventListener('click', ev => { const b = ev.target.closest('[data-a]'); if (b) act1(b, b.dataset.a); });
  $('#pkl').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('[data-n]')) { ev.preventDefault(); const b = ev.target.closest('[data-id]').querySelector('[data-a="add"]'); act1(b, 'add'); } });
}
/** 點品名：看配方（全螢幕；每包幾個、還要用多少、庫存夠不夠） */
function bomSheet(o) {
  const B = packBom(o); const u = esc(o.unit || '');
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>關閉</button><b>配方</b><span style="width:40px"></span></div>
    <div class="card"><b>${esc(B.g?.name || pname(o))}</b><div class="muted mono">${esc(B.g?.code || '')}</div>
      <div style="margin-top:4px">排程 <b>${fmtQ(B.need)}</b> ${u}${B.left !== B.need ? `・還剩 <b>${fmtQ(B.left)}</b> ${u}` : ''}${cn(o) ? `・客戶 ${esc(cn(o))}` : ''}</div></div>
    ${B.rows.length ? `<div class="note" style="text-align:left;margin:8px 0">共 ${B.rows.length} 種零件${B.rows.some(r => r.short) ? `，${B.rows.filter(r => r.short).length} 種庫存不夠` : '，庫存都夠'}。「還要用」＝每包數量 × 還剩的包數。點庫存數字可以調整庫存。</div>
      <div class="bomlist">${B.rows.map((r, i) => `<div class="card bomrow ${r.short ? 'short' : ''}"><span class="bomno">${i + 1}</span><div class="gm"><b>${esc(r.name)}${r.cust ? ' <span class="pktag">客供</span>' : ''}</b><small>${esc(r.code)}</small></div>
        <div class="bomq"><span>每包<b>${fmtQ(r.per)}</b></span><span>還要用<b>${fmtQ(r.rest)}</b></span><button type="button" class="bomstk ${r.short ? 'bad' : ''}" data-stk="${esc(r.gid)}" aria-label="調整庫存">庫存 ›<b>${fmtQ(r.stock)}</b>${r.short ? '<em>不夠</em>' : ''}</button></div></div>`).join('')}</div>`
      : '<div class="card ph" style="margin-top:10px"><b>這個商品還沒有設定配方</b><span class="muted">請管理者在電腦版「基本資料 › 商品」設定。</span></div>'}`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); };
  el.querySelector('[data-x]').onclick = close;
  el.querySelectorAll('[data-stk]').forEach(b => b.onclick = () => { const p = store.get('goods', b.dataset.stk); if (p) adjustStock(p, () => { close(); bomSheet(store.get('packs', o.id) || o); }); });
}
/** 排程有變動（電腦版新增、別人登記了）：正在打字（搜尋、數量）就先不重畫，免得打到一半被清掉 */
export function onPackChange(view, ch) {
  if (!(ch.has('packs') || ch.has('goods') || ch.has('bills'))) return;
  const ae = document.activeElement;
  if (view.contains(ae) && ae.matches('input')) { if (ae.id === 'pkq') { const l = view.querySelector('#pkl'); if (l) l.innerHTML = listHtml(rows()); } return; }
  if ([...view.querySelectorAll('[data-n]')].some(i => i.value.trim())) return;   // 有人填了數量還沒按登記
  packPage(view);
}
/** 還沒包完的筆數、有沒有逾期（平板分頁上的數字） */
export const packOpen = () => { const a = store.list('packs').filter(o => !isDone(o)); return { n: a.length, late: a.some(o => o.due && o.due < today()) }; };
