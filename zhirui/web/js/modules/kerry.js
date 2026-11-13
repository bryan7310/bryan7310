// 嘉里託運：把要寄嘉里大榮的銷貨單整理成「網路託運平台 → 多筆匯入」的 Excel。
// 嘉里那邊要先在「基本維護 → 設定上傳格式」建一個格式，欄位順序照 COLS（第一次設定一次就好）。
// 收貨人、地址、電話預設帶客戶資料；改過的會記住（設定 kerry），下次同一個客戶直接帶。不會自動登入或替你送出託運單。
import { esc, fmt, today, slash } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal } from '../core/ui.js';
import { calc, cdisp, totals } from '../core/calc.js';
import { printName } from '../core/names.js';
import { billKg } from './ship.js';
import { loadXlsx } from './purchase_import.js';

export const COLS = ['出貨日期', '收貨人', '收貨人地址', '收貨人電話1', '收貨人電話2', '件數', '重量', '出貨單號', '代收貨款', '貨品內容', '備註'];
const KERRY = 'https://webedi.kerrytj.com/login.aspx';
const ui = { date: '', pick: new Set(), rows: {} };
const mem = () => store.setting('kerry').c || {};
const tel = t => String(t || '').split(/[、,，;；/／]/)[0].replace(/\s+/g, '').replace(/^\((\d+)\)/, '$1-').replace(/[()]/g, '');   // (04)2330-2106 → 04-2330-2106；多支電話取第一支

export default {
  id: 'kerry', name: '嘉里託運', group: '倉儲', icon: 'stock',
  render(el) { this.el = el; if (!ui.date) ui.date = today(); draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts'))) draw(this.el); },
};
function rowOf(b) {
  if (ui.rows[b.id]) return ui.rows[b.id];
  const C = calc(); const c = C.ct[b.cid] || {}; const m = mem()[b.cid] || {}; const w = billKg(b).kg;
  return ui.rows[b.id] = { name: m.name || printName(c.name || '') || cdisp(c), addr: m.addr || c.addr || '', tel: m.tel || tel(c.phone), tel2: m.tel2 || tel(c.mobile), n: m.n || 1, kg: w > 0 ? Math.max(1, Math.ceil(w)) : '', cod: '', what: m.what || '螺絲', note: '' };
}
function draw(el) {
  const C = calc();
  const list = C.bills.filter(b => b.type === 'SALE' && !b.hist && b.date === ui.date).sort((a, b) => String(a.no).localeCompare(String(b.no)));
  for (const id of [...ui.pick]) if (!list.some(b => b.id === id)) ui.pick.delete(id);
  const bad = b => { const r = rowOf(b); return !r.name || !r.addr || !r.tel || !(+r.n >= 1 && +r.n <= 999); };
  el.innerHTML = `<div class="head"><h1>嘉里託運</h1><span class="sub">勾要寄嘉里的出貨單 → 下載 Excel → 到嘉里「多筆匯入」上傳</span><span class="sp"></span><a class="btn" href="${KERRY}" target="_blank" rel="noopener">開嘉里網路託運</a><button class="btn" id="kHelp">第一次設定</button></div>
    <div class="panel" style="display:grid;gap:10px">
      <div class="tools"><label>出貨日期 <input type="date" id="kDate" value="${esc(ui.date)}"></label><button class="btn sm" data-d="-1">‹ 前一天</button><button class="btn sm" data-d="1">後一天 ›</button><span class="sp"></span><span class="muted small">${list.length} 張出貨單，勾選 ${ui.pick.size} 張</span><button class="btn pri" id="kGo" ${ui.pick.size ? '' : 'disabled'}>下載嘉里匯入 Excel（${ui.pick.size}）</button></div>
      <div class="tw"><table><thead><tr><th style="width:30px"><input type="checkbox" id="kAll" ${list.length && ui.pick.size === list.length ? 'checked' : ''} aria-label="全選"></th><th>出貨單號</th><th>收貨人</th><th>收貨人地址</th><th>電話1</th><th>電話2</th><th class="n" style="width:60px">件數</th><th class="n" style="width:70px">重量 kg</th><th class="n" style="width:90px">代收貨款</th><th style="width:90px">貨品內容</th><th>備註</th></tr></thead><tbody>
      ${list.map(b => { const r = rowOf(b); const inp = (k, w, cls = '') => `<input data-b="${b.id}" data-k="${k}" value="${esc(r[k])}" class="${cls}" style="width:${w};min-width:0">`;
        return `<tr ${ui.pick.has(b.id) && bad(b) ? 'style="background:var(--bad-soft)"' : ''}><td><input type="checkbox" data-p="${b.id}" ${ui.pick.has(b.id) ? 'checked' : ''}></td><td class="mono nowrap">${esc(b.no)}<div class="muted small">${esc(cdisp(C.ct[b.cid]) || '')}・${fmt(totals(b).total)}</div></td>
          <td>${inp('name', '140px')}</td><td>${inp('addr', '100%')}</td><td>${inp('tel', '110px')}</td><td>${inp('tel2', '100px')}</td><td>${inp('n', '50px', 'num')}</td><td>${inp('kg', '60px', 'num')}</td><td>${inp('cod', '80px', 'num')}</td><td>${inp('what', '80px')}</td><td>${inp('note', '100%')}</td></tr>`; }).join('') || `<tr><td colspan="11"><div class="empty"><b>${esc(slash(ui.date))} 沒有出貨單</b>換一天看看</div></td></tr>`}
      </tbody></table></div>
      <p class="muted small" style="margin:0">收貨人、地址、電話預設帶客戶資料；這裡改過的，下載時會記住，下次同一個客戶直接帶。重量依商品單重估算（無條件進位到整數公斤）。紅底＝必填欄位（收貨人、地址、電話1、件數）沒填。</p>
    </div>`;
  el.querySelector('#kDate').onchange = ev => { ui.date = ev.target.value || today(); ui.pick.clear(); draw(el); };
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const d = new Date(ui.date + 'T00:00:00'); d.setDate(d.getDate() + +b.dataset.d); ui.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; ui.pick.clear(); draw(el); });
  el.querySelector('#kAll').onchange = ev => { if (ev.target.checked) list.forEach(b => ui.pick.add(b.id)); else ui.pick.clear(); draw(el); };
  el.querySelectorAll('[data-p]').forEach(cb => cb.onchange = () => { if (cb.checked) ui.pick.add(cb.dataset.p); else ui.pick.delete(cb.dataset.p); draw(el); });
  el.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => { ui.rows[inp.dataset.b][inp.dataset.k] = inp.value; });
  el.querySelector('#kHelp').onclick = help;
  el.querySelector('#kGo').onclick = async () => {
    const sel = list.filter(b => ui.pick.has(b.id)); const miss = sel.filter(bad);
    if (miss.length) { toast(`${miss.map(b => b.no).join('、')} 的收貨人、地址、電話1 或件數沒填好`); draw(el); return; }
    const badCod = sel.find(b => { const v = +rowOf(b).cod; return rowOf(b).cod !== '' && !(v >= 1 && v <= 50000); }); if (badCod) { toast(`${badCod.no} 的代收貨款要在 1～50,000 之間（不代收就留空）`); return; }
    const aoa = [COLS, ...sel.map(b => { const r = rowOf(b); return [ui.date.replace(/-/g, '/'), r.name, r.addr, r.tel, r.tel2, +r.n || 1, r.kg === '' ? '' : +r.kg, b.no, r.cod === '' ? '' : +r.cod, r.what, r.note]; })];
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
