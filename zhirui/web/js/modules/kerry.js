// 嘉里託運：把要寄嘉里大榮的銷貨單整理成「網路託運平台 → 多筆匯入」的 Excel。
// 嘉里那邊要先在「基本維護 → 設定上傳格式」建一個格式，欄位順序照 COLS（第一次設定一次就好）。
// 收貨人、地址、電話預設帶客戶資料；改過的會記住（設定 kerry），下次同一個客戶直接帶。
// 「送嘉里」：伺服器用設定好的嘉里帳號登入、上傳、送出，拿回託運單號記在銷貨單（server/kerry.py）。
import { esc, fmt, today, slash } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm } from '../core/ui.js';
import { api } from '../core/api.js';
import { calc, cdisp, totals } from '../core/calc.js';
import { printName } from '../core/names.js';
import { billKg } from './ship.js';
import { loadXlsx } from './purchase_import.js';
import { matchCo } from './faxin.js';

export const COLS = ['出貨日期', '收貨人', '收貨人地址', '收貨人電話1', '收貨人電話2', '件數', '重量', '出貨單號', '代收貨款', '貨品內容', '備註'];
const KERRY = 'https://webedi.kerrytj.com/login.aspx';
const ui = { date: '', pick: new Set(), rows: {}, busy: false, showSkip: false };
const shipDate = b => (b.date && b.date > today() ? b.date : today());   // 託運日期不能是過去
const mem = () => store.setting('kerry').c || {};
// 嘉里「維護收貨人」匯出的收貨人清單（設定 kerrybook）：對到客戶就優先用它的地址電話
let BOOK = null, BOOKgen = -1;
function bookOf(cid) {
  if (!BOOK || BOOKgen !== store.gen) { BOOK = new Map(); BOOKgen = store.gen; for (const x of store.setting('kerrybook').list || []) { const c = matchCo(x.name, x.tel); if (c && c.kind === 'C' && !BOOK.has(c.id)) BOOK.set(c.id, x); } }
  return BOOK.get(cid) || null;
}
const tel = t => String(t || '').split(/[、,，;；/／]/)[0].replace(/\s+/g, '').replace(/^\((\d+)\)/, '$1-').replace(/[()]/g, '');   // (04)2330-2106 → 04-2330-2106；多支電話取第一支

export default {
  id: 'kerry', name: '嘉里託運', group: '倉儲', icon: 'stock',
  render(el) { this.el = el; if (!ui.date) ui.date = today(); draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts'))) draw(this.el); },
};
export function rowOf(b) {
  if (ui.rows[b.id]) return ui.rows[b.id];
  const C = calc(); const c = C.ct[b.cid] || {}; const m = mem()[b.cid] || {}; const k = bookOf(b.cid) || {}; const w = billKg(b).kg;
  return ui.rows[b.id] = { name: m.name || k.name || printName(c.name || '') || cdisp(c), addr: m.addr || k.addr || c.addr || '', tel: m.tel || tel(k.tel) || tel(c.phone), tel2: m.tel2 || tel(k.tel2) || tel(c.mobile), n: m.n || 1, kg: w > 0 ? Math.max(1, Math.ceil(w)) : '', cod: '', what: m.what || '螺絲', note: '' };
}
function draw(el) {
  const C = calc();
  const day = C.bills.filter(b => b.type === 'SALE' && !b.hist && b.date === ui.date).sort((a, b) => String(a.no).localeCompare(String(b.no)));
  const skipped = day.filter(b => b.noKerry); const list = ui.showSkip ? day : day.filter(b => !b.noKerry);
  for (const id of [...ui.pick]) if (!list.some(b => b.id === id)) ui.pick.delete(id);
  const bad = b => { const r = rowOf(b); return !r.name || !r.addr || !r.tel || !(+r.n >= 1 && +r.n <= 999); };
  el.innerHTML = `<div class="head"><h1>嘉里託運</h1><span class="sub">勾要寄嘉里的出貨單 → 下載 Excel → 到嘉里「多筆匯入」上傳</span><span class="sp"></span><a class="btn" href="${KERRY}" target="_blank" rel="noopener">開嘉里網路託運</a><button class="btn" id="kHelp">第一次設定</button><button class="btn" id="kBook" title="嘉里網站「基本維護 → 維護收貨人」匯出的 Excel">匯入嘉里收貨人${(store.setting('kerrybook').list || []).length ? `（${store.setting('kerrybook').list.length}）` : ''}</button><input type="file" id="kBookFile" accept=".xls,.xlsx,.csv" hidden>${(store.user?.role || 'admin') === 'admin' ? '<button class="btn" id="kCfg">帳號設定</button>' : ''}</div>
    <div class="panel" style="display:grid;gap:10px">
      <div class="tools"><label>出貨日期 <input type="date" id="kDate" value="${esc(ui.date)}"></label><button class="btn sm" data-d="-1">‹ 前一天</button><button class="btn sm" data-d="1">後一天 ›</button><span class="sp"></span><span class="muted small">${list.length} 張出貨單，勾選 ${ui.pick.size} 張${skipped.length ? `・<a href="#" id="kSkip">${ui.showSkip ? '隱藏' : '顯示'}不寄嘉里的 ${skipped.length} 張</a>` : ''}</span><button class="btn" id="kGo" ${ui.pick.size ? '' : 'disabled'}>下載 Excel（${ui.pick.size}）</button><button class="btn pri" id="kSendAll" ${ui.pick.size && !ui.busy ? '' : 'disabled'}>勾選的直接送嘉里（${ui.pick.size}）</button></div>
      <div class="tw"><table><thead><tr><th style="width:30px"><input type="checkbox" id="kAll" ${list.length && ui.pick.size === list.length ? 'checked' : ''} aria-label="全選"></th><th>出貨單號</th><th>收貨人</th><th>收貨人地址</th><th>電話1</th><th>電話2</th><th class="n" style="width:60px">件數</th><th class="n" style="width:70px">重量 kg</th><th class="n" style="width:90px">代收貨款</th><th style="width:90px">貨品內容</th><th>備註</th><th>嘉里</th></tr></thead><tbody>
      ${list.map(b => { const r = rowOf(b); const inp = (k, w, cls = '') => `<input data-b="${b.id}" data-k="${k}" value="${esc(r[k])}" class="${cls}" style="width:${w};min-width:0">`;
        return `<tr ${ui.pick.has(b.id) && bad(b) ? 'style="background:var(--bad-soft)"' : ''}><td><input type="checkbox" data-p="${b.id}" ${ui.pick.has(b.id) ? 'checked' : ''}></td><td class="mono nowrap">${esc(b.no)}<div class="muted small">${esc(cdisp(C.ct[b.cid]) || '')}・${fmt(totals(b).total)}</div></td>
          <td>${inp('name', '140px')}</td><td>${inp('addr', '100%')}</td><td>${inp('tel', '110px')}</td><td>${inp('tel2', '100px')}</td><td>${inp('n', '50px', 'num')}</td><td>${inp('kg', '60px', 'num')}</td><td>${inp('cod', '80px', 'num')}</td><td>${inp('what', '80px')}</td><td>${inp('note', '100%')}</td><td class="nowrap">${b.kerry?.no || b.kerry?.at ? `<span class="pill ok" title="${esc(b.kerry.at || '')}">${esc(b.kerry.no || '已送出')}</span> <button class="btn xs danger" data-kdel="${b.id}" title="到嘉里網站刪掉這筆託運單（只有當天可以）">刪除</button>` : b.noKerry ? `<span class="pill">不寄嘉里</span> <button class="btn xs" data-unskip="${b.id}">改回要寄</button>` : `<button class="btn xs" data-send="${b.id}">送嘉里</button> <button class="btn xs" data-skip="${b.id}" title="這張不寄嘉里，從清單拿掉（銷貨單不會刪）">不寄</button>`}</td></tr>`; }).join('') || `<tr><td colspan="12"><div class="empty"><b>${esc(slash(ui.date))} 沒有出貨單</b>換一天看看</div></td></tr>`}
      </tbody></table></div>
      <p class="muted small" style="margin:0">收貨人、地址、電話預設帶客戶資料；這裡改過的，下載時會記住，下次同一個客戶直接帶。重量依商品單重估算（無條件進位到整數公斤）。紅底＝必填欄位（收貨人、地址、電話1、件數）沒填。</p>
    </div>`;
  el.querySelector('#kDate').onchange = ev => { ui.date = ev.target.value || today(); ui.pick.clear(); draw(el); };
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const d = new Date(ui.date + 'T00:00:00'); d.setDate(d.getDate() + +b.dataset.d); ui.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; ui.pick.clear(); draw(el); });
  el.querySelector('#kAll').onchange = ev => { if (ev.target.checked) list.forEach(b => ui.pick.add(b.id)); else ui.pick.clear(); draw(el); };
  el.querySelectorAll('[data-p]').forEach(cb => cb.onchange = () => { if (cb.checked) ui.pick.add(cb.dataset.p); else ui.pick.delete(cb.dataset.p); draw(el); });
  el.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { ui.rows[inp.dataset.b][inp.dataset.k] = inp.value; });
  el.querySelector('#kHelp').onclick = help;
  el.querySelector('#kCfg')?.addEventListener('click', cfgDialog);
  el.querySelector('#kSkip')?.addEventListener('click', ev => { ev.preventDefault(); ui.showSkip = !ui.showSkip; draw(el); });
  const setSkip = async (id, on) => { const cur = store.get('bills', id); if (!cur) return; const { id: _, noKerry, ...rest } = cur; await store.save('bills', id, on ? { ...rest, noKerry: true } : rest); ui.pick.delete(id); };
  el.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => setSkip(b.dataset.skip, true));
  el.querySelectorAll('[data-unskip]').forEach(b => b.onclick = () => setSkip(b.dataset.unskip, false));
  el.querySelectorAll('[data-kdel]').forEach(btn => btn.onclick = async () => { const b = store.get('bills', btn.dataset.kdel); if (b) { await kerryDelete(b); if (el.isConnected) draw(el); } });
  const f = el.querySelector('#kBookFile'); el.querySelector('#kBook').onclick = () => f.click(); { f.onchange = async () => { const file = f.files[0]; if (!file) return; try { const n = await importBook(file); ui.rows = {}; toast(`已匯入嘉里收貨人 ${n} 筆`); if (el.isConnected) draw(el); } catch (e) { toast('匯入失敗：' + (e.message || e)); } f.value = ''; }; }
  el.querySelectorAll('[data-send]').forEach(btn => btn.onclick = async () => { const b = store.get('bills', btn.dataset.send); if (!b) return; btn.disabled = true; btn.textContent = '送出中…'; await sendOne(b); if (el.isConnected) draw(el); });
  el.querySelector('#kSendAll').onclick = async () => {
    const sel = list.filter(b => ui.pick.has(b.id)); const done = sel.filter(b => b.kerry);
    if (sel.some(bad)) { toast('有勾選的單子收貨人、地址、電話1 或件數沒填好'); draw(el); return; }
    if (!await confirm(`把 ${sel.length} 張出貨單送到嘉里建託運單？${done.length ? `\n其中 ${done.length} 張之前送過了，會再送一次。` : ''}\n送出後要改，請到嘉里網站「維護託運登錄」（當天可以改、刪）。`, { ok: '送出' })) return;
    ui.busy = true; draw(el); let ok = 0;
    for (const b of sel) { if (await sendOne(b, true)) ok++; }
    ui.busy = false; ui.pick.clear(); toast(`嘉里託運：送出 ${ok}／${sel.length} 張`); if (el.isConnected) draw(el);
  };
  el.querySelector('#kGo').onclick = async () => {
    const sel = list.filter(b => ui.pick.has(b.id)); const miss = sel.filter(bad);
    if (miss.length) { toast(`${miss.map(b => b.no).join('、')} 的收貨人、地址、電話1 或件數沒填好`); draw(el); return; }
    const badCod = sel.find(b => { const v = +rowOf(b).cod; return rowOf(b).cod !== '' && !(v >= 1 && v <= 50000); }); if (badCod) { toast(`${badCod.no} 的代收貨款要在 1～50,000 之間（不代收就留空）`); return; }
    const aoa = [COLS, ...sel.map(b => { const r = rowOf(b); return [shipDate(b).replace(/-/g, '/'), r.name, r.addr, r.tel, r.tel2, +r.n || 1, r.kg === '' ? '' : +r.kg, b.no, r.cod === '' ? '' : +r.cod, r.what, r.note]; })];
    try {
      const XLSX = await loadXlsx(); const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [10, 20, 40, 14, 14, 6, 8, 14, 10, 10, 20].map(w => ({ wch: w }));
      for (let i = 2; i <= aoa.length; i++) for (const col of ['D', 'E', 'H']) { const c = ws[col + i]; if (c) { c.t = 's'; c.v = String(c.v); c.z = '@'; } }   // 電話、單號存成文字（0 開頭才不會不見）
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '託運'); XLSX.writeFile(wb, `嘉里託運_${ui.date.replace(/-/g, '')}.xlsx`);
    } catch (e) { toast('產生 Excel 失敗：' + (e.message || e)); return; }
    // 記住每個客戶的收貨資料
    const M = { ...mem() }; for (const b of sel) { const r = rowOf(b); M[b.cid] = { name: r.name, addr: r.addr, tel: r.tel, tel2: r.tel2, n: +r.n || 1, what: r.what }; }
    try { await store.saveSetting('kerry', { ...store.setting('kerry'), c: M }); } catch (e) { /* 記不住也沒關係 */ }
    store.log('匯出', `嘉里託運 Excel ${ui.date}｜${sel.length} 張`);
    toast(`已下載 ${sel.length} 筆，請到嘉里「託運登錄 → 多筆匯入」上傳`);
  };
}
function help() {
  modal({ title: '嘉里多筆匯入：第一次設定', width: 640,
    body: `<ol style="margin:0;padding-left:20px;line-height:1.9">
      <li>登入嘉里網路託運平台 → 「基本維護」→「設定上傳格式」→ 新增。</li>
      <li>託運類別選「常溫」，格式名稱隨意（例如「志瑞平台」）。</li>
      <li>照這個順序勾選欄位：<br><b>${COLS.join('、')}</b></li>
      <li>存檔。以後每次：在這裡下載 Excel → 嘉里「託運登錄」→「多筆匯入」→ 託運類別「常溫」、託運人編號選志瑞、上傳格式選剛剛建的 → 選檔案上傳 → 在嘉里確認資料後送出。</li></ol>
      <p class="muted small">嘉里要求：件數 1～999；代收貨款 1～50,000（不代收留空）。常溫託運週一到週五 16:00、週六 14:00 截止。</p>`,
    footer: `<a class="btn" href="${KERRY}" target="_blank" rel="noopener">開嘉里網路託運</a><span class="sp"></span><button class="btn pri" data-close>知道了</button>` });
}

// ---------- 嘉里收貨人清單匯入 ----------
async function importBook(file) {
  const XLSX = await loadXlsx(); const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const H = rows[0].map(x => String(x).trim()); const ix = names => names.map(n => H.indexOf(n)).find(i => i >= 0);
  const c = { code: ix(['收貨人編號', '收貨人代號']), name: ix(['收貨人']), tel: ix(['電話', '電話1', '收貨人電話1']), addr: ix(['地址', '收貨人地址']), tel2: ix(['電話2', '收貨人電話2']) };
  if (c.name == null || c.addr == null) throw new Error('找不到「收貨人」「地址」欄');
  const list = rows.slice(1).map(r => ({ code: String(r[c.code] ?? '').trim(), name: String(r[c.name] ?? '').trim(), tel: String(r[c.tel] ?? '').trim(), addr: String(r[c.addr] ?? '').trim(), tel2: String(r[c.tel2] ?? '').trim() })).filter(x => x.name && x.addr);
  if (!list.length) throw new Error('檔案裡沒有收貨人');
  await store.saveSetting('kerrybook', { list, at: new Date().toISOString(), file: file.name });
  store.log('匯入', `嘉里收貨人清單 ${list.length} 筆`);
  return list.length;
}

// ---------- 直接送嘉里（伺服器代登入、上傳、送出） ----------
/** 送一張：成功回傳 true。quiet＝批次送時不再一張張問（重複、聯運確認仍會問） */
export async function sendOne(b, quiet) {
  const r = rowOf(b);
  const ship = { ship_date: shipDate(b), name: r.name, addr: r.addr, tel: r.tel, tel2: r.tel2, n: r.n, kg: r.kg, no: b.no, cod: r.cod, what: r.what, note: r.note };
  let res;
  try {
    res = await api.post('/api/kerry/send', { ship });
    if (res.need_confirm) { if (!await confirm(`嘉里提醒（${b.no}）：\n${res.need_confirm}\n\n還是要送出嗎？`, { ok: '送出' })) return false; res = await api.post('/api/kerry/send', { ship, confirm: 1 }); }
  } catch (e) { toast(`${b.no} 送嘉里失敗：${e.message || e}`); return false; }
  if (!res?.ok) { toast(`${b.no} 送嘉里失敗`); return false; }
  const cur = store.get('bills', b.id);
  if (cur) { const { id, ...rest } = cur; await store.save('bills', b.id, { ...rest, kerry: { no: res.no || '', at: new Date().toISOString(), by: store.user?.name || '', n: +r.n || 1 } }); }
  const M = { ...mem(), [b.cid]: { name: r.name, addr: r.addr, tel: r.tel, tel2: r.tel2, n: +r.n || 1, what: r.what } };
  try { await store.saveSetting('kerry', { ...store.setting('kerry'), c: M }); } catch (e) { /* 記不住也沒關係 */ }
  store.log('嘉里託運', `${b.no}｜${r.name}｜${res.no ? '託運單號 ' + res.no : res.msg || ''}`);
  if (!quiet) toast(res.no ? `已送嘉里，託運單號 ${res.no}` : `已送嘉里（${res.msg || '沒抓到託運單號，請到嘉里網站查'}）`);
  return true;
}
/** 刪掉已送到嘉里的託運單（伺服器到嘉里網站刪），成功就清掉銷貨單上的託運單號 */
export async function kerryDelete(b) {
  if (!b?.kerry) return false;
  if (!b.kerry.no) { toast('這張沒有記到託運單號，請到嘉里網站「維護託運登錄」手動刪除'); return false; }
  if (!await confirm(`到嘉里刪掉託運單 ${b.kerry.no}（${b.no}）？\n只有託運日期當天可以刪，刪了不能復原。`, { danger: true, ok: '刪除' })) return false;
  try { await api.post('/api/kerry/delete', { no: b.kerry.no }); } catch (e) { toast('刪除失敗：' + (e.message || e)); return false; }
  const cur = store.get('bills', b.id); if (cur) { const { id, kerry, ...rest } = cur; await store.save('bills', b.id, rest); }
  store.log('嘉里託運', `${b.no}｜刪除託運單 ${b.kerry.no}`); toast(`已刪除嘉里託運單 ${b.kerry.no}`);
  return true;
}
/** 銷貨單上的「送嘉里」：先確認收貨資料再送 */
export function kerryShip(b, onDone) {
  if (!b) return;
  const r = rowOf(b); const f = (k, label, w = '') => `<div class="f" ${w}><label for="ks-${k}">${label}</label><input id="ks-${k}" value="${esc(r[k] ?? '')}" ${['n', 'kg', 'cod'].includes(k) ? 'class="num" inputmode="decimal"' : ''}></div>`;
  modal({ title: `送嘉里｜${b.no}`, width: 640,
    body: `${b.kerry ? `<div class="banner">這張 ${esc(b.kerry.at ? new Date(b.kerry.at).toLocaleString('zh-TW', { hour12: false }) : '')} 已經送過嘉里了${b.kerry.no ? `（託運單號 ${esc(b.kerry.no)}）` : ''}，再送會多一筆託運單。</div>` : ''}
      ${b.kerry && !b.kerry.no ? `<div class="f"><label for="ks-kno">託運單號（系統沒抓到，可到嘉里網站查了填在這裡）</label><div style="display:flex;gap:6px"><input id="ks-kno" inputmode="numeric" placeholder="例如 74433269951"><button class="btn" id="ks-knoSave">存託運單號</button></div></div>` : ''}<div class="grid" style="grid-template-columns:1fr 1fr">${f('name', '收貨人')}${f('tel', '電話1')}${f('addr', '收貨人地址', 'style="grid-column:1/-1"')}${f('tel2', '電話2')}${f('what', '貨品內容')}${f('n', '件數（1～999）')}${f('kg', '重量 kg')}${f('cod', '代收貨款（不代收留空）')}${f('note', '備註')}</div>
      <p class="muted small" style="margin:0">託運日期 ${esc(slash(shipDate(b)))}・出貨單號 ${esc(b.no)}。送出後要改，請到嘉里網站「維護託運登錄」（當天可以改、刪）。</p><div class="err" id="ks-err"></div>`,
    footer: `${b.kerry ? '<button class="btn danger" id="ks-del">刪除嘉里託運單</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ks-go">${b.kerry ? '再送一筆' : '送到嘉里'}</button>`,
    onOpen(el, close) {
      el.querySelector('#ks-knoSave')?.addEventListener('click', async () => { const v = el.querySelector('#ks-kno').value.replace(/\D/g, ''); if (v.length < 8) { toast('託運單號不對'); return; } const cur = store.get('bills', b.id); if (!cur) return; const { id, ...rest } = cur; await store.save('bills', b.id, { ...rest, kerry: { ...(cur.kerry || {}), no: v } }); store.log('嘉里託運', `${b.no}｜補填託運單號 ${v}`); toast('已存託運單號 ' + v); close(); onDone && onDone(store.get('bills', b.id)); });
      el.querySelector('#ks-del')?.addEventListener('click', async () => { if (await kerryDelete(b)) { close(); onDone && onDone(store.get('bills', b.id)); } });
      el.querySelector('#ks-go').onclick = async ev => {
        for (const k of ['name', 'tel', 'addr', 'tel2', 'what', 'n', 'kg', 'cod', 'note']) r[k] = el.querySelector('#ks-' + k).value.trim();
        if (!r.name || !r.addr || !r.tel || !(+r.n >= 1 && +r.n <= 999)) { el.querySelector('#ks-err').textContent = '收貨人、地址、電話1 要填，件數 1～999'; return; }
        ev.target.disabled = true; ev.target.textContent = '送出中…（約 10 秒）';
        if (await sendOne(b)) { close(); onDone && onDone(store.get('bills', b.id)); } else { ev.target.disabled = false; ev.target.textContent = '送到嘉里'; }
      };
    } });
}
function cfgDialog() {
  api.get('/api/kerry/cfg').then(c => modal({ title: '嘉里網路託運帳號', width: 520,
    body: `<div class="f"><label for="kc-acc">帳號</label><input id="kc-acc" value="${esc(c.account || '')}" autocomplete="off"></div>
      <div class="f"><label for="kc-pw">密碼</label><input id="kc-pw" type="password" autocomplete="new-password" placeholder="${c.password_set ? '已設定，不改就留空' : '請輸入'}"></div>
      <div class="grid" style="grid-template-columns:1fr 1fr"><div class="f"><label for="kc-fields">上傳格式編號</label><input id="kc-fields" value="${esc(c.fields || 'ZR01')}"></div><div class="f"><label for="kc-cust">託運人編號代碼（空白＝自動）</label><input id="kc-cust" value="${esc(c.customer_no || '')}"></div></div>
      <p class="muted small" style="margin:0">帳號密碼只存在伺服器電腦（data/kerry.json），不會傳回網頁。按「送嘉里」時伺服器用這組帳號登入嘉里網路託運、上傳、送出。</p><div id="kc-msg" class="small"></div>`,
    footer: '<button class="btn" id="kc-test">測試登入</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="kc-save">儲存</button>',
    onOpen(el, close) {
      const val = () => ({ account: el.querySelector('#kc-acc').value.trim(), password: el.querySelector('#kc-pw').value, fields: el.querySelector('#kc-fields').value.trim() || 'ZR01', customer_no: el.querySelector('#kc-cust').value.trim() });
      const msg = (t, ok) => { const m = el.querySelector('#kc-msg'); m.textContent = t; m.style.color = ok ? 'var(--ok)' : 'var(--bad)'; };
      el.querySelector('#kc-test').onclick = async ev => { ev.target.disabled = true; msg('連線中…', true); try { const r = await api.post('/api/kerry/test', val()); msg(r.msg, r.ok); } catch (e) { msg(e.message); } ev.target.disabled = false; };
      el.querySelector('#kc-save').onclick = async () => { try { await api.post('/api/kerry/cfg', val()); store.log('修改', '嘉里網路託運帳號設定'); close(); toast('已儲存'); } catch (e) { msg(e.message); } };
    } })).catch(e => toast(e.message));
}

