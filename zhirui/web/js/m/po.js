// 手機版：採購單＋傳真。廠商、品項（數量×單價，預設上次進價）、希望交期、小計、稅、總計；
// 存成跟電腦版一樣的採購單（單號 PO＋日期＋流水號），傳真交給伺服器上現有的傳真小幫手（faxjobs，跟電腦版「自動傳真」同一條路）。
import { esc, fmt, fmtQ, today, uid, ls, qTerms, matchQ, slash, addDays } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { calc, totals, lineAmt, nextNo, cdisp, cname, suppliers, gname, unitFactor } from '../core/calc.js';
import { queueFax, faxDial, isTaichung } from '../modules/faxes.js';
import { scanQR } from '../core/qr.js';
import { search, findByCode } from './stock.js';

const KEY = 'zr.m.po';
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); };
const p4 = n => (Math.round((+n || 0) * 10000) / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
const blank = () => ({ cid: '', date: today(), deliv: addDays(today(), 7), tax: false, note: '', attn: '', lines: [] });
let cur = null;
const load = () => { if (!cur) { const x = ls.get(KEY, null); cur = x && Array.isArray(x.lines) ? { ...blank(), ...x } : blank(); } return cur; };
const keep = () => ls.set(KEY, cur);
let lastPO = '';   // 剛存的採購單 id

// 廠商對應（規格書）：長驥＝彈簧華司、宏悅＝鍍鎳、寓承＝防鬆／耐落
const MAP = [[/彈簧華司/, '長驥'], [/鍍鎳|黑鎳/, '宏悅'], [/防鬆|耐落/, '寓承']];
const supBy = s => suppliers(true).find(c => (c.short || c.name).includes(s) || c.name.includes(s)) || null;
/** 這個商品建議找哪家廠商：品名對應規則 → 最近一次進貨的廠商 */
export function suggestSup(gid) {
  const g = store.get('goods', gid); if (!g) return null;
  for (const [re, s] of MAP) if (re.test(g.name)) { const c = supBy(s); if (c) return c; }
  const p = (calc().purIdx[gid] || []).filter(x => x.cid).sort((a, b) => b.d - a.d)[0];
  return p ? store.get('contacts', p.cid) : null;
}
/** 預設單價：這家廠商最近的進價 → 任何廠商最近的進價 → 商品進價（每 1 個商品單位） */
function priceFor(l, cid) {
  const g = store.get('goods', l.gid) || {}; const [, k] = unitFactor(g.unit || ''); const li = (calc().purIdx[l.gid] || []).slice().sort((a, b) => b.d - a.d);
  const x = li.find(y => y.cid === cid) || li[0];
  if (x) { l.price = Math.round(x.per * k * 10000) / 10000; l.hint = `上次進價 ${p4(l.price)}（${x.cid === cid ? '' : cdisp(store.get('contacts', x.cid)) + ' '}${slash(x.date)}）`; }
  else if (+g.purPrice > 0) { l.price = +g.purPrice; l.hint = '商品資料的進價'; }
  else { l.price = ''; l.hint = '查不到進價'; }
  l.ap = true;
}
export function addToPO(gid, qty) {
  const e = load(); if (!e.cid) { const s = suggestSup(gid); if (s) { e.cid = s.id; e.attn = s.person || ''; } }
  const l = { gid, qty: qty || '', price: '' }; priceFor(l, e.cid); e.lines.push(l); keep();
}
const docOf = e => ({ type: 'PO', date: e.date, cid: e.cid, tax: !!e.tax, disc: 0, lines: e.lines.filter(l => l.gid).map(l => ({ gid: l.gid, qty: +l.qty || 0, price: +l.price || 0 })) });
/** 傳真稿用：虹瑩的品名前面要加「內六角」（品名已經有「內六角」就不加） */
export function faxCopy(b) {
  const c = store.get('contacts', b.cid); if (!c || !/虹瑩/.test(c.name)) return b;
  return { ...b, lines: b.lines.map(l => { if (!l.gid) return l; const n = gname(l.gid, 'PO'); const { gid, ...rest } = l; return { ...rest, n: /內六角/.test(n) ? n : '內六角' + n, unit: store.get('goods', gid)?.unit || '' }; }) };
}

// ---------- 頁面 ----------
export function poPage(view, sub, arg) {
  if (sub === 'v' && arg) return poView(view, decodeURIComponent(arg));
  if (sub === 'g' && arg) { const g = store.get('goods', decodeURIComponent(arg)); if (g) { const C = calc(); const q = Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0); addToPO(g.id, +g.safety > q ? Math.ceil(+g.safety - q) : ''); toast('已加入採購單：' + g.name); } history.replaceState(null, '', '#po'); }
  const e = load(); const c = e.cid ? store.get('contacts', e.cid) : null;
  view.innerHTML = `<div class="hd"><h1>採購單</h1></div>
    ${lastPO ? poCard(store.get('bills', lastPO)) : ''}
    <div class="card list">
      <a href="#" id="ps"><span>廠商</span><span class="go">${c ? `<b>${esc(cdisp(c))}</b>` : '<span class="muted">請選擇</span>'} ›</span></a>
      <div class="row"><span>日期</span><input type="date" id="pdt" class="inl" value="${esc(e.date)}"></div>
      <div class="row"><span>希望交期</span><input type="date" id="pdv" class="inl" value="${esc(e.deliv)}"></div>
      <div class="row"><span>聯絡人</span><input id="pat" class="inl" value="${esc(e.attn)}" placeholder="${esc(c?.person || '選填')}"></div>
      <div class="row"><span>傳真號碼</span><span class="go">${c ? (c.fax ? `${esc(c.fax)}<small class="muted">　撥 ${esc(faxDial(c, c.fax))}${isTaichung(c) ? '（台中去掉 04）' : ''}</small>` : '<span class="bad">廠商資料沒有傳真</span>') : '—'}</span></div>
    </div>
    <div class="sec">品項 ${e.lines.length ? `<span class="muted">${e.lines.length} 項</span>` : ''}</div>
    <div id="pl">${e.lines.map((l, i) => lineCard(l, i)).join('')}</div>
    <div class="btn2"><button class="btn ghost" id="padd">＋ 加品項</button><button class="btn ghost" id="pscan">掃 QR 碼加入</button></div>
    <div class="card list" id="ptot"></div>
    <div class="sec">備註</div><div class="card"><textarea id="pnote" rows="2" placeholder="選填，會印在採購單上">${esc(e.note)}</textarea></div>
    <div id="perr" class="err"></div>
    <div class="acts"><button class="btn ghost" id="psave">只存採購單</button><button class="btn" id="pfax">存並傳真</button></div>
    ${e.lines.length || e.cid ? '<p><button class="btn ghost danger" id="pclr">清除這張</button></p>' : ''}
    <div class="sec">最近的採購單</div>
    <div class="card list" id="prec">${recentHtml()}</div>`;
  const $ = q => view.querySelector(q); const redraw = () => poPage(view);
  drawTot(view);
  $('#ps').onclick = ev => { ev.preventDefault(); pickSupplier(id => { e.cid = id; const s = store.get('contacts', id); e.attn = s?.person || ''; e.lines.forEach(l => { if (l.ap || l.price === '') priceFor(l, e.cid); }); keep(); redraw(); }); };
  $('#pdt').onchange = ev => { e.date = ev.target.value || today(); keep(); };
  $('#pdv').onchange = ev => { e.deliv = ev.target.value; keep(); };
  $('#pat').oninput = ev => { e.attn = ev.target.value; keep(); };
  $('#pnote').oninput = ev => { e.note = ev.target.value; keep(); };
  $('#padd').onclick = () => pickGoods(redraw);
  $('#pscan').onclick = () => scanQR(t => { const g = findByCode(t); if (!g) { toast('找不到料號：' + t); return; } addToPO(g.id); redraw(); }, { title: '掃商品 QR 碼' });
  const pl = $('#pl');
  pl.addEventListener('input', ev => { const i = +ev.target.closest('[data-i]')?.dataset.i; const l = e.lines[i]; if (!l) return; if (ev.target.dataset.f === 'qty') l.qty = ev.target.value; if (ev.target.dataset.f === 'price') { l.price = ev.target.value; l.ap = false; } keep(); const a = pl.querySelector(`[data-i="${i}"] .amt`); if (a) a.textContent = fmt(lineAmt(l)); drawTot(view); });
  pl.addEventListener('click', ev => { const b = ev.target.closest('[data-del]'); if (!b) return; e.lines.splice(+b.dataset.del, 1); keep(); redraw(); });
  $('#psave').onclick = () => savePO(view, false);
  $('#pfax').onclick = () => savePO(view, true);
  $('#pclr')?.addEventListener('click', () => { if (!window.confirm('清除這張採購單（還沒存的內容）？')) return; cur = blank(); keep(); redraw(); });
  bindCard(view);
}
function lineCard(l, i) {
  const g = store.get('goods', l.gid) || {};
  return `<div class="card ln" data-i="${i}"><div class="lnh"><div class="gm"><b>${esc(g.name || '（商品已刪除）')}</b><small>${esc(g.code || '')}${g.vcode ? '・廠商料號 ' + esc(g.vcode) : ''}${l.hint ? '・' + esc(l.hint) : ''}</small></div><button class="x" data-del="${i}" aria-label="刪除">×</button></div>
    <div class="lnr"><label>數量<input data-f="qty" inputmode="decimal" value="${esc(l.qty)}" placeholder="0"></label><span class="u">${esc(g.unit || '')}</span><label>單價<input data-f="price" inputmode="decimal" value="${esc(l.price)}" placeholder="0"></label><span class="amt">${fmt(lineAmt(l))}</span></div></div>`;
}
function drawTot(view) {
  const e = load(); const box = view.querySelector('#ptot'); if (!box) return; const t = totals(docOf(e));
  box.innerHTML = `<div class="row"><span>小計</span><span class="go">${fmt(t.net)}</span></div>
    <label class="row"><span>加 5% 營業稅</span><span class="go"><input type="checkbox" id="ptx" ${e.tax ? 'checked' : ''}> ${e.tax ? fmt(t.tax) : ''}</span></label>
    <div class="row"><b>總計</b><span class="go"><b>${fmt(t.total)}</b></span></div>`;
  box.querySelector('#ptx').onchange = ev => { e.tax = ev.target.checked; keep(); drawTot(view); };
}
async function savePO(view, fax) {
  const e = load(); const err = view.querySelector('#perr'); const c = e.cid ? store.get('contacts', e.cid) : null;
  const ls2 = e.lines.filter(l => l.gid);
  const msg = !c ? '請選擇廠商' : !ls2.length ? '請至少加一項商品' : ls2.some(l => !(+l.qty > 0)) ? '每一項的數量都要大於 0' : fax && !c.fax ? '這家廠商的資料沒有傳真號碼，請先到電腦版廠商資料補上' : '';
  if (msg) { err.textContent = msg; toast(msg); return; }
  if (fax && !window.confirm(`確定要傳真給 ${cname(c.id)}？\n傳真號碼：${faxDial(c, c.fax)}\n傳出去就收不回來。`)) return;
  err.textContent = ''; view.querySelectorAll('.acts button').forEach(b => b.disabled = true);
  const d = docOf(e); const no = nextNo('PO', e.date); const id = uid('b');
  const doc = { type: 'PO', no, date: e.date, note: e.note || '', createdAt: Date.now(), updatedAt: Date.now(), cid: e.cid, lines: d.lines, disc: 0, tax: !!e.tax, createdBy: store.user.id };
  if (e.attn) doc.attn = e.attn; if (e.deliv) doc.deliv = e.deliv;
  try { await store.save('bills', id, doc); } catch (x) { toast('存檔失敗：' + x.message); view.querySelectorAll('.acts button').forEach(b => b.disabled = false); return; }
  store.log('新增', `採購單 ${no}｜${cname(doc.cid)}｜${fmt(totals(doc).total)} 元（手機）`);
  lastPO = id; cur = blank(); keep();
  if (fax) await sendFax({ ...doc, id }).catch(x => toast('排入傳真失敗：' + x.message));
  toast(`採購單 ${no} 已存${fax ? '，已排入傳真' : ''}`); poPage(view); window.scrollTo(0, 0);
}
async function sendFax(b) {
  const c = store.get('contacts', b.cid); const to = faxDial(c, c.fax);
  await queueFax(faxCopy(b), c, { to, attn: b.attn || c.person || '', subj: `採購單 ${b.no}`, msg: '敬請依採購單內容安排交貨，收到後請簽回確認，謝謝。', cover: false, big: true });
}
// 傳真狀態：最新一筆傳真工作
const lastJob = b => { const f = (b?.faxLog || []).filter(x => x.job).slice(-1)[0]; return f ? store.get('faxjobs', f.job) : null; };
const hm = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const recentHtml = () => store.list('bills').filter(b => b.type === 'PO').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8).map(b => `<a href="#po/v/${encodeURIComponent(b.id)}"><div class="gm"><b>${esc(cname(b.cid))}</b><small>${esc(b.no)}・${esc(slash(b.date))}・${fmt(totals(b).total)} 元</small></div><span class="go">${faxTag(b)} ›</span></a>`).join('') || '<div class="row muted">還沒有採購單</div>';
function faxTag(b) {
  const j = lastJob(b); if (!j) return (b.faxLog || []).length ? '<small class="muted">已手動傳真</small>' : '<small class="muted">未傳真</small>';
  return j.status === 'sent' ? `<small class="good">已傳真 ${hm(j.doneAt || j.at)}</small>` : j.status === 'failed' ? '<small class="bad">傳真失敗</small>' : '<small class="warn">傳真中…</small>';
}
function poCard(b) {
  if (!b) return ''; const j = lastJob(b);
  const st = !j ? '<div class="pst">還沒傳真</div>' : j.status === 'sent' ? `<div class="pst done">已傳真 ${hm(j.doneAt || j.at)}<small>${esc(j.msg || '')}</small></div>` : j.status === 'failed' ? `<div class="pst failed">失敗<small>${esc(j.msg || '')}</small></div>` : `<div class="pst queued">${j.status === 'sending' ? '傳送中…' : '排隊中，等傳真小幫手'}</div>`;
  return `<div class="card sent" data-po="${b.id}"><b>採購單 ${esc(b.no)}</b><small>${esc(cname(b.cid))}・${fmt(totals(b).total)} 元・電腦版「採購進貨」看得到</small>${st}
    ${!j || j.status === 'failed' ? `<button class="btn ghost" data-refax="${b.id}">${j ? '重試傳真' : '傳真這張'}</button>` : ''}<div class="note" data-fh></div></div>`;
}
function bindCard(view) {
  view.querySelectorAll('[data-refax]').forEach(btn => btn.onclick = async () => {
    const b = store.get('bills', btn.dataset.refax); const c = store.get('contacts', b?.cid); if (!b || !c) return;
    if (!c.fax) { toast('這家廠商的資料沒有傳真號碼'); return; }
    if (!window.confirm(`確定要傳真採購單 ${b.no} 給 ${cname(c.id)}（${faxDial(c, c.fax)}）？`)) return;
    btn.disabled = true; try { await sendFax(b); toast('已排入傳真'); } catch (x) { toast('排入傳真失敗：' + x.message); btn.disabled = false; }
  });
  const fh = view.querySelector('[data-fh]'); if (fh) api.get('/api/fax/helper').then(r => { if (fh.isConnected) fh.textContent = r.online ? (r.busy ? `傳真小幫手正在送 ${r.busy}` : '傳真小幫手在線上') : '⚠ 傳真小幫手沒有在執行，傳真會排隊'; }).catch(() => {});
}
export function onPOChange(view, ch) {
  if (!(ch.has('faxjobs') || ch.has('bills'))) return;
  const rc = view.querySelector('#prec'); if (rc) rc.innerHTML = recentHtml();
  view.querySelectorAll('[data-po]').forEach(old => { const t = document.createElement('div'); t.innerHTML = poCard(store.get('bills', old.dataset.po)); if (t.firstElementChild) old.replaceWith(t.firstElementChild); });
  bindCard(view);
}
function poView(view, id) {
  const b = store.get('bills', id); if (!b) { view.innerHTML = '<div class="hd"><a class="back" href="#po">‹ 採購單</a></div><div class="card ph"><b>找不到這張採購單</b></div>'; return; }
  const t = totals(b);
  view.innerHTML = `<div class="hd"><a class="back" href="#po">‹ 採購單</a></div>${poCard(b)}
    <div class="card list"><div class="row"><span>日期</span><span class="go">${esc(slash(b.date))}</span></div>${b.deliv ? `<div class="row"><span>交期</span><span class="go">${esc(slash(b.deliv))}</span></div>` : ''}${b.attn ? `<div class="row"><span>聯絡人</span><span class="go">${esc(b.attn)}</span></div>` : ''}</div>
    <div class="sec">品項</div><div class="card list">${(b.lines || []).filter(l => l.gid || l.n).map(l => `<div class="row"><div class="gm"><b>${esc(l.gid ? gname(l.gid, 'PO') : l.n)}</b><small>${fmtQ(l.qty)} ${esc(l.u || store.get('goods', l.gid)?.unit || '')} × ${p4(l.price)}</small></div><span class="go">${fmt(lineAmt(l))}</span></div>`).join('')}
      <div class="row"><span>小計</span><span class="go">${fmt(t.net)}</span></div>${b.tax ? `<div class="row"><span>稅</span><span class="go">${fmt(t.tax)}</span></div>` : ''}<div class="row"><b>總計</b><span class="go"><b>${fmt(t.total)}</b></span></div></div>
    <div class="sec">傳真紀錄</div><div class="card list">${(b.faxLog || []).slice().reverse().map(f => { const j = f.job ? store.get('faxjobs', f.job) : null; return `<div class="row"><span>${esc(hm(f.at))}　${esc(f.to)}</span><span class="go">${j ? (j.status === 'sent' ? '<small class="good">已傳真</small>' : j.status === 'failed' ? `<small class="bad">失敗：${esc(j.msg || '')}</small>` : '<small class="warn">傳送中</small>') : '<small class="muted">手動</small>'}</span></div>`; }).join('') || '<div class="row muted">還沒傳真</div>'}</div>`;
  bindCard(view);
}

// ---------- 選廠商、加品項 ----------
function sheet(title, body, right = '') {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>${right ? '完成' : '取消'}</button><b>${title}</b><span style="width:40px"></span></div>${body}`;
  document.body.append(el); document.body.classList.add('noscroll');
  return { el, close: () => { el.remove(); document.body.classList.remove('noscroll'); } };
}
function pickSupplier(onPick) {
  const { el, close } = sheet('選廠商', '<div class="search"><input type="search" id="sq" placeholder="廠商名稱、代號" autocomplete="off"></div><div class="card list" id="sl"></div>');
  const all = suppliers().map(c => ({ c, t: [c.code, c.name, c.short, ...(c.aliases || [])].filter(Boolean).join(' ') }));
  const draw = v => { el.querySelector('#sl').innerHTML = all.filter(x => matchQ(x.t, qTerms(v))).slice(0, 60).map(x => `<a href="#" data-id="${x.c.id}"><span class="mono muted">${esc(x.c.code)}</span>${esc(cdisp(x.c))}<span class="go">${x.c.fax ? '' : '<small class="muted">無傳真</small>'}</span></a>`).join('') || '<div class="row muted">找不到</div>'; };
  el.querySelector('#sq').addEventListener('input', ev => draw(ev.target.value)); draw('');
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('#sl').addEventListener('click', ev => { const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault(); close(); onPick(a.dataset.id); });
  setTimeout(() => el.querySelector('#sq').focus(), 50);
}
function pickGoods(done) {
  const { el, close } = sheet('加品項', '<div class="search"><input type="search" id="gq" placeholder="規格或品名" autocomplete="off" autocorrect="off" autocapitalize="off"></div><div class="card list" id="gl"></div>', 1);
  const C = calc();
  const draw = v => { el.querySelector('#gl').innerHTML = search(v, '').slice(0, 50).map(g => `<a href="#" data-id="${g.id}"><div class="gm"><b>${esc(g.name)}</b><small>${esc(g.code)}・庫存 ${C.stock[g.id] ? fmtQ(Object.values(C.stock[g.id]).reduce((a, b) => a + b, 0)) : '—'}</small></div><span class="go">＋</span></a>`).join('') || `<div class="row muted">${v.trim() ? '找不到' : '輸入規格或品名'}</div>`; };
  let tm = 0; el.querySelector('#gq').addEventListener('input', ev => { clearTimeout(tm); tm = setTimeout(() => draw(ev.target.value), 150); }); draw('');
  el.querySelector('[data-x]').onclick = () => { close(); done(); };
  el.querySelector('#gl').addEventListener('click', ev => { const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault(); addToPO(a.dataset.id); a.querySelector('.go').textContent = '✓'; });
  setTimeout(() => el.querySelector('#gq').focus(), 50);
}
