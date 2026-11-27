// 手機版：拍照上傳。拍進貨單、採購單、廠商報價、手寫訂單、支票 → AI 辨識 → 待確認 → 人工核對後入帳：
// 進貨單＝建立進貨單（庫存增加）、採購單（志瑞開給廠商的）＝存成採購單、廠商報價＝存成詢價單、手寫訂單＝轉成出貨單草稿、支票＝登記客票、
// 銷項發票（手寫本開的）＝登記到發票作業的銷項發票（列在最下面「手寫本發票」，可一起沖待開的銷貨單）。
// 每次上傳記在 uploads 集合（照片存伺服器 data/files），狀態：辨識中 → 待確認 → 已入帳（或失敗可重試）。
import { esc, fmt, fmtQ, today, uid, ls, slash, ymLabel, ubnOk, toHalf } from '../core/util.js';
import { api, aiOcr } from '../core/api.js';
import { store } from '../core/store.js';
import { calc, nextNo, defWh, cdisp, cname, customers, suppliers, totals, lineAmt, unitFactor, lastSale } from '../core/calc.js';
import { piMatch } from '../modules/purchase_import.js';
import { preOf, findDupCheck } from '../modules/checks_in.js';
import { checkForm, shrink } from './ar.js';
import { search } from './stock.js';
import { sendFax } from './po.js';
import { editGoods } from './goodsedit.js';
import { stdGoods } from '../core/codegen.js';
import { faxDial, isTaichung } from '../modules/faxes.js';
import { pendingGroups, saveHandInvoice } from '../modules/invoices.js';

const KINDS = [['pur', '進貨單', 'S'], ['po', '採購單', 'S'], ['quote', '廠商報價', 'S'], ['order', '手寫訂單', 'C'], ['check', '支票', 'C'], ['inv', '銷項發票', 'C']];
const KN = Object.fromEntries(KINDS.map(k => [k[0], k[1]]));
const ST = { reading: ['辨識中', 'warn'], review: ['待確認', 'warn'], done: ['已入帳', 'good'], failed: ['失敗', 'bad'] };
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); };
const hm = ms => { const d = new Date(ms); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const upd = (id, patch) => { const u = store.get('uploads', id); if (!u) return Promise.resolve(); const { id: _, ...rest } = u; return store.save('uploads', id, { ...rest, ...patch }); };

/** 單據上的公司名稱 → 客戶／廠商（全名、簡稱、別名互相包含就算，取最長的） */
function matchParty(name, kind) {
  const n = x => String(x || '').replace(/[\s　()（）\-－]/g, '').replace(/(股份)?有限公司|企業社|實業|企業|工業|商行/g, '').toLowerCase();
  const d = n(name); if (d.length < 2) return null;
  const list = kind === 'S' ? suppliers(true) : customers(true); let best = null, bl = 0;
  for (const c of list) for (const a of [c.name, c.short, ...(c.aliases || [])]) { const k = n(a); if (k.length < 2) continue; const l = k === d ? 1000 : d.includes(k) ? k.length : k.includes(d) ? d.length : 0; if (l > bl) { bl = l; best = c; } }
  return bl >= 2 ? best : null;
}

// ---------- 上傳頁 ----------
export function uploadPage(view, sub) {
  if (sub) return reviewPage(view, decodeURIComponent(sub));
  const kind = ls.get('zr.m.upk', 'pur');
  const list = store.list('uploads').sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30);
  view.innerHTML = `<div class="hd"><h1>拍照上傳</h1></div>
    <div class="chips seg">${KINDS.map(([k, n]) => `<button class="chip ${kind === k ? 'on' : ''}" data-k="${k}">${n}</button>`).join('')}</div>
    <div class="card shot"><button class="btn" id="cam">📷 拍${esc(KN[kind])}</button><button class="btn ghost" id="lib">從相簿或檔案選</button>
      <div class="note" style="margin:6px 0 0">拍好後 AI 會自動辨識（約 10～40 秒），辨識完到下面「待確認」核對，確認後才會入帳。</div></div>
    <input type="file" id="fc" accept="image/*" capture="environment" hidden><input type="file" id="fl" accept="image/*${kind === 'check' ? '' : ',application/pdf'}" hidden>
    <div class="sec">最近上傳</div>
    <div class="card list" id="ul">${list.map(rowHtml).join('') || '<div class="row muted">還沒有上傳</div>'}</div>`;
  view.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { ls.set('zr.m.upk', b.dataset.k); uploadPage(view); });
  const fc = view.querySelector('#fc'), fl = view.querySelector('#fl');
  view.querySelector('#cam').onclick = () => fc.click(); view.querySelector('#lib').onclick = () => fl.click();
  const go = inp => () => { const f = inp.files[0]; inp.value = ''; if (f) start(kind, f).catch(e => toast(e.message || String(e))); };
  fc.onchange = go(fc); fl.onchange = go(fl);
}
function rowHtml(u) {
  const [t, c] = ST[u.status] || [u.status, ''];
  const who = u.cid ? cdisp(store.get('contacts', u.cid)) : u.result?.party || u.result?.buyer || (u.result?.checks ? `${u.result.checks.length} 張支票` : '');
  return `<a href="#up/${encodeURIComponent(u.id)}"><img class="thumb" src="${u.file && !/\.pdf$/.test(u.file) ? '/api/files/' + esc(u.file) : ''}" alt="" loading="lazy"><div class="gm"><b>${esc(KN[u.kind] || u.kind)}${who ? '・' + esc(who) : ''}</b><small>${esc(hm(u.at))}・${esc(u.by || '')}${u.msg ? '・' + esc(u.msg) : ''}</small></div><span class="go"><small class="${c}">${t}</small> ›</span></a>`;
}
export function onUploadChange(view, ch) {
  if (!ch.has('uploads')) return;
  const ul = view.querySelector('#ul'); if (ul) { ul.innerHTML = store.list('uploads').sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 30).map(rowHtml).join('') || '<div class="row muted">還沒有上傳</div>'; return; }
  const rv = view.querySelector('[data-rv]'); if (rv) { const u = store.get('uploads', rv.dataset.rv); if (u && u.status !== rv.dataset.st) reviewPage(view, u.id); }
}

// ---------- 上傳＋辨識 ----------
const dataUrlOf = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(f); });
async function start(kind, file) {
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (pdf && kind === 'check') throw new Error('支票請拍照片');
  const url = pdf ? await dataUrlOf(file) : await shrink(file, 2000, 0.85);
  const blob = await (await fetch(url)).blob();
  const r = await fetch(`/api/files?name=${pdf ? 'doc.pdf' : 'photo.jpg'}`, { method: 'POST', body: blob, credentials: 'same-origin' }).then(x => x.json());
  if (!r.ok) throw new Error(r.error || '照片上傳失敗');
  const id = uid('up');
  await store.save('uploads', id, { kind, status: 'reading', file: r.id, at: Date.now(), by: store.user.name, uid: store.user.id });
  toast('已上傳，辨識中…');
  runOcr(id, url, pdf);
}
async function runOcr(id, url, pdf) {
  const u = store.get('uploads', id); if (!u) return;
  try {
    let result;
    if (u.kind === 'check') { const r = await aiOcr('/api/ocr/check', { image: url }); result = { checks: Array.isArray(r.checks) && r.checks.length ? r.checks : [r.fields || {}] }; }
    else {
      const body = { kind: u.kind, data: url.split(',')[1], media: pdf ? 'application/pdf' : 'image/jpeg' };
      try { result = await aiOcr('/api/ocr/doc', body); }
      catch (e) { if (u.kind !== 'po' || !/不認識的單據類型/.test(e.message || '')) throw e; result = await aiOcr('/api/ocr/doc', { ...body, kind: 'pur' }); }   // 伺服器還沒重新啟動
    }
    const kindParty = (KINDS.find(k => k[0] === u.kind) || [])[2];
    const tid = u.kind === 'inv' ? String(result.taxid || '').replace(/\D/g, '') : '';
    const p = u.kind === 'check' ? null : (tid.length === 8 && customers(true).find(c => c.taxId === tid)) || matchParty(result.party, kindParty);
    await upd(id, { status: 'review', result, cid: p?.id || '', msg: '' });
    toast(`${KN[u.kind]}辨識完成，請到「待確認」核對`);
  } catch (e) { await upd(id, { status: 'failed', msg: (e.message || String(e)).slice(0, 120) }); toast('辨識失敗：' + (e.message || e)); }
}
async function retry(id) {
  const u = store.get('uploads', id); if (!u?.file) return;
  await upd(id, { status: 'reading', msg: '' });
  const blob = await fetch('/api/files/' + u.file, { credentials: 'same-origin' }).then(x => x.blob());
  const url = await dataUrlOf(blob); runOcr(id, url, /\.pdf$/.test(u.file));
}

// ---------- 待確認：核對後入帳 ----------
const r4 = n => Math.round(n * 10000) / 10000;
const zhe = f => { const x = Math.round(f * 100); return (x % 10 ? x : x / 10) + " 折"; };   // 0.8 → 8 折、0.85 → 85 折
/** 實際單價：有折數就換算（80＝8 折、8.5＝85 折）；沒讀到折數但「數量×單價」跟金額對不上時，用金額回推折數（四捨五入到 1%） */
function netPrice(r) {
  const p = +r.price || 0, q = +r.qty || 0, a = +r.amount || 0, d = +r.disc || 0;
  if (!p) return { price: q && a ? r4(a / q) : '', note: q && a ? '依金額÷數量算出' : '' };
  const f = d > 10 ? d / 100 : d > 0 ? d / 10 : 0;
  if (f > 0 && f < 1) return { price: r4(p * f), note: `原價 ${p} × ${zhe(f)}` };
  if (q && a && Math.abs(q * p - a) > Math.max(1, a * 0.01)) {
    const k = Math.round(a / (q * p) * 100) / 100;
    if (k > 0.2 && k < 1) return { price: r4(p * k), note: `原價 ${p} × ${zhe(k)}（依金額推算）` };
  }
  return { price: p, note: '' };
}
const rv = {};   // 每個上傳的編輯中明細（記在記憶體）
/** 平台上已經有同單號的採購單（拍的是平台自己印出來的採購單） */
const poDup = no => { const n = String(no || '').replace(/\s/g, ''); return n ? store.list('bills').find(b => b.type === 'PO' && String(b.no || '') === n) : null; };
function linesOf(u) {
  if (rv[u.id] && rv[u.id].cid === u.cid) return rv[u.id].lines;
  const date = u.result?.date || today();
  const lines = (u.result?.lines || []).filter(r => r.name || r.code || +r.qty).map(r => {
    const m = piMatch({ code: r.code, name: [r.name, r.spec].filter(Boolean).join(' '), price: +r.price || 0, unit: r.unit, date }, u.cid);
    const best = m.cands[0]; const g = best && best.s >= 60 ? best.o.g : null;
    const np = netPrice(r);
    const l = { src: [r.code, r.name, r.spec].filter(Boolean).join(' '), code: r.code || '', nm: [r.name, r.spec].filter(Boolean).join(' '), gid: g?.id || '', qty: +r.qty || '', price: np.price, pnote: np.note, unit: r.unit || '', on: true, sure: !!g && best.s >= 90 };
    if (g && r.unit) { const [c1, k1] = unitFactor(r.unit), [c2, k2] = unitFactor(g.unit || ''); if (c1 === c2 && k1 !== k2) l.u = r.unit; }
    if (u.kind === 'order' && g && !(+l.price) && u.cid) { const x = lastSale(u.cid, g.id, today()); if (x) { l.price = x.price; if (x.u) l.u = x.u; } }
    return l;
  });
  rv[u.id] = { cid: u.cid, lines }; return lines;
}
function reviewPage(view, id) {
  const u = store.get('uploads', id);
  if (!u) { view.innerHTML = '<div class="hd"><a class="back" href="#up">‹ 拍照上傳</a></div><div class="card ph"><b>找不到這筆上傳</b></div>'; return; }
  const [t, c] = ST[u.status] || [u.status, ''];
  const img = u.file ? (/\.pdf$/.test(u.file) ? `<a class="btn ghost" href="/api/files/${esc(u.file)}" target="_blank">打開 PDF</a>` : `<a href="/api/files/${esc(u.file)}" target="_blank"><img class="photo" src="/api/files/${esc(u.file)}" alt="上傳的照片"></a>`) : '';
  let body = '';
  if (u.status === 'reading') body = `<div class="card ph"><b>辨識中…</b><span class="muted">約 10～40 秒；超過 3 分鐘還沒好可以按重試</span></div>${Date.now() - (u.at || 0) > 180000 ? '<p><button class="btn ghost" id="rt">重新辨識</button></p>' : ''}`;
  else if (u.status === 'failed') body = `<div class="card"><div class="err">${esc(u.msg || '辨識失敗')}</div></div><p><button class="btn" id="rt">重新辨識</button></p>`;
  else if (u.status === 'done' && u.kind === 'inv') body = invDone(u);
  else if (u.status === 'done') body = `<div class="card list">${u.billId ? `<div class="row"><span>已建立</span><span class="go">${esc(u.doneText || '')}</span></div>` : `<div class="row">${esc(u.doneText || '已入帳')}</div>`}${u.kind === 'po' && u.billId && store.get('bills', u.billId) ? `<a href="#po/v/${encodeURIComponent(u.billId)}"><span>打開採購單（傳真狀態、傳真這張）</span><span class="go">›</span></a>` : ''}</div>`;
  else body = u.kind === 'check' ? checkReview(u) : u.kind === 'inv' ? invReview(u) : docReview(u);
  view.innerHTML = `<div class="hd"><a class="back" href="#up">‹ 拍照上傳</a><span class="sp"></span><small class="${c}">${t}</small></div>
    <div class="hd" style="margin-top:0" data-rv="${esc(u.id)}" data-st="${esc(u.status)}"><h1>${esc(KN[u.kind])}</h1><span class="sub">${esc(hm(u.at))}</span></div>
    ${img}${body}
    ${u.status !== 'done' ? '<p><button class="btn ghost danger" id="del">刪除這筆上傳</button></p>' : ''}`;
  const $ = q => view.querySelector(q);
  $('#rt')?.addEventListener('click', () => { retry(u.id).catch(e => toast(e.message)); });
  $('#del')?.addEventListener('click', async () => { if (!window.confirm('刪除這筆上傳？（不會影響已經建立的單據）')) return; await store.remove('uploads', u.id); location.hash = '#up'; });
  if (u.status === 'review') u.kind === 'check' ? bindCheck(view, u) : u.kind === 'inv' ? bindInv(view, u) : bindDoc(view, u);
  if (u.status === 'done' && u.kind === 'inv') bindInvAtt(view, u);
}
const ACT = { pur: '確認入庫（建立進貨單）', po: '存成採購單', quote: '存成詢價單（廠商報價）', order: '轉成出貨單草稿' };
function docReview(u) {
  const R = u.result || {}; const partyKind = u.kind === 'order' ? 'C' : 'S'; const c = u.cid ? store.get('contacts', u.cid) : null;
  const lines = linesOf(u); const C = calc();
  const doc = { tax: !!(rv[u.id].tax), disc: 0, lines: lines.filter(l => l.on && l.gid).map(l => ({ qty: +l.qty || 0, price: +l.price || 0 })) }; const t = totals(doc);
  return `<div class="card list">
      <a href="#" id="pp"><span>${partyKind === 'C' ? '客戶' : '廠商'}</span><span class="go">${c ? `<b>${esc(cdisp(c))}</b>` : `<span class="bad">請選擇</span>`} ›</span></a>
      ${R.party ? `<div class="row src">單據上寫：${esc(R.party)}</div>` : ''}
      <div class="row"><span>單號</span><span class="go">${esc(R.doc_no || '—')}</span></div>${u.kind === 'po' && poDup(R.doc_no) ? `<div class="row bad">平台已經有採購單 ${esc(R.doc_no)}（${esc(cname(poDup(R.doc_no).cid))}），不用再建</div>` : ''}
      <div class="row"><span>日期</span><input type="date" id="rd" class="inl" value="${esc(rv[u.id].date || R.date || today())}"></div></div>
    ${R.doubts ? `<div class="note" style="text-align:left">${R._engine === 'local' ? '' : 'AI 提醒：'}${esc(R.doubts)}</div>` : ''}${R._engine === 'local' ? '' : R._local_why?.length ? `<div class="muted small" style="margin:4px 0">本機先讀過但不完整（${esc(R._local_why.slice(0, 2).join('；'))}），改用 AI 辨識</div>` : ''}
    <div class="sec">明細 <span class="muted">${lines.filter(l => l.on).length}／${lines.length} 項・對不到商品的請點「選商品」</span></div>
    <div id="rl">${lines.map((l, i) => { const g = l.gid ? C.g[l.gid] : null; return `<div class="card ln ${l.on ? '' : 'off'} ${l.on && (!g || !l.sure) ? 'warnbox' : ''}" data-i="${i}">
      <div class="lnh"><div class="gm"><small>單據：${esc(l.src)}</small><b>${g ? esc(g.name) : '<span class="bad">對不到商品</span>'}</b>${g ? '' : `<div style="margin:4px 0 0"><button class="chip" data-new="${i}">＋ 新建這個商品</button></div>`}<small>${g ? esc(g.code) : ''}${l.pnote ? '・單價：' + esc(l.pnote) : ''}</small>${g && !l.sure ? `<div class="err" style="margin:4px 0 0">AI 配對不確定：是這個商品嗎？ <button class="chip" data-yes="${i}">對，是這個</button> <button class="chip" data-new="${i}">＋ 新建商品</button></div>` : ''}</div><label class="check" style="margin:0"><input type="checkbox" data-on ${l.on ? 'checked' : ''}>要</label></div>
      <div class="lnr"><label>數量<input data-f="qty" inputmode="decimal" value="${esc(l.qty)}"></label><span class="u">${esc(l.u || g?.unit || l.unit || '')}</span><label>單價<input data-f="price" inputmode="decimal" value="${esc(l.price)}"></label><button class="chip" data-pick="${i}">${g ? '換商品' : '選商品'}</button></div></div>`; }).join('') || '<div class="card"><div class="row muted">沒有讀到明細</div></div>'}</div>
    <div class="card list">${u.kind === 'order' ? '' : `<label class="row"><span>加 5% 營業稅</span><span class="go"><input type="checkbox" id="rtx" ${rv[u.id].tax ? 'checked' : ''}> ${rv[u.id].tax ? fmt(t.tax) : ''}</span></label>`}<div class="row"><b>總計</b><span class="go"><b id="rtot">${fmt(t.total)}</b></span></div></div>
    <div id="rerr" class="err"></div>
    ${u.kind === 'po' ? `<div class="card list"><div class="row"><span>傳真號碼</span><span class="go">${c ? (c.fax ? `${esc(c.fax)}<small class="muted">　撥 ${esc(faxDial(c, c.fax))}${isTaichung(c) ? '（台中去掉 04）' : ''}</small>` : '<span class="bad">廠商資料沒有傳真</span>') : '—'}</span></div></div>
    <div class="acts"><button class="btn ghost" id="ok">只存採購單</button><button class="btn" id="okfax">存並傳真</button></div>` : `<p><button class="btn" id="ok">${ACT[u.kind]}</button></p>`}`;
}
function bindDoc(view, u) {
  const $ = q => view.querySelector(q); const st = rv[u.id]; const redraw = () => reviewPage(view, u.id);
  $('#pp').onclick = ev => { ev.preventDefault(); pickParty(u.kind === 'order' ? 'C' : 'S', async id => { delete rv[u.id]; await upd(u.id, { cid: id }); redraw(); }); };
  $('#rd').onchange = ev => { st.date = ev.target.value; };
  $('#rtx')?.addEventListener('change', ev => { st.tax = ev.target.checked; redraw(); });
  const rl = $('#rl');
  rl.addEventListener('input', ev => { const i = +ev.target.closest('[data-i]')?.dataset.i; const l = st.lines[i]; if (!l) return; if (ev.target.dataset.f) l[ev.target.dataset.f] = ev.target.value; const doc = { tax: !!st.tax, disc: 0, lines: st.lines.filter(x => x.on && x.gid).map(x => ({ qty: +x.qty || 0, price: +x.price || 0 })) }; $('#rtot').textContent = fmt(totals(doc).total); });
  rl.addEventListener('change', ev => { if (!ev.target.matches('[data-on]')) return; const i = +ev.target.closest('[data-i]').dataset.i; st.lines[i].on = ev.target.checked; redraw(); });
  rl.addEventListener('click', ev => { const y = ev.target.closest('[data-yes]'); if (y) { st.lines[+y.dataset.yes].sure = true; redraw(); return; } const nb = ev.target.closest('[data-new]'); if (nb) { newGoods(u, st.lines[+nb.dataset.new], redraw); return; } const b = ev.target.closest('[data-pick]'); if (!b) return; const l = st.lines[+b.dataset.pick]; pickGoods(l.src, gid => { l.gid = gid; l.sure = true; delete l.u; l.on = true; redraw(); }); });
  const fail = e => { $('#rerr').textContent = e.message; toast(e.message); view.querySelectorAll('#ok, #okfax').forEach(b => b.disabled = false); };
  $('#ok').onclick = () => commit(view, u).catch(fail);
  $('#okfax')?.addEventListener('click', () => commit(view, u, true).catch(fail));
}
/** 對不到商品：用單據上的品名新建（標準品名＋自動料號；認不出就照抄品名，料號在畫面上補），存好直接帶進這一行 */
function newGoods(u, l, redraw) {
  const s = stdGoods(l.nm || l.src) || stdGoods(l.src);
  const sup = u.kind !== 'order' && u.kind !== 'po';   // 廠商的單據：單據上的料號記成廠商料號
  const unit = /^(PCS|KG|包|組|H|批|箱)$/i.test(l.unit || '') ? l.unit.toUpperCase().replace(/^PCS$/, 'PCS') : 'PCS';
  const tpl = { name: s?.name || l.nm || l.src, code: s?.code || '', cat: s?.cat || '', unit, note: `手機拍照上傳新建（單據寫：${l.src}）` };
  if (sup && l.code) tpl.vcode = l.code;
  if (u.kind === 'po' || u.kind === 'pur') { const pr = +l.price; if (pr > 0) tpl.purPrice = pr; }
  editGoods('new', null, id => { l.gid = id; l.sure = true; l.on = true; delete l.u; redraw(); }, tpl);
}
async function commit(view, u, fax) {
  const st = rv[u.id]; const c = u.cid ? store.get('contacts', u.cid) : null; const R = u.result || {};
  if (!c) throw new Error(u.kind === 'order' ? '請選客戶' : '請選廠商');
  const ls2 = st.lines.filter(l => l.on);
  if (!ls2.length) throw new Error('沒有要入帳的明細');
  if (ls2.some(l => !l.gid)) throw new Error('有明細還沒對到商品：選商品，或取消勾選「要」');
  if (ls2.some(l => !l.sure)) throw new Error('有 AI 配對不確定的明細（黃框）：按「對，是這個」或「換商品」');
  if (ls2.some(l => !(+l.qty > 0)) && u.kind !== 'quote') throw new Error('數量要大於 0');
  if (u.kind === 'po' && poDup(R.doc_no)) throw new Error(`平台已經有採購單 ${R.doc_no}，不用再建`);
  if (fax && !c.fax) throw new Error('這家廠商的資料沒有傳真號碼，請先到電腦版廠商資料補上');
  if (fax && !window.confirm(`確定要傳真給 ${cname(c.id)}？\n傳真號碼：${faxDial(c, c.fax)}\n傳出去就收不回來。`)) return;
  const date = st.date || R.date || today();
  const lines = ls2.map(l => { const o = { gid: l.gid, qty: +l.qty || 0, price: +l.price || 0 }; if (l.u) o.u = l.u; return o; });
  const note = `手機拍照上傳${R.doc_no ? `：${c.short || c.name}單號 ${R.doc_no}` : ''}`;
  view.querySelectorAll('#ok, #okfax').forEach(b => b.disabled = true);
  if (u.kind === 'order') {
    const did = uid('d');
    await store.save('drafts', did, { cid: c.id, date: today(), tax: false, note, fmt: 'std', lines: lines.map(l => ({ ...l, ap: false })), by: store.user.name, uid: store.user.id, at: Date.now() });
    await upd(u.id, { status: 'done', draftId: did, doneText: `出貨單草稿（${lines.length} 項）` });
    toast('已轉成出貨單草稿，到「開單」確認送出'); location.hash = '#bill/drafts'; return;
  }
  const type = { pur: 'PUR', po: 'PO' }[u.kind] || 'RFQ'; const TN = { PUR: '進貨單', PO: '採購單', RFQ: '詢價單' }[type]; const no = nextNo(type, date); const id = uid('b');
  const doc = { type, no, date, note, createdAt: Date.now(), updatedAt: Date.now(), cid: c.id, lines, disc: 0, tax: !!st.tax, createdBy: store.user.id };
  if (type === 'PUR') { doc.wid = defWh()?.id || ''; doc.paid = 0; doc.aid = store.list('accounts')[0]?.id || ''; }
  await store.save('bills', id, doc);
  store.log('新增', `${TN} ${no}｜${cname(c.id)}｜${fmt(totals(doc).total)} 元（手機拍照）`);
  await upd(u.id, { status: 'done', billId: id, doneText: `${TN} ${no}・${fmt(totals(doc).total)} 元` });
  if (fax) await sendFax({ ...doc, id }).catch(x => toast('排入傳真失敗：' + x.message));
  delete rv[u.id]; toast(`已建立${type === 'PUR' ? '進貨單（庫存已增加）' : TN} ${no}${fax ? '，已排入傳真' : ''}`);
}
// ---------- 銷項發票（手寫本）：核對號碼、買受人、金額 → 登記；同一個客戶有待開的銷貨單可以一起沖 ----------
const num = v => Math.round(+toHalf(String(v ?? '')).replace(/[,\s]/g, '') || 0);
function invState(u) {
  if (rv[u.id] && rv[u.id].cid === u.cid) return rv[u.id];
  const R = u.result || {}; const c = u.cid ? store.get('contacts', u.cid) : null;
  let un = num(R.untaxed), tx = num(R.tax); const tot = num(R.total);
  if (!un && tot) { un = Math.round(tot / 1.05); tx = tot - un; } else if (un && !tx && tot > un) tx = tot - un;
  const groups = u.cid ? pendingGroups().filter(g => g.cid === u.cid && g.net > 0).sort((a, b) => b.ym.localeCompare(a.ym)).slice(0, 4) : [];
  const pick = groups.find(g => Math.abs(g.net - un) <= 1);   // 未稅金額一樣就預先勾
  return rv[u.id] = { cid: u.cid, no: String(R.no || '').replace(/[\s-]/g, '').toUpperCase(), date: R.date || today(), buyer: String(R.taxid || '').replace(/\D/g, '') || c?.taxId || '', untaxed: un, tax: tx, groups, on: new Set(pick ? [pick.key] : []) };
}
function invReview(u) {
  const R = u.result || {}; const st = invState(u); const c = u.cid ? store.get('contacts', u.cid) : null; const dup = st.no && store.get('invoices', st.no);
  return `<div class="card list">
      <div class="row"><span>發票號碼</span><input id="ino" class="inl" value="${esc(st.no)}" autocapitalize="characters" style="font-family:monospace"></div>${dup ? `<div class="row bad">發票 ${esc(st.no)} 已經登記過了（${esc(dup.name || '')}）</div>` : ''}
      <div class="row"><span>日期</span><input type="date" id="idt" class="inl" value="${esc(st.date)}"></div>
      <a href="#" id="pp"><span>買受人</span><span class="go">${c ? `<b>${esc(cdisp(c))}</b>` : `<span class="bad">請選客戶</span>`} ›</span></a>
      ${R.buyer ? `<div class="row src">發票上寫：${esc(R.buyer)}</div>` : ''}
      <div class="row"><span>統一編號</span><input id="ibu" class="inl" inputmode="numeric" maxlength="8" value="${esc(st.buyer)}"></div></div>
    ${R.doubts ? `<div class="note" style="text-align:left">AI 提醒：${esc(R.doubts)}</div>` : ''}
    <div class="sec">品名 <span class="muted">${(R.lines || []).length} 行</span></div>
    <div class="card list">${(R.lines || []).map(l => `<div class="row"><div class="gm"><b>${esc(l.name || '')}</b><small>${l.qty ? fmt(l.qty) : ''}${l.price ? ' × ' + fmt(l.price) : ''}</small></div><span class="go">${l.amount ? fmt(l.amount) : ''}</span></div>`).join('') || '<div class="row muted">沒有讀到品名</div>'}</div>
    <div class="card list" style="margin-top:10px">
      <div class="row"><span>銷售額</span><input id="iun" class="inl" inputmode="numeric" value="${esc(st.untaxed)}"></div>
      <div class="row"><span>稅額</span><input id="itx" class="inl" inputmode="numeric" value="${esc(st.tax)}"></div>
      <div class="row"><b>總計</b><span class="go"><b id="itot">${fmt(st.untaxed + st.tax)}</b></span></div></div>
    ${st.groups.length ? `<div class="sec">一起沖待開的銷貨單</div><div class="card list">${st.groups.map(g => `<label class="row"><div class="gm"><b>${esc(ymLabel(g.ym))}・${g.bills.length} 張</b><small>未稅 ${fmt(g.net)}・稅 ${fmt(g.tax)}${Math.abs(g.net - st.untaxed) <= 1 ? '・<span class="good">金額一樣</span>' : ''}</small></div><span class="go"><input type="checkbox" data-g="${esc(g.key)}" ${st.on.has(g.key) ? 'checked' : ''}></span></label>`).join('')}</div><div class="note" style="text-align:left">勾了，那些銷貨單就標上這張發票號碼，不會再出現在「待開」。</div>` : c ? '<div class="note" style="text-align:left">這個客戶沒有待開發票的銷貨單。</div>' : ''}
    <div id="rerr" class="err"></div>
    <p><button class="btn" id="ok">登記這張發票（手寫本）</button></p>`;
}
function bindInv(view, u) {
  const $ = q => view.querySelector(q); const st = rv[u.id]; const redraw = () => reviewPage(view, u.id);
  const keep = () => { st.no = $('#ino').value.replace(/[\s-]/g, '').toUpperCase(); st.date = $('#idt').value; st.buyer = $('#ibu').value.trim(); st.untaxed = num($('#iun').value); st.tax = num($('#itx').value); };
  $('#pp').onclick = ev => { ev.preventDefault(); keep(); pickParty('C', async id => { const c = store.get('contacts', id); const old = { ...st }; delete rv[u.id]; await upd(u.id, { cid: id }); const n = invState(store.get('uploads', u.id)); Object.assign(n, { no: old.no, date: old.date, untaxed: old.untaxed, tax: old.tax, buyer: old.buyer || c?.taxId || '' }); redraw(); }); };
  $('#ino').onchange = () => { keep(); redraw(); };
  $('#iun').onchange = () => { keep(); st.tax = Math.round(st.untaxed * 0.05); redraw(); };
  $('#itx').oninput = () => { keep(); $('#itot').textContent = fmt(st.untaxed + st.tax); };
  ['#idt', '#ibu'].forEach(q => $(q).onchange = keep);
  view.querySelectorAll('[data-g]').forEach(cb => cb.onchange = () => { cb.checked ? st.on.add(cb.dataset.g) : st.on.delete(cb.dataset.g); });
  $('#ok').onclick = async () => {
    keep(); const err = m => { $('#rerr').textContent = m; toast(m); };
    const c = u.cid ? store.get('contacts', u.cid) : null; const R = u.result || {};
    if (!/^[A-Z]{2}\d{8}$/.test(st.no)) return err('發票號碼格式：2 個英文字母＋8 碼數字');
    if (store.get('invoices', st.no)) return err(`發票 ${st.no} 已經登記過了`);
    if (!c && !R.buyer) return err('請選客戶');
    if (!(st.untaxed > 0)) return err('請填銷售額');
    if (st.buyer && !ubnOk(st.buyer) && !window.confirm(`統一編號 ${st.buyer} 檢查碼不符，仍要登記？`)) return;
    const gs = st.groups.filter(g => st.on.has(g.key)); const net = gs.reduce((a, g) => a + g.net, 0);
    if (gs.length && Math.abs(net - st.untaxed) > 1 && !window.confirm(`勾的銷貨單未稅 ${fmt(net)}，發票銷售額 ${fmt(st.untaxed)}，金額不一樣，仍要一起沖？`)) return;
    const out = { no: st.no, date: st.date || today(), buyer: st.buyer, name: c?.name || R.buyer || '', cid: c?.id || null, items: (R.lines || []).filter(l => l.name).map(l => ({ name: l.name, qty: +l.qty || null, price: +l.price || null, amount: +l.amount || 0 })), untaxed: st.untaxed, tax: st.tax, taxMode: 'ex', void: false, note: '手寫本發票', photo: u.file || '', upId: u.id, createdAt: Date.now(), createdBy: store.user.id };
    $('#ok').disabled = true;
    try { await saveHandInvoice(out, gs.flatMap(g => g.bills.map(b => b.id))); }
    catch (e) { $('#ok').disabled = false; return err('登記失敗：' + (e.message || e)); }
    await upd(u.id, { status: 'done', invNo: st.no, attAsk: true, doneText: `發票 ${st.no}・${fmt(st.untaxed + st.tax)} 元${gs.length ? `・沖銷貨單 ${gs.reduce((a, g) => a + g.bills.length, 0)} 張` : ''}` });
    delete rv[u.id]; toast(`發票 ${st.no} 已登記，要拍明細附件嗎？`); redraw();
  };
}
// 登記好以後：提醒要不要拍明細當附件（存在那張發票的「附件」，電腦版點進發票看得到）
function invDone(u) {
  const inv = u.invNo ? store.get('invoices', u.invNo) : null; const fs = inv?.files || [];
  return `<div class="card list"><div class="row">${esc(u.doneText || '已登記')}</div></div>
    ${inv ? `<div class="card ${fs.length ? '' : 'warnbox'}" style="margin-top:10px"><b>${fs.length ? `附件 ${fs.length} 個` : '要不要拍明細附件？'}</b>
      <div class="muted small" style="margin:4px 0 8px">手寫本發票通常有附明細，拍下來（或選 Excel、PDF）存在這張發票，以後到電腦版點進發票就查得到。</div>
      ${fs.map(f => `<div class="row" style="padding:4px 0"><a href="/api/files/${esc(f.id)}?n=${encodeURIComponent(f.name || f.id)}" target="_blank">${/\.(xlsx|xls|csv)$/i.test(f.id) ? '📊' : /\.pdf$/i.test(f.id) ? '📄' : '🖼'} ${esc(f.name || f.id)}</a></div>`).join('')}
      <div class="acts" style="margin-top:8px"><button class="btn" id="atc">📷 拍附件</button><button class="btn ghost" id="atl">相簿或檔案</button></div>
      ${!fs.length && u.attAsk ? '<p style="margin:8px 0 0"><button class="btn ghost" id="atno">不用附件</button></p>' : ''}</div>
      <input type="file" id="atfc" accept="image/*" capture="environment" hidden><input type="file" id="atfl" accept=".xlsx,.xls,.csv,.pdf,image/*" multiple hidden>` : ''}
    <div class="note" style="text-align:left">電腦版「發票作業 › 銷項發票」最下面的「手寫本發票」看得到。</div>`;
}
function bindInvAtt(view, u) {
  const $ = q => view.querySelector(q); if (!$('#atc')) return;
  const go = inp => async () => {
    const list = [...inp.files]; inp.value = ''; if (!list.length) return; let n = 0;
    for (const f of list) {
      try {
        const img = /^image\//.test(f.type); const body = img ? await (await fetch(await shrink(f, 2400, 0.85))).blob() : f;
        const name = img ? `明細${(store.get('invoices', u.invNo)?.files || []).length + 1}.jpg` : f.name;
        toast(`上傳 ${name}…`);
        const r = await fetch('/api/files?name=' + encodeURIComponent(name), { method: 'POST', body, credentials: 'same-origin' }).then(x => x.json());
        if (!r.ok) throw new Error(r.error || '上傳失敗');
        const inv = store.get('invoices', u.invNo); if (!inv) throw new Error('找不到這張發票');
        await store.save('invoices', inv.no, { ...inv, files: [...(inv.files || []), { id: r.id, name, at: today(), size: r.size }] }); n++;
      } catch (e) { toast(`${f.name}：${e.message || e}`); }
    }
    await upd(u.id, { attAsk: false }); if (n) toast(`已加 ${n} 個附件`); reviewPage(view, u.id);
  };
  const fc = $('#atfc'), fl = $('#atfl'); $('#atc').onclick = () => fc.click(); $('#atl').onclick = () => fl.click();
  fc.onchange = go(fc); fl.onchange = go(fl);
  $('#atno')?.addEventListener('click', async () => { await upd(u.id, { attAsk: false }); reviewPage(view, u.id); });
}
function checkReview(u) {
  const list = (u.result?.checks || []).map(preOf); const done = new Set(u.doneChecks || []);
  return `<div class="sec">辨識到 ${list.length} 張支票</div><div class="card list">${list.map((p, i) => `<div class="row"><div class="gm"><b>${esc(p.name || '（發票人？）')}</b><small>${esc(p.bank || '')}・${esc(p.no || '')}・到期 ${esc(p.due || '?')}</small></div><span class="go">${p.amt ? fmt(p.amt) : '?'} ${done.has(i) ? '<small class="good">已登記</small>' : `${findDupCheck(p) ? '<small class="bad">已登記過？</small> ' : ''}<button class="chip" data-ck="${i}">核對登記</button>`}</span></div>`).join('')}</div>
    <div class="note" style="text-align:left">每一張都要打開核對後才會登記成客票；全部登記完這筆就變「已入帳」。</div>`;
}
function bindCheck(view, u) {
  const list = (u.result?.checks || []).map(preOf);
  view.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => { const i = +b.dataset.ck; checkForm(list[i], i, list.length, async () => {
    const done = [...new Set([...(store.get('uploads', u.id)?.doneChecks || []), i])];
    await upd(u.id, done.length >= list.length ? { doneChecks: done, status: 'done', doneText: `已登記 ${list.length} 張客票` } : { doneChecks: done });
    reviewPage(view, u.id);
  }, () => {}); });
}

// ---------- 選客戶／廠商、選商品 ----------
function sheet(title, body) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>取消</button><b>${title}</b><span style="width:40px"></span></div>${body}`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); };
  el.querySelector('[data-x]').onclick = close; return { el, close };
}
function pickParty(kind, onPick) {
  const { el, close } = sheet(kind === 'C' ? '選客戶' : '選廠商', '<div class="search"><input type="search" id="pq" placeholder="名稱、代號" autocomplete="off"></div><div class="card list" id="plist"></div>');
  const all = (kind === 'C' ? customers() : suppliers()).map(c => ({ c, t: [c.code, c.name, c.short, ...(c.aliases || [])].filter(Boolean).join(' ').toLowerCase() }));
  const draw = v => { const q = v.trim().toLowerCase(); el.querySelector('#plist').innerHTML = all.filter(x => !q || q.split(/\s+/).every(w => x.t.includes(w))).slice(0, 60).map(x => `<a href="#" data-id="${x.c.id}"><span class="mono muted">${esc(x.c.code)}</span>${esc(cdisp(x.c))}</a>`).join('') || '<div class="row muted">找不到</div>'; };
  el.querySelector('#pq').addEventListener('input', ev => draw(ev.target.value)); draw('');
  el.querySelector('#plist').addEventListener('click', ev => { const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault(); close(); onPick(a.dataset.id); });
  setTimeout(() => el.querySelector('#pq').focus(), 50);
}
function pickGoods(hint, onPick) {
  const { el, close } = sheet('選商品', `<div class="note" style="text-align:left;margin:0 0 8px">單據上寫：${esc(hint)}</div><div class="search"><input type="search" id="gq" placeholder="規格或品名" autocomplete="off" autocorrect="off" autocapitalize="off"></div><div class="card list" id="gl"></div>`);
  const C = calc();
  const draw = v => { el.querySelector('#gl').innerHTML = search(v, '').slice(0, 50).map(g => `<a href="#" data-id="${g.id}"><div class="gm"><b>${esc(g.name)}</b><small>${esc(g.code)}・庫存 ${C.stock[g.id] ? fmtQ(Object.values(C.stock[g.id]).reduce((a, b) => a + b, 0)) : '—'}</small></div></a>`).join('') || `<div class="row muted">${v.trim() ? '找不到' : '輸入規格或品名'}</div>`; };
  let tm = 0; const q = el.querySelector('#gq'); q.addEventListener('input', ev => { clearTimeout(tm); tm = setTimeout(() => draw(ev.target.value), 150); });
  const m = String(hint).match(/[MW#]?\d[\d./*#xX×-]*/); q.value = m ? m[0] : ''; draw(q.value);
  el.querySelector('#gl').addEventListener('click', ev => { const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault(); close(); onPick(a.dataset.id); });
}
export const uploadsWaiting = () => store.list('uploads').filter(u => u.status === 'review').length;
