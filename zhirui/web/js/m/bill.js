// 手機版：開出貨單。客戶、品項（數量×單價，預設該客戶上次成交價）、小計、稅、總計、本單毛利；存草稿、送出、送出並交給主機列印中一刀。
// 存檔格式跟電腦版銷貨單完全一樣（bills 集合），電腦版直接看得到、可以再修改。草稿另存 drafts 集合，不影響庫存與帳款。
import { esc, fmt, fmtQ, today, uid, ls, slash } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { calc, totals, lineAmt, nextNo, defWh, cdisp, cname, lastSale, unitPrice, costOf } from '../core/calc.js';
import { shipDoc, ruyangTpl } from '../modules/ship.js';
import { scanQR } from '../core/qr.js';
import { search, findByCode, pickCustomer } from './stock.js';

const KEY = 'zr.m.bill';
const PRINTER_DEF = 'EPSON LQ-310 ESC/P2 (云盒_75 USB3)';
const blank = () => ({ cid: '', date: today(), tax: false, note: '', lines: [], fmt: 'std', draftId: '' });
let cur = null;
const load = () => { if (!cur) { const x = ls.get(KEY, null); cur = x && Array.isArray(x.lines) ? { ...blank(), ...x } : blank(); } return cur; };
const keep = () => ls.set(KEY, cur);
let lastSent = null;   // 剛送出的單：{ billId, no, jobId }
const p2 = n => (Math.round((+n || 0) * 10000) / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); };

/** 品項預設單價：該客戶上次成交價（含單位）→ 商品售價 */
function priceFor(l, cid, date) {
  const x = cid ? lastSale(cid, l.gid, date) : null;
  if (x) { l.price = x.price; if (x.u) l.u = x.u; else delete l.u; l.hint = `上次 ${p2(x.price)}${x.u ? '/' + x.u : ''}（${slash(x.date)}）`; }
  else { const p = unitPrice(store.get('goods', l.gid) || {}, 'SALE'); l.price = p === '' ? '' : p; delete l.u; l.hint = cid ? '這個客戶沒買過' : ''; }
  l.ap = true;   // 自動帶的單價（換客戶會重帶）
}
export function addToBill(gid, qty) {
  const e = load(); const l = { gid, qty: qty || '', price: '' }; priceFor(l, e.cid, e.date); e.lines.push(l); keep(); return l;
}
const docOf = e => ({ type: 'SALE', date: e.date, cid: e.cid, tax: !!e.tax, disc: 0, lines: e.lines.filter(l => l.gid).map(l => { const o = { gid: l.gid, qty: +l.qty || 0, price: +l.price || 0 }; if (l.u) o.u = l.u; return o; }) });
/** 本單毛利：每行用跟電腦版一樣的成本推算（進貨單 → 採購單 → 查價） */
function profitOf(doc) {
  const C = calc(); let cost = 0, miss = 0;
  for (const l of doc.lines) { const r = costOf(l, doc.date, C.purIdx, C.g, C.poIdx); if (r) cost += r.c * (+l.qty || 0); else miss++; }
  const t = totals(doc); return { t, cost, profit: t.net - cost, rate: t.net ? (t.net - cost) / t.net : 0, miss };
}

// ---------- 開單頁 ----------
export function billPage(view, sub) {
  const e = load(); const c = e.cid ? store.get('contacts', e.cid) : null;
  const drafts = store.list('drafts');
  const ry = c && /如陽/.test(c.name);
  if (e.fmt === 'ry' && !ry) e.fmt = 'std';
  view.innerHTML = `<div class="hd"><h1>開出貨單</h1><span class="sp"></span>${drafts.length ? `<button class="chip" id="dl">草稿 ${drafts.length}</button>` : ''}</div>
    ${lastSent ? sentCard() : ''}
    ${e.draftId ? `<div class="note" style="margin:0 0 8px">正在編輯草稿${(s => s ? `（${esc(s.by || '')} ${new Date(s.at).toLocaleString('zh-TW', { hour12: false })}）` : '')(store.get('drafts', e.draftId))}</div>` : ''}
    <div class="card list">
      <a href="#" id="pc"><span>客戶</span><span class="go">${c ? `<b>${esc(cdisp(c))}</b>` : '<span class="muted">請選擇</span>'} ›</span></a>
      <div class="row"><span>日期</span><input type="date" id="dt" class="inl" value="${esc(e.date)}"></div>
    </div>
    <div class="sec">品項 ${e.lines.length ? `<span class="muted">${e.lines.length} 項</span>` : ''}</div>
    <div id="lines">${e.lines.map((l, i) => lineCard(l, i)).join('')}</div>
    <div class="btn2"><button class="btn ghost" id="add">＋ 加品項</button><button class="btn ghost" id="scan">掃 QR 碼加入</button></div>
    <div class="card list" id="tot"></div>
    <div class="sec">備註</div>
    <div class="card"><textarea id="note" rows="2" placeholder="選填">${esc(e.note)}</textarea></div>
    <div class="sec">列印格式</div>
    <div class="chips">${[['std', '一般'], ['pn', '含客料號'], ['na', '不含金額'], ...(ry ? [['ry', '如陽格式']] : [])].map(([k, n]) => `<button class="chip ${e.fmt === k ? 'on' : ''}" data-fmt="${k}">${n}</button>`).join('')}</div>
    <div id="err" class="err"></div>
    <div class="acts"><button class="btn ghost" id="draft">存草稿</button><button class="btn ghost" id="save">送出</button></div>
    <p><button class="btn" id="saveprint">送出並列印（中一刀）</button></p>
    <p><button class="btn ghost danger" id="clr">清除這張</button></p>
    <div class="note" id="ph"></div>
    ${(m => `<details class="card set"><summary>主機列印設定</summary>
      <div class="f"><label for="mp-pr">印表機名稱（主機上的）</label><input id="mp-pr" value="${esc(m.printer || PRINTER_DEF)}"></div>
      <div class="f2"><div class="f"><label for="mp-l">往右移（mm）</label><input id="mp-l" inputmode="decimal" value="${esc(m.off?.left ?? 6)}"></div><div class="f"><label for="mp-t">往下移（mm）</label><input id="mp-t" inputmode="decimal" value="${esc(m.off?.top ?? 4)}"></div></div>
      <button class="btn ghost" id="mp-save">儲存</button><div class="note">印出來位置不準時調整：字太靠左就加大「往右移」，太靠上就加大「往下移」。全公司共用。</div></details>`)(store.setting('mprint'))}`;
  const $ = s => view.querySelector(s);
  const redraw = () => billPage(view);
  drawTot(view);
  $('#pc').onclick = ev => { ev.preventDefault(); pickCustomer(redraw, id => { e.cid = id; e.lines.forEach(l => { if (l.ap || l.price === '' || l.price == null) priceFor(l, e.cid, e.date); }); keep(); }); };
  $('#dt').onchange = ev => { e.date = ev.target.value || today(); keep(); };
  $('#note').oninput = ev => { e.note = ev.target.value; keep(); };
  $('#add').onclick = () => pickGoods(redraw);
  $('#scan').onclick = () => scanQR(text => { const g = findByCode(text); if (!g) { toast('找不到料號：' + text); return; } addToBill(g.id); toast('已加入：' + g.name); redraw(); }, { title: '掃商品 QR 碼' });
  $('#dl')?.addEventListener('click', () => draftList(redraw));
  view.querySelectorAll('[data-fmt]').forEach(b => b.onclick = () => { e.fmt = b.dataset.fmt; keep(); view.querySelectorAll('[data-fmt]').forEach(x => x.classList.toggle('on', x === b)); });
  const lines = $('#lines');
  lines.addEventListener('input', ev => {
    const i = +ev.target.closest('[data-i]')?.dataset.i; const l = e.lines[i]; if (!l) return;
    if (ev.target.dataset.f === 'qty') l.qty = ev.target.value;
    if (ev.target.dataset.f === 'price') { l.price = ev.target.value; l.ap = false; }
    keep(); const a = lines.querySelector(`[data-i="${i}"] .amt`); if (a) a.textContent = fmt(lineAmt({ qty: l.qty, price: l.price }));
    drawTot(view);
  });
  lines.addEventListener('click', ev => { const b = ev.target.closest('[data-del]'); if (!b) return; e.lines.splice(+b.dataset.del, 1); keep(); redraw(); });
  $('#draft').onclick = () => saveDraft(view);
  $('#save').onclick = () => submit(view, false);
  $('#saveprint').onclick = () => submit(view, true);
  $('#clr').onclick = () => { if (!e.lines.length && !e.cid) return; if (!window.confirm('清除這張出貨單（還沒送出的內容）？')) return; cur = blank(); keep(); lastSent = null; redraw(); };
  $('#mp-save').onclick = async () => {
    const n = id => { const v = parseFloat($(id).value); return isFinite(v) ? Math.max(-30, Math.min(60, v)) : 0; };
    try { await store.save('settings', 'mprint', { ...store.setting('mprint'), printer: $('#mp-pr').value.trim() || PRINTER_DEF, off: { left: n('#mp-l'), top: n('#mp-t') } }); toast('列印設定已儲存'); } catch (err) { toast('儲存失敗：' + err.message); }
  };
  helperState(view);
  if (sub === 'drafts' && drafts.length) draftList(redraw);
}
function lineCard(l, i) {
  const g = store.get('goods', l.gid) || {}; const unit = l.u || g.unit || '';
  return `<div class="card ln" data-i="${i}"><div class="lnh"><div class="gm"><b>${esc(g.name || '（商品已刪除）')}</b><small>${esc(g.code || '')}${l.hint ? '・' + esc(l.hint) : ''}</small></div><button class="x" data-del="${i}" aria-label="刪除">×</button></div>
    <div class="lnr"><label>數量<input data-f="qty" inputmode="decimal" value="${esc(l.qty)}" placeholder="0"></label><span class="u">${esc(unit)}</span><label>單價<input data-f="price" inputmode="decimal" value="${esc(l.price)}" placeholder="0"></label><span class="amt">${fmt(lineAmt({ qty: l.qty, price: l.price }))}</span></div></div>`;
}
function drawTot(view) {
  const e = load(); const box = view.querySelector('#tot'); if (!box) return;
  const doc = docOf(e); const k = profitOf(doc);
  box.innerHTML = `<div class="row"><span>小計（未稅）</span><span class="go">${fmt(k.t.net)}</span></div>
    <label class="row"><span>加 5% 營業稅</span><span class="go"><input type="checkbox" id="tx" ${e.tax ? 'checked' : ''}> ${e.tax ? fmt(k.t.tax) : '<small class="muted">不勾＝月結時依客戶加稅</small>'}</span></label>
    <div class="row"><b>總計</b><span class="go"><b>${fmt(k.t.total)}</b></span></div>
    <div class="row"><span>本單毛利</span><span class="go ${k.profit >= 0 ? 'good' : 'bad'}">${doc.lines.length ? `${fmt(k.profit)}（${(k.rate * 100).toFixed(1)}%）` : '—'}</span></div>
    ${k.miss ? `<div class="row src">${k.miss} 項查不到成本，毛利偏高</div>` : ''}`;
  box.querySelector('#tx').onchange = ev => { e.tax = ev.target.checked; keep(); drawTot(view); };
}
function check(e) {
  if (!e.cid) return '請選擇客戶';
  const ls2 = e.lines.filter(l => l.gid);
  if (!ls2.length) return '請至少加一項商品';
  if (ls2.some(l => !(+l.qty > 0))) return '每一項的數量都要大於 0';
  if (ls2.some(l => l.price === '' || l.price == null || isNaN(+l.price))) return '有品項還沒填單價';
  return '';
}
async function saveDraft(view) {
  const e = load(); if (!e.cid && !e.lines.length) { toast('這張還是空的'); return; }
  const id = e.draftId || uid('d');
  const doc = { cid: e.cid, date: e.date, tax: !!e.tax, note: e.note || '', fmt: e.fmt, lines: e.lines.map(l => ({ gid: l.gid, qty: l.qty, price: l.price, ...(l.u ? { u: l.u } : {}), ...(l.hint ? { hint: l.hint } : {}), ap: !!l.ap })), by: store.user.name, uid: store.user.id, at: Date.now() };
  try { await store.save('drafts', id, doc); } catch (err) { toast('存草稿失敗：' + err.message); return; }
  cur = blank(); keep(); toast('已存成草稿'); billPage(view);
}
async function submit(view, print) {
  const e = load(); const err = check(e); const box = view.querySelector('#err');
  if (err) { box.textContent = err; toast(err); return; }
  box.textContent = '';
  view.querySelectorAll('.acts button, #saveprint').forEach(b => b.disabled = true);
  const d = docOf(e); const no = nextNo('SALE', e.date); const id = uid('b');
  const doc = { type: 'SALE', no, date: e.date, note: e.note || '', createdAt: Date.now(), updatedAt: Date.now(), cid: e.cid, wid: defWh()?.id || '', lines: d.lines, disc: 0, tax: !!e.tax, paid: 0, aid: store.list('accounts')[0]?.id || '', createdBy: store.user.id };
  try { await store.save('bills', id, doc); }
  catch (err2) { toast('送出失敗：' + err2.message); view.querySelectorAll('.acts button, #saveprint').forEach(b => b.disabled = false); return; }
  store.log('新增', `銷貨單 ${no}｜${cname(doc.cid)}｜${fmt(totals(doc).total)} 元（手機）`);
  if (e.draftId && store.get('drafts', e.draftId)) await store.remove('drafts', e.draftId).catch(() => {});
  lastSent = { billId: id, no, jobId: '' };
  if (print) lastSent.jobId = await queuePrint({ ...doc, id }, e.fmt).catch(err3 => { toast('排入列印失敗：' + err3.message); return ''; });
  cur = blank(); keep(); toast(`銷貨單 ${no} 已送出${print ? '，已排入列印' : ''}`); billPage(view); window.scrollTo(0, 0);
}
/** 出貨單交給主機的列印小幫手印中一刀（格式、位置用平台設定；印表機名稱在設定 mprint） */
export async function queuePrint(b, f) {
  const set = store.setting('mprint') || {};
  const opt = f === 'pn' ? { pn: true } : f === 'na' ? { noAmt: true } : f === 'ry' ? { pn: true, label: '如陽列印', tpl: ruyangTpl() } : {};
  if (set.off) opt.off = set.off;
  const d = shipDoc(b, opt);
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>銷貨單 ${esc(b.no)}</title><style>${d.css}</style></head><body>${d.html}</body></html>`;
  const id = uid('pj');
  await store.save('printjobs', id, { status: 'queued', billId: b.id, no: b.no, type: b.type, fmt: f || 'std', printer: set.printer || PRINTER_DEF, html, by: store.user.name, at: new Date().toISOString() });
  store.log('列印', `銷貨單 ${b.no}（手機，主機列印）`);
  return id;
}
const ST = { queued: '排隊中，等主機列印', printing: '列印中…', done: '已印出', failed: '列印失敗' };
function sentCard() {
  const j = lastSent.jobId ? store.get('printjobs', lastSent.jobId) : null; const b = store.get('bills', lastSent.billId);
  return `<div class="card sent"><b>已送出 ${esc(lastSent.no)}</b>${b ? `<small>${esc(cname(b.cid))}・${fmt(totals(b).total)} 元・電腦版「銷貨單」看得到</small>` : ''}
    ${j ? `<div class="pst ${j.status}">${ST[j.status] || j.status}${j.msg ? `<small>${esc(j.msg)}</small>` : ''}</div>${j.status === 'failed' ? '<button class="btn ghost" id="rp">重印</button>' : ''}` : `<button class="btn ghost" id="rp">列印這張（中一刀）</button>`}</div>`;
}
async function helperState(view) {
  const ph = view.querySelector('#ph'); const rp = view.querySelector('#rp');
  if (rp) rp.onclick = async () => { const b = store.get('bills', lastSent.billId); if (!b) return; rp.disabled = true; lastSent.jobId = await queuePrint(b, 'std').catch(err => { toast(err.message); return ''; }); billPage(view); };
  try { const s = await api.get('/api/print/helper'); if (ph?.isConnected) ph.textContent = s.online ? '主機列印小幫手：運作中' : '⚠ 主機的列印小幫手沒有開，列印會排隊，等它開了才印'; } catch (e) {}
}
/** 列印狀態更新時重畫已送出卡片 */
export function onBillChange(view, ch) {
  if (lastSent && (ch.has('printjobs') || ch.has('bills'))) { const old = view.querySelector('.sent'); if (old) { const t = document.createElement('div'); t.innerHTML = sentCard(); old.replaceWith(t.firstElementChild); helperState(view); } }
  if (ch.has('drafts')) { const dl = view.querySelector('#dl'); const n = store.list('drafts').length; if (dl) dl.textContent = '草稿 ' + n; }
}

// ---------- 加品項（搜尋） ----------
function pickGoods(done) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>完成</button><b>加品項</b><span style="width:40px"></span></div>
    <div class="search"><input type="search" id="gq" placeholder="規格或品名，例如 M6*20" autocomplete="off" autocorrect="off" autocapitalize="off"></div><div class="card list" id="gl"></div><div class="note" id="gn"></div>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); done(); };
  const C = calc(); let n = 0;
  const draw = v => { const list = search(v, ''); el.querySelector('#gl').innerHTML = list.slice(0, 50).map(g => `<a href="#" data-id="${g.id}"><div class="gm"><b>${esc(g.name)}</b><small>${esc(g.code)}・庫存 ${C.stock[g.id] ? fmtQ(Object.values(C.stock[g.id]).reduce((a, b) => a + b, 0)) : '—'}</small></div><span class="go">＋</span></a>`).join('') || (v.trim() ? '<div class="row muted">找不到</div>' : '<div class="row muted">輸入規格或品名</div>'); };
  let tm = 0; el.querySelector('#gq').addEventListener('input', ev => { clearTimeout(tm); tm = setTimeout(() => draw(ev.target.value), 150); }); draw('');
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('#gl').addEventListener('click', ev => { const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault(); addToBill(a.dataset.id); n++; a.querySelector('.go').textContent = '✓'; el.querySelector('#gn').textContent = `已加入 ${n} 項，按「完成」回出貨單`; });
  setTimeout(() => el.querySelector('#gq').focus(), 50);
}

// ---------- 草稿清單（同事或自己存的） ----------
function draftList(done) {
  const el = document.createElement('div'); el.className = 'sheet';
  const list = store.list('drafts').sort((a, b) => (b.at || 0) - (a.at || 0));
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>關閉</button><b>草稿</b><span style="width:40px"></span></div>
    <div class="card list">${list.map(d => { const t = totals(docOf({ ...d, lines: d.lines || [] })); return `<a href="#" data-id="${d.id}"><div class="gm"><b>${esc(d.cid ? cname(d.cid) : '（未選客戶）')}</b><small>${esc(d.by || '')}・${new Date(d.at).toLocaleString('zh-TW', { hour12: false })}・${(d.lines || []).length} 項</small></div><span class="go">${fmt(t.total)} ›</span></a>`; }).join('') || '<div class="row muted">沒有草稿</div>'}</div>
    <div class="note">點草稿打開：檢查、修改後按「送出」就是確認；送出後草稿自動刪除。</div>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); done(); };
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('.list').addEventListener('click', ev => {
    const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault();
    const e = load(); if ((e.lines.length || e.cid) && !e.draftId && !window.confirm('目前這張還沒送出，要換成這張草稿嗎？（目前的內容會清掉）')) return;
    const d = store.get('drafts', a.dataset.id);
    cur = { ...blank(), cid: d.cid || '', date: d.date || today(), tax: !!d.tax, note: d.note || '', fmt: d.fmt || 'std', lines: (d.lines || []).map(l => ({ ...l })), draftId: d.id }; keep(); lastSent = null; close();
  });
}
export const draftCount = () => store.list('drafts').length;
