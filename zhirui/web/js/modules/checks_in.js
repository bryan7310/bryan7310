// 支票登記：登記收到的客票、依到期日送代收、帳戶分類
import { $, esc, money, today, roc, slash, parseNum, uid, daysLeft, qTerms, matchQ, toHalf, addDays, copyText } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, pager, printHTML, onSearch, askOcrDup } from '../core/ui.js';
import { customers, cshort, cdisp } from '../core/calc.js';
import { api, aiOcr } from '../core/api.js';
import { printName } from '../core/names.js';
import { arFromCheck } from './receivables.js';

const DEFAULT_ACCOUNTS = [{ id: 'chao', code: '超', bank: '上海銀行', holder: '陳彥超', alias: '陳彥超,超' }, { id: 'sh', code: '上海', bank: '上海銀行', holder: '志瑞螺絲', alias: '上海,海' }, { id: 'land', code: '土', bank: '土地銀行', holder: '志瑞螺絲', alias: '土銀,土' }];
const accounts = () => store.setting('bank_accounts').list || DEFAULT_ACCOUNTS;
const acctById = id => accounts().find(a => a.id === id);
const ui = { tab: 'pending', q: '', page: 0, sel: new Set(), acct: 'sh', year: '' };
export default {
  id: 'checks-in', name: '支票登記', group: '財務', icon: 'checksin',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('checks_in') || ch.has('settings') || ch.has('contacts'))) draw(this.el); },
  badge() { const t = today(); const p = store.list('checks_in').filter(c => !c.col); const late = p.filter(c => c.due && c.due < t).length; const soon = p.filter(c => c.due >= t && daysLeft(c.due) <= 7).length; return { cnt: late + soon, alert: late > 0 }; },
};
const labelOf = c => { if (!c.col) return ''; const a = acctById(c.col.a); if (c.col.d && a) return slash(c.col.d).slice(5) + a.code; return c.col.raw || (c.col.d ? slash(c.col.d) : '已代收'); };
const sum = l => l.reduce((s, c) => s + (+c.amt || 0), 0);
function draw(el) {
  if (ui.tab === 'done') return drawDone(el);
  const t = today(); const all = store.list('checks_in'); const q = qTerms(ui.q);
  const pend = all.filter(c => !c.col).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const list = pend.filter(c => !q.length || matchQ([c.name, c.bank, c.no, c.note, money(c.amt)].join(' '), q));
  const [s, e, pg] = pager('ci', list.length, ui.page);
  const late = pend.filter(c => c.due && c.due < t), soon = pend.filter(c => c.due >= t && daysLeft(c.due) <= 7);
  el.innerHTML = `<div class="head"><h1>支票登記</h1><span class="sp"></span>${tabs('ci', [['pending', `待代收 ${pend.length}`], ['done', '已代收']], ui.tab)}<button class="btn" id="ciScan" title="拍支票照片，AI 辨識後帶入登記客票">📷 拍照辨識</button><button class="btn pri" id="ciNew">＋ 登記客票</button></div>
    ${ui.tab === 'pending' ? `<div class="kpis"><div class="kpi"><span>待代收</span><b>${money(sum(pend))}</b><small>${pend.length} 張</small></div><div class="kpi ${late.length ? 'alert' : ''}"><span>已到期未送</span><b>${money(sum(late))}</b><small>${late.length} 張</small></div><div class="kpi"><span>7 天內到期</span><b>${money(sum(soon))}</b><small>${soon.length} 張</small></div></div>` : ''}
    <div class="panel"><div class="tools">${ui.tab === 'done' ? `<select id="ciYear"><option value="all" ${ui.year === 'all' ? 'selected' : ''}>全部年度</option>${(ui.years || []).map(y => `<option value="${y}" ${y === ui.year ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}<input type="search" id="ciQ" placeholder="搜尋客戶、銀行、票號、金額" value="${esc(ui.q)}"><span class="muted small">${list.length} 張・合計 ${money(sum(list))}</span><span class="sp"></span>
      ${ui.tab === 'pending' ? `<span class="muted small">勾選後送代收到：</span><select id="ciAcct">${accounts().map(a => `<option value="${a.id}" ${a.id === ui.acct ? 'selected' : ''}>${esc(a.code)} ${esc(a.bank)} ${esc(a.holder)}</option>`).join('')}</select><input type="date" id="ciDate" value="${t}"><button class="btn sm pri" id="ciSend" ${ui.sel.size ? '' : 'disabled'}>送代收 ${ui.sel.size ? `(${ui.sel.size} 張 ${money(sum(pend.filter(c => ui.sel.has(c.id))))})` : ''}</button><button class="btn sm" id="ciList" ${ui.sel.size ? '' : 'disabled'}>列印託收清單</button>` : ''}</div>
    <div class="tw" style="margin-top:10px"><table><thead><tr>${ui.tab === 'pending' ? '<th><input type="checkbox" id="ciAll" aria-label="全選"></th>' : ''}<th>到期日</th><th>客戶</th><th>銀行</th><th>票號</th><th>帳號</th><th class="n">金額</th><th>收到日</th>${ui.tab === 'done' ? '<th>代收</th>' : ''}<th>備註</th><th></th></tr></thead><tbody>
      ${list.slice(s, e).map(c => { const dl = c.due ? daysLeft(c.due) : null; const tag = ui.tab === 'pending' && c.due ? (dl < 0 ? `<span class="pill bad">到期 ${-dl} 天</span>` : dl <= 7 ? `<span class="pill warn">${dl === 0 ? '今天' : dl + ' 天後'}</span>` : '') : ''; return `<tr class="row" data-id="${c.id}">${ui.tab === 'pending' ? `<td><input type="checkbox" data-sel="${c.id}" ${ui.sel.has(c.id) ? 'checked' : ''}></td>` : ''}<td class="nowrap">${esc(roc(c.due))} ${tag}</td><td><b>${esc(c.cid ? cshort(c.cid) : c.name)}</b></td><td>${esc(c.bank || '')}</td><td class="mono">${esc(c.no || '')}</td><td class="mono muted">${esc(c.acct || '')}</td><td class="n">${money(c.amt)}</td><td class="nowrap muted">${c.recv ? esc(roc(c.recv)) : ''}</td>${ui.tab === 'done' ? `<td><span class="pill blue">${esc(labelOf(c))}</span></td>` : ''}<td class="muted">${esc(c.note || '')}</td><td class="nowrap">${ui.tab === 'done' ? `<button class="btn xs" data-undo="${c.id}">退回待代收</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="11"><div class="empty"><b>${ui.tab === 'pending' ? '沒有待代收的客票' : '沒有紀錄'}</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; ui.q = ''; draw(el); }, { once: true });
  onSearch($('#ciQ', el), v => { ui.q = v; ui.page = 0; draw(el); const i = $('#ciQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#ciYear', el)?.addEventListener('change', ev => { ui.year = ev.target.value; ui.page = 0; draw(el); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  $('#ciNew', el).addEventListener('click', () => editCheck(null));
  $('#ciScan', el).addEventListener('click', scanCheck);
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button,input')) return; editCheck(store.get('checks_in', tr.dataset.id)); }));
  el.querySelectorAll('[data-sel]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) ui.sel.add(cb.dataset.sel); else ui.sel.delete(cb.dataset.sel); draw(el); }));
  $('#ciAll', el)?.addEventListener('change', ev => { if (ev.target.checked) list.slice(s, e).forEach(c => ui.sel.add(c.id)); else ui.sel.clear(); draw(el); });
  $('#ciAcct', el)?.addEventListener('change', ev => { ui.acct = ev.target.value; });
  $('#ciSend', el)?.addEventListener('click', async () => {
    const d = $('#ciDate', el).value || t; const a = acctById(ui.acct); const sel = pend.filter(c => ui.sel.has(c.id));
    if (!await confirm(`把 ${sel.length} 張客票（${money(sum(sel))}）送代收到 ${a.code} ${a.bank} ${a.holder}，日期 ${roc(d)}？`, { ok: '送代收' })) return;
    await store.batch(sel.map(c => ({ col: 'checks_in', id: c.id, data: { ...c, id: undefined, col: { d, a: a.id } } })));
    store.log('代收', `${sel.length} 張客票 ${money(sum(sel))} → ${a.code}（${roc(d)}）`); ui.sel.clear(); toast('已送代收');
  });
  $('#ciList', el)?.addEventListener('click', () => { const sel = pend.filter(c => ui.sel.has(c.id)); const a = acctById(ui.acct); const co = store.setting('company'); printHTML('託收清單', `@page{size:A4;margin:14mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:11pt;margin:0}h1{font-size:15pt;text-align:center;margin:0 0 4mm}table{width:100%;border-collapse:collapse}th,td{border:.5pt solid #000;padding:1.5mm 2mm;text-align:left}td.n,th.n{text-align:right}`, `<h1>${esc(co.name || '')} 支票託收清單</h1><p>存入：${esc(a.bank)} ${esc(a.holder)}　日期：${esc(roc($('#ciDate', el).value || t))}</p><table><thead><tr><th>#</th><th>到期日</th><th>發票人</th><th>付款銀行</th><th>票號</th><th class="n">金額</th></tr></thead><tbody>${sel.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(roc(c.due))}</td><td>${esc(dname(c))}</td><td>${esc(c.bank || '')}</td><td>${esc(c.no || '')}</td><td class="n">${money(c.amt)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">合計 ${sel.length} 張</td><td class="n">${money(sum(sel))}</td></tr></tfoot></table>`, { tip: '按 Ctrl+P 列印。' }); });
  el.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => { const c = store.get('checks_in', b.dataset.undo); const { col, ...rest } = c; delete rest.id; await store.save('checks_in', c.id, rest); toast('已退回待代收'); }));
}
// 託收清單上的發票人印全名：有連到客戶就用客戶全名，否則用支票上登記的名字
const dname = c => { const x = c.cid && store.get('contacts', c.cid); return x ? printName(x.name) : (c.name || ''); };
// ---------- 已代收：依年度、帳戶，按「代收批次」（同一天送同一帳戶）分組 ----------
const colKey = c => `${c.col.d || ''}|${c.col.a || ''}|${c.col.raw || ''}`;
const yearOf = c => (c.col.d || c.due || '').slice(0, 4);
const acctOf = c => c.col.a && acctById(c.col.a) ? c.col.a : 'other';
const acctTitle = a => `${a.code} ${a.bank} ${a.holder}`;
// 帳戶顏色：依帳戶在設定裡的順序給 acc-0～acc-4（app.css），未註記帳戶用 acc-x
const accCls = id => { const i = accounts().findIndex(a => a.id === id); return i < 0 ? 'acc-x' : 'acc-' + (i % 5); };
function drawDone(el) {
  const t = today(); const all = store.list('checks_in'); const done = all.filter(c => c.col); const pendN = all.length - done.length;
  const years = [...new Set(done.map(yearOf).filter(Boolean))].sort().reverse();
  // 預設顯示今年（或最近有資料的一年）；日期打錯成 2133 之類的年份不會變成預設
  if (!ui.year) { const cy = +t.slice(0, 4); ui.year = years.find(y => +y <= cy + 1) || years[0] || 'all'; }
  ui.acctF ??= 'all'; ui.open ??= new Set();
  const q = qTerms(ui.q);
  const yl = q.length ? done.filter(c => matchQ([c.name, c.bank, c.no, c.acct, money(c.amt), labelOf(c), c.note].join(' '), q)) : done.filter(c => ui.year === 'all' || yearOf(c) === ui.year);
  const list = yl.filter(c => ui.acctF === 'all' || acctOf(c) === ui.acctF);
  const accs = accounts(); const cards = [...accs.map(a => ({ id: a.id, title: acctTitle(a), code: a.code })), { id: 'other', title: '其他／未註記帳戶', code: '其他' }];
  const groups = new Map();
  for (const c of list) { const k = colKey(c); let g = groups.get(k); if (!g) groups.set(k, g = { k, d: c.col.d || '', a: c.col.a || '', raw: c.col.raw || '', rows: [] }); g.rows.push(c); }
  const gl = [...groups.values()].sort((x, y) => (y.d || '').localeCompare(x.d || '') || (y.raw || '').localeCompare(x.raw || ''));
  gl.forEach(g => g.rows.sort((x, y) => (x.due || '').localeCompare(y.due || '') || String(x.name).localeCompare(String(y.name), 'zh-Hant')));
  const scope = q.length ? '搜尋結果' : ui.year === 'all' ? '全部年度' : `${ui.year} 年`;
  const gLabel = g => { const a = acctById(g.a); if (g.d && a) return slash(g.d).slice(5) + a.code; return g.raw || (g.d ? slash(g.d) : '已代收（未註記）'); };
  el.innerHTML = `<div class="head"><h1>支票登記</h1><span class="sp"></span>${tabs('ci', [['pending', `待代收 ${pendN}`], ['done', '已代收']], ui.tab)}<button class="btn" id="ciScan" title="拍支票照片，AI 辨識後帶入登記客票">📷 拍照辨識</button><button class="btn pri" id="ciNew">＋ 登記客票</button></div>
    <div class="panel" style="display:grid;gap:12px">
      <div class="tools" style="align-items:center"><select id="ciYear"><option value="all" ${ui.year === 'all' ? 'selected' : ''}>全部年度</option>${years.map(y => `<option value="${y}" ${y === ui.year ? 'selected' : ''}>${y} 年</option>`).join('')}</select>
        <div class="tabs">${[['all', '全部'], ...cards.map(c => [c.id, c.code])].map(([k, l]) => `<button type="button" class="${ui.acctF === k ? 'on' : ''}" data-acf="${k}">${esc(l)}</button>`).join('')}</div>
        <input type="search" id="ciQ" placeholder="搜尋全部年度：戶名、號碼、金額、分行" value="${esc(ui.q)}" style="flex:1 1 260px"></div>
      <div class="kpis">${cards.map((c, i) => { const cs = yl.filter(x => acctOf(x) === c.id); if (!cs.length && c.id === 'other') return ''; const n = new Set(cs.map(colKey)).size; return `<button type="button" class="kpi acc ${accCls(c.id)}" data-acf="${c.id}" style="text-align:left;cursor:pointer;border:2px solid ${ui.acctF === c.id ? 'var(--acc-fg)' : 'transparent'}"><span><b>${esc(c.code)}</b>　${esc(c.title.replace(c.code, '').trim())}</span><b>NT$ ${money(sum(cs))}</b><small>${n} 次代收・${cs.length} 張</small></button>`; }).join('')}</div>
      <div class="tools" style="align-items:center"><span class="muted">${scope}：${gl.length} 次代收・${list.length} 張</span><span class="sp"></span><b>NT$ ${money(sum(list))}</b></div>
      ${gl.length ? gl.map((g, i) => `<details class="panel acc-batch ${accCls(acctById(g.a) ? g.a : 'other')}" data-g="${esc(g.k)}" ${ui.open.has(g.k) || (i === 0 && !ui.open.size) ? 'open' : ''} style="padding:0;overflow:hidden">
        <summary style="display:flex;gap:12px;align-items:center;padding:10px 14px;cursor:pointer;list-style:none"><span class="pill acc">${esc(gLabel(g))}</span><span class="muted">${esc(slash(g.d))}</span><span class="muted">${esc(acctById(g.a) ? acctById(g.a).bank + ' ' + acctById(g.a).holder : g.raw || '')}</span><span class="sp"></span><span class="muted">${g.rows.length} 張</span><b>${money(sum(g.rows))}</b></summary>
        <div class="tw"><table><thead><tr><th>到期日</th><th>戶名</th><th>付款行</th><th>號碼</th><th>帳號</th><th class="n">金額</th><th>備註</th></tr></thead><tbody>${g.rows.map(c => `<tr class="row" data-id="${c.id}"><td class="nowrap">${esc(slash(c.due) || c.dueRaw || '')}</td><td><b>${esc(c.cid ? cshort(c.cid) : c.name)}</b></td><td>${esc(c.bank || '')}</td><td class="mono">${esc(c.no || '')}</td><td class="mono muted">${esc(c.acct || '')}</td><td class="n">${money(c.amt)}</td><td class="muted">${esc(c.note || '')}</td></tr>`).join('')}</tbody></table></div>
        <div class="tools" style="padding:8px 14px 12px;align-items:center"><span class="muted small">點一列可編輯（改帳戶、改日期或退回待代收）</span><span class="sp"></span>${/上海/.test((acctById(g.a)?.bank || '') + (acctById(g.a)?.code || '')) ? `<button class="btn sm" data-shb="${esc(g.k)}">列印上海託收單</button>` : ''}<button class="btn sm" data-copy="${esc(g.k)}">複製清單</button><button class="btn sm" data-print="${esc(g.k)}">列印清單</button><button class="btn sm danger" data-undo-all="${esc(g.k)}">整批退回待代收</button></div></details>`).join('') : '<div class="empty"><b>沒有紀錄</b>換個年度、帳戶或清除搜尋。</div>'}
    </div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; ui.q = ''; draw(el); }, { once: true });
  $('#ciNew', el).addEventListener('click', () => editCheck(null));
  $('#ciScan', el).addEventListener('click', scanCheck);
  $('#ciYear', el).addEventListener('change', ev => { ui.year = ev.target.value; ui.open = new Set(); draw(el); });
  el.querySelectorAll('[data-acf]').forEach(b => b.addEventListener('click', () => { ui.acctF = ui.acctF === b.dataset.acf && b.classList.contains('kpi') ? 'all' : b.dataset.acf; draw(el); }));
  const qi = $('#ciQ', el); let timer = null;
  const go = () => { ui.q = qi.value; clearTimeout(timer); timer = setTimeout(() => { if (!el.isConnected) return; draw(el); const i = $('#ciQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  qi.addEventListener('input', ev => { if (ev.isComposing) return; go(); }); qi.addEventListener('compositionend', go);
  el.querySelectorAll('details[data-g]').forEach(d => d.addEventListener('toggle', () => { d.open ? ui.open.add(d.dataset.g) : ui.open.delete(d.dataset.g); }));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button,input')) return; editCheck(store.get('checks_in', tr.dataset.id)); }));
  const byKey = k => groups.get(k);
  const lines = g => g.rows.map(c => `${roc(c.due) || c.dueRaw || ''}\t${dname(c)}\t${c.bank || ''}\t${c.no || ''}\t${c.acct || ''}\t${money(c.amt)}`);
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => { const g = byKey(b.dataset.copy); const txt = [`${gLabel(g)} ${slash(g.d)} ${acctById(g.a) ? acctById(g.a).bank + ' ' + acctById(g.a).holder : ''}`, '到期日\t戶名\t付款行\t號碼\t帳號\t金額', ...lines(g), `合計 ${g.rows.length} 張\t\t\t\t\t${money(sum(g.rows))}`].join('\n'); copyText(txt).then(ok => toast(ok ? '已複製清單' : '無法複製，請手動選取')); }));
  el.querySelectorAll('[data-shb]').forEach(b => b.addEventListener('click', () => printShbSlip(byKey(b.dataset.shb))));
  el.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => { const g = byKey(b.dataset.print); const a = acctById(g.a); const co = store.setting('company'); printHTML('託收清單', `@page{size:A4;margin:14mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:11pt;margin:0}h1{font-size:15pt;text-align:center;margin:0 0 4mm}table{width:100%;border-collapse:collapse}th,td{border:.5pt solid #000;padding:1.5mm 2mm;text-align:left}td.n,th.n{text-align:right}`, `<h1>${esc(co.name || '')} 支票託收清單</h1><p>存入：${esc(a ? a.bank + ' ' + a.holder : g.raw || '')}　日期：${esc(roc(g.d))}</p><table><thead><tr><th>#</th><th>到期日</th><th>發票人</th><th>付款銀行</th><th>票號</th><th>帳號</th><th class="n">金額</th></tr></thead><tbody>${g.rows.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(roc(c.due) || c.dueRaw || '')}</td><td>${esc(dname(c))}</td><td>${esc(c.bank || '')}</td><td>${esc(c.no || '')}</td><td>${esc(c.acct || '')}</td><td class="n">${money(c.amt)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="6">合計 ${g.rows.length} 張</td><td class="n">${money(sum(g.rows))}</td></tr></tfoot></table>`, { tip: '按 Ctrl+P 列印。' }); }));
  el.querySelectorAll('[data-undo-all]').forEach(b => b.addEventListener('click', async () => { const g = byKey(b.dataset.undoAll); if (!await confirm(`把 ${gLabel(g)} 這批 ${g.rows.length} 張（${money(sum(g.rows))}）全部退回待代收？`, { danger: true, ok: '退回' })) return; await store.batch(g.rows.map(c => { const { col, id, ...rest } = c; return { col: 'checks_in', id: c.id, data: rest }; })); store.log('退回', `${gLabel(g)} ${g.rows.length} 張退回待代收`); toast('已退回待代收'); }));
}
/** 拍照辨識：選一張支票照片（手機會跳出拍照／相簿）→ 縮圖上傳 → AI 擷取欄位 → 帶入登記客票（仍要人工核對後才登記） */
/** 上海銀行託收單＝套印上海商銀「存款憑條」（19.1×9 公分）。
 *  位置是 2026/11/24 從空白憑條的照片量的（單位 mm，原點是憑條左上角）：
 *  日期：年／月／日 三個字前面；帳號 14 格（第 1 格中心 x=31，格距 6）；戶名欄；金額 10 格（拾億…元，第 1 格中心 x=38.5，格距 7）；
 *  存入明細勾「交換票據」並填張數。帳號、戶名第一次列印時輸入，之後記在 設定 bank_accounts。 */
// PW：送給印表機的紙長。Brother 驅動裡使用者建的自訂紙張是「上海託收單 90×190」，頁面大小要跟它一模一樣，
// 不然 Chrome 會改用預設紙張（76×127）把整頁縮成 66%（11/24 第一次試印就是這樣）。憑條實際長 191，少的 1mm 在左邊空白處。
const SHB = { W: 191, PW: 190, H: 90, dateY: 13, yR: 146, mR: 164.5, dR: 183, acX: 31, acP: 6, acY: 27, nameX: 121.5, nameY: 26, amX: 38.5, amP: 7, amY: 43, ckX: 132.9, ckY: 39.4, cntX: 152.8, cntY: 39.5 };
function printShbSlip(g) {
  if (!g) return; const a = acctById(g.a); const co = store.setting('company'); const ps = store.setting('shb_slip');
  const rows = g.rows.slice().sort((x, y) => String(x.due || '').localeCompare(String(y.due || '')) || String(x.no || '').localeCompare(String(y.no || '')));
  const v = { no: a?.no || '', name: a?.name || (a?.holder === '志瑞螺絲' ? co.name || a.holder : a?.holder || ''), date: g.d || today(), amt: sum(rows), cnt: ps.cnt ? rows.length : '', dx: +ps.dx || 0, dy: +ps.dy || 0, rot: ps.rot === 0 ? 0 : -90 };
  modal({ title: `列印上海託收單（存款憑條）　${a ? a.code : ''}`, width: 620,
    body: `<p class="muted small" style="margin:0 0 8px">套印在上海商銀的「存款憑條」（19.1×9 公分）上：日期、帳號、戶名、金額（前面沒用到的格子劃一條線）。帳號和戶名輸入一次就會記住。這批 ${rows.length} 張、合計 ${money(sum(rows))}。</p>
      <div class="grid"><div class="f"><label for="sb-no">帳號（14 碼數字）</label><input id="sb-no" class="mono" inputmode="numeric" maxlength="20" value="${esc(v.no)}"></div>
      <div class="f"><label for="sb-name">戶名</label><input id="sb-name" value="${esc(v.name)}"></div>
      <div class="f"><label for="sb-date">日期</label><input type="date" id="sb-date" value="${esc(v.date)}"></div>
      <div class="f"><label for="sb-amt">金額</label><input id="sb-amt" class="num" value="${money(v.amt)}"></div>
      <div class="f"><label for="sb-cnt">交換票據張數（空白＝不勾、不填）</label><input id="sb-cnt" class="num" value="${v.cnt}" placeholder="${rows.length}"></div>
      <div class="f"><label>位置微調 mm（右＋／下＋）</label><div class="tools" style="gap:6px"><input id="sb-dx" class="num" style="width:70px" value="${v.dx}" title="水平位移"><input id="sb-dy" class="num" style="width:70px" value="${v.dy}" title="垂直位移"></div></div>
      <div class="f" style="grid-column:1/-1"><label for="sb-rot">進紙方式</label><select id="sb-rot"><option value="-90" ${v.rot ? 'selected' : ''}>直放：手動進紙槽，窄邊先進、日期那端先進、正面朝上（跟支票一樣，紙張「上海託收單」寬 90×高 190）</option><option value="0" ${v.rot ? '' : 'selected'}>橫放：紙張 寬 191×高 90</option></select></div></div><div class="err" id="sb-err"></div>`,
    footer: '<button class="btn" id="sb-list">列印票據明細表（A4）</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="sb-ok">列印存款憑條</button>',
    onOpen(el, close) {
      $('#sb-list', el).onclick = () => printShbList(g, rows);
      $('#sb-ok', el).onclick = async () => {
        const no = $('#sb-no', el).value.replace(/\D/g, ''); const name = $('#sb-name', el).value.trim(); const amt = Math.round(+String($('#sb-amt', el).value).replace(/,/g, '') || 0); const cnt = $('#sb-cnt', el).value.trim();
        const dx = +$('#sb-dx', el).value || 0, dy = +$('#sb-dy', el).value || 0; const rot = +$('#sb-rot', el).value || 0; const d = $('#sb-date', el).value || today();
        if (!no) return $('#sb-err', el).textContent = '請輸入帳號'; if (no.length > 14) return $('#sb-err', el).textContent = '帳號最多 14 碼（憑條上只有 14 格）'; if (!(amt > 0) || String(amt).length > 10) return $('#sb-err', el).textContent = '金額不對';
        const ops = [];
        if (a && (a.no !== no || a.name !== name)) ops.push({ col: 'settings', id: 'bank_accounts', data: { ...store.setting('bank_accounts'), list: accounts().map(x => x.id === a.id ? { ...x, no, name } : x) } });
        if (dx !== v.dx || dy !== v.dy || rot !== v.rot || !!cnt !== !!ps.cnt) ops.push({ col: 'settings', id: 'shb_slip', data: { ...ps, dx, dy, rot, cnt: !!cnt } });
        if (ops.length) await store.batch(ops);
        const f = (x, y, t, al, cls) => t === '' || t == null ? '' : `<span class="f ${al || ''} ${cls || ''}" style="left:${(x + dx).toFixed(2)}mm;top:${(y + dy).toFixed(2)}mm">${esc(String(t))}</span>`;
        const [yy, mm, dd] = d.split('-').map(Number);
        let h = f(SHB.yR, SHB.dateY, yy - 1911, 'r') + f(SHB.mR, SHB.dateY, mm, 'r') + f(SHB.dR, SHB.dateY, dd, 'r') + f(SHB.nameX, SHB.nameY, name, '', 'nm');
        [...no.padStart(14, ' ')].forEach((ch, i) => { if (ch !== ' ') h += f(SHB.acX + i * SHB.acP, SHB.acY, ch, 'c', 'dg'); });
        [...String(amt).padStart(10, ' ')].forEach((ch, i) => { if (ch !== ' ') h += f(SHB.amX + i * SHB.amP, SHB.amY, ch, 'c', 'dg'); });
        const blank = 10 - String(amt).length;   // 金額前面沒用到的格子劃一條橫線（照手寫的習慣）
        if (blank > 0) h += `<span class="ln" style="left:${(SHB.amX - SHB.amP / 2 + 1.5 + dx).toFixed(2)}mm;top:${(SHB.amY + 1.5 + dy).toFixed(2)}mm;width:${(blank * SHB.amP - 3).toFixed(2)}mm"></span>`;
        if (cnt) h += f(SHB.ckX, SHB.ckY, 'V', 'c', 'dg') + f(SHB.cntX, SHB.cntY, cnt, 'c', 'sm');
        // 不在 CSS 指定 @page size：11/24 實測 Chrome 會把指定的頁面「縮放去配合印表機預設紙張（76×127）」→ 整頁變 66%。紙張改由列印視窗選「上海託收單」。
        // 直放：紙張 90×190，內容逆時針轉 90 度（憑條右邊＝日期那端先進印表機），跟支票套印同一種放法
        printHTML('上海存款憑條', `@page{margin:0}body{margin:0}.page{position:relative;overflow:hidden;width:${rot ? SHB.H : SHB.PW}mm;height:${(rot ? SHB.PW : SHB.H) - 0.5}mm}.sheet{position:absolute;left:0;top:0;transform-origin:0 0;${rot ? `transform:translate(0,${SHB.W}mm) rotate(-90deg);` : ''}width:${SHB.W}mm;height:${SHB.H}mm;color:#000;font:11pt/1 "Microsoft JhengHei","微軟正黑體",sans-serif}.f{position:absolute;white-space:nowrap;transform:translateY(-50%)}.f.c{transform:translate(-50%,-50%)}.f.r{transform:translate(-100%,-50%)}.dg{font-size:13pt;font-family:Arial,"Microsoft JhengHei",sans-serif}.nm{font-size:12pt}.sm{font-size:10pt}.ln{position:absolute;height:0;border-top:.35mm solid #000}`, `<div class="page"><div class="sheet">${h}</div></div>`, { tip: rot ? '存款憑條直放在手動進紙槽：窄邊先進、日期那端先進、正面朝上、導板夾中間（跟支票一樣）。<b>列印視窗的「紙張大小」一定要選「上海託收單」</b>（寬 90×高 190 mm）、邊界「無」、縮放 100，印表機驅動的縮放要「關」。第一次請先用白紙印，疊在憑條上對位置；偏了回上一個視窗填「位置微調」（照憑條本身的方向）。' : '紙張大小選 191×90mm、邊界「無」、縮放 100%。第一次請先用白紙印，疊在憑條上對位置。' });
        store.log('列印', `上海存款憑條 ${slash(d)} ${a ? a.code : ''} ${rows.length} 張 ${money(amt)}`); close();
      };
    } });
}
/** 票據明細表（A4，照原本 Excel「支票代收.xls」Sheet2：筆數、票據號碼、到期日、票據金額、票據總金額；上下兩份） */
function printShbList(g, rows) {
  const a = acctById(g.a);
  const one = `<div class="slip"><p>${esc(a ? a.bank + ' ' + a.holder : g.raw || '')}　託收日期 ${esc(slash(g.d) || '')}　共 ${rows.length} 張</p><table><thead><tr><th class="c">筆數</th><th>票據號碼</th><th class="c">到期日</th><th class="n">票據金額</th></tr></thead><tbody>${rows.map((c, i) => `<tr><td class="c">${i + 1}</td><td class="mono">${esc(c.no || '')}</td><td class="c">${esc(slash(c.due) || c.dueRaw || '')}</td><td class="n">${money(c.amt)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">票據總金額</td><td class="n">${money(sum(rows))}</td></tr></tfoot></table></div>`;
  const two = rows.length <= 14;
  printHTML('上海票據明細表', `@page{size:A4;margin:14mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:12pt;margin:0}.slip{width:120mm;${two ? 'height:128mm;' : 'page-break-after:always;'}box-sizing:border-box}.slip p{margin:0 0 2mm;font-size:10pt}table{width:100%;border-collapse:collapse}th,td{border:.6pt solid #000;padding:1.3mm 2.5mm;text-align:left}td.n,th.n{text-align:right}td.c,th.c{text-align:center}.mono{font-family:Consolas,"Courier New",monospace}tfoot td{font-weight:bold}`, one + one, { tip: '按 Ctrl+P 列印，A4。上下兩份內容一樣。' });
}
function scanCheck() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.addEventListener('change', async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    let wait = modal({ title: '辨識中…', width: 360, body: '<div class="muted" style="padding:8px 0">正在讀取支票照片並辨識欄位，請稍候（約 10～30 秒）</div>', footer: '', closeOnBg: false });
    try {
      const image = await shrinkImage(file, 1800, 0.85);
      const r = await aiOcr('/api/ocr/check', { image }, askOcrDup);
      wait.close(); wait = null;
      const list = (Array.isArray(r.checks) && r.checks.length ? r.checks : [r.fields || {}]).map(preOf);
      if (list.length === 1) editCheck(null, list[0]);
      else reviewChecks(list);
    } catch (e) {
      if (wait) wait.close();
      toast(e.message || '辨識失敗');
    }
  });
  inp.click();
}
/** AI 辨識的一張支票 → 登記客票的預填值 */
/** 防呆：同一張支票是否已經登記過（拍照辨識常把票號、帳號讀錯一兩個字，所以放寬比對）：
 *  1. 票號相同，且帳號相同／沒帳號／金額相同（帳號讀錯也抓得到）
 *  2. 票號只差一個字（含少一個字），且金額、到期日都相同（同客戶每月連號同額的票不算）
 *  3. 票號不同或沒填，但發票人（或客戶）、金額、到期日都一樣
 *  selfId＝修改中的那張，不跟自己比 */
const normNo = s => toHalf(String(s || '')).replace(/[\s\-－_.]/g, '').toUpperCase();
const normAcct = s => toHalf(String(s || '')).replace(/\D/g, '').replace(/^0+/, '');
const near1 = (a, b) => {   // 兩個字串只差一個字（換一個字、多一個或少一個字）
  if (a === b) return true; if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++diff > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return diff + (a.length - i) + (b.length - j) <= 1;
};
export function findDupCheck(x, selfId) {
  const no = normNo(x.no), acct = normAcct(x.acct), amt = +x.amt || 0, nm = String(x.name || '').trim();
  const others = store.list('checks_in').filter(c => c.id !== selfId);
  return others.find(c => no && normNo(c.no) === no && (!acct || !normAcct(c.acct) || normAcct(c.acct) === acct || (amt && +c.amt === amt)))
    || others.find(c => no && amt && +c.amt === amt && (!x.due || !c.due || c.due === x.due) && normNo(c.no).length >= 5 && near1(normNo(c.no), no))
    || others.find(c => amt && +c.amt === amt && x.due && c.due === x.due && ((nm && String(c.name || '').trim() === nm) || (x.cid && c.cid === x.cid)))
    || null;
}
export const dupText = c => `${c.name || ''}・票號 ${c.no || '—'}・${money(c.amt)} 元・${roc(c.due)} 到期・${roc(c.recv)} 收到${c.col ? '・已送代收' : ''}`;
export function preOf(f) {
  const drawer = String(f.drawer || '').trim();
  const c = drawer ? matchCustomer(drawer) : null;
  const bank = [f.bank, f.branch].map(x => String(x || '').trim()).filter(Boolean).join(' ');
  return { name: c ? (c.short || c.name) : drawer, cid: c ? c.id : undefined, bank, no: toHalf(String(f.checkNo || '')).replace(/\s+/g, '').toUpperCase(), acct: toHalf(String(f.account || '')).replace(/\s+/g, ''), due: /^\d{4}-\d{2}-\d{2}$/.test(f.dueDate || '') ? f.dueDate : '', amt: +f.amount > 0 ? +f.amount : '', _ocr: { drawer, matched: !!c, notes: String(f.notes || '').trim() } };
}
/** 一張照片辨識到好幾張支票：先列清單，逐張打開登記客票核對；登記完自動接下一張 */
export function reviewChecks(list) {
  const done = new Set();
  const m = modal({
    title: `辨識到 ${list.length} 張支票`, width: 860, closeOnBg: false,
    body: '<div id="rvBody"></div>',
    footer: '<span class="muted small" id="rvSum"></span><span class="sp"></span><button class="btn" data-close>關閉</button><button class="btn pri" id="rvNext">登記下一張</button>',
    onOpen(el) {
      const draw = () => {
        el.querySelector('#rvBody').innerHTML = `<p class="muted small" style="margin:0 0 8px">每一張都要人工核對後才會登記。發票人對不到客戶的，打開後請自行選客戶。</p><div class="tw"><table><thead><tr><th>#</th><th>發票人 → 客戶</th><th>付款銀行</th><th>票號</th><th class="n">金額</th><th>到期日</th><th></th></tr></thead><tbody>${list.map((p, i) => `<tr class="${done.has(i) ? 'muted' : ''}"><td>${i + 1}</td><td>${p._ocr.matched ? `<b>${esc(p.name)}</b>` : p._ocr.drawer ? `${esc(p._ocr.drawer)} <span class="pill">找不到客戶</span>` : '<span class="pill">沒讀到</span>'}${p._ocr.notes ? `<div class="muted small">${esc(p._ocr.notes)}</div>` : ''}</td><td>${esc(p.bank)}</td><td class="mono">${esc(p.no)}</td><td class="n">${p.amt !== '' ? money(p.amt) : '—'}</td><td class="nowrap">${p.due ? roc(p.due) : '—'}</td><td class="r nowrap">${done.has(i) ? '<span class="pill ok">已登記</span>' : `${findDupCheck(p) ? '<span class="pill bad" title="同票號的支票已經登記過">已登記過？</span> ' : ''}<button class="btn xs pri" data-rv="${i}">登記</button>`}</td></tr>`).join('')}</tbody></table></div>`;
        el.querySelector('#rvSum').textContent = `已登記 ${done.size} / ${list.length} 張`;
        el.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => open(+b.dataset.rv));
        const nb = el.querySelector('#rvNext'); const next = list.findIndex((_, i) => !done.has(i)); nb.disabled = next < 0; nb.textContent = next < 0 ? '全部登記完成' : `登記第 ${next + 1} 張`;
      };
      const open = i => editCheck(null, list[i], () => { done.add(i); draw(); const next = list.findIndex((_, k) => !done.has(k)); if (next >= 0) setTimeout(() => open(next), 250); else toast(`${list.length} 張都登記好了`); });
      el.querySelector('#rvNext').onclick = () => { const next = list.findIndex((_, i) => !done.has(i)); if (next >= 0) open(next); };
      draw();
    },
  });
  return m;
}
/** 發票人名稱對到客戶：全名、簡稱、別名互相包含就算 */
function matchCustomer(drawer) {
  const n = x => String(x || '').replace(/[\s　()（）\-－]/g, '').toLowerCase();
  const d = n(drawer); if (d.length < 2) return null;
  const all = customers(true);
  let best = null, bestLen = 0;
  for (const c of all) for (const a of [c.name, c.short, ...(c.aliases || [])]) {
    const k = n(a); if (k.length < 2) continue;
    const l = k === d ? 1000 : d.includes(k) ? k.length : k.includes(d) ? d.length : 0;
    if (l > bestLen) { bestLen = l; best = c; }
  }
  return bestLen >= 2 ? best : null;
}
function shrinkImage(file, max, q) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { try { const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', q)); } catch (e) { rej(e); } };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('讀不到這張圖片')); };
    img.src = url;
  });
}
function editCheck(c, pre, onSaved) {
  const d = c ? { ...c } : { name: '', bank: '', no: '', acct: '', due: '', amt: '', note: '', recv: today(), ...(pre || {}) };
  const ocr = d._ocr; delete d._ocr;
  const hist = name => store.list('checks_in').filter(x => x.name === name).sort((a, b) => (b.recv || b.due || '').localeCompare(a.recv || a.due || ''));
  modal({
    title: c ? '修改客票' : '登記客票', width: 600,
    body: `${ocr ? `<div class="banner ${ocr.matched ? 'info' : ''}" style="margin-bottom:10px">已由照片辨識帶入，請逐欄核對再登記。${ocr.matched ? '' : ocr.drawer ? `發票人「${esc(ocr.drawer)}」找不到對應客戶，請自行選擇。` : '沒讀到發票人。'}${ocr.notes ? '辨識備註：' + esc(ocr.notes) : ''}</div>` : ''}<div class="grid"><div class="f" style="grid-column:1/-1"><label for="ck-name">客戶（發票人）</label><div class="combo"><input id="ck-name" value="${esc(d.name)}" placeholder="搜尋客戶或直接輸入" autofocus></div></div>
      <div class="f"><label for="ck-bank">付款銀行</label><input id="ck-bank" value="${esc(d.bank || '')}" list="ck-banks"><datalist id="ck-banks"></datalist></div><div class="f"><label for="ck-no">票號</label><input id="ck-no" class="mono" value="${esc(d.no || '')}"></div>
      <div class="f"><label for="ck-acct">帳號</label><input id="ck-acct" class="mono" value="${esc(d.acct || '')}"></div><div class="f"><label for="ck-due">到期日</label><input type="date" id="ck-due" value="${esc(d.due || '')}"></div>
      <div class="f"><label for="ck-amt">金額</label><input id="ck-amt" class="num" value="${d.amt !== '' ? money(d.amt) : ''}"></div><div class="f"><label for="ck-recv">收到日</label><input type="date" id="ck-recv" value="${esc(d.recv || '')}"></div>
      <div class="f" style="grid-column:1/-1"><label for="ck-note">備註</label><input id="ck-note" value="${esc(d.note || '')}"></div>
      ${c?.col ? `<div class="f"><label for="ck-col-a">代收帳戶</label><select id="ck-col-a">${accounts().map(a => `<option value="${a.id}" ${d.col.a === a.id ? 'selected' : ''}>${esc(acctTitle(a))}</option>`).join('')}<option value="" ${!d.col.a || !acctById(d.col.a) ? 'selected' : ''}>其他／未註記${d.col.raw ? `（${esc(d.col.raw)}）` : ''}</option></select></div><div class="f"><label for="ck-col-d">代收日期</label><input type="date" id="ck-col-d" value="${esc(d.col.d || '')}"></div>` : ''}</div><div id="ck-dup" class="banner" style="margin-top:10px;display:none"></div><div id="ck-hist" class="muted small"></div>`,
    footer: `${c ? '<button class="btn danger" id="ck-del">刪除</button>' : ''}${c?.col ? '<button class="btn" id="ck-undo">退回待代收</button>' : ''}<span class="sp"></span><button class="btn" data-close>${c ? '取消' : '關閉'}</button><button class="btn pri" id="ck-ok">${c ? '儲存' : '登記並繼續'}</button>`,
    onOpen(el, close) {
      let cid = d.cid;
      const fill = name => { const h = hist(name); const banks = [...new Set(h.map(x => x.bank).filter(Boolean))]; $('#ck-banks', el).innerHTML = banks.map(b => `<option>${esc(b)}</option>`).join(''); if (h[0] && !c) { if (!$('#ck-bank', el).value) $('#ck-bank', el).value = h[0].bank || ''; if (!$('#ck-acct', el).value) $('#ck-acct', el).value = h[0].acct || ''; } $('#ck-hist', el).innerHTML = h.length ? `最近：${h.slice(0, 3).map(x => `${roc(x.due)} ${esc(x.bank || '')} ${money(x.amt)}`).join('、')}（共 ${h.length} 張）` : ''; };
      combo($('#ck-name', el), { items: () => { const names = new Map(); customers().forEach(x => names.set(x.short || x.name, { id: x.id, label: x.short || x.name, sub: x.name !== (x.short || x.name) ? x.name : '', text: [x.code, x.name, x.short, ...(x.aliases || [])].join(' ') })); store.list('checks_in').forEach(x => { if (x.name && !names.has(x.name)) names.set(x.name, { id: x.cid || null, label: x.name, sub: '', text: x.name }); }); return [...names.values()]; }, allowFree: true, onPick: it => { cid = it.id; fill(it.label); }, onBlur: v => fill(v) });
      if (d.name) fill(d.name);
      // 防呆：票號／帳號／金額一改就檢查是不是已經登記過
      const cur = () => ({ no: $('#ck-no', el).value, acct: $('#ck-acct', el).value, name: $('#ck-name', el).value.trim(), amt: parseNum($('#ck-amt', el).value), due: $('#ck-due', el).value });
      const dupWarn = () => { const x = findDupCheck(cur(), d.id); const b = $('#ck-dup', el); b.style.display = x ? '' : 'none'; b.innerHTML = x ? `⚠ 這張支票已經登記過：${esc(dupText(x))}` : ''; return x; };
      ['ck-no', 'ck-acct', 'ck-amt', 'ck-due', 'ck-name'].forEach(id => $('#' + id, el).addEventListener('change', dupWarn));
      dupWarn();
      $('#ck-ok', el).onclick = async () => {
        const amt = parseNum($('#ck-amt', el).value); const name = $('#ck-name', el).value.trim();
        if (!name) return toast('請填客戶'); if (!(amt > 0)) return toast('金額要大於 0'); if (!$('#ck-due', el).value) return toast('請填到期日');
        const out = { ...d, cid, name, bank: $('#ck-bank', el).value.trim(), no: toHalf($('#ck-no', el).value).trim().toUpperCase(), acct: $('#ck-acct', el).value.trim(), due: $('#ck-due', el).value, amt, recv: $('#ck-recv', el).value, note: $('#ck-note', el).value.trim() }; delete out.id;
        const dup = findDupCheck(out, d.id);
        if (dup && !await confirm(`這張支票已經登記過（${dupText(dup)}），確定還要再登記一次嗎？`, { danger: true, ok: '仍要登記' })) return;
        if (c?.col) { const a = $('#ck-col-a', el).value; out.col = { d: $('#ck-col-d', el).value || '', a, raw: a ? '' : (d.col.raw || '') }; }
        const ckId = d.id || uid('ci'); await store.save('checks_in', ckId, out); toast(`已登記 ${name} ${money(amt)}`);
        if (c || pre) close(); else { ['ck-no', 'ck-amt', 'ck-note', 'ck-due'].forEach(id => $('#' + id, el).value = ''); $('#ck-name', el).focus(); }
        onSaved && onSaved(out);
        if (!c) arFromCheck({ ...out, id: ckId });   // 新登記的客票：接著打開對應月份的應收帳款，帶入收款資料
      };
      $('#ck-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這張客票？', { danger: true, ok: '刪除' })) { await store.remove('checks_in', c.id); close(); } });
      $('#ck-undo', el)?.addEventListener('click', async () => { const { col, id, ...rest } = c; await store.save('checks_in', c.id, rest); toast('已退回待代收'); close(); });
    },
  });
}
