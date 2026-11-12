// 手機版：標籤列印（佳博 GP-1324D，50×40 mm，203 dpi ≈ 400×320 點）。
// 手機把標籤畫成黑白點陣圖（畫面預覽＝印出來的樣子）→ 組成 TSPL 指令 → 交給主機列印小幫手直接送到標籤機。
// 四行：品名（開頭連續中文，最多 10 字（老闆決定從規格書的 8 字放寬））／規格＋表面處理／數量 PCS（H×100）／日期；右下角料號 QR 碼。
// 拆字拆不準的（開頭不是中文、中文中間夾數字英文…）不自己猜：列在「拆字檢查」給老闆確認，確認後的文字存在設定 lblfix。
import { esc, today, uid, ls, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, unitFactor } from '../core/calc.js';
import { qrMatrix, scanQR } from '../core/qr.js';
import { search, findByCode } from './stock.js';

const W = 400, H = 320;   // 50×40 mm @ 203 dpi
const KEY = 'zr.m.lbl';
const NMAX = 10;   // 品名最多幾個字（第 1 行字會自動縮小）
const PRINTER_DEF = 'Gprinter GP-1324D';
const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff';
const RE_LEAD = new RegExp(`^[${CJK}]+`), RE_CJK = new RegExp(`[${CJK}]`);
const FINS = ['三價白鋅', '三價黑鋅', '三價鋅', '鍍錏黑', '錏黑', '鍍鋅', '染黑', '五彩', '黑鎳', '鍍鎳', '鍍鉻', '紅古銅', '青古銅', '古銅', '磷酸', '達克羅', '黑身', '白皮', '原色', '洗油', '耐落', '防鬆'];
const toast = msg => { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); };
const fixes = () => store.setting('lblfix').fix || {};
const cfg = () => ({ printer: PRINTER_DEF, mode: 'tspl', invert: false, dir: 1, dx: 0, dy: 0, qr: true, gap: 2, ...store.setting('mlabel') });

/** 品名 → 標籤文字；ok=false 表示拆不準、要人確認（why 說原因） */
export function lblParse(g) {
  // 開頭的 ⊕、Θ 等符號先去掉（跟網頁版如陽標籤一樣），CAP 改成「有頭」，再照規則拆
  const raw = String(g?.name || '').trim().replace(/^[^\p{L}\p{N}]+/u, '').trim().replace(/^CAP\s*/i, '有頭');   // CAP 開頭改成「有頭」
  const f = fixes()[g?.id];
  const tok = raw.split(/\s+/)[0] || ''; const lead = (tok.match(RE_LEAD) || [''])[0]; const rest = tok.slice(lead.length);
  let others = raw.slice(tok.length); const fin = [];
  for (const w of FINS) if (others.includes(w)) { fin.push(w); others = others.replace(w, ' '); }
  const auto = { name: lead.slice(0, NMAX), spec: rest, fin: fin.join(' ') };
  if (f) return { ...auto, name: f.n ?? auto.name, spec: f.s ?? auto.spec, fin: f.f ?? auto.fin, ok: true, fixed: true };
  let why = '';
  if (!raw) why = '沒有品名';
  else if (!lead) why = '品名開頭不是中文';
  else if (!rest) why = '品名後面沒有規格';
  else if (RE_CJK.test(rest)) why = '中文中間夾數字或英文';
  else if (lead.length > NMAX) why = `品名 ${lead.length} 個字，超過 ${NMAX} 字`;
  return { ...auto, ok: !why, why };
}
/** 數量文字：H＝100 支、千＝1000、萬支＝10000，一律換成 PCS 加千分位；公斤照寫 */
export function qtyText(q, unit) {
  q = +q || 0; const u = String(unit || '').trim();
  if (/萬/.test(u)) return (q * 10000).toLocaleString('en-US') + ' PCS';
  const [cls, k] = unitFactor(u);
  if (cls === 'p') return Math.round(q * k * 1000) / 1000 === Math.round(q * k) ? Math.round(q * k).toLocaleString('en-US') + ' PCS' : (q * k).toLocaleString('en-US') + ' PCS';
  return q.toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' ' + (cls === 'kg' ? 'KG' : u);
}

// ---------- 畫標籤（400×320，純黑白） ----------
const FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei","Heiti TC",sans-serif';
function fitText(cx, text, maxW, px, bold, min = 18) {
  for (; px > min; px -= 2) { cx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`; if (cx.measureText(text).width <= maxW) break; }
  return px;
}
export async function drawLabel(cv, it, opt = {}) {
  const c = { ...cfg(), ...opt }; cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.fillStyle = '#000'; cx.textBaseline = 'alphabetic';
  const P = 14; const full = W - P * 2;
  let qrW = 0;
  if (c.qr && it.code) {
    const m = await qrMatrix(it.code, 'M'); const n = m.length; const s = Math.max(2, Math.floor(104 / n)); qrW = n * s;
    const x0 = W - P - qrW, y0 = H - P - qrW;
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (m[r][k]) cx.fillRect(x0 + k * s, y0 + r * s, s, s);
  }
  const half = full - (qrW ? qrW + 12 : 0);
  let px = fitText(cx, it.name, full, 54, true); cx.fillText(it.name, P, P + px * 0.92);
  const l2 = [it.spec, it.fin].filter(Boolean).join('　');
  px = fitText(cx, l2, full, 42, false); cx.fillText(l2, P, 128);
  px = fitText(cx, it.qty, half, 46, true); cx.fillText(it.qty, P, 212);
  px = fitText(cx, it.date, half, 32, false); cx.fillText(it.date, P, H - P - 8);
  // 轉純黑白（熱感印表機沒有灰階）
  const img = cx.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 140 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  cx.putImageData(img, 0, 0);
  return cv;
}
/** 點陣圖 → TSPL BITMAP 資料（每列 50 bytes，高位元在左；預設 0＝黑點） */
function bitmapBytes(cv, invert, dx, dy) {
  const d = cv.getContext('2d').getImageData(0, 0, W, H).data; const wb = W / 8; const out = new Uint8Array(wb * H);
  for (let y = 0; y < H; y++) for (let xb = 0; xb < wb; xb++) {
    let b = 0;
    for (let bit = 0; bit < 8; bit++) {
      const sx = xb * 8 + bit - dx, sy = y - dy; const black = sx >= 0 && sx < W && sy >= 0 && sy < H && d[(sy * W + sx) * 4] < 128;
      if (invert ? black : !black) b |= 0x80 >> bit;
    }
    out[y * wb + xb] = b;
  }
  return out;
}
const enc = s => new TextEncoder().encode(s);
function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export function tspl(labels, c) {
  const head = `SIZE 50 mm,40 mm\r\nGAP ${+c.gap || 0} mm,0 mm\r\nDIRECTION ${c.dir ? 1 : 0}\r\nREFERENCE 0,0\r\nDENSITY 8\r\nSPEED 4\r\nSET TEAR ON\r\n`;
  const parts = [enc(head)];
  for (const { cv, copies } of labels) parts.push(enc('CLS\r\nBITMAP 0,0,50,320,0,'), bitmapBytes(cv, !!c.invert, +c.dx || 0, +c.dy || 0), enc(`\r\nPRINT 1,${Math.max(1, Math.round(copies) || 1)}\r\n`));
  return concat(parts);
}

// ---------- 標籤清單（記在手機上） ----------
let st = null;
const load = () => { if (!st) { const x = ls.get(KEY, null); st = x && Array.isArray(x.items) ? x : { items: [], date: '' }; } return st; };
const keep = () => ls.set(KEY, st);
export function addLabel(gid, per, n, unit) { const s = load(); const g = store.get('goods', gid); if (!g) return; s.items.push({ gid, per: per || '', n: n || 1, unit: unit || g.unit || 'PCS' }); keep(); }
const itemOf = (x, date) => { const g = store.get('goods', x.gid) || {}; const p = lblParse(g); return { name: p.name, spec: p.spec, fin: p.fin, qty: qtyText(x.per, x.unit), date, code: g.code || '', p, g }; };

export function labelPage(view, sub, arg) {
  if (sub === 'check') return checkPage(view);
  const s = load();
  if (sub === 'b' && arg) { const b = store.get('bills', arg); if (b) { s.items = (b.lines || []).filter(l => l.gid && +l.qty > 0).map(l => ({ gid: l.gid, per: +l.qty, n: 1, unit: l.u || store.get('goods', l.gid)?.unit || 'PCS' })); keep(); toast(`已帶入 ${b.no} 的 ${s.items.length} 項`); } history.replaceState(null, '', '#lbl'); }
  if (sub === 'g' && arg) { addLabel(decodeURIComponent(arg)); history.replaceState(null, '', '#lbl'); }
  const date = s.date || today(); const c = cfg();
  const total = s.items.reduce((a, x) => a + (Math.round(+x.n) || 0), 0);
  const bad = s.items.filter(x => !lblParse(store.get('goods', x.gid) || {}).ok).length;
  view.innerHTML = `<div class="hd"><h1>印標籤</h1><span class="sp"></span><a class="chip" href="#lbl/check">拆字檢查</a></div>
    <div class="card list"><div class="row"><span>日期</span><input type="date" id="ld" class="inl" value="${esc(date)}"></div></div>
    <div class="sec">標籤 ${s.items.length ? `<span class="muted">${s.items.length} 種・共 ${total} 張</span>` : ''}</div>
    <div id="li">${s.items.map((x, i) => itemCard(x, i)).join('') || '<div class="card ph"><b>還沒有標籤</b><span class="muted">用下面按鈕加品項、掃 QR 碼，或在出貨單送出後按「印這張的標籤」。</span></div>'}</div>
    <div class="btn2"><button class="btn ghost" id="add">＋ 加品項</button><button class="btn ghost" id="scan">掃 QR 碼加入</button></div>
    ${bad ? `<div class="err">${bad} 種品名拆字需要確認（黃色框），確認後才會印。</div>` : ''}
    <p><button class="btn" id="go" ${s.items.length && !bad ? '' : 'disabled'}>列印 ${total} 張標籤</button></p>
    ${s.items.length ? '<p><button class="btn ghost danger" id="clr">清空清單</button></p>' : ''}
    <div class="note" id="ph"></div>
    <details class="card set"><summary>標籤機設定</summary>
      <div class="f"><label for="lp">印表機名稱（主機上的）</label><input id="lp" value="${esc(c.printer)}"></div>
      <div class="f"><label>列印方式</label><div class="chips" id="lm">${[['tspl', 'TSPL 直送（建議）'], ['driver', 'Windows 驅動']].map(([k, n]) => `<button type="button" class="chip ${c.mode === k ? 'on' : ''}" data-m="${k}">${n}</button>`).join('')}</div></div>
      <div class="f2"><div class="f"><label for="ldx">往右移（點，8 點＝1 mm）</label><input id="ldx" inputmode="numeric" value="${esc(c.dx)}"></div><div class="f"><label for="ldy">往下移（點）</label><input id="ldy" inputmode="numeric" value="${esc(c.dy)}"></div></div>
      <div class="f2"><div class="f"><label for="lgap">標籤間距（mm）</label><input id="lgap" inputmode="decimal" value="${esc(c.gap)}"></div><div class="f"><label>&nbsp;</label><label class="check"><input type="checkbox" id="lqr" ${c.qr ? 'checked' : ''}> 印料號 QR 碼</label></div></div>
      <label class="check"><input type="checkbox" id="linv" ${c.invert ? 'checked' : ''}> 黑白相反（印出來整張黑底時勾）</label>
      <label class="check"><input type="checkbox" id="ldir" ${c.dir ? '' : 'checked'}> 上下顛倒（印出來倒過來時勾）</label>
      <p><button class="btn ghost" id="lsave">儲存設定</button></p></details>`;
  const $ = q => view.querySelector(q); const redraw = () => labelPage(view);
  // 預覽
  s.items.forEach((x, i) => { const cv = view.querySelector(`[data-cv="${i}"]`); if (cv) drawLabel(cv, itemOf(x, date)).catch(() => {}); });
  $('#ld').onchange = ev => { s.date = ev.target.value; keep(); redraw(); };
  const li = $('#li');
  li.addEventListener('change', ev => { const i = +ev.target.closest('[data-i]')?.dataset.i; const x = s.items[i]; if (!x) return; const f = ev.target.dataset.f; if (f === 'per') x.per = ev.target.value; if (f === 'n') x.n = Math.max(1, Math.round(+ev.target.value) || 1); keep(); redraw(); });
  li.addEventListener('click', ev => {
    const del = ev.target.closest('[data-del]'); if (del) { s.items.splice(+del.dataset.del, 1); keep(); redraw(); return; }
    const fx = ev.target.closest('[data-fix]'); if (fx) fixSheet(store.get('goods', s.items[+fx.dataset.fix].gid), redraw);
  });
  $('#add').onclick = () => pickGoods(redraw);
  $('#scan').onclick = () => scanQR(text => { const g = findByCode(text); if (!g) { toast('找不到料號：' + text); return; } addLabel(g.id); redraw(); }, { title: '掃商品 QR 碼' });
  $('#clr')?.addEventListener('click', () => { if (!window.confirm('清空標籤清單？')) return; s.items = []; keep(); redraw(); });
  $('#go').onclick = () => printAll(view);
  view.querySelectorAll('#lm [data-m]').forEach(b => b.onclick = () => view.querySelectorAll('#lm [data-m]').forEach(x => x.classList.toggle('on', x === b)));
  $('#lsave').onclick = async () => {
    const n = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
    const out = { ...store.setting('mlabel'), printer: $('#lp').value.trim() || PRINTER_DEF, mode: $('#lm .on')?.dataset.m || 'tspl', dx: Math.round(n('#ldx', 0)), dy: Math.round(n('#ldy', 0)), gap: n('#lgap', 2), qr: $('#lqr').checked, invert: $('#linv').checked, dir: $('#ldir').checked ? 0 : 1 };
    try { await store.save('settings', 'mlabel', out); toast('標籤機設定已儲存'); redraw(); } catch (e) { toast('儲存失敗：' + e.message); }
  };
  helperState(view);
}
function itemCard(x, i) {
  const g = store.get('goods', x.gid) || {}; const p = lblParse(g);
  return `<div class="card ln ${p.ok ? '' : 'warnbox'}" data-i="${i}"><div class="lnh"><div class="gm"><b>${esc(g.name || '（商品已刪除）')}</b><small>${esc(g.code || '')}${p.fixed ? '・已確認文字' : ''}</small></div><button class="x" data-del="${i}" aria-label="刪除">×</button></div>
    <canvas class="lblcv" data-cv="${i}" width="${W}" height="${H}"></canvas>
    ${p.ok ? '' : `<div class="err" style="margin:6px 0 0">拆字需要確認：${esc(p.why)}</div>`}
    <div class="lnr"><label>每張數量<input data-f="per" inputmode="decimal" value="${esc(x.per)}"></label><span class="u">${esc(x.unit)}</span><label>張數（箱數）<input data-f="n" inputmode="numeric" value="${esc(x.n)}"></label><button class="chip" data-fix="${i}">${p.ok ? '改文字' : '確認文字'}</button></div></div>`;
}
async function printAll(view) {
  const s = load(); const c = cfg(); const date = s.date || today(); const btn = view.querySelector('#go'); btn.disabled = true;
  try {
    if (s.items.some(x => !(+x.per > 0))) throw new Error('每一種都要填每張數量');
    const labels = [];
    for (const x of s.items) { const cv = document.createElement('canvas'); await drawLabel(cv, itemOf(x, date)); labels.push({ cv, copies: Math.max(1, Math.round(+x.n) || 1) }); }
    const n = labels.reduce((a, l) => a + l.copies, 0);
    const job = { status: 'queued', type: 'LABEL', no: `標籤 ${n} 張`, what: `標籤 ${n} 張`, printer: c.printer, by: store.user.name, at: new Date().toISOString() };
    if (c.mode === 'driver') {
      const imgs = labels.flatMap(l => Array(l.copies).fill(`<img src="${l.cv.toDataURL('image/png')}">`)).join('');
      job.html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:50mm 40mm;margin:0}body{margin:0}img{display:block;width:50mm;height:40mm;break-after:page}</style></head><body>${imgs}</body></html>`;
    } else job.raw = b64(tspl(labels, c));
    const id = uid('pj'); await store.save('printjobs', id, job);
    store.log('列印', `標籤 ${n} 張（手機，${c.mode === 'driver' ? '驅動' : 'TSPL'}）`);
    lastJob = id; toast(`已送出 ${n} 張標籤`); labelPage(view);
  } catch (e) { toast(e.message || String(e)); btn.disabled = false; }
}
let lastJob = '';
const STT = { queued: '排隊中，等主機列印', printing: '列印中…', done: '已送到標籤機', failed: '列印失敗' };
async function helperState(view) {
  const ph = view.querySelector('#ph'); if (!ph) return;
  const j = lastJob ? store.get('printjobs', lastJob) : null;
  ph.innerHTML = j ? `<div class="pst ${j.status}">${STT[j.status] || j.status}${j.msg ? `<small>${esc(j.msg)}</small>` : ''}</div>` : '';
  try { const r = await (await fetch('/api/print/helper', { credentials: 'same-origin' })).json(); if (!r.online && ph.isConnected && !ph.querySelector('.hw')) ph.insertAdjacentHTML('beforeend', '<div class="hw">⚠ 主機的列印小幫手沒有開，標籤會排隊，等它開了才印</div>'); } catch (e) {}
}
export function onLabelChange(view, ch) { if (lastJob && ch.has('printjobs')) helperState(view); }

// ---------- 加品項 ----------
function pickGoods(done) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>完成</button><b>加標籤品項</b><span style="width:40px"></span></div>
    <div class="search"><input type="search" id="gq" placeholder="規格或品名" autocomplete="off" autocorrect="off" autocapitalize="off"></div><div class="card list" id="gl"></div>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); done(); };
  const draw = v => { el.querySelector('#gl').innerHTML = search(v, '').slice(0, 50).map(g => `<a href="#" data-id="${g.id}"><div class="gm"><b>${esc(g.name)}</b><small>${esc(g.code)}${lblParse(g).ok ? '' : '・拆字需確認'}</small></div><span class="go">＋</span></a>`).join('') || `<div class="row muted">${v.trim() ? '找不到' : '輸入規格或品名'}</div>`; };
  let tm = 0; el.querySelector('#gq').addEventListener('input', ev => { clearTimeout(tm); tm = setTimeout(() => draw(ev.target.value), 150); }); draw('');
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('#gl').addEventListener('click', ev => { const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault(); addLabel(a.dataset.id); a.querySelector('.go').textContent = '✓'; });
  setTimeout(() => el.querySelector('#gq').focus(), 50);
}

// ---------- 確認／修改標籤文字（存在設定 lblfix，全公司共用） ----------
function fixSheet(g, done) {
  if (!g) return; const p = lblParse(g);
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>取消</button><b>標籤文字</b><span style="width:40px"></span></div>
    <div class="card"><b>${esc(g.name)}</b><div class="muted mono">${esc(g.code)}</div>${p.ok ? '' : `<div class="err" style="margin:6px 0 0">${esc(p.why)}：請確認下面的文字</div>`}</div>
    <div class="card" style="margin-top:10px">
      <div class="f"><label for="fn">第 1 行：品名（最多 10 字）</label><input id="fn" maxlength="10" value="${esc(p.name)}"></div>
      <div class="f"><label for="fs">第 2 行：規格</label><input id="fs" value="${esc(p.spec)}"></div>
      <div class="f"><label for="ff">第 2 行：表面處理</label><input id="ff" value="${esc(p.fin)}"></div></div>
    <canvas class="lblcv" id="fcv" width="${W}" height="${H}" style="margin-top:10px"></canvas>
    <p><button class="btn" id="ok">確認，以後都用這個文字</button></p>${p.fixed ? '<p><button class="btn ghost danger" id="rm">取消確認（恢復自動拆字）</button></p>' : ''}`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); done(); };
  const v = id => el.querySelector(id).value.trim();
  const pv = () => drawLabel(el.querySelector('#fcv'), { name: v('#fn'), spec: v('#fs'), fin: v('#ff'), qty: qtyText(1000, 'PCS'), date: today(), code: g.code }).catch(() => {});
  el.querySelectorAll('input').forEach(i => i.addEventListener('input', pv)); pv();
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('#ok').onclick = async () => {
    if (!v('#fn')) { toast('品名不能空白'); return; }
    const fx = { ...fixes(), [g.id]: { n: v('#fn'), s: v('#fs'), f: v('#ff') } };
    try { await store.save('settings', 'lblfix', { ...store.setting('lblfix'), fix: fx }); } catch (e) { toast('儲存失敗：' + e.message); return; }
    toast('已確認標籤文字'); close();
  };
  el.querySelector('#rm')?.addEventListener('click', async () => { const fx = { ...fixes() }; delete fx[g.id]; await store.save('settings', 'lblfix', { ...store.setting('lblfix'), fix: fx }); toast('已恢復自動拆字'); close(); });
}

// ---------- 拆字檢查：列出拆不準的商品給老闆確認 ----------
const chk = { why: '', q: '', scope: 'stock' };
function checkPage(view) {
  const C = calc(); const all = store.list('goods').filter(g => !g.nostock);
  const scoped = chk.scope === 'stock' ? all.filter(g => C.stock[g.id]) : all;
  const rows = scoped.map(g => ({ g, p: lblParse(g) })).filter(x => !x.p.ok);
  const by = new Map(); for (const x of rows) by.set(x.p.why.replace(/\d+ 個字/, 'N 個字'), (by.get(x.p.why.replace(/\d+ 個字/, 'N 個字')) || 0) + 1);
  const ts = qTerms(chk.q); const list = rows.filter(x => (!chk.why || x.p.why.replace(/\d+ 個字/, 'N 個字') === chk.why) && matchQ(x.g.code + ' ' + x.g.name, ts));
  const nFix = Object.keys(fixes()).length;
  view.innerHTML = `<div class="hd"><a class="back" href="#lbl">‹ 印標籤</a></div><div class="hd" style="margin-top:0"><h1>拆字檢查</h1></div>
    <div class="note" style="text-align:left;margin:0 0 10px">這些商品的品名沒辦法照規則拆成「品名／規格」，印標籤前要先確認文字。已確認 ${nFix} 項。</div>
    <div class="chips">${[['stock', '有庫存紀錄的'], ['all', '全部商品']].map(([k, n]) => `<button class="chip ${chk.scope === k ? 'on' : ''}" data-s="${k}">${n}</button>`).join('')}</div>
    <div class="chips"><button class="chip ${!chk.why ? 'on' : ''}" data-w="">全部 ${rows.length}</button>${[...by].map(([w, n]) => `<button class="chip ${chk.why === w ? 'on' : ''}" data-w="${esc(w)}">${esc(w)} ${n}</button>`).join('')}</div>
    <div class="search"><input type="search" id="cq" placeholder="搜尋料號、品名" value="${esc(chk.q)}" autocomplete="off"></div>
    <div class="card list" style="margin-top:10px">${list.slice(0, 100).map(x => `<a href="#" data-g="${x.g.id}"><div class="gm"><b>${esc(x.g.name)}</b><small>${esc(x.g.code)}・${esc(x.p.why)}</small></div><span class="go">›</span></a>`).join('') || '<div class="row muted">沒有需要確認的 ✓</div>'}</div>
    ${list.length > 100 ? `<div class="note">只列前 100 項（共 ${list.length} 項），用搜尋縮小範圍。</div>` : ''}`;
  view.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { chk.scope = b.dataset.s; chk.why = ''; checkPage(view); });
  view.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { chk.why = b.dataset.w; checkPage(view); });
  let tm = 0; view.querySelector('#cq').addEventListener('input', ev => { clearTimeout(tm); tm = setTimeout(() => { chk.q = ev.target.value; const pos = ev.target.selectionStart; checkPage(view); const i = view.querySelector('#cq'); i.focus(); i.setSelectionRange(pos, pos); }, 250); });
  view.querySelector('.list').addEventListener('click', ev => { const a = ev.target.closest('[data-g]'); if (!a) return; ev.preventDefault(); fixSheet(store.get('goods', a.dataset.g), () => checkPage(view)); });
}
