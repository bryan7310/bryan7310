// 手機版：標籤列印（佳博 GP-1324D，50×40 mm，203 dpi ≈ 400×320 點）。
// 手機把標籤畫成黑白點陣圖（畫面預覽＝印出來的樣子）→ 組成 TSPL 指令 → 交給主機列印小幫手直接送到標籤機。
// 四行：品名（開頭連續中文，最多 10 字（老闆決定從規格書的 8 字放寬））／規格＋表面處理／數量 PCS（H×100）／日期；右下角料號 QR 碼。
// 拆字拆不準的（開頭不是中文、中文中間夾數字英文…）不自己猜：列在「拆字檢查」給老闆確認，確認後的文字存在設定 lblfix。
import { esc, today, uid, ls, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, unitFactor, cdisp, customers, suppliers } from '../core/calc.js';
import { api } from '../core/api.js';
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
const cfg = () => ({ printer: PRINTER_DEF, mode: 'tspl', rot: 'port', invert: false, dir: 1, dx: 0, dy: 0, qr: true, gap: 2, ...store.setting('mlabel') });

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
  px = fitText(cx, l2, full, 42, true); cx.fillText(l2, P, 128);
  px = fitText(cx, it.qty, half, 46, true); cx.fillText(it.qty, P, 212);
  px = fitText(cx, it.date, half, 32, false); cx.fillText(it.date, P, H - P - 8);
  toBW(cx); return cv;
}
/** 轉純黑白（熱感印表機沒有灰階） */
function toBW(cx) {
  const img = cx.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 140 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  cx.putImageData(img, 0, 0);
}
/** 點陣圖 → TSPL BITMAP 資料（高位元在左；預設 0＝黑點）。
 *  rot＝直放（標籤 40 mm 那邊橫過印字頭、50 mm 往出紙方向）：整張轉 90 度，輸出 320×400 點；橫放＝400×320 不轉 */
function bitmapBytes(cv, invert, dx, dy, rot) {
  const d = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const OW = rot ? H : W, OH = rot ? W : H, wb = OW / 8; const out = new Uint8Array(wb * OH);
  for (let oy = 0; oy < OH; oy++) for (let xb = 0; xb < wb; xb++) {
    let b = 0;
    for (let bit = 0; bit < 8; bit++) {
      const ox = xb * 8 + bit;
      const sx = (rot ? oy : ox) - dx, sy = (rot ? H - 1 - ox : oy) - dy;   // 順時針轉 90 度
      const black = sx >= 0 && sx < W && sy >= 0 && sy < H && d[(sy * W + sx) * 4] < 128;
      if (invert ? black : !black) b |= 0x80 >> bit;
    }
    out[oy * wb + xb] = b;
  }
  return out;
}
const enc = s => new TextEncoder().encode(s);
function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export function tspl(labels, c) {
  const rot = c.rot !== 'land';
  const head = `SIZE ${rot ? '40 mm,50 mm' : '50 mm,40 mm'}\r\nGAP ${+c.gap || 0} mm,0 mm\r\nDIRECTION ${c.dir ? 1 : 0}\r\nREFERENCE 0,0\r\nDENSITY 8\r\nSPEED 4\r\nSET TEAR ON\r\n`;
  const parts = [enc(head)];
  for (const { cv, copies } of labels) parts.push(enc(`CLS\r\nBITMAP 0,0,${rot ? '40,400' : '50,320'},0,`), bitmapBytes(cv, !!c.invert, +c.dx || 0, +c.dy || 0, rot), enc(`\r\nPRINT 1,${Math.max(1, Math.round(copies) || 1)}\r\n`));
  return concat(parts);
}

// ---------- 標籤清單（記在手機上） ----------
let st = null;
const load = () => { if (!st) { const x = ls.get(KEY, null); st = x && Array.isArray(x.items) ? x : { items: [], date: '' }; } return st; };
const keep = () => ls.set(KEY, st);
export function addLabel(gid, per, n, unit) { const s = load(); const g = store.get('goods', gid); if (!g) return; s.items.push({ gid, per: per || '', n: n || 1, unit: unit || g.unit || 'PCS' }); keep(); }
const itemOf = (x, date) => { const g = store.get('goods', x.gid) || {}; const p = lblParse(g); return { name: p.name, spec: p.spec, fin: p.fin, qty: qtyText(x.per, x.unit), date, code: g.code || '', p, g }; };

const MODES = [['goods', '商品標籤'], ['addr', '地址標籤']];
const modeTabs = m => `<div class="chips">${MODES.map(([k, n]) => `<button class="chip ${m === k ? 'on' : ''}" data-mode="${k}">${n}</button>`).join('')}</div>`;
const bindMode = view => view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { ls.set('zr.m.lblmode', b.dataset.mode); labelPage(view); });
export function labelPage(view, sub, arg) {
  if (sub === 'check') return checkPage(view);
  if (sub === 'a' && arg) { ls.set('zr.m.lblmode', 'addr'); pickAddr(decodeURIComponent(arg)); history.replaceState(null, '', '#lbl'); }
  if (sub === 'g' || sub === 'b') ls.set('zr.m.lblmode', 'goods');
  if (ls.get('zr.m.lblmode', 'goods') === 'addr') return addrPage(view);
  const s = load();
  if (sub === 'b' && arg) { const b = store.get('bills', arg); if (b) { s.items = (b.lines || []).filter(l => l.gid && +l.qty > 0).map(l => ({ gid: l.gid, per: +l.qty, n: 1, unit: l.u || store.get('goods', l.gid)?.unit || 'PCS' })); keep(); toast(`已帶入 ${b.no} 的 ${s.items.length} 項`); } history.replaceState(null, '', '#lbl'); }
  if (sub === 'g' && arg) { addLabel(decodeURIComponent(arg)); history.replaceState(null, '', '#lbl'); }
  const date = s.date || today(); const c = cfg();
  const total = s.items.reduce((a, x) => a + (Math.round(+x.n) || 0), 0);
  const bad = s.items.filter(x => !lblParse(store.get('goods', x.gid) || {}).ok).length;
  view.innerHTML = `<div class="hd"><h1>印標籤</h1><span class="sp"></span><a class="chip" href="#lbl/check">拆字檢查</a></div>${modeTabs('goods')}
    <div class="card list"><div class="row"><span>日期</span><input type="date" id="ld" class="inl" value="${esc(date)}"></div></div>
    <div class="sec">標籤 ${s.items.length ? `<span class="muted">${s.items.length} 種・共 ${total} 張</span>` : ''}</div>
    <div id="li">${s.items.map((x, i) => itemCard(x, i)).join('') || '<div class="card ph"><b>還沒有標籤</b><span class="muted">用下面按鈕加品項、掃 QR 碼，或在出貨單送出後按「印這張的標籤」。</span></div>'}</div>
    <div class="btn2"><button class="btn ghost" id="add">＋ 加品項</button><button class="btn ghost" id="scan">掃 QR 碼加入</button></div>
    ${bad ? `<div class="err">${bad} 種品名拆字需要確認（黃色框），確認後才會印。</div>` : ''}
    <p><button class="btn" id="go" ${s.items.length && !bad ? '' : 'disabled'}>列印 ${total} 張標籤</button></p>
    <div class="note" style="margin-top:-6px">標籤方向：${c.rot === 'land' ? '橫放（50 mm 橫過印字頭）' : '直放（40 mm 橫過印字頭，整張轉 90 度）'}・可在下面「標籤機設定」改</div>
    ${s.items.length ? '<p><button class="btn ghost danger" id="clr">清空清單</button></p>' : ''}
    <div class="note" id="ph"></div>
    <details class="card set"><summary>標籤機設定</summary>
      <div class="f"><label for="lp">印表機名稱（主機上的）</label><input id="lp" value="${esc(c.printer)}"></div>
      <div class="f"><label>列印方式</label><div class="chips" id="lm">${[['tspl', 'TSPL 直送（建議）'], ['driver', 'Windows 驅動']].map(([k, n]) => `<button type="button" class="chip ${c.mode === k ? 'on' : ''}" data-m="${k}">${n}</button>`).join('')}</div></div>
      <div class="f2"><div class="f"><label for="ldx">往右移（點，8 點＝1 mm）</label><input id="ldx" inputmode="numeric" value="${esc(c.dx)}"></div><div class="f"><label for="ldy">往下移（點）</label><input id="ldy" inputmode="numeric" value="${esc(c.dy)}"></div></div>
      <div class="f2"><div class="f"><label for="lgap">標籤間距（mm）</label><input id="lgap" inputmode="decimal" value="${esc(c.gap)}"></div><div class="f"><label>&nbsp;</label><label class="check"><input type="checkbox" id="lqr" ${c.qr ? 'checked' : ''}> 印料號 QR 碼</label></div></div>
      <label class="check"><input type="checkbox" id="linv" ${c.invert ? 'checked' : ''}> 黑白相反（印出來整張黑底時勾）</label>
      <div class="f"><label>標籤怎麼放在標籤機裡</label><div class="chips" id="lrot">${[['port', '直放：40 mm 那邊橫過印字頭（目前這台）'], ['land', '橫放：50 mm 那邊橫過印字頭']].map(([k, n]) => `<button type="button" class="chip ${c.rot === k ? 'on' : ''}" data-r="${k}">${n}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="ldir" ${c.dir ? '' : 'checked'}> 上下顛倒（印出來倒過來時勾）</label>
      <p><button class="btn ghost" id="lsave">儲存設定</button></p></details>`;
  const $ = q => view.querySelector(q); const redraw = () => labelPage(view);
  // 預覽
  s.items.forEach((x, i) => { const cv = view.querySelector(`[data-cv="${i}"]`); if (cv) drawLabel(cv, itemOf(x, date)).catch(() => {}); });
  $('#ld').onchange = ev => { s.date = ev.target.value; keep(); redraw(); };
  const li = $('#li');
  // 張數：點進去先清空（灰字顯示原本的數字），直接打新的；沒打就恢復原本的
  li.addEventListener('focusin', ev => { const t = ev.target; if (t.dataset.f !== 'n') return; t.placeholder = t.value; t.value = ''; });
  li.addEventListener('focusout', ev => { const t = ev.target; if (t.dataset.f === 'n' && t.value.trim() === '') t.value = t.placeholder || '1'; });
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
  view.querySelectorAll('#lrot [data-r]').forEach(b => b.onclick = () => view.querySelectorAll('#lrot [data-r]').forEach(x => x.classList.toggle('on', x === b)));
  $('#lsave').onclick = async () => {
    const n = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) ? v : d; };
    const out = { ...store.setting('mlabel'), printer: $('#lp').value.trim() || PRINTER_DEF, mode: $('#lm .on')?.dataset.m || 'tspl', rot: $('#lrot .on')?.dataset.r || 'port', dx: Math.round(n('#ldx', 0)), dy: Math.round(n('#ldy', 0)), gap: n('#lgap', 2), qr: $('#lqr').checked, invert: $('#linv').checked, dir: $('#ldir').checked ? 0 : 1 };
    try { await store.save('settings', 'mlabel', out); toast('標籤機設定已儲存'); redraw(); } catch (e) { toast('儲存失敗：' + e.message); }
  };
  helperState(view); bindMode(view);
}
function itemCard(x, i) {
  const g = store.get('goods', x.gid) || {}; const p = lblParse(g);
  return `<div class="card ln ${p.ok ? '' : 'warnbox'}" data-i="${i}"><div class="lnh"><div class="gm"><b>${esc(g.name || '（商品已刪除）')}</b><small>${esc(g.code || '')}${p.fixed ? '・已確認文字' : ''}</small></div><button class="x" data-del="${i}" aria-label="刪除">×</button></div>
    <canvas class="lblcv" data-cv="${i}" width="${W}" height="${H}"></canvas>
    ${p.ok ? '' : `<div class="err" style="margin:6px 0 0">拆字需要確認：${esc(p.why)}</div>`}
    <div class="lnr"><label>每張數量<input data-f="per" inputmode="decimal" value="${esc(x.per)}"></label><span class="u">${esc(x.unit)}</span><label>張數（箱數）<input data-f="n" inputmode="numeric" value="${esc(x.n)}"></label><button class="chip" data-fix="${i}">${p.ok ? '改文字' : '確認文字'}</button></div></div>`;
}
/** 標籤交給主機列印小幫手（TSPL 直送或 Windows 驅動）；回傳列印工作 id */
async function queueLabels(labels, what) {
  const c = cfg(); const n = labels.reduce((a, l) => a + l.copies, 0);
  const job = { status: 'queued', type: 'LABEL', no: what, what, printer: c.printer, by: store.user.name, at: new Date().toISOString() };
  if (c.mode === 'driver') {
    const imgs = labels.flatMap(l => Array(l.copies).fill(`<img src="${l.cv.toDataURL('image/png')}">`)).join('');
    job.html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:50mm 40mm;margin:0}body{margin:0}img{display:block;width:50mm;height:40mm;break-after:page}</style></head><body>${imgs}</body></html>`;
  } else job.raw = b64(tspl(labels, c));
  const id = uid('pj'); await store.save('printjobs', id, job);
  store.log('列印', `${what}（手機，${c.mode === 'driver' ? '驅動' : 'TSPL'}，${n} 張）`);
  return id;
}
async function printAll(view) {
  const s = load(); const c = cfg(); const date = s.date || today(); const btn = view.querySelector('#go'); btn.disabled = true;
  try {
    if (s.items.some(x => !(+x.per > 0))) throw new Error('每一種都要填每張數量');
    const labels = [];
    for (const x of s.items) { const cv = document.createElement('canvas'); await drawLabel(cv, itemOf(x, date)); labels.push({ cv, copies: Math.max(1, Math.round(+x.n) || 1) }); }
    const n = labels.reduce((a, l) => a + l.copies, 0);
    lastJob = await queueLabels(labels, `標籤 ${n} 張`); toast(`已送出 ${n} 張標籤`); labelPage(view);
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

// ---------- 地址標籤（跟網頁版「標籤列印 › 地址標籤」一樣）：選客戶／廠商 → 郵局查 3+3 郵遞區號 → 郵遞區號／地址兩行／簡稱＋公司收 ----------
const splitAddr = a => { const m = String(a || '').match(/^(.{2,3}[縣市].{1,4}?[區鄉鎮市])(.+)$/); return m ? [m[1], m[2]] : [String(a || ''), '']; };
const stripZip = a => String(a || '').replace(/\s+/g, '').replace(/^\d{3,6}/, '');
// 志瑞自己的地址（網頁版標籤列印也有同一顆「志瑞地址」）
const OWN_ADDR = { zip: '412041', l2: '台中市大里區現岱路88號', l3: '', l4: '04 24839193  志瑞螺絲' };
let AD = null;   // { cid, addr, zip, l2, l3, l4, copies, save, msg }
let adView = null;
function pickAddr(cid) {
  const c = store.get('contacts', cid); if (!c) return;
  const addr = stripZip(c.addr); const [l2, l3] = splitAddr(addr);
  AD = { cid, addr, zip: /^\d{6}$/.test(c.zip || '') ? c.zip : '', l2, l3, l4: `${cdisp(c)}公司收`, copies: 1, save: !c.addr, msg: '' };
  if (addr) queryZip();
}
async function queryZip() {
  if (!AD?.addr) return; const cid = AD.cid; AD.msg = '查郵遞區號中…';
  try {
    const r = await api.get('/api/zip33?addr=' + encodeURIComponent(AD.addr));
    if (!AD || AD.cid !== cid) return;
    if (!r.ok) { AD.msg = '郵局查不到：' + (r.error || '') + '。請確認地址，或自己填郵遞區號。'; [AD.l2, AD.l3] = splitAddr(AD.addr); }
    else { AD.zip = r.zip; AD.l2 = r.city || splitAddr(AD.addr)[0]; AD.l3 = r.street || splitAddr(AD.addr)[1]; AD.msg = `郵局標準地址：${r.zip} ${r.city}${r.street}`; }
  } catch (e) { if (AD) AD.msg = '查詢失敗：' + e.message + '。可以自己填郵遞區號。'; }
  if (adView?.isConnected && adView.querySelector('[data-addrpage]')) addrPage(adView);
}
async function drawAddr(cv, F) {
  cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.fillStyle = '#000'; cx.textBaseline = 'alphabetic';
  const P = 24, full = W - P * 2;
  // 第一行郵遞區號：粗體、字距拉開
  cx.font = 'bold 42px Arial,Helvetica,sans-serif'; let x = P; for (const ch of String(F.zip || '')) { cx.fillText(ch, x, P + 36); x += cx.measureText(ch).width + 4; }
  fitText(cx, F.l2, full, 36, true); cx.fillText(F.l2, P, 140);
  fitText(cx, F.l3, full, 36, true); cx.fillText(F.l3, P, 208);
  fitText(cx, F.l4, full, 46, true); cx.textAlign = 'right'; cx.fillText(F.l4, W - P, H - 26); cx.textAlign = 'left';
  toBW(cx); return cv;
}
function addrPage(view) {
  adView = view;
  const c = AD ? store.get('contacts', AD.cid) : null; const kindName = x => x?.kind === 'S' ? '廠商' : '客戶';
  const changed = !!AD && !!AD.addr && (stripZip(c?.addr) !== AD.addr || (!!AD.zip && c?.zip !== AD.zip));
  view.innerHTML = `<div class="hd" data-addrpage><h1>印標籤</h1></div>${modeTabs('addr')}
    <div class="srow" style="margin-bottom:10px"><button class="btn ghost" id="aown">志瑞地址（一鍵列印）</button><input id="aownn" inputmode="numeric" value="1" style="width:64px;flex:none;text-align:center" aria-label="張數"></div>
    <div class="card list"><a href="#" id="apk"><span>客戶或廠商</span><span class="go">${c ? `<b>${esc(cdisp(c))}</b><small class="muted">　${kindName(c)}</small>` : '<span class="muted">請選擇</span>'} ›</span></a></div>
    ${AD ? `<div class="card" style="margin-top:10px">
      <div class="f"><label for="aad">地址（${c?.addr ? `${kindName(c)}資料上的地址，可以改` : `${kindName(c)}資料沒有地址，請填`}）</label><div class="srow"><input id="aad" value="${esc(AD.addr)}"><button class="btn ghost" id="aq" style="width:auto;padding:9px 14px">查郵遞區號</button></div></div>
      ${AD.msg ? `<div class="note" style="text-align:left;margin:0 0 8px">${esc(AD.msg)}</div>` : ''}
      <div class="f2"><div class="f"><label for="az">第一行：郵遞區號 3+3</label><input id="az" data-k="zip" inputmode="numeric" maxlength="6" value="${esc(AD.zip)}"></div><div class="f"><label for="acp">張數</label><input id="acp" inputmode="numeric" value="${esc(AD.copies)}"></div></div>
      <div class="f"><label for="a2">第二行：縣市區</label><input id="a2" data-k="l2" value="${esc(AD.l2)}"></div>
      <div class="f"><label for="a3">第三行：路段號</label><input id="a3" data-k="l3" value="${esc(AD.l3)}"></div>
      <div class="f"><label for="a4">第四行：收件</label><input id="a4" data-k="l4" value="${esc(AD.l4)}"></div>
      ${changed ? `<label class="check"><input type="checkbox" id="asv" ${AD.save ? 'checked' : ''}> 把地址和郵遞區號存回${kindName(c)}資料</label>` : ''}</div>
      <canvas class="lblcv" id="acv" width="${W}" height="${H}"></canvas>
      <p><button class="btn" id="ago">列印地址標籤</button></p>` : '<div class="note">選客戶或廠商，會自動帶地址並向郵局查 3+3 郵遞區號。</div>'}
    <div class="note" id="ph"></div>`;
  const $ = q => view.querySelector(q);
  bindMode(view);
  $('#apk').onclick = ev => { ev.preventDefault(); pickContact(id => { pickAddr(id); addrPage(view); }); };
  const own = $('#aownn');
  own.addEventListener('focusin', ev => { ev.target.placeholder = ev.target.value; ev.target.value = ''; });
  own.addEventListener('focusout', ev => { if (!ev.target.value.trim()) ev.target.value = ev.target.placeholder || '1'; });
  $('#aown').onclick = async () => {
    const n = Math.max(1, Math.round(+own.value || +own.placeholder) || 1); const b = $('#aown'); b.disabled = true;
    try { const cv = document.createElement('canvas'); await drawAddr(cv, OWN_ADDR); lastJob = await queueLabels([{ cv, copies: n }], '志瑞地址標籤'); toast(`已送出 ${n} 張志瑞地址標籤`); addrPage(view); }
    catch (e) { toast(e.message || String(e)); b.disabled = false; }
  };
  helperState(view);
  if (!AD) return;
  const pv = () => drawAddr($('#acv'), AD).catch(() => {}); pv();
  view.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => { AD[i.dataset.k] = i.value.trim(); pv(); }));
  $('#aad').addEventListener('input', ev => { AD.addr = stripZip(ev.target.value); });
  $('#aad').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#aq').click(); } });
  $('#aq').onclick = () => { AD.addr = stripZip($('#aad').value); if (!AD.addr) { toast('請填地址'); return; } queryZip(); addrPage(view); };
  $('#acp').addEventListener('focusin', ev => { ev.target.placeholder = ev.target.value; ev.target.value = ''; });
  $('#acp').addEventListener('focusout', ev => { if (!ev.target.value.trim()) ev.target.value = ev.target.placeholder || '1'; AD.copies = Math.max(1, Math.round(+ev.target.value) || 1); });
  $('#asv')?.addEventListener('change', ev => { AD.save = ev.target.checked; });
  $('#ago').onclick = async () => {
    if (!AD.l2 && !AD.l3) { toast('沒有地址'); return; }
    if (AD.zip && !/^\d{6}$/.test(AD.zip) && !window.confirm(`郵遞區號「${AD.zip}」不是 6 碼，確定要印嗎？`)) return;
    const btn = $('#ago'); btn.disabled = true;
    try {
      AD.copies = Math.max(1, Math.round(+$('#acp').value || +$('#acp').placeholder) || 1);
      const cc = store.get('contacts', AD.cid);
      if (cc && AD.save && changed) { const { id, ...d } = cc; d.addr = AD.addr; if (AD.zip) d.zip = AD.zip; await store.save('contacts', id, d); store.log('修改', `${cc.name}：地址 ${AD.zip} ${AD.addr}（手機地址標籤）`); }
      const cv = document.createElement('canvas'); await drawAddr(cv, AD);
      lastJob = await queueLabels([{ cv, copies: AD.copies }], `地址標籤 ${cc ? cdisp(cc) : ''}`); toast(`已送出 ${AD.copies} 張地址標籤`); addrPage(view);
    } catch (e) { toast(e.message || String(e)); btn.disabled = false; }
  };
}
function pickContact(onPick) {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = '<div class="sheet-hd"><button class="link" data-x>取消</button><b>客戶或廠商</b><span style="width:40px"></span></div><div class="search"><input type="search" id="cq" placeholder="名稱、代號" autocomplete="off"></div><div class="card list" id="cl"></div>';
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); };
  const all = [...customers(), ...suppliers()].map(c => ({ c, t: [c.code, c.name, c.short, ...(c.aliases || [])].filter(Boolean).join(' ') }));
  const draw = v => { el.querySelector('#cl').innerHTML = all.filter(x => matchQ(x.t, qTerms(v))).slice(0, 60).map(x => `<a href="#" data-id="${x.c.id}"><span class="mono muted">${esc(x.c.code)}</span>${esc(cdisp(x.c))}<span class="go"><small class="muted">${x.c.kind === 'S' ? '廠商' : '客戶'}${x.c.addr ? '' : '・沒有地址'}</small></span></a>`).join('') || '<div class="row muted">找不到</div>'; };
  el.querySelector('#cq').addEventListener('input', ev => draw(ev.target.value)); draw('');
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('#cl').addEventListener('click', ev => { const a = ev.target.closest('[data-id]'); if (!a) return; ev.preventDefault(); close(); onPick(a.dataset.id); });
  setTimeout(() => el.querySelector('#cq').focus(), 50);
}
