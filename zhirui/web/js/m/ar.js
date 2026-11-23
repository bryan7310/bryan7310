// 手機版：應收帳款。未收總額（跟電腦版「應收帳款 › 未收款」同一份資料）、各客戶金額與帳齡、待兌現支票；記錄收款沖帳、拍支票登記。
import { esc, fmt, money, today, thisMonth, shiftMonth, ymLabel, slash, daysLeft, uid, toHalf } from '../core/util.js';
import { api, aiOcr } from '../core/api.js';
import { store } from '../core/store.js';
import { cdisp } from '../core/calc.js';
import { arSummary, allOpen, isLate, saveRow, arMatchCheck, custYear } from '../modules/receivables.js';
import { preOf, findDupCheck, dupText } from '../modules/checks_in.js';
import { pickCustomer } from './stock.js';

const ui = { f: 'all' };
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); };
/** 到期日：有填就用；沒填照電腦版的逾期規則（月份＋2 個月的 15 日） */
const dueOf = r => r.due || shiftMonth(r.ym, 2) + '-15';
const ageTxt = r => { const d = daysLeft(dueOf(r)); return isLate(r) ? `逾期 ${-d} 天` : d === 0 ? '今天到期' : `${d} 天後到期`; };
const keyOf = r => r.cid || 'n:' + r.name;
function groups() {
  arSummary();   // 確保舊系統銷貨單已載入（跟電腦版同一份）
  const m = thisMonth(); const map = new Map();
  for (const r of allOpen()) {
    const k = keyOf(r); const g = map.get(k) || map.set(k, { k, cid: r.cid, name: r.name, rows: [], total: 0, late: 0, lateAmt: 0, thisM: 0, worst: null }).get(k);
    g.rows.push(r); g.total += r.total;
    if (isLate(r)) { g.late++; g.lateAmt += r.total; } else if (dueOf(r).startsWith(m)) g.thisM += r.total;
    if (!g.worst || dueOf(r) < dueOf(g.worst)) g.worst = r;
  }
  return [...map.values()].sort((a, b) => b.lateAmt - a.lateAmt || b.total - a.total);
}
export function arPage(view, sub, arg) {
  if (sub === 'c') return custPage(view, decodeURIComponent(arg || ''));
  if (sub === 'y') { const [k, y] = String(arg || '').split('/'); return yearPage(view, decodeURIComponent(k || ''), y); }
  const s = arSummary(); const gs = groups();
  const lateAmt = gs.reduce((t, g) => t + g.lateAmt, 0), thisAmt = gs.reduce((t, g) => t + g.thisM, 0);
  const list = gs.filter(g => ui.f === 'all' || (ui.f === 'late' ? g.late : g.thisM > 0));
  const cin = store.list('checks_in').filter(c => !c.col).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const t = today();
  view.innerHTML = `<div class="hd"><h1>應收帳款</h1><span class="sp"></span><a class="chip" href="#rep">報表</a></div>
    <div class="kpis">
      <div class="card kpi"><span>未收總額</span><b>${money(s.open)}</b><small>${gs.length} 家・${s.openN} 筆</small></div>
      <div class="card kpi ${lateAmt ? 'alert' : ''}"><span>逾期</span><b>${money(lateAmt)}</b><small>${gs.filter(g => g.late).length} 家・${s.late} 筆</small></div>
    </div>
    <div class="chips" style="margin-top:12px">${[['all', '全部'], ['late', '逾期'], ['month', '本月到期']].map(([k, n]) => `<button class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
    ${ui.f === 'month' ? `<div class="note" style="margin:-4px 0 8px;text-align:left">本月到期（還沒逾期）共 ${money(thisAmt)}</div>` : ''}
    <div class="card list">${list.map(g => `<a href="#ar/y/${encodeURIComponent(g.k)}/${thisMonth().slice(0, 4)}"><div class="gm"><b>${esc(g.name)}</b><small class="${g.late ? 'bad' : ''}">${esc(ageTxt(g.worst))}・${g.rows.length} 個月</small></div><span class="go"><b>${money(ui.f === 'late' ? g.lateAmt : ui.f === 'month' ? g.thisM : g.total)}</b> ›</span></a>`).join('') || `<div class="row muted">${ui.f === 'all' ? '全部都收齊了 ✓' : '沒有'}</div>`}</div>
    <div class="sec">待兌現支票 <span class="muted">${cin.length} 張・${money(cin.reduce((a, c) => a + (+c.amt || 0), 0))}</span></div>
    <button class="btn ghost" id="snap" style="margin-bottom:8px">拍支票登記</button>
    <div class="card list">${cin.slice(0, 40).map(c => `<div class="row"><div class="gm"><b>${esc(c.cid ? cdisp(store.get('contacts', c.cid)) || c.name : c.name)}</b><small class="${c.due && c.due < t ? 'bad' : ''}">${esc(slash(c.due))}${c.due && c.due < t ? '・已到期還沒送代收' : ''}・${esc(c.bank || '')}</small></div><span class="go">${money(c.amt)}</span></div>`).join('') || '<div class="row muted">沒有待兌現的支票</div>'}${cin.length > 40 ? `<div class="row muted">還有 ${cin.length - 40} 張，請用電腦版看</div>` : ''}</div>
    <input type="file" id="ckf" accept="image/*" capture="environment" hidden>`;
  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { ui.f = b.dataset.f; arPage(view); });
  const f = view.querySelector('#ckf');
  view.querySelector('#snap').onclick = () => f.click();
  f.onchange = () => { const file = f.files[0]; f.value = ''; if (file) snapCheck(file, () => arPage(view)); };
}

// ---------- 單一客戶：各月未收、收款沖帳 ----------
function custPage(view, k) {
  const g = groups().find(x => x.k === k);
  const yl = `#ar/y/${encodeURIComponent(k)}/${thisMonth().slice(0, 4)}`;
  if (!g) { view.innerHTML = `<div class="hd"><a class="back" href="#ar">‹ 應收帳款</a></div><div class="card ph"><b>這家已經收齊了 ✓</b></div><p><a class="btn ghost" href="${yl}" style="display:block;text-align:center;text-decoration:none">📅 看整年明細</a></p>`; return; }
  const c = g.cid ? store.get('contacts', g.cid) : null;
  const rows = g.rows.slice().sort((a, b) => a.ym.localeCompare(b.ym));
  view.innerHTML = `<div class="hd"><a class="back" href="#ar">‹ 應收帳款</a></div>
    <div class="card"><a class="gname" href="${yl}" style="display:block;color:inherit;text-decoration:none">${esc(c?.name || g.name)} <span class="muted" style="font-size:14px;font-weight:500">整年明細 ›</span></a><div class="muted">未收 <b>${money(g.total)}</b>・${rows.length} 個月${c?.payMethod ? '・付款方式 ' + esc(c.payMethod) : ''}${c?.phone ? `・<a href="tel:${esc(String(c.phone).replace(/[^\d#*+]/g, ''))}">${esc(c.phone)}</a>` : ''}</div></div>
    <div class="sec">各月未收（25 結）</div>
    ${rows.map((r, i) => `<div class="card arr"><div class="lnh"><div class="gm"><b>${esc(ymLabel(r.ym))}</b><small class="${isLate(r) ? 'bad' : ''}">到期 ${esc(slash(dueOf(r)))}・${esc(ageTxt(r))}${r.manual ? '・手調' : ''}</small><small>貨款 ${money(r.amt)}・稅 ${money(r.tax)}${r.note ? '・' + esc(r.note) : ''}</small></div><b class="amt2">${money(r.total)}</b></div>
      <button class="btn ghost" data-pay="${i}">收款沖帳</button></div>`).join('')}
    ${rows.length > 1 ? `<p><button class="btn" id="payall">全部收齊（${money(g.total)}）</button></p>` : ''}`;
  view.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => payForm(rows[+b.dataset.pay], c, () => custPage(view, k)));
  view.querySelector('#payall')?.addEventListener('click', () => payAll(rows, c, () => custPage(view, k)));
}
// ---------- 單一客戶：整年明細（跟電腦版「應收帳款 › 年度彙總」點客戶看到的一樣；只看，收款沖帳回上一頁） ----------
function yearPage(view, k, y) {
  y = /^\d{4}$/.test(y || '') ? y : thisMonth().slice(0, 4); arSummary();
  const rows = custYear(k, y).sort((a, b) => a.ym.localeCompare(b.ym)); const cid = k.startsWith('n:') ? '' : k;
  const c = cid ? store.get('contacts', cid) : null; const name = c?.name || rows[0]?.name || k.replace(/^n:/, '');
  const sum = f => rows.reduce((s, r) => s + (f(r) || 0), 0); const open = sum(r => r.rec ? 0 : r.total);
  const go = d => `#ar/y/${encodeURIComponent(k)}/${+y + d}`;
  view.innerHTML = `<div class="hd"><a class="back" href="#ar">‹ 應收帳款</a></div>
    <div class="card"><div class="gname">${esc(name)}</div><div style="display:flex;gap:8px;align-items:center;margin-top:8px"><a class="chip" style="flex:none" href="${go(-1)}">‹ ${+y - 1912} 年</a><b style="flex:1;text-align:center;font-size:16px">${+y - 1911} 年・${rows.length} 筆</b><a class="chip" style="flex:none" href="${go(1)}">${+y - 1910} 年 ›</a></div></div>
    <div class="kpis"><div class="card kpi"><span>全年總額</span><b>${money(sum(r => r.total))}</b><small>貨款 ${money(sum(r => r.amt))}・稅 ${money(sum(r => r.tax))}</small></div><div class="card kpi ${open ? 'alert' : ''}"><span>未收</span><b>${money(open)}</b><small>已收 ${money(sum(r => r.rec ? (r.recAmt ?? r.total) : 0))}</small></div></div>
    <div class="sec">各月（25 結）</div>
    <div class="card list">${rows.map(r => `<div class="row"><div class="gm"><b>${+r.ym.slice(5)} 月${r.manual ? ' <span class="tag">手調</span>' : ''}${!r.rec && isLate(r) ? ' <span class="tag bad">逾期</span>' : ''}</b><small>貨款 ${money(r.amt)}・稅 ${r.tax ? money(r.tax) : '—'}</small>${r.rec ? `<small>已收 ${money(r.recAmt ?? r.total)}${r.method ? '・' + esc(r.method) : ''}${r.recDate ? '・' + esc(slash(r.recDate)) : ''}</small>` : ''}${r.note ? `<small>${esc(r.note)}</small>` : ''}</div><span class="go" style="text-align:right"><b>${money(r.total)}</b><br><small class="${r.rec ? 'good' : 'bad'}">${r.rec ? '已收' : '未收'}</small></span></div>`).join('') || `<div class="row muted">${+y - 1911} 年沒有應收帳款</div>`}</div>
    ${open ? `<p><a class="btn" href="#ar/c/${encodeURIComponent(k)}" style="display:block;text-align:center;text-decoration:none">收款沖帳 ›</a></p>` : ''}`;
  window.scrollTo(0, 0);
}
const METHODS = ['匯款', '支票', '現金', '扣趴'];
function sheet(title, body) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>取消</button><b>${title}</b><span style="width:40px"></span></div>${body}`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); };
  el.querySelector('[data-x]').onclick = close;
  return { el, close };
}
function payForm(r, c, done, pre) {   // pre：由支票帶入 { amt, date, msg, note, chk }
  const { el, close } = sheet('收款沖帳', `${pre ? `<div class="note" style="text-align:left;margin:0 0 8px">由剛登記的支票帶入，請確認後按「確認收款」。${pre.msg}</div>` : ''}<div class="card"><b>${esc(r.name)}</b>　${esc(ymLabel(r.ym))}<div class="muted">應收 ${money(r.total)}</div></div>
    <div class="card" style="margin-top:10px">
      <div class="f"><label for="pa">實收金額</label><input id="pa" inputmode="numeric" value="${Math.round(pre ? pre.amt : r.total)}"></div>
      <div class="f"><label for="pd">收款日</label><input id="pd" type="date" value="${pre?.date || today()}"></div>
      <div class="f"><label>付款方式</label><div class="chips" id="pm">${METHODS.map(m => `<button type="button" class="chip ${m === (pre ? '支票' : r.method || c?.payMethod || '匯款') ? 'on' : ''}" data-m="${m}">${m}</button>`).join('')}</div></div>
      <div class="note" style="text-align:left">實收和應收不同（例如扣匯費）也可以照實填，電腦版會顯示實收金額。</div></div>
    <p><button class="btn" id="ok">確認收款</button></p>`);
  let method = el.querySelector('#pm .on')?.dataset.m || '匯款';
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { method = b.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); });
  el.querySelector('#ok').onclick = async () => {
    const amt = Math.round(+toHalf(el.querySelector('#pa').value).replace(/[,\s]/g, ''));
    if (!(amt > 0)) { toast('請填實收金額'); return; }
    const extra = pre ? { note: pre.note, chks: [...new Set([...((r.id && store.get('receivables', r.id)?.chks) || []), pre.chk])] } : {};   // 記下用哪張支票沖的
    try { await saveRow(r, { rec: true, recAmt: amt, recDate: el.querySelector('#pd').value || today(), amt: r.amt, tax: r.tax, manual: !!r.manual, method, ...extra }); }
    catch (e) { toast('儲存失敗：' + e.message); return; }
    store.log('收款', `${r.name} ${ymLabel(r.ym)} 實收 ${money(amt)}（${method}，手機）`);
    close(); toast(`${r.name} ${ymLabel(r.ym)} 已收款 ${money(amt)}`); done();
  };
}
function payAll(rows, c, done) {
  const tot = rows.reduce((s, r) => s + r.total, 0);
  const { el, close } = sheet('全部收齊', `<div class="card"><b>${esc(rows[0].name)}</b><div class="muted">${rows.length} 個月・合計 ${money(tot)}；每個月都記成照應收金額收齊</div></div>
    <div class="card" style="margin-top:10px"><div class="f"><label for="pd">收款日</label><input id="pd" type="date" value="${today()}"></div>
    <div class="f"><label>付款方式</label><div class="chips" id="pm">${METHODS.map(m => `<button type="button" class="chip ${m === (c?.payMethod || '匯款') ? 'on' : ''}" data-m="${m}">${m}</button>`).join('')}</div></div></div>
    <p><button class="btn" id="ok">確認全部收齊</button></p>`);
  let method = el.querySelector('#pm .on')?.dataset.m || '匯款';
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { method = b.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); });
  el.querySelector('#ok').onclick = async () => {
    const d = el.querySelector('#pd').value || today();
    try { for (const r of rows) await saveRow(r, { rec: true, recAmt: Math.round(r.total), recDate: d, amt: r.amt, tax: r.tax, manual: !!r.manual, method }); }
    catch (e) { toast('儲存失敗：' + e.message); return; }
    store.log('收款', `${rows[0].name} ${rows.length} 個月全部收齊 ${money(tot)}（${method}，手機）`);
    close(); toast(`${rows[0].name} 已全部收齊 ${money(tot)}`); done();
  };
}

// ---------- 拍支票：AI 辨識 → 逐張核對 → 登記客票（跟電腦版「客票」同一份） ----------
export const shrink = (file, max = 1800, q = 0.85) => new Promise((ok, bad) => { const u = URL.createObjectURL(file); const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(u); ok(cv.toDataURL('image/jpeg', q)); }; img.onerror = () => { URL.revokeObjectURL(u); bad(new Error('讀不到這張照片')); }; img.src = u; });
async function snapCheck(file, done) {
  const w = sheet('拍支票', '<div class="card ph"><b>辨識中…</b><span class="muted">約 10～30 秒</span></div>');
  let list;
  try { const r = await aiOcr('/api/ocr/check', { image: await shrink(file) }); list = (Array.isArray(r.checks) && r.checks.length ? r.checks : [r.fields || {}]).map(preOf); }
  catch (e) { w.close(); toast(e.message || '辨識失敗'); return; }
  w.close();
  const next = i => { if (i >= list.length) { toast(`${list.length} 張支票都登記好了`); done(); return; } checkForm(list[i], i, list.length, () => next(i + 1), done); };
  next(0);
}
export function checkForm(p, i, n, onSaved, onCancel) {
  let cid = p.cid || '';
  const { el, close } = sheet(n > 1 ? `第 ${i + 1}／${n} 張` : '登記支票', `<div class="note" style="text-align:left;margin:0 0 8px">已由照片辨識帶入，請逐欄核對${p._ocr?.matched ? '' : p._ocr?.drawer ? `；發票人「${esc(p._ocr.drawer)}」對不到客戶，請選客戶` : ''}${p._ocr?.notes ? `；AI 提醒：${esc(p._ocr.notes)}` : ''}</div>
    <div class="note" id="cdup" style="text-align:left;margin:0 0 8px;display:none;color:var(--bad);font-weight:600"></div>
    <div class="card">
      <div class="f"><label>客戶</label><button type="button" class="chip" id="cc">${cid ? esc(cdisp(store.get('contacts', cid))) : '選客戶'}</button></div>
      <div class="f"><label for="cn">發票人（名稱）</label><input id="cn" value="${esc(p.name || '')}"></div>
      <div class="f2"><div class="f"><label for="ca">金額</label><input id="ca" inputmode="numeric" value="${esc(p.amt)}"></div><div class="f"><label for="cd">到期日</label><input id="cd" type="date" value="${esc(p.due || '')}"></div></div>
      <div class="f"><label for="cb">付款銀行</label><input id="cb" value="${esc(p.bank || '')}"></div>
      <div class="f2"><div class="f"><label for="cno">票號</label><input id="cno" value="${esc(p.no || '')}"></div><div class="f"><label for="cac">帳號</label><input id="cac" inputmode="numeric" value="${esc(p.acct || '')}"></div></div>
      <div class="f"><label for="cr">收到日</label><input id="cr" type="date" value="${today()}"></div>
      <div class="f"><label for="cnote">備註</label><input id="cnote" value=""></div></div>
    <p><button class="btn" id="ok">登記這張支票</button></p>`);
  el.querySelector('[data-x]').onclick = () => { close(); onCancel(); };
  // 防呆：同一張支票已經登記過就提醒
  const cur = () => { const v = id => el.querySelector(id).value.trim(); return { no: v('#cno'), acct: v('#cac'), name: v('#cn'), amt: Math.round(+toHalf(v('#ca')).replace(/[,\s]/g, '')), due: v('#cd') }; };
  const dupWarn = () => { const x = findDupCheck(cur()); const b = el.querySelector('#cdup'); b.style.display = x ? '' : 'none'; b.textContent = x ? '⚠ 這張支票已經登記過：' + dupText(x) : ''; return x; };
  ['#cno', '#cac', '#ca', '#cd', '#cn'].forEach(id => el.querySelector(id).addEventListener('change', dupWarn));
  dupWarn();
  el.querySelector('#cc').onclick = () => pickCustomer(() => {}, id => { cid = id; const c = id ? store.get('contacts', id) : null; el.querySelector('#cc').textContent = c ? cdisp(c) : '選客戶'; if (c && !el.querySelector('#cn').value.trim()) el.querySelector('#cn').value = c.short || c.name; });
  el.querySelector('#ok').onclick = async () => {
    const v = id => el.querySelector(id).value.trim();
    const amt = Math.round(+toHalf(v('#ca')).replace(/[,\s]/g, ''));
    if (!(amt > 0)) { toast('請填金額'); return; }
    if (!v('#cd')) { toast('請填到期日'); return; }
    const c = cid ? store.get('contacts', cid) : null; const name = v('#cn') || (c ? c.short || c.name : '');
    if (!name) { toast('請選客戶或填發票人'); return; }
    const doc = { name, bank: v('#cb'), no: toHalf(v('#cno')).toUpperCase(), acct: v('#cac'), due: v('#cd'), amt, note: v('#cnote'), recv: v('#cr') || today() };
    if (cid) doc.cid = cid;
    const dup = findDupCheck(doc);
    if (dup && !window.confirm(`這張支票已經登記過（${dupText(dup)}），確定還要再登記一次嗎？`)) return;
    const ckId = uid('ci');
    try { await store.save('checks_in', ckId, doc); } catch (e) { toast('登記失敗：' + e.message); return; }
    store.log('新增', `客票 ${name} ${money(amt)}（到期 ${doc.due}，手機拍照）`);
    close(); toast(`已登記 ${name} ${money(amt)}`); onSaved();
    // 接著打開對應月份的收款沖帳，帶入支票金額、收到日（沒有客戶或沒有未收就只提示）
    const m = arMatchCheck({ ...doc, id: ckId });
    if (m.err) { if (cid) setTimeout(() => toast(m.err), 1500); return; }
    payForm(m.r, c, () => {}, { amt, date: doc.recv, chk: ckId, note: m.note, msg: esc(m.why) + (m.others ? `　其他未收：${esc(m.others)}` : '') });
  };
}
