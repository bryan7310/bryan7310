// 電子信箱：伺服器定時向郵件主機（HiNet）收信；這裡看信、智能分類、新增／回覆／轉寄／草稿、刪除（移到垃圾桶，可復原）。
// 分類在瀏覽器算：手動指定 > 寄件人規則 > 廣告 > 客戶／廠商（寄件人名稱對到資料）> 關鍵字（帳單、訂單、報價、出貨）> 系統通知 > 其他。
// 已讀、手動分類、寄件人規則記在設定 mailread／mailmeta（大家共用）。刪除只刪伺服器上的這一份，HiNet 上的信不動。
import { esc } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { modal, toast, confirm } from '../core/ui.js';
import { matchCo } from './faxin.js';
import { cdisp } from '../core/calc.js';

const WEBMAIL = 'https://webmail.hinet.net/';
let LIST = { items: [], total: 0, counts: {}, state: {}, cfg: {} }, LOADED = 0;
const ui = { sel: '', q: '', folder: 'inbox', cat: '', checked: new Set() };
export const FOLDERS = [['inbox', '收件匣'], ['sent', '寄件備份'], ['draft', '草稿'], ['trash', '垃圾桶']];
export const mailRead = () => store.setting('mailread').read || {};
export const isMailRead = m => !!mailRead()[m.id];
export const mailWhen = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); const t = new Date(); return d.toDateString() === t.toDateString() ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getFullYear() === t.getFullYear() ? '' : d.getFullYear() + '/'}${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const mailList = () => LIST;

// ---------- 智能分類 ----------
// 分類可在「編輯分類」改：名稱、關鍵字、順序、優先、新增刪除。存在設定 mailmeta.cats；沒存過就用預設。
// 比對順序：手動指定 > 寄件人規則 > 勾「優先」的分類（關鍵字）> 客戶／廠商（寄件人對到資料）> 其他分類照清單順序比關鍵字 > 最後一類（其他）
export const DEFAULT_CATS = [
  { k: 'C', n: '客戶', co: 'C' }, { k: 'S', n: '廠商', co: 'S' },
  { k: 'order', n: '訂單採購', kw: '訂單,採購,訂購,下單,交期,purchase order' },
  { k: 'quote', n: '報價詢價', kw: '報價,詢價,估價,quotation,quote,RFQ' },
  { k: 'bill', n: '帳單付款', kw: '帳單,發票,繳費,付款,匯款,對帳,請款,收據,扣款,入帳,invoice,statement,payment,remittance' },
  { k: 'ship', n: '出貨物流', kw: '出貨,送貨,物流,貨運,託運,到貨,配送,宅配,shipping,delivery,tracking' },
  { k: 'ad', n: '廣告電子報', kw: '電子報,優惠,促銷,折扣,限時,特價,取消訂閱,unsubscribe,newsletter,廣告,edm,promotion', first: true },
  { k: 'sys', n: '系統通知', kw: 'no-reply,noreply,service@,system,notify,notification,mailer-daemon,postmaster,驗證碼,密碼,登入通知,系統通知,安全性' },
  { k: 'other', n: '其他' },
];
const meta = () => store.setting('mailmeta');
export function cats() {
  const L = (meta().cats || DEFAULT_CATS).filter(c => c.k !== 'other');
  const o = (meta().cats || DEFAULT_CATS).find(c => c.k === 'other') || DEFAULT_CATS[DEFAULT_CATS.length - 1];
  return [...L, o];
}
export const catList = () => cats().map(c => [c.k, c.n]);
export const catName = k => (cats().find(c => c.k === k) || cats()[cats().length - 1]).n;
export const kwSplit = s => String(s || '').split(/[,，、\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
let CC = new Map(), CCgen = -1, KC = null, KCgen = -1;
export function mailCo(m) {
  if (CCgen !== store.gen) { CC = new Map(); CCgen = store.gen; }
  const k = m.from + '|' + m.from_name; if (CC.has(k)) return CC.get(k);
  const c = (m.folder === 'sent' || m.folder === 'draft') ? null : matchCo(m.from_name !== m.from ? m.from_name : '', '');
  CC.set(k, c); return c;
}
function compiled() {
  if (KC && KCgen === store.gen) return KC;
  const L = cats(); KC = { keys: new Set(L.map(c => c.k)), first: [], rest: [], co: {} };
  for (const c of L) { if (c.co) { KC.co[c.co] = c.k; continue; } const kw = kwSplit(c.kw); if (kw.length) (c.first ? KC.first : KC.rest).push([c.k, kw]); }
  KC.other = L[L.length - 1].k; KCgen = store.gen; return KC;
}
export function classify(m) {
  const M = meta(); const K = compiled(); const from = String(m.from || '').toLowerCase(); const dom = from.split('@')[1] || '';
  const ok = k => k && K.keys.has(k) ? k : '';
  const man = ok(M.cat?.[m.id]) || ok(M.rules?.[from]) || (dom && ok(M.rules?.['@' + dom])); if (man) return man;
  const t = `${m.subject} ${m.snippet} ${m.from_name} ${m.from}`.toLowerCase();
  for (const [k, kw] of K.first) if (kw.some(w => t.includes(w))) return k;
  const c = mailCo(m); if (c) { const k = K.co[c.kind === 'S' ? 'S' : 'C']; if (k) return k; }
  for (const [k, kw] of K.rest) if (kw.some(w => t.includes(w))) return k;
  return K.other;
}
export async function setCat(m, cat, rule) {
  const M = meta(); const c = { ...(M.cat || {}) }, r = { ...(M.rules || {}) };
  c[m.id] = cat; if (rule && m.from) r[String(m.from).toLowerCase()] = cat;
  await store.saveSetting('mailmeta', { ...M, cat: c, rules: r });
}

// 排序／篩選：time＝依時間、top＝未讀置頂、only＝只看未讀（記在這台裝置）
export const SORTS = [['time', '依時間'], ['top', '未讀置頂'], ['only', '只看未讀']];
export const mailSort = v => { try { if (v) localStorage.setItem('zr-mail-sort', v); return localStorage.getItem('zr-mail-sort') || 'time'; } catch (e) { return v || 'time'; } };
export function orderMail(items, mode, folder = 'inbox', keep = '') {   // keep：正在看的那封，看了變已讀也先留著
  if (folder !== 'inbox' || mode === 'time') return items;
  const r = mailRead();
  if (mode === 'only') return items.filter(m => !r[m.id] || m.id === keep);
  return [...items.filter(m => !r[m.id]), ...items.filter(m => r[m.id])];
}

// ---------- 資料 ----------
export async function mailLoad(q = '', folder = 'inbox') {
  try {
    const r = await api.get(`/api/email/list?folder=${folder}&q=${encodeURIComponent(q)}`);
    if (!q && folder === 'inbox') { LIST = r; LOADED = Date.now(); window.dispatchEvent(new Event('zr-nav')); }
    return r;
  } catch (e) { return { items: [], total: 0, counts: {}, state: { err: e.message }, cfg: {} }; }
}
export const mailMark = (m, on = true) => mailMarkMany([m.id], on);
export async function mailMarkMany(list, on = true) {
  const s = store.setting('mailread'); const read = { ...(s.read || {}) };
  for (const id of list) if (on) read[id] = 1; else delete read[id];
  const ids = Object.keys(read); if (ids.length > 3000) for (const k of ids.slice(0, ids.length - 3000)) delete read[k];
  await store.saveSetting('mailread', { ...s, read }); window.dispatchEvent(new Event('zr-nav'));
}
export const mailDelete = (ids, on = true) => api.post('/api/email/del', { ids, on });
export const mailPurge = ids => api.post('/api/email/purge', { ids });
/** 信件內容放在沒有腳本、沒有同源權限的 iframe 裡（信裡的程式不會執行），連結開新分頁 */
export const mailFrame = (m, h = '70vh') => m.html
  ? `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" style="width:100%;height:${h};border:0;background:#fff" srcdoc="${esc('<base target="_blank"><meta charset="utf-8"><style>body{font-family:-apple-system,"Microsoft JhengHei",sans-serif;font-size:15px;margin:10px;word-break:break-word}img{max-width:100%;height:auto}</style>' + m.html)}"></iframe>`
  : `<pre style="white-space:pre-wrap;word-break:break-word;font:inherit;margin:10px">${esc(m.text || '')}</pre>`;
export const attUrl = (m, a, dl) => `/api/email/att?id=${m.id}&n=${a.n}${dl ? '&dl=1' : ''}`;
export const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
setInterval(() => { if (store.user) mailLoad(); }, 120000);
setTimeout(() => { if (store.user) mailLoad(); }, 4000);

// ---------- 寫信（新增、回覆、全部回覆、轉寄、編輯草稿）：電腦版和手機版共用 ----------
const sig = () => { const co = store.setting('company') || {}; return `\n\n--\n${co.name || '志瑞螺絲企業有限公司'}\n電話 ${co.phone || ''}　傳真 ${co.fax || ''}\n${co.addr || ''}`; };
/** 依模式準備表單內容；mode：new／reply／all／fwd／draft；src：原信（完整內容） */
export function composeInit(mode, src) {
  if (mode === 'draft' && src) return { to: src.to_raw ?? src.to ?? '', cc: src.cc_raw || '', subject: src.subject === '（沒有主旨）' ? '' : src.subject, body: src.body ?? src.text ?? '', reply_to: src.reply_to || '', fwd: (src.atts || []).map(a => ({ id: src.id, n: a.n, name: a.name, size: a.size })), draft_id: src.id };
  if (!src) return { to: '', cc: '', subject: '', body: sig(), fwd: [] };
  const me = String(LIST.cfg?.from_addr || LIST.cfg?.user || '').toLowerCase();
  const head = `\n\n----- 原始郵件 -----\n寄件人：${src.from_name} <${src.from}>\n日期：${new Date(src.date).toLocaleString('zh-TW')}\n收件人：${src.to || ''}\n主旨：${src.subject}\n\n`;
  const quoted = String(src.text || '').split('\n').map(l => '> ' + l).join('\n');
  const re = s => /^(re|回覆)\s*[:：]/i.test(s) ? s : 'Re: ' + s, fw = s => /^(fw|fwd|轉寄)\s*[:：]/i.test(s) ? s : 'Fw: ' + s;
  if (mode === 'fwd') return { to: '', cc: '', subject: fw(src.subject), body: sig() + head + (src.text || ''), fwd: (src.atts || []).map(a => ({ id: src.id, n: a.n, name: a.name, size: a.size })) };
  const cc = mode === 'all' ? String(src.to || '').split(',').map(s => s.trim()).filter(a => a && !a.toLowerCase().includes(me) && a.toLowerCase() !== String(src.from).toLowerCase()).join(', ') : '';
  return { to: src.from, cc, subject: re(src.subject), body: sig() + head + quoted, reply_to: src.id, fwd: [] };
}
/** 把寫信表單畫進 box；done(結果) 在寄出或存草稿後呼叫 */
export function composeForm(box, v, done, ask = confirm) {
  const files = [];
  const paint = () => {
    box.innerHTML = `<div class="f"><label for="cm-to">收件人（多個用逗號隔開）</label><input id="cm-to" value="${esc(v.to)}" autocomplete="off" inputmode="email"></div>
      <div class="f"><label for="cm-cc">副本</label><input id="cm-cc" value="${esc(v.cc)}" autocomplete="off" inputmode="email"></div>
      <div class="f"><label for="cm-sub">主旨</label><input id="cm-sub" value="${esc(v.subject)}"></div>
      <div class="f"><label for="cm-body">內容</label><textarea id="cm-body" style="min-height:260px;font:inherit">${esc(v.body)}</textarea></div>
      <div class="f"><label>附件</label><div id="cm-atts" style="display:flex;flex-wrap:wrap;gap:6px">${v.fwd.map((a, i) => `<span class="pill">📎 ${esc(a.name)} <span class="muted">${kb(a.size || 0)}</span> <a href="#" data-rf="${i}" title="拿掉">✕</a></span>`).join('')}${files.map((f, i) => `<span class="pill">📎 ${esc(f.name)} <span class="muted">${kb(f.size)}</span> <a href="#" data-rn="${i}" title="拿掉">✕</a></span>`).join('')}</div>
        <input type="file" id="cm-file" multiple style="margin-top:6px"></div>
      <div class="err" id="cm-err"></div>
      <div class="tools" style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" id="cm-draft">存草稿</button><button class="btn pri" id="cm-send">傳送</button></div>`;
    const sync = () => { v.to = box.querySelector('#cm-to').value; v.cc = box.querySelector('#cm-cc').value; v.subject = box.querySelector('#cm-sub').value; v.body = box.querySelector('#cm-body').value; };
    box.querySelectorAll('[data-rf]').forEach(a => a.onclick = ev => { ev.preventDefault(); sync(); v.fwd.splice(+a.dataset.rf, 1); paint(); });
    box.querySelectorAll('[data-rn]').forEach(a => a.onclick = ev => { ev.preventDefault(); sync(); files.splice(+a.dataset.rn, 1); paint(); });
    box.querySelector('#cm-file').onchange = async ev => {
      sync();
      for (const f of ev.target.files) {
        if (f.size > 20 * 1024 * 1024) { toast(`${f.name} 超過 20 MB`); continue; }
        const data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.readAsDataURL(f); });
        files.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, data });
      }
      paint();
    };
    const go = async (kind, btn) => {
      sync(); const err = box.querySelector('#cm-err'); err.textContent = '';
      if (kind === 'send' && !v.to.trim()) { err.textContent = '請填收件人'; return; }
      if (kind === 'send' && !await ask(`寄出這封信給 ${v.to}${v.cc ? `，副本 ${v.cc}` : ''}？`, { ok: '寄出' })) return;
      btn.disabled = true; btn.textContent = kind === 'send' ? '寄出中…' : '儲存中…';
      try {
        const body = { to: v.to, cc: v.cc, subject: v.subject, body: v.body, reply_to: v.reply_to || '', fwd: v.fwd.map(a => ({ id: a.id, n: a.n })), files: files.map(f => ({ name: f.name, type: f.type, data: f.data })), draft_id: v.draft_id || '', id: v.draft_id || '' };
        const r = await api.post(kind === 'send' ? '/api/email/send' : '/api/email/draft', body);
        store.log(kind === 'send' ? '寄信' : '存草稿', `${v.subject || '（沒有主旨）'}｜${v.to}`);
        toast(kind === 'send' ? '已寄出' : '已存成草稿'); done && done({ kind, id: r.id });
      } catch (e) { err.textContent = e.message || String(e); btn.disabled = false; btn.textContent = kind === 'send' ? '傳送' : '存草稿'; }
    };
    box.querySelector('#cm-send').onclick = ev => go('send', ev.target);
    box.querySelector('#cm-draft').onclick = ev => go('draft', ev.target);
  };
  paint();
}

// ---------- 電腦版頁面 ----------
export default {
  id: 'email', name: '電子信箱', icon: 'mail', group: '管理',
  badge() { const r = mailRead(); return { cnt: LIST.items.filter(m => !r[m.id]).length }; },
  async render(el) { this.el = el; draw(el); await refresh(el); },
  onChange(ch) { if (this.el?.isConnected && ch.has('settings')) { drawSide(this.el); drawList(this.el); } },
};
let CUR = { items: [], counts: {} };
async function refresh(el) {
  const r = await mailLoad(ui.q.trim(), ui.folder); if (!ui.q.trim() && ui.folder !== 'inbox') await mailLoad();
  CUR = r; if (!el.isConnected) return; el.querySelector('#emState').innerHTML = stateText(); drawSide(el); drawList(el);
}
function stateText() {
  const s = LIST.state || {}; const c = LIST.cfg || {};
  if (!c.pass_set) return '還沒設定收信帳號，請按「收信設定」。';
  return `${s.running ? '收信中…' : s.last ? `上次收信 ${mailWhen(s.last)}${s.new ? `，收到 ${s.new} 封新信` : ''}` : '還沒收過信'}${c.auto ? `・每 ${c.interval} 分鐘自動收信` : '・自動收信關閉'}${s.err ? `<div style="color:var(--warn)">${esc(s.err)}</div>` : ''}`;
}
function draw(el) {
  const admin = (store.user?.role || 'admin') === 'admin';
  el.innerHTML = `<div class="head"><h1>電子信箱</h1><span class="sub" id="emState">${stateText()}</span><span class="sp"></span>
      <button class="btn pri" id="emNew">＋ 新郵件</button><button class="btn" id="emFetch">立即收信</button>${admin ? '<button class="btn" id="emCfg">收信設定</button>' : ''}<a class="btn" href="${WEBMAIL}" target="_blank" rel="noopener">HiNet 網頁信箱</a></div>
    <div class="panel" style="display:grid;grid-template-columns:150px minmax(280px,380px) 1fr;gap:14px;align-items:start">
      <div id="emSide"></div>
      <div><input type="search" id="emQ" placeholder="搜尋寄件人、主旨、內容" value="${esc(ui.q)}" style="width:100%;margin-bottom:8px">
        <div class="tools" style="margin-bottom:6px;align-items:center;gap:6px;flex-wrap:wrap"><label class="check small" title="全選／全不選"><input type="checkbox" id="emAll"> 全選</label><span class="muted small" id="emInfo"></span><span class="sp"></span><select id="emSort" class="sm" aria-label="排序">${SORTS.map(([k, n]) => `<option value="${k}" ${mailSort() === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div id="emBulk" class="tools" style="gap:6px;margin-bottom:6px;flex-wrap:wrap"></div>
        <div id="emList" style="max-height:72vh;overflow:auto;border:1px solid var(--line);border-radius:8px"></div></div>
      <div id="emView"><div class="empty"><b>點左邊的信來看</b></div></div></div>`;
  el.querySelector('#emNew').onclick = () => openCompose(el, 'new');
  el.querySelector('#emFetch').onclick = async () => { try { await api.post('/api/email/fetch', {}); toast('開始收信…'); setTimeout(() => refresh(el), 4000); } catch (e) { toast(e.message); } };
  el.querySelector('#emCfg')?.addEventListener('click', () => cfgDialog(() => refresh(el)));
  el.querySelector('#emSort').onchange = ev => { mailSort(ev.target.value); ui.checked.clear(); drawList(el); };
  let tm = 0; el.querySelector('#emQ').addEventListener('input', ev => { clearTimeout(tm); tm = setTimeout(() => { ui.q = ev.target.value; refresh(el); }, 300); });
  drawSide(el); drawList(el);
  if (ui.sel) openMsg(el, ui.sel);
}
function drawSide(el) {
  const box = el.querySelector('#emSide'); if (!box) return;
  const cnt = (CUR.counts && Object.keys(CUR.counts).length ? CUR.counts : LIST.counts) || {};
  const inbox = ui.folder === 'inbox' && !ui.q ? CUR.items : LIST.items; const r = mailRead();
  const byCat = {}; for (const m of inbox) { const k = classify(m); byCat[k] = byCat[k] || { n: 0, u: 0 }; byCat[k].n++; if (!r[m.id]) byCat[k].u++; }
  const item = (on, attrs, label, n, u) => `<a href="#" ${attrs} style="display:flex;padding:6px 8px;border-radius:6px;text-decoration:none;color:inherit;${on ? 'background:var(--blue-soft);font-weight:600' : ''}"><span>${label}</span><span class="sp"></span><span class="muted small">${u ? `<b style="color:#1e88e5">${u}</b>／` : ''}${n || ''}</span></a>`;
  box.innerHTML = FOLDERS.map(([k, n]) => item(ui.folder === k && !ui.cat, `data-fd="${k}"`, n, cnt[k], k === 'inbox' ? LIST.items.filter(m => !r[m.id]).length : 0)).join('')
    + '<div class="muted small" style="margin:10px 8px 4px;display:flex"><span>收件匣分類</span><span class="sp"></span><a href="#" id="emCatEdit" title="新增、改名、刪除、排序、關鍵字">編輯</a></div>'
    + catList().map(([k, n]) => item(ui.folder === 'inbox' && ui.cat === k, `data-ct="${k}"`, n, byCat[k]?.n, byCat[k]?.u)).join('');
  box.querySelectorAll('[data-fd]').forEach(a => a.onclick = ev => { ev.preventDefault(); ui.folder = a.dataset.fd; ui.cat = ''; ui.sel = ''; ui.checked.clear(); refresh(el); el.querySelector('#emView').innerHTML = '<div class="empty"><b>點左邊的信來看</b></div>'; });
  box.querySelector('#emCatEdit').onclick = ev => { ev.preventDefault(); catDialog(() => { ui.cat = cats().some(c => c.k === ui.cat) ? ui.cat : ''; drawSide(el); drawList(el); }); };
  box.querySelectorAll('[data-ct]').forEach(a => a.onclick = ev => { ev.preventDefault(); const was = ui.folder; ui.folder = 'inbox'; ui.cat = ui.cat === a.dataset.ct ? '' : a.dataset.ct; ui.checked.clear(); if (was !== 'inbox') refresh(el); else { drawSide(el); drawList(el); } });
}
function shownList() { return orderMail(ui.folder === 'inbox' && ui.cat ? CUR.items.filter(m => classify(m) === ui.cat) : CUR.items, mailSort(), ui.folder, ui.sel); }
function drawList(el) {
  const box = el.querySelector('#emList'); if (!box) return;
  const L = shownList(); const r = mailRead(); const inbox = ui.folder === 'inbox';
  el.querySelector('#emInfo').textContent = `${FOLDERS.find(x => x[0] === ui.folder)[1]}${ui.cat ? '・' + catName(ui.cat) : ''} ${L.length} 封${CUR.total > CUR.items.length ? `（共 ${CUR.total}，只列最近 ${CUR.items.length}）` : ''}`;
  for (const id of [...ui.checked]) if (!L.some(m => m.id === id)) ui.checked.delete(id);   // 換分類、篩選後，看不到的不算勾選
  const bulk = el.querySelector('#emBulk'); const n = ui.checked.size;
  const all = el.querySelector('#emAll'); all.checked = n > 0 && n === L.length; all.indeterminate = n > 0 && n < L.length; all.disabled = !L.length;
  all.onchange = () => { if (all.checked) L.forEach(m => ui.checked.add(m.id)); else ui.checked.clear(); drawList(el); };
  bulk.innerHTML = n ? `<b class="small">已勾選 ${n} 封</b>` + (ui.folder === 'trash' ? `<button class="btn sm" id="bkRestore">復原</button><button class="btn sm danger" id="bkPurge">永久刪除</button>` : `<button class="btn sm danger" id="bkDel">刪除</button>${inbox ? '<button class="btn sm" id="bkRead">標成已讀</button><button class="btn sm" id="bkUnread">標成未讀</button>' : ''}`) + '<button class="btn sm ghost" id="bkClear">取消勾選</button>' : '';
  bulk.style.display = n ? 'flex' : 'none';
  box.innerHTML = L.map(m => { const u = inbox && !r[m.id]; const who = ui.folder === 'sent' || ui.folder === 'draft' ? '給 ' + (m.to || '（沒有收件人）') : m.from_name; const c = inbox ? mailCo(m) : null;
    return `<div data-em="${m.id}" style="display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line);cursor:pointer;${m.id === ui.sel ? 'background:var(--blue-soft);' : ''}">
      <input type="checkbox" data-ck="${m.id}" ${ui.checked.has(m.id) ? 'checked' : ''} aria-label="勾選" style="margin-top:3px">
      <div style="min-width:0;flex:1"><div style="display:flex;gap:6px;align-items:center">${u ? '<span style="width:8px;height:8px;border-radius:50%;background:#1e88e5;flex:none"></span>' : ''}<b style="${u ? '' : 'font-weight:400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c ? cdisp(c) : who)}</b>${inbox ? `<span class="pill" style="flex:none">${esc(catName(classify(m)))}</span>` : ''}<span class="sp"></span><span class="muted small nowrap">${m.att ? '📎 ' : ''}${esc(mailWhen(m.date))}</span></div>
      <div style="${u ? 'font-weight:600' : ''};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.subject)}</div>
      <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.snippet)}</div></div></div>`; }).join('') || `<div class="muted" style="padding:12px">${ui.q ? '沒有符合的信' : '沒有信'}</div>`;
  box.querySelectorAll('[data-ck]').forEach(c => { c.onclick = ev => ev.stopPropagation(); c.onchange = () => { if (c.checked) ui.checked.add(c.dataset.ck); else ui.checked.delete(c.dataset.ck); drawList(el); }; });
  box.querySelectorAll('[data-em]').forEach(a => a.addEventListener('click', () => openMsg(el, a.dataset.em)));
  const ids = [...ui.checked];
  bulk.querySelector('#bkClear')?.addEventListener('click', () => { ui.checked.clear(); drawList(el); });
  bulk.querySelector('#bkRead')?.addEventListener('click', async () => { await mailMarkMany(ids, true); ui.checked.clear(); drawSide(el); drawList(el); });
  bulk.querySelector('#bkUnread')?.addEventListener('click', async () => { await mailMarkMany(ids, false); ui.checked.clear(); drawSide(el); drawList(el); });
  bulk.querySelector('#bkDel')?.addEventListener('click', async () => { await mailDelete(ids, true); ui.checked.clear(); toast(`已移到垃圾桶（${ids.length} 封）`); refresh(el); });
  bulk.querySelector('#bkRestore')?.addEventListener('click', async () => { await mailDelete(ids, false); ui.checked.clear(); toast(`已復原 ${ids.length} 封`); refresh(el); });
  bulk.querySelector('#bkPurge')?.addEventListener('click', async () => { if (!await confirm(`永久刪除 ${ids.length} 封？\n只刪志瑞平台上的這一份，HiNet 信箱裡的信不會動；刪了不能復原。`, { danger: true, ok: '永久刪除' })) return; await mailPurge(ids); ui.checked.clear(); toast('已永久刪除'); refresh(el); });
}
function navTo(el, id) {
  openMsg(el, id); const row = el.querySelector(`[data-em="${id}"]`); row && row.scrollIntoView({ block: 'nearest' });
}
// ← → 換上一封、下一封（在輸入框或有對話框時不動）
document.addEventListener('keydown', ev => {
  const el = document.querySelector('#emView'); if (!el || !ui.sel || ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.querySelector('#modals .modal-bg')) return;
  const b = el.querySelectorAll('[data-nav]')[ev.key === 'ArrowLeft' ? 0 : 1]; if (b && b.dataset.nav) { ev.preventDefault(); b.click(); }
});
async function openMsg(el, id) {
  ui.sel = id; drawList(el); const v = el.querySelector('#emView'); v.innerHTML = '<div class="muted">載入中…</div>';
  let m; try { m = await api.get('/api/email/msg?id=' + id); } catch (e) { v.innerHTML = `<div class="banner">${esc(e.message)}</div>`; return; }
  if (!v.isConnected || ui.sel !== id) return;
  const head = CUR.items.find(x => x.id === id) || m; const trash = ui.folder === 'trash', draft = ui.folder === 'draft', inbox = ui.folder === 'inbox';
  const cat = inbox ? classify(head) : '';
  const L = shownList(); const i = L.findIndex(x => x.id === id); const prev = L[i - 1], next = L[i + 1];
  v.innerHTML = `<div class="tools" style="gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center"><button class="btn sm" data-nav="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'} title="上一封（←）">‹ 上一封</button><button class="btn sm" data-nav="${next ? next.id : ''}" ${next ? '' : 'disabled'} title="下一封（→）">下一封 ›</button>${i >= 0 ? `<span class="muted small">${i + 1}／${L.length}</span>` : ''}<span style="width:8px"></span>${trash ? '<button class="btn sm" data-a="restore">復原</button><button class="btn sm danger" data-a="purge">永久刪除</button>'
      : draft ? '<button class="btn sm pri" data-a="edit">編輯草稿</button><button class="btn sm" data-a="del">刪除</button>'
      : `<button class="btn sm" data-a="reply">回覆</button><button class="btn sm" data-a="all">全部回覆</button><button class="btn sm" data-a="fwd">轉寄</button><button class="btn sm" data-a="del">刪除</button>${inbox ? '<button class="btn sm" data-a="unread">標成未讀</button>' : ''}`}
      ${inbox ? `<span class="sp"></span><label class="small">分類 <select id="emCat">${catList().map(([k, n]) => `<option value="${k}" ${k === cat ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="check small"><input type="checkbox" id="emRule"> 以後這個寄件人都放這類</label>` : ''}</div>
    <div style="margin-bottom:8px"><h2 style="margin:0 0 4px;font-size:18px">${esc(m.subject)}</h2>
      <div class="small"><b>${esc(m.from_name)}</b> <span class="muted">&lt;${esc(m.from)}&gt;</span>${(c => c ? ` <span class="pill">${c.kind === 'S' ? '廠商' : '客戶'}：${esc(cdisp(c))}</span>` : '')(inbox ? mailCo(head) : null)}　<span class="muted">${esc(new Date(m.date).toLocaleString('zh-TW'))}</span></div>
      ${m.to ? `<div class="muted small">收件：${esc(m.to)}</div>` : ''}
      ${(m.atts || []).length ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">${m.atts.map(a => `<span class="pill">📎 <a href="${attUrl(m, a)}" target="_blank" rel="noopener">${esc(a.name)}</a> <span class="muted">${kb(a.size)}</span> <a href="${attUrl(m, a, 1)}" title="下載">⬇</a></span>`).join('')}</div>` : ''}</div>
    <div style="border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff">${mailFrame(m)}</div>`;
  v.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'reply' || a === 'all' || a === 'fwd') return openCompose(el, a, m);
    if (a === 'edit') return openCompose(el, 'draft', m);
    if (a === 'unread') { await mailMark(m, false); drawSide(el); drawList(el); return; }
    if (a === 'del') { await mailDelete([m.id], true); toast('已移到垃圾桶'); }
    if (a === 'restore') { await mailDelete([m.id], false); toast('已復原'); }
    if (a === 'purge') { if (!await confirm('永久刪除這封信？\n只刪志瑞平台上的這一份，HiNet 信箱裡的信不會動；刪了不能復原。', { danger: true, ok: '永久刪除' })) return; await mailPurge([m.id]); toast('已永久刪除'); }
    const go = next || prev; ui.sel = ''; v.innerHTML = '<div class="empty"><b>點左邊的信來看</b></div>'; await refresh(el);
    if (go && el.isConnected && CUR.items.some(x => x.id === go.id)) openMsg(el, go.id);   // 刪除後直接看下一封
  });
  v.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { if (b.dataset.nav) navTo(el, b.dataset.nav); });
  v.querySelector('#emCat')?.addEventListener('change', async ev => { await setCat(head, ev.target.value, v.querySelector('#emRule').checked); toast(`已改成「${catName(ev.target.value)}」`); drawSide(el); drawList(el); });
  v.querySelector('#emRule')?.addEventListener('change', async ev => { if (ev.target.checked) { await setCat(head, v.querySelector('#emCat').value, true); toast(`以後 ${head.from} 的信都放「${catName(v.querySelector('#emCat').value)}」`); drawSide(el); drawList(el); } });
  if (inbox && !isMailRead(m)) { await mailMark(m, true); drawSide(el); drawList(el); }
}
function openCompose(el, mode, src) {
  const v = composeInit(mode, src);
  modal({ title: { new: '新郵件', reply: '回覆', all: '全部回覆', fwd: '轉寄', draft: '編輯草稿' }[mode], width: 760, closeOnBg: false, body: '<div id="cmBox"></div>', footer: '<span class="sp"></span><button class="btn" data-close>關閉</button>',
    onOpen(m, close) { composeForm(m.querySelector('#cmBox'), v, r => { close(); if (r.kind === 'send' && mode === 'draft') ui.sel = ''; refresh(el); }); } });
}
function cfgDialog(after) {
  api.get('/api/email/cfg').then(c => modal({
    title: '收信／寄信設定', width: 620,
    body: `<div class="grid">
      <div class="f"><label for="ec-proto">收信方式</label><select id="ec-proto"><option value="imap" ${c.proto === 'imap' ? 'selected' : ''}>IMAP（建議）</option><option value="pop3" ${c.proto === 'pop3' ? 'selected' : ''}>POP3</option></select></div>
      <div class="f"><label for="ec-host">收信伺服器</label><input id="ec-host" value="${esc(c.host)}"></div>
      <div class="f"><label for="ec-port">埠號</label><input id="ec-port" class="num" value="${esc(c.port)}"></div>
      <label class="check" style="align-self:end"><input type="checkbox" id="ec-ssl" ${c.ssl ? 'checked' : ''}> SSL 加密</label>
      <div class="f"><label for="ec-user">帳號（信箱 @ 前面那段）</label><input id="ec-user" value="${esc(c.user)}" autocomplete="off"></div>
      <div class="f"><label for="ec-pass">密碼</label><input id="ec-pass" type="password" autocomplete="new-password" placeholder="${c.pass_set ? '已設定，不改就留空' : '請輸入'}"></div>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" id="ec-auto" ${c.auto ? 'checked' : ''}> 自動收信，每 <input id="ec-int" class="num" value="${esc(c.interval)}" style="width:50px"> 分鐘一次</label>
      <div class="f" style="grid-column:1/-1;margin-top:6px"><b>寄信</b></div>
      <div class="f"><label for="ec-shost">寄信伺服器</label><input id="ec-shost" value="${esc(c.smtp_host)}"></div>
      <div class="f"><label for="ec-sport">埠號</label><input id="ec-sport" class="num" value="${esc(c.smtp_port)}"></div>
      <div class="f"><label for="ec-ssec">加密</label><select id="ec-ssec">${[['starttls', 'STARTTLS（587）'], ['ssl', 'SSL（465）'], ['none', '不加密（25）']].map(([k, n]) => `<option value="${k}" ${c.smtp_sec === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="f"><label for="ec-from">寄件人信箱</label><input id="ec-from" value="${esc(c.from_addr)}" placeholder="空白＝帳號@msa.hinet.net"></div>
      <div class="f"><label for="ec-fname">寄件人名稱</label><input id="ec-fname" value="${esc(c.from_name)}"></div>
      <div class="f"><label for="ec-spass">寄信密碼（跟收信一樣就留空）</label><input id="ec-spass" type="password" autocomplete="new-password" placeholder="${c.smtp_pass_set ? '已另外設定' : '跟收信同一組'}"></div></div>
      <p class="muted small">HiNet：收信 msa.hinet.net（IMAP 993／POP3 995，SSL）；寄信 msr.hinet.net（587，STARTTLS，要登入）。帳號密碼只存在伺服器電腦，不會傳回網頁。收下來的信不會從 HiNet 刪掉，也不會被標成已讀。</p>
      <div id="ec-msg" class="small"></div>`,
    footer: '<button class="btn" id="ec-test">測試收信</button><button class="btn" id="ec-stest">測試寄信</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ec-save">儲存</button>',
    onOpen(el, close) {
      el.querySelector('#ec-proto').onchange = ev => { const p = el.querySelector('#ec-port'); if (ev.target.value === 'pop3' && p.value === '993') p.value = '995'; if (ev.target.value === 'imap' && p.value === '995') p.value = '993'; };
      el.querySelector('#ec-ssec').onchange = ev => { el.querySelector('#ec-sport').value = { starttls: 587, ssl: 465, none: 25 }[ev.target.value]; };
      const val = () => ({ proto: el.querySelector('#ec-proto').value, host: el.querySelector('#ec-host').value.trim(), port: +el.querySelector('#ec-port').value || 993, ssl: el.querySelector('#ec-ssl').checked, user: el.querySelector('#ec-user').value.trim(), pass: el.querySelector('#ec-pass').value, auto: el.querySelector('#ec-auto').checked, interval: +el.querySelector('#ec-int').value || 5,
        smtp_host: el.querySelector('#ec-shost').value.trim(), smtp_port: +el.querySelector('#ec-sport').value || 587, smtp_sec: el.querySelector('#ec-ssec').value, from_addr: el.querySelector('#ec-from').value.trim(), from_name: el.querySelector('#ec-fname').value.trim(), smtp_pass: el.querySelector('#ec-spass').value });
      const msg = (t, ok) => { const m = el.querySelector('#ec-msg'); m.textContent = t; m.style.color = ok ? 'var(--ok,#1a7f37)' : 'var(--bad,#c62828)'; };
      el.querySelector('#ec-test').onclick = async ev => { ev.target.disabled = true; msg('連線中…', true); try { const r = await api.post('/api/email/test', val()); msg(r.msg, r.ok); } catch (e) { msg(e.message); } ev.target.disabled = false; };
      el.querySelector('#ec-stest').onclick = async ev => { ev.target.disabled = true; msg('連線中…', true); try { const r = await api.post('/api/email/smtptest', val()); msg(r.msg, r.ok); } catch (e) { msg(e.message); } ev.target.disabled = false; };
      el.querySelector('#ec-save').onclick = async () => { try { await api.post('/api/email/cfg', val()); store.log('修改', '電子信箱收信／寄信設定'); close(); toast('已儲存設定'); after && after(); } catch (e) { msg(e.message); } };
    },
  })).catch(e => toast(e.message));
}

// ---------- 編輯分類 ----------
function catDialog(after) {
  let L = cats().map(c => ({ ...c })); const M0 = meta(); let rules = { ...(M0.rules || {}) };
  const coTip = { C: '寄件人名稱對到資料裡的「客戶」', S: '寄件人名稱對到資料裡的「廠商」' };
  modal({
    title: '編輯信箱分類', width: 860, closeOnBg: false,
    body: `<p class="muted small" style="margin-top:0">比對順序：手動指定的信 → 寄件人規則 → 勾「優先」的分類 → 客戶／廠商 → 其他分類照下面順序比關鍵字 → 都沒對到就放最後一類。<br>關鍵字用逗號隔開，比對主旨、內文開頭、寄件人名稱和信箱，不分大小寫。</p>
      <div id="ceRows"></div><button class="btn sm" id="ceAdd" style="margin-top:6px">＋ 新增分類</button>
      <h3 style="margin:16px 0 6px;font-size:15px">寄件人規則 <span class="muted small" style="font-weight:400">（看信時勾「以後這個寄件人都放這類」產生；信箱填 @網域 代表整個網域）</span></h3>
      <div id="ceRules"></div><div style="display:flex;gap:6px;margin-top:6px"><input id="ceRAddr" placeholder="寄件人信箱或 @網域" style="flex:1"><select id="ceRCat"></select><button class="btn sm" id="ceRAdd">加入規則</button></div>
      <div class="err" id="ceErr"></div>`,
    footer: '<button class="btn" id="ceReset" title="分類回到預設（寄件人規則和手動指定不動）">還原預設分類</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ceSave">儲存</button>',
    onOpen(el, close) {
      const sync = () => el.querySelectorAll('[data-row]').forEach(r => { const c = L[+r.dataset.row]; c.n = r.querySelector('[data-f=n]').value.trim(); const kw = r.querySelector('[data-f=kw]'); if (kw) c.kw = kw.value; const f = r.querySelector('[data-f=first]'); if (f) c.first = f.checked; });
      const optCats = sel => L.map(c => `<option value="${esc(c.k)}" ${c.k === sel ? 'selected' : ''}>${esc(c.n || '（未命名）')}</option>`).join('');
      const paint = () => {
        const last = L.length - 1;
        el.querySelector('#ceRows').innerHTML = `<table class="tbl" style="width:100%"><thead><tr><th style="width:150px">名稱</th><th>關鍵字／比對方式</th><th style="width:50px">優先</th><th style="width:120px"></th></tr></thead><tbody>${L.map((c, i) => `<tr data-row="${i}">
          <td><input data-f="n" value="${esc(c.n)}" style="width:100%"></td>
          <td>${i === last ? '<span class="muted small">都沒對到的信放這裡（固定在最後）</span>' : c.co ? `<span class="muted small">${coTip[c.co]}</span>` : `<textarea data-f="kw" rows="2" style="width:100%;font:inherit;font-size:13px">${esc(c.kw || '')}</textarea>`}</td>
          <td style="text-align:center">${i === last || c.co ? '' : `<input type="checkbox" data-f="first" ${c.first ? 'checked' : ''} title="比客戶／廠商先比對（例如廣告）">`}</td>
          <td class="nowrap">${i === last ? '' : `<button class="btn sm" data-up="${i}" ${i ? '' : 'disabled'} title="上移">↑</button><button class="btn sm" data-dn="${i}" ${i < last - 1 ? '' : 'disabled'} title="下移">↓</button><button class="btn sm danger" data-rm="${i}">刪除</button>`}</td></tr>`).join('')}</tbody></table>`;
        const R = Object.entries(rules).sort((a, b) => a[0].localeCompare(b[0]));
        el.querySelector('#ceRules').innerHTML = R.length ? `<table class="tbl" style="width:100%"><tbody>${R.map(([a, k]) => `<tr><td>${esc(a)}</td><td style="width:180px"><select data-ra="${esc(a)}">${optCats(k)}${L.some(c => c.k === k) ? '' : `<option value="${esc(k)}" selected>（已刪除的分類）</option>`}</select></td><td style="width:60px"><button class="btn sm danger" data-rr="${esc(a)}">刪除</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted small">還沒有寄件人規則</div>';
        el.querySelector('#ceRCat').innerHTML = optCats(L[0]?.k);
        el.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { sync(); const i = +b.dataset.up; [L[i - 1], L[i]] = [L[i], L[i - 1]]; paint(); });
        el.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { sync(); const i = +b.dataset.dn; [L[i + 1], L[i]] = [L[i], L[i + 1]]; paint(); });
        el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sync(); const c = L[+b.dataset.rm]; const nr = Object.values(rules).filter(k => k === c.k).length;
          if (nr && !window.confirm(`「${c.n}」有 ${nr} 條寄件人規則，刪掉分類後這些規則會失效（信改用自動分類）。確定刪除？`)) return; L.splice(+b.dataset.rm, 1); paint(); });
        el.querySelectorAll('[data-ra]').forEach(s => s.onchange = () => { rules[s.dataset.ra] = s.value; });
        el.querySelectorAll('[data-rr]').forEach(b => b.onclick = () => { sync(); delete rules[b.dataset.rr]; paint(); });
      };
      paint();
      el.querySelector('#ceAdd').onclick = () => { sync(); L.splice(L.length - 1, 0, { k: 'u' + Date.now().toString(36), n: '新分類', kw: '' }); paint(); const ins = el.querySelectorAll('[data-f=n]'); const x = ins[ins.length - 2]; x && (x.focus(), x.select()); };
      el.querySelector('#ceRAdd').onclick = () => { sync(); const a = el.querySelector('#ceRAddr').value.trim().toLowerCase(); if (!/^[^\s@]*@[^\s@]+$/.test(a)) { el.querySelector('#ceErr').textContent = '請填寄件人信箱（例如 abc@xx.com.tw）或 @網域（例如 @xx.com.tw）'; return; } rules[a] = el.querySelector('#ceRCat').value; el.querySelector('#ceRAddr').value = ''; el.querySelector('#ceErr').textContent = ''; paint(); };
      el.querySelector('#ceReset').onclick = () => { L = DEFAULT_CATS.map(c => ({ ...c })); paint(); };
      el.querySelector('#ceSave').onclick = async () => {
        sync(); const err = el.querySelector('#ceErr');
        if (L.some(c => !c.n)) { err.textContent = '分類名稱不能空白'; return; }
        if (new Set(L.map(c => c.n)).size !== L.length) { err.textContent = '分類名稱重複了'; return; }
        const out = L.map(c => { const o = { k: c.k, n: c.n }; if (c.co) o.co = c.co; else if (c !== L[L.length - 1]) { o.kw = kwSplit(c.kw).length ? String(c.kw).split(/[,，、\n]+/).map(x => x.trim()).filter(Boolean).join(',') : ''; if (c.first) o.first = true; } return o; });
        out[out.length - 1].k = 'other';
        const M = meta(); await store.saveSetting('mailmeta', { ...M, cats: out, rules });
        store.log('修改', '信箱分類'); close(); toast('已儲存分類'); after && after();
      };
    },
  });
}

