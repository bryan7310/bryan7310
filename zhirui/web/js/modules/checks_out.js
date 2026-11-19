// 支票開立：付款支票、國字金額、套印；從應付帳款帶入
import { $, esc, money, today, roc, rocLong, parseNum, uid, cnMoney, slash, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, printHTML, pager, onSearch } from '../core/ui.js';
import { suppliers, cshort } from '../core/calc.js';
import { printName, legalName } from '../core/names.js';

const ui = { tab: 'pending', q: '', page: 0, day: '', cust: '', sel: new Set() };
export default {
  id: 'checks-out', name: '支票開立', group: '財務', icon: 'checks',
  render(el, { sub }) { this.el = el; if (sub === 'done' || sub === 'hist') ui.tab = sub; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('checks_out') || ch.has('settings') || ch.has('contacts'))) draw(this.el); },
  badge() { return { cnt: store.list('checks_out').filter(c => !c.printedAt).length }; },
};
const DEFAULT_LAYOUT = { pageW: 190.5, pageH: 98.4, offX: 0, offY: 0, mT: 13, mB: 0, mL: 26, mR: 0, rot: 0, a4: 0, a4Al: 'c', a4X: 0, a4Y: 0 };   // a4：印表機只有 A4 紙張時，支票放在 A4 上（手動進紙槽置中）   // rot：0 橫印、90 順時針轉、-90 逆時針轉（印表機直式進紙）
const FIELDS = { year: { x: 135.3, y: 18.0, w: 13.5, h: 8.2, v: 'vb', pt: 12 }, month: { x: 148.8, y: 18.0, w: 11.1, h: 8.2, v: 'vb', pt: 12 }, day: { x: 159.9, y: 18.0, w: 20.4, h: 8.2, v: 'vb', pt: 12 }, payee: { x: 67.3, y: 26.2, w: 113.0, h: 9.8, v: 'vc', pt: 14 }, words: { x: 62.8, y: 36.0, w: 117.5, h: 7.9, v: 'vc', pt: 14 }, num: { x: 67.3, y: 46.3, w: 68.0, h: 6.9, v: 'vt', pt: 14 } };
// 支票紙張預設：臺灣土地銀行單張支票 17.5×8.5 cm（位置量自實際支票：年月日、憑票支付、新臺幣、NT$）
const F0 = { font: '', bold: true, al: 'l', ls: 0, pre: '', suf: '' };
const PRESETS = {
  land175: { name: '臺灣土地銀行 17.5×8.5 cm', layout: { pageW: 175, pageH: 85, offX: 0, offY: 0, mT: 0, mB: 0, mL: 0, mR: 0 }, list: [
    { k: 'year', on: true, x: 109.2, y: 13.3, w: 6.6, h: 8, v: 'vb', pt: 12, ...F0, al: 'c' },
    { k: 'month', on: true, x: 118.2, y: 13.3, w: 6.4, h: 8, v: 'vb', pt: 12, ...F0, al: 'c' },
    { k: 'day', on: true, x: 127, y: 13.3, w: 6.5, h: 8, v: 'vb', pt: 12, ...F0, al: 'c' },
    { k: 'payee', on: true, x: 50, y: 20.3, w: 97, h: 8, v: 'vb', pt: 14, ...F0 },
    { k: 'words', on: true, x: 45.5, y: 28.6, w: 101, h: 8, v: 'vb', pt: 14, ...F0 },
    { k: 'num', on: true, x: 44, y: 36.6, w: 34, h: 7, v: 'vb', pt: 14, ...F0 },
    { k: 'no', on: false, x: 110, y: 6, w: 40, h: 6, v: 'vc', pt: 11, ...F0 },
    { k: 'note', on: false, x: 44, y: 45, w: 60, h: 6, v: 'vc', pt: 11, ...F0, bold: false }] },
};
const FNAME = { year: '年', month: '月', day: '日', payee: '抬頭（憑票支付）', words: '金額大寫（新臺幣）', num: '金額（NT$）', no: '支票號碼', note: '備註' };
function layout() { const s = store.setting('check_print'); return { ...DEFAULT_LAYOUT, ...(s.layout || {}) }; }
function fmtList() {
  const s = store.setting('check_print'); if (s.fmt && Array.isArray(s.fmt.list)) return s.fmt.list;
  const L = layout(); const r1 = v => Math.round(v * 10) / 10;
  return [...Object.keys(FIELDS).map(k => ({ k, on: true, ...FIELDS[k], x: r1(FIELDS[k].x - L.mL), y: r1(FIELDS[k].y - L.mT), font: '', bold: true, al: 'l', ls: 0, pre: '', suf: '' })), { k: 'no', on: false, x: 109.3, y: 0, w: 45, h: 7, v: 'vc', pt: 11, font: '', bold: true, al: 'l', ls: 0, pre: '', suf: '' }, { k: 'note', on: false, x: 41.3, y: 42, w: 68, h: 7, v: 'vc', pt: 11, font: '', bold: false, al: 'l', ls: 0, pre: '', suf: '' }];
}
const incNo = no => { const m = String(no || '').match(/^(.*?)(\d+)$/); return m ? m[1] + String(+m[2] + 1).padStart(m[2].length, '0') : ''; };
export function lastNo() { const s = store.setting('check_print'); if (s.lastNo) return s.lastNo; const w = store.list('checks_out').filter(c => c.no).sort((a, b) => (b.seq || 0) - (a.seq || 0)); return w.length ? w[0].no : ''; }
const rocDate = iso => { const [y, m, d] = iso.split('-').map(Number); return { y: y - 1911, m, d }; };

// 開票順序：金額由小到大，金額最小的支票號碼最小（同額依兌現日期）
const byAmt = (a, b) => (+a.amount || 0) - (+b.amount || 0) || (a.date || '').localeCompare(b.date || '');
// 分頁：待列印（還沒印）／已列印（印好、還沒到兌現日）／票據明細（印好、兌現日已過）
const isPast = c => !!c.printedAt && (c.date || '') < today();
const tabOf = c => !c.printedAt ? 'pending' : isPast(c) ? 'hist' : 'done';
const nameOf = c => payeeOut(c) || (c.cid ? cshort(c.cid) : String(c.payee || ''));   // 抬頭空白時用廠商簡稱稱呼這張支票
const WD = '日一二三四五六';
const wd = iso => WD[new Date(iso + 'T00:00:00').getDay()] || '';
// 還沒兌現的支票（兌現日今天以後）依兌現日期統計
function dueSummary(all) {
  const t = today(); const m = new Map();
  for (const c of all) {
    if (!c.date || c.date < t) continue;
    const g = m.get(c.date) || m.set(c.date, { date: c.date, n: 0, sum: 0, pend: 0 }).get(c.date);
    g.n++; g.sum += +c.amount || 0; if (!c.printedAt) g.pend++;
  }
  return [...m.values()].sort((x, y) => x.date.localeCompare(y.date));
}
function summaryHTML(rows) {
  if (!rows.length) return '';
  const tot = rows.reduce((a, r) => a + r.sum, 0), n = rows.reduce((a, r) => a + r.n, 0);
  return `<div class="co-due"><div class="co-due-h"><b>兌現統計</b><span class="muted small">還沒兌現的支票 ${n} 張・合計 ${money(tot)}；點日期只看那天的支票</span>${ui.day ? '<button class="btn xs" data-day="">看全部日期</button>' : ''}</div>
    <div class="co-due-g">${rows.map(r => `<button type="button" class="co-due-c${ui.day === r.date ? ' on' : ''}" data-day="${r.date}"><span class="d">${esc(roc(r.date))}（${wd(r.date)}）</span><b>${money(r.sum)}</b><span class="muted small">${r.n} 張${r.pend ? `・${r.pend} 張待列印` : ''}</span></button>`).join('')}</div></div>`;
}
function draw(el) {
  const all = store.list('checks_out'); const q = qTerms(ui.q);
  const ids = new Set(all.map(c => c.id)); for (const id of [...ui.sel]) if (!ids.has(id)) ui.sel.delete(id);
  let list = all.filter(c => tabOf(c) === ui.tab);
  if (ui.tab !== 'hist' && ui.day) list = list.filter(c => c.date === ui.day);
  if (ui.tab === 'hist' && ui.cust.trim()) { const cq = qTerms(ui.cust); list = list.filter(c => matchQ([c.payee, nameOf(c), c.cid ? cshort(c.cid) : '', c.cid ? store.get('contacts', c.cid)?.name : ''].join(' '), cq)); }
  if (q.length) list = list.filter(c => matchQ([c.payee, nameOf(c), c.cid ? cshort(c.cid) : '', c.no, c.note, money(c.amount)].join(' '), q));
  list.sort((a, b) => ui.tab === 'pending' ? byAmt(a, b) : ui.tab === 'done' ? (a.date || '').localeCompare(b.date || '') || byAmt(a, b) : (b.date || '').localeCompare(a.date || '') || byAmt(a, b));
  const [s, e, pg] = pager('co', list.length, ui.page); const page = list.slice(s, e);
  const cnt = k => all.filter(c => tabOf(c) === k).length;
  const sel = all.filter(c => ui.sel.has(c.id)); const selSum = sel.reduce((a, c) => a + (+c.amount || 0), 0);
  const hist = ui.tab === 'hist';
  el.innerHTML = `<div class="head"><h1>支票開立</h1><span class="sp"></span>${tabs('co', [['pending', `待列印 ${cnt('pending') || ''}`], ['done', `已列印 ${cnt('done') || ''}`], ['hist', '票據明細']], ui.tab)}<button class="btn" id="coLayout">套印位置</button><button class="btn pri" id="coNew">＋ 開立支票</button></div>
    ${hist ? '' : summaryHTML(dueSummary(all))}
    <div class="panel"><div class="tools">${hist ? `<div class="f" style="width:220px"><label for="coCust">客戶名稱</label><input type="search" id="coCust" placeholder="輸入抬頭／客戶名稱篩選" value="${esc(ui.cust)}"></div>` : ''}<input type="search" id="coQ" placeholder="搜尋抬頭、票號、金額、備註" value="${esc(ui.q)}"><span class="muted small">${list.length} 張・合計 ${money(list.reduce((a, c) => a + (+c.amount || 0), 0))}${!hist && ui.day ? `（兌現日 ${esc(roc(ui.day))}）` : ''}</span><span class="sp"></span>${ui.tab === 'pending' && list.length ? `<button class="btn sm pri" id="coPrintAll">列印全部待列印（${list.length} 張）</button>` : ''}</div>
    ${hist ? '<p class="muted small" style="margin:6px 0 0">已列印、兌現日期已過的支票會自動移到這裡。</p>' : ''}
    <div class="tools co-selbar"${sel.length ? '' : ' hidden'}><b>已勾選 ${sel.length} 張</b><span class="muted small">合計 ${money(selSum)}</span><span class="sp"></span>${sel.some(c => c.printedAt) ? `<button class="btn sm" id="coBackSel">退回待列印${sel.length > 1 ? `（${sel.filter(c => c.printedAt).length}）` : ''}</button>` : ''}<button class="btn sm" id="coEditSel">修改</button><button class="btn sm danger" id="coDelSel">刪除</button><button class="btn sm ghost" id="coClrSel">取消勾選</button></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th><input type="checkbox" id="coSelAll" aria-label="全選這一頁" ${page.length && page.every(c => ui.sel.has(c.id)) ? 'checked' : ''}></th><th>兌現日期</th><th>抬頭</th><th class="n">金額</th><th>國字</th><th>支票號碼</th><th>備註</th>${ui.tab === 'pending' ? '' : '<th>列印日</th>'}<th></th></tr></thead><tbody>${page.map(c => `<tr class="row${ui.sel.has(c.id) ? ' on' : ''}" data-id="${c.id}"><td><input type="checkbox" data-sel="${c.id}" ${ui.sel.has(c.id) ? 'checked' : ''} aria-label="勾選 ${esc(nameOf(c))}"></td><td class="nowrap">${esc(roc(c.date))}</td><td>${payeeOut(c) ? `<b>${esc(payeeOut(c))}</b>` : `<span class="muted">（空白）</span><span class="sub">${esc(c.cid ? cshort(c.cid) : '')}</span>`}</td><td class="n">${money(c.amount)}</td><td class="muted small">${esc(cnMoney(c.amount))}</td><td class="mono">${esc(c.no || '')}</td><td class="muted">${esc(c.note || '')}</td>${ui.tab === 'pending' ? '' : `<td class="nowrap muted small">${c.printedAt ? esc(roc(new Date(c.printedAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))) : ''}</td>`}<td class="nowrap"><button class="btn xs" data-print="${c.id}">${c.printedAt ? '重印' : '列印'}</button></td></tr>`).join('') || `<tr><td colspan="9"><div class="empty"><b>${ui.tab === 'pending' ? '沒有待列印的支票' : ui.tab === 'done' ? '沒有還沒兌現的已列印支票' : '沒有兌現日已過的支票'}</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; ui.sel.clear(); draw(el); }, { once: true });
  onSearch($('#coQ', el), v => { ui.q = v; ui.page = 0; draw(el); const i = $('#coQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  if ($('#coCust', el)) onSearch($('#coCust', el), v => { ui.cust = v; ui.page = 0; draw(el); const i = $('#coCust', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  el.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { ui.day = ui.day === b.dataset.day ? '' : b.dataset.day; ui.page = 0; if (ui.day && ui.tab === 'hist') ui.tab = 'pending'; draw(el); }));
  $('#coNew', el).addEventListener('click', () => newCheckOut());
  $('#coLayout', el).addEventListener('click', layoutDialog);
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button,input')) return; newCheckOut(store.get('checks_out', tr.dataset.id)); }));
  el.querySelectorAll('[data-sel]').forEach(cb => cb.addEventListener('change', () => { cb.checked ? ui.sel.add(cb.dataset.sel) : ui.sel.delete(cb.dataset.sel); draw(el); }));
  $('#coSelAll', el)?.addEventListener('change', ev => { for (const c of page) ev.target.checked ? ui.sel.add(c.id) : ui.sel.delete(c.id); draw(el); });
  $('#coClrSel', el)?.addEventListener('click', () => { ui.sel.clear(); draw(el); });
  $('#coEditSel', el)?.addEventListener('click', () => { if (sel.length === 1) newCheckOut(sel[0], v => { if (v) ui.sel.clear(); }); else editMany(sel); });
  $('#coDelSel', el)?.addEventListener('click', () => deleteChecks(sel));
  $('#coBackSel', el)?.addEventListener('click', () => backToPending(sel.filter(c => c.printedAt)));
  el.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => printChecks([store.get('checks_out', b.dataset.print)])));
  $('#coPrintAll', el)?.addEventListener('click', () => printChecks(list));
}
// 和應付帳款連動：支票從應付帳款「送待開支票」來的（apId），改金額／兌現日要同步，刪掉要讓應付帳款回到待開票
function apSync(c, ops, del) {
  if (!c.apId) return;
  const ap = store.get('payables', c.apId); if (!ap || ap.checkId !== c.id) return;
  const d = { ...ap }; delete d.id;
  if (del) { delete d.pay; delete d.payDate; delete d.checkId; } else { d.pay = +c.amount; d.dueDate = c.date; }
  ops.push({ col: 'payables', id: c.apId, data: d });
}
async function deleteChecks(list) {
  if (!list.length) return;
  const sum = list.reduce((a, c) => a + (+c.amount || 0), 0); const printed = list.filter(c => c.printedAt).length; const linked = list.filter(c => c.apId).length;
  if (!await confirm(`刪除 ${list.length} 張支票（合計 ${money(sum)}）？\n${list.slice(0, 12).map(c => `${nameOf(c)}　${money(c.amount)}　${roc(c.date)}${c.no ? '　' + c.no : ''}`).join('\n')}${list.length > 12 ? `\n…等 ${list.length} 張` : ''}${printed ? `\n\n其中 ${printed} 張已經列印過。` : ''}${linked ? `\n從應付帳款送來的 ${linked} 張，應付帳款會回到「待開票」。` : ''}`, { danger: true, ok: '刪除' })) return;
  const ops = [];
  for (const c of list) { ops.push({ col: 'checks_out', id: c.id, delete: true }); apSync(c, ops, true); }
  await store.batch(ops); for (const c of list) ui.sel.delete(c.id);
  store.log('刪除', `支票 ${list.length} 張：${list.map(c => `${nameOf(c)} ${money(c.amount)}`).join('、')}`); toast(`已刪除 ${list.length} 張支票`);
}
// 退回待列印：清掉列印紀錄，支票號碼保留（重印時沿用；要換號碼到「修改」清掉）
async function backToPending(list) {
  if (!list.length) return;
  const lines = list.slice(0, 12).map(c => `${nameOf(c)}　${money(c.amount)}　${c.no || ''}`).join('\n');
  if (!await confirm(`把 ${list.length} 張已列印的支票退回「待列印」？\n${lines}${list.length > 12 ? `\n…等 ${list.length} 張` : ''}\n\n支票號碼會保留，重印時沿用；要換號碼請到「修改」把號碼清掉。`, { ok: '退回待列印' })) return;
  const ops = list.map(c0 => { const c = { ...store.get('checks_out', c0.id) }; delete c.id; delete c.printedAt; delete c.seq; return { col: 'checks_out', id: c0.id, data: c }; });
  await store.batch(ops); for (const c of list) ui.sel.delete(c.id);
  store.log('修改', `支票 ${list.length} 張退回待列印：${list.map(c => `${nameOf(c)} ${money(c.amount)}`).join('、')}`); toast(`已退回待列印 ${list.length} 張`);
}
// 一次修改多張：兌現日期、備註（空白＝不改）
function editMany(list) {
  modal({
    title: `修改 ${list.length} 張支票`, width: 460,
    body: `<p class="muted small" style="margin-top:0">${list.map(c => esc(`${nameOf(c)} ${money(c.amount)}`)).join('、')}</p>
      <div class="grid"><div class="f"><label for="cm-date">兌現日期</label><input type="date" id="cm-date"></div><div class="f"><label for="cm-note">備註</label><input id="cm-note" placeholder="空白＝不改"></div></div>
      <p class="muted small">只會改有填的欄位；金額、抬頭請一張一張改。</p>`,
    footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="cm-ok">儲存</button>',
    onOpen(m, close) {
      $('#cm-ok', m).onclick = async () => {
        const date = $('#cm-date', m).value, note = $('#cm-note', m).value.trim();
        if (!date && !note) return toast('沒有要改的內容');
        const ops = [];
        for (const c0 of list) { const c = { ...store.get('checks_out', c0.id) }; if (date) c.date = date; if (note) c.note = note; apSync(c, ops); delete c.id; ops.push({ col: 'checks_out', id: c0.id, data: c }); }
        await store.batch(ops); store.log('修改', `支票 ${list.length} 張${date ? `兌現日改 ${roc(date)}` : ''}${note ? `　備註改「${note}」` : ''}`);
        ui.sel.clear(); close(); toast(`已修改 ${list.length} 張`);
      };
    },
  });
}
export function newCheckOut(preset, cb) {
  const d = preset?.id ? { ...preset } : { date: today(), payee: '', amount: '', note: '', no: '', ...(preset || {}) };
  const isNew = !preset?.id;
  modal({
    title: isNew ? '開立支票' : '修改支票', width: 560,
    body: `<div class="grid"><div class="f" style="grid-column:1/-1"><label for="co-payee">抬頭（受款人）</label><div class="combo"><input id="co-payee" value="${esc(d.payee || (d.cid ? cshort(d.cid) : ''))}" placeholder="搜尋供應商或直接輸入"></div></div>
      <div class="f" id="co-pn-wrap" style="grid-column:1/-1" hidden><label for="co-pn">票據抬頭</label><select id="co-pn"></select></div>
      <div class="f"><label for="co-date">兌現日期</label><input type="date" id="co-date" value="${esc(d.date)}"></div><div class="f"><label for="co-amount">金額</label><input id="co-amount" class="num" value="${d.amount !== '' ? money(d.amount) : ''}"></div>
      <div class="f"><label for="co-no">支票號碼（可列印時再填）</label><input id="co-no" class="mono" value="${esc(d.no || '')}" placeholder="${esc(incNo(lastNo()))}"></div><div class="f"><label for="co-note">備註</label><input id="co-note" value="${esc(d.note || '')}"></div></div>
      <div class="muted" id="co-cn" style="font-size:15px">${cnMoney(d.amount)}</div>`,
    footer: `${!isNew ? '<button class="btn danger" id="co-del">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="co-ok">儲存</button>`,
    onOpen(el, close) {
      let cid = d.cid;
      const pnFill = keep => {
        const s = cid && store.get('contacts', cid); const cps = cpNames(s); const wrap = $('#co-pn-wrap', el), sel = $('#co-pn', el);
        if (!s) { wrap.hidden = true; sel.innerHTML = ''; return; }
        const def = cpDef(s); const dp = String(d.payee || '').trim(); const mk = v => v === def ? '・預設' : '';
        const v = keep ? sel.value : d.payeeFixed ? (!dp ? 'blank' : cps.includes(dp) ? 'cp' + cps.indexOf(dp) : 'orig') : def;
        sel.innerHTML = `${cps.map((n, i) => `<option value="cp${i}">${esc(n)}（票據抬頭${cps.length > 1 ? ' ' + (i + 1) : ''}${mk('cp' + i)}）</option>`).join('')}<option value="orig">${esc(legalName(s.name))}（正式名稱${mk('orig')}）</option><option value="blank">（空白，不寫抬頭${mk('blank')}）</option>`; sel.value = [...sel.options].some(o => o.value === v) ? v : def; wrap.hidden = false;
      };
      pnFill(false);
      combo($('#co-payee', el), { items: () => suppliers().map(c => ({ id: c.id, label: printName(c.name), sub: c.short || '', text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { cid = it.id; pnFill(false); } });
      $('#co-amount', el).addEventListener('input', () => { $('#co-cn', el).textContent = cnMoney(parseNum($('#co-amount', el).value) || 0); });
      $('#co-ok', el).onclick = async () => {
        const amount = parseNum($('#co-amount', el).value); const payee = $('#co-payee', el).value.trim();
        if (!payee && !cid) return toast('請填抬頭'); if (!(amount > 0)) return toast('金額要大於 0');
        const out = { ...d, cid, payee, amount, date: $('#co-date', el).value, no: $('#co-no', el).value.trim().toUpperCase(), note: $('#co-note', el).value.trim(), createdAt: d.createdAt || Date.now() }; delete out.id;
        const sc = cid && store.get('contacts', cid);
        if (!out.payee && sc) out.payee = sc.name;
        const pm = $('#co-pn-wrap', el).hidden ? '' : $('#co-pn', el).value;
        // 選的就是這家的預設抬頭 → 不指定（跟著基本資料走）；選別的 → 這張固定用選的
        if (!pm) delete out.payeeFixed;
        else if (pm === cpDef(sc)) { delete out.payeeFixed; out.payee = sc.name; }   // 回到預設：抬頭跟著廠商，不留之前指定的名稱
        else { out.payeeFixed = true; out.payee = pm === 'blank' ? '' : pm === 'orig' ? legalName(sc.name) : cpNames(sc)[+pm.slice(2)]; }
        const id = d.id || uid('co'); const ops = [{ col: 'checks_out', id, data: out }]; apSync({ ...out, id }, ops); await store.batch(ops); store.log(isNew ? '開立' : '修改', `支票 ${payee} ${money(amount)}`); close(); toast('已儲存'); cb && cb({ ...out, id });
      };
      $('#co-del', el)?.addEventListener('click', async () => { close(); await deleteChecks([store.get('checks_out', d.id)]); });
    },
    onClose: v => { if (!v) cb && cb(null); },
  });
}
// 支票抬頭印正式全名：抬頭寫的是該供應商的簡稱／別名時換成全名；拿掉備註括號，(股)公司 寫成 股份有限公司
const cpList = s => String(s?.checkPayee || '').split(/[,，]/).map(x => x.trim()).filter(Boolean);
// 票據抬頭裡的「不填」＝抬頭空白；排第一個就是預設空白
const cpNames = s => cpList(s).filter(n => n !== '不填');
const cpDef = s => cpList(s)[0] === '不填' ? 'blank' : cpNames(s).length ? 'cp0' : 'orig';
function payeeOut(c) {
  const s = c.cid && store.get('contacts', c.cid); const p = String(c.payee || '').trim();
  if (c.payeeFixed) return p;   // 這張指定了抬頭（正式名稱或空白）就照存的印
  const cps = cpNames(s);
  if (s && (!p || p === s.short || p === s.name || cps.includes(p) || (s.aliases || []).includes(p))) { const df = cpDef(s); return df === 'blank' ? '' : df === 'cp0' ? cps[0] : legalName(s.name); }   // 預設：第一個票據抬頭（「不填」＝空白），沒有就用正式全名
  return legalName(p);
}
async function printChecks(list) {
  list = [...list].sort(byAmt);
  // 沒票號的先補：從上一張 +1
  const need = list.filter(c => !c.no);
  if (need.length) {
    const first = await new Promise(res => modal({ title: '填支票號碼', width: 420, body: `<p>有 ${need.length} 張沒有支票號碼。依金額由小到大配號：輸入金額最小那張的號碼，其餘自動 +1。</p><div class="f"><input id="cn1" class="mono" value="${esc(incNo(lastNo()))}" autofocus></div>`, footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="cnOk">繼續</button>', onOpen(el, close) { el.querySelector('#cnOk').onclick = () => { res(el.querySelector('#cn1').value.trim().toUpperCase()); close(); }; }, onClose: () => res(null) }));
    if (!first) return;
    let no = first; for (const c of need) { c.no = no; no = incNo(no); }
  }
  const L = layout(); const { css, html } = checkHTML(list, L, fmtList());
  printHTML('支票套印', css, html, { tip: `把支票放進印表機，紙張 ${paperTxt(L)}、邊界「無」、縮放 100%。共 ${list.length} 張。` });
  const ops = list.map(c => ({ col: 'checks_out', id: c.id, data: { ...store.get('checks_out', c.id), no: c.no, printedAt: Date.now(), seq: Date.now() } }));
  const last = (need.length ? need : list)[(need.length ? need : list).length - 1].no; const s = store.setting('check_print');
  ops.push({ col: 'settings', id: 'check_print', data: { ...s, lastNo: last } });
  for (const o of ops) delete o.data.id;
  await store.batch(ops);
}
/** 套印版面：test＝對位測試頁（白紙印，欄位畫框、紙張外框） */
function checkHTML(list, L, fl, test) {
  const html = list.map(c => {
    const dt = rocDate(c.date); const vals = { year: dt.y, month: dt.m, day: dt.d, payee: payeeOut(c), words: cnMoney(c.amount), num: money(c.amount), no: c.no || '', note: c.note || '' };
    const r = +L.rot || 0; const tf = r === 90 ? `transform:translate(${L.pageH}mm,0) rotate(90deg);` : r === -90 ? `transform:translate(0,${L.pageW}mm) rotate(-90deg);` : '';
    let h = `${r ? `<div class="sheet" style="width:${L.pageH}mm;height:${L.pageW}mm">` : ''}<div class="check${test ? ' test' : ''}" style="width:${L.pageW}mm;height:${L.pageH}mm;${tf}">`;
    for (const f of fl) { if (!f.on) continue; let v = f.custom ? (f.txt || '') : (vals[f.k] ?? ''); if (v !== '' && v != null) v = (f.pre || '') + v + (f.suf || ''); h += `<div class="f ${f.v || 'vc'}${f.al === 'c' ? ' ha-c' : f.al === 'r' ? ' ha-r' : ''}" style="left:${+L.mL + f.x + +L.offX}mm;top:${+L.mT + f.y + +L.offY}mm;width:${f.w}mm;height:${f.h}mm;font-size:${f.pt}pt;${f.font ? `font-family:${esc(f.font)};` : ''}font-weight:${f.bold ? 700 : 400};${f.bold ? '-webkit-text-stroke:.45px #000;' : ''}${+f.ls ? `letter-spacing:${+f.ls}mm;` : ''}">${test ? `<i>${esc(FNAME[f.k] || f.k)}</i>` : ''}<span>${esc(v)}</span></div>`; }
    h += '</div>' + (+L.rot ? '</div>' : '');
    if (+L.a4) { const w = +L.rot ? +L.pageH : +L.pageW; h = `<div class="a4p"><div class="pos" style="left:${(L.a4Al === 'l' ? 0 : (210 - w) / 2) + (+L.a4X || 0)}mm;top:${+L.a4Y || 0}mm">${h}</div></div>`; }
    return h;
  }).join('');
  const rot = +L.rot || 0;
  const css = `@page{size:${+L.a4 ? 'A4 portrait' : rot ? `${L.pageH}mm ${L.pageW}mm` : `${L.pageW}mm ${L.pageH}mm`};margin:0}body{margin:0}.a4p{position:relative;width:210mm;height:296.5mm;overflow:hidden;break-after:page;page-break-after:always}.a4p .pos{position:absolute}.a4p .sheet,.a4p .check{break-after:auto;page-break-after:auto}${test && +L.a4 ? '.a4p{outline:.2mm dotted #bbb;outline-offset:-.1mm}' : ''}.sheet{position:relative;overflow:hidden;break-after:page;page-break-after:always}.sheet .check{position:absolute;left:0;top:0;transform-origin:0 0;break-after:auto;page-break-after:auto}.check{position:relative;color:#000;font-family:"PMingLiU","新細明體","MingLiU","Noto Serif TC",serif;font-weight:700;overflow:hidden;break-after:page;page-break-after:always}.f{position:absolute;display:flex;white-space:nowrap;padding-left:.6mm;line-height:1}.f.vb{align-items:flex-end;padding-bottom:.4mm}.f.vc{align-items:center}.f.vt{align-items:flex-start;padding-top:.4mm}.f.ha-c{justify-content:center}.f.ha-r{justify-content:flex-end}`
    + `.check.test{outline:.3mm solid #000;outline-offset:-.15mm}.check.test .f{outline:.2mm dashed #888}.check.test .f i{position:absolute;left:0;top:-2.6mm;font:normal 6pt sans-serif;color:#666}`;
  return { css, html };
}
const paperTxt = L => +L.a4 ? `A4（支票在 A4 上方${L.a4Al === 'l' ? '靠左' : '置中'}${+L.rot ? '，內容轉 90 度' : ''}）` : +L.rot ? `${L.pageH}×${L.pageW} mm（直式，內容轉 90 度）` : `${L.pageW}×${L.pageH} mm`;
/** 對位測試頁：用 A4 白紙印，跟支票疊在一起對著光看，或用尺量 */
function testPrint(over = {}) {
  const L = { ...layout(), ...over }; const sample = [{ date: new Date().toISOString().slice(0, 10), payee: '測試抬頭有限公司', amount: 123456, no: 'SCAB4508247' }];
  const { css, html } = checkHTML(sample.map(c => ({ ...c, id: 'test' })), L, fmtList(), true);
  printHTML('支票對位測試頁', css, html, { tip: `先用白紙印：紙張 ${paperTxt(L)}、邊界「無」、縮放 100%。外框是支票邊緣，虛線框是各欄位；跟真的支票疊起來對，偏右就把「水平位移」改負數、偏下就把「垂直位移」改負數。` });
}
const a4Of = el => ({ a4: el.querySelector('#lyA4')?.checked ? 1 : 0, a4Al: el.querySelector('#ly-a4Al')?.value || 'c', a4X: parseFloat(el.querySelector('#ly-a4X')?.value) || 0, a4Y: parseFloat(el.querySelector('#ly-a4Y')?.value) || 0 });
function layoutDialog() {
  const L = layout(); const s = store.setting('check_print');
  modal({
    title: '支票套印位置', width: 520,
    body: `<p class="muted" style="margin:0">支票紙張大小與列印位移（mm）。印出來整體偏右就把「水平位移」改負數；偏下就把「垂直位移」改負數。各欄位的細部位置沿用舊作業平台的設定。</p>
      <div class="grid">${[['pageW', '紙寬'], ['pageH', '紙高'], ['mL', '左邊界'], ['mT', '上邊界'], ['offX', '水平位移'], ['offY', '垂直位移']].map(([k, l]) => `<div class="f"><label for="ly-${k}">${l}</label><input id="ly-${k}" class="num" value="${L[k]}"></div>`).join('')}</div>
      <div class="f" style="margin-top:10px"><label>列印方向（印表機怎麼進紙）</label><div class="tools">${[[0, '橫印（不轉）'], [90, '轉 90 度（順時針）'], [-90, '轉 90 度（逆時針）']].map(([v, t]) => `<label class="check" style="display:inline-flex;gap:6px;align-items:center;white-space:nowrap"><input type="radio" name="lyRot" value="${v}" ${(+L.rot || 0) === v ? 'checked' : ''}> ${t}</label>`).join('')}</div><div class="muted small">支票直著放進印表機（窄邊先進）就選轉 90 度；先印對位測試頁看外框和字的方向對不對，反了就換另一個方向。</div></div>
      <div class="f" style="margin-top:10px"><label class="check" style="display:flex;gap:8px;align-items:flex-start;text-align:left"><input type="checkbox" id="lyA4" style="width:auto;margin-top:3px;flex:none" ${+L.a4 ? 'checked' : ''}> 用 A4 紙張印（印表機沒有支票尺寸的紙張；支票放進手動進紙槽，導板夾在中間）</label>
        <div class="grid" style="margin-top:6px"><div class="f"><label for="ly-a4Al">支票在 A4 上</label><select id="ly-a4Al"><option value="c" ${L.a4Al !== 'l' ? 'selected' : ''}>上方置中</option><option value="l" ${L.a4Al === 'l' ? 'selected' : ''}>上方靠左</option></select></div><div class="f"><label for="ly-a4X">A4 水平位移</label><input id="ly-a4X" class="num" value="${+L.a4X || 0}"></div><div class="f"><label for="ly-a4Y">A4 垂直位移</label><input id="ly-a4Y" class="num" value="${+L.a4Y || 0}"></div></div>
        <div class="muted small">A4 位移照「印出來的紙」方向：整張偏右填負數、偏下填負數（mm）。</div></div>
      <div class="tools" style="margin-top:10px">${Object.entries(PRESETS).map(([k, p]) => `<button class="btn" data-preset="${k}">套用：${esc(p.name)}</button>`).join('')}<button class="btn" id="lyTest">印對位測試頁</button></div>
      <p class="muted small" style="margin:6px 0 0">目前：${s.preset && PRESETS[s.preset] ? esc(PRESETS[s.preset].name) : `${L.pageW}×${L.pageH} mm（舊作業平台的版面）`}。套用會換掉紙張大小和各欄位位置（位移歸零）。</p>`,
    footer: '<button class="btn" id="lyReset">恢復預設</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="lyOk">儲存</button>',
    onOpen(el, close) {
      $('#lyOk', el).onclick = async () => { const o = { ...L }; for (const k of Object.keys(DEFAULT_LAYOUT)) { const v = parseFloat($('#ly-' + k, el)?.value); if (isFinite(v)) o[k] = v; } o.rot = +(el.querySelector('[name="lyRot"]:checked')?.value || 0); Object.assign(o, a4Of(el)); await store.saveSetting('check_print', { ...s, layout: o }); close(); toast('已儲存'); };
      $('#lyReset', el).onclick = async () => { await store.saveSetting('check_print', { ...s, layout: DEFAULT_LAYOUT }); close(); };
      $('#lyTest', el).onclick = () => testPrint({ rot: +(el.querySelector('[name="lyRot"]:checked')?.value || 0), ...a4Of(el) });
      el.querySelectorAll('[data-preset]').forEach(b => b.onclick = async () => {
        const p = PRESETS[b.dataset.preset]; if (!await confirm(`套用「${p.name}」？\n紙張會改成 ${p.layout.pageW}×${p.layout.pageH} mm，年月日、抬頭、金額的位置一起換掉。`, { ok: '套用' })) return;
        const old = s.preset ? null : { layout: s.layout, fmt: s.fmt };   // 第一次套用：留一份舊版面
        await store.saveSetting('check_print', { ...s, preset: b.dataset.preset, layout: { ...p.layout, rot: +(el.querySelector('[name="lyRot"]:checked')?.value || 0), ...a4Of(el) }, fmt: { list: p.list.map(f => ({ ...f })) }, ...(old ? { oldLayout: old } : {}) });
        close(); toast(`已套用 ${p.name}；建議先印對位測試頁`); layoutDialog();
      });
    },
  });
}
