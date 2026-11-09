// 支票登記：登記收到的客票、依到期日送代收、帳戶分類
import { $, esc, money, today, roc, slash, parseNum, uid, daysLeft, qTerms, matchQ, toHalf, addDays } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, pager, printHTML } from '../core/ui.js';
import { customers, cshort } from '../core/calc.js';

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
function draw(el) {
  const t = today(); const all = store.list('checks_in'); const q = qTerms(ui.q);
  const pend = all.filter(c => !c.col).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const sum = l => l.reduce((s, c) => s + (+c.amt || 0), 0);
  let list;
  if (ui.tab === 'pending') list = pend.filter(c => !q.length || matchQ([c.name, c.bank, c.no, c.note, money(c.amt)].join(' '), q));
  else {
    const years = [...new Set(all.filter(c => c.col).map(c => (c.col.d || c.due || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    // 預設顯示今年（或最近有資料的一年）；日期打錯成 2133 之類的年份不會變成預設
    if (!ui.year) { const cy = +t.slice(0, 4); ui.year = years.find(y => +y <= cy + 1) || years[0] || 'all'; }
    list = all.filter(c => c.col && (ui.year === 'all' || (c.col.d || c.due || '').startsWith(ui.year)) && (!q.length || matchQ([c.name, c.bank, c.no, c.note, money(c.amt), labelOf(c)].join(' '), q))).sort((a, b) => (b.col.d || b.due || '').localeCompare(a.col.d || a.due || ''));
    ui.years = years;
  }
  const [s, e, pg] = pager('ci', list.length, ui.page);
  const late = pend.filter(c => c.due && c.due < t), soon = pend.filter(c => c.due >= t && daysLeft(c.due) <= 7);
  el.innerHTML = `<div class="head"><h1>支票登記</h1><span class="sp"></span>${tabs('ci', [['pending', `待代收 ${pend.length}`], ['done', '已代收']], ui.tab)}<button class="btn pri" id="ciNew">＋ 登記客票</button></div>
    ${ui.tab === 'pending' ? `<div class="kpis"><div class="kpi"><span>待代收</span><b>${money(sum(pend))}</b><small>${pend.length} 張</small></div><div class="kpi ${late.length ? 'alert' : ''}"><span>已到期未送</span><b>${money(sum(late))}</b><small>${late.length} 張</small></div><div class="kpi"><span>7 天內到期</span><b>${money(sum(soon))}</b><small>${soon.length} 張</small></div></div>` : ''}
    <div class="panel"><div class="tools">${ui.tab === 'done' ? `<select id="ciYear"><option value="all" ${ui.year === 'all' ? 'selected' : ''}>全部年度</option>${(ui.years || []).map(y => `<option value="${y}" ${y === ui.year ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}<input type="search" id="ciQ" placeholder="搜尋客戶、銀行、票號、金額" value="${esc(ui.q)}"><span class="muted small">${list.length} 張・合計 ${money(sum(list))}</span><span class="sp"></span>
      ${ui.tab === 'pending' ? `<span class="muted small">勾選後送代收到：</span><select id="ciAcct">${accounts().map(a => `<option value="${a.id}" ${a.id === ui.acct ? 'selected' : ''}>${esc(a.code)} ${esc(a.bank)} ${esc(a.holder)}</option>`).join('')}</select><input type="date" id="ciDate" value="${t}"><button class="btn sm pri" id="ciSend" ${ui.sel.size ? '' : 'disabled'}>送代收 ${ui.sel.size ? `(${ui.sel.size} 張 ${money(sum(pend.filter(c => ui.sel.has(c.id))))})` : ''}</button><button class="btn sm" id="ciList" ${ui.sel.size ? '' : 'disabled'}>列印託收清單</button>` : ''}</div>
    <div class="tw" style="margin-top:10px"><table><thead><tr>${ui.tab === 'pending' ? '<th><input type="checkbox" id="ciAll" aria-label="全選"></th>' : ''}<th>到期日</th><th>客戶</th><th>銀行</th><th>票號</th><th>帳號</th><th class="n">金額</th><th>收到日</th>${ui.tab === 'done' ? '<th>代收</th>' : ''}<th>備註</th><th></th></tr></thead><tbody>
      ${list.slice(s, e).map(c => { const dl = c.due ? daysLeft(c.due) : null; const tag = ui.tab === 'pending' && c.due ? (dl < 0 ? `<span class="pill bad">到期 ${-dl} 天</span>` : dl <= 7 ? `<span class="pill warn">${dl === 0 ? '今天' : dl + ' 天後'}</span>` : '') : ''; return `<tr class="row" data-id="${c.id}">${ui.tab === 'pending' ? `<td><input type="checkbox" data-sel="${c.id}" ${ui.sel.has(c.id) ? 'checked' : ''}></td>` : ''}<td class="nowrap">${esc(roc(c.due))} ${tag}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.bank || '')}</td><td class="mono">${esc(c.no || '')}</td><td class="mono muted">${esc(c.acct || '')}</td><td class="n">${money(c.amt)}</td><td class="nowrap muted">${c.recv ? esc(roc(c.recv)) : ''}</td>${ui.tab === 'done' ? `<td><span class="pill blue">${esc(labelOf(c))}</span></td>` : ''}<td class="muted">${esc(c.note || '')}</td><td class="nowrap">${ui.tab === 'done' ? `<button class="btn xs" data-undo="${c.id}">退回待代收</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="11"><div class="empty"><b>${ui.tab === 'pending' ? '沒有待代收的客票' : '沒有紀錄'}</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; ui.q = ''; draw(el); }, { once: true });
  $('#ciQ', el).addEventListener('input', ev => { ui.q = ev.target.value; ui.page = 0; draw(el); const i = $('#ciQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#ciYear', el)?.addEventListener('change', ev => { ui.year = ev.target.value; ui.page = 0; draw(el); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  $('#ciNew', el).addEventListener('click', () => editCheck(null));
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
  $('#ciList', el)?.addEventListener('click', () => { const sel = pend.filter(c => ui.sel.has(c.id)); const a = acctById(ui.acct); const co = store.setting('company'); printHTML('託收清單', `@page{size:A4;margin:14mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:11pt;margin:0}h1{font-size:15pt;text-align:center;margin:0 0 4mm}table{width:100%;border-collapse:collapse}th,td{border:.5pt solid #000;padding:1.5mm 2mm;text-align:left}td.n,th.n{text-align:right}`, `<h1>${esc(co.name || '')} 支票託收清單</h1><p>存入：${esc(a.bank)} ${esc(a.holder)}　日期：${esc(roc($('#ciDate', el).value || t))}</p><table><thead><tr><th>#</th><th>到期日</th><th>發票人</th><th>付款銀行</th><th>票號</th><th class="n">金額</th></tr></thead><tbody>${sel.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(roc(c.due))}</td><td>${esc(c.name)}</td><td>${esc(c.bank || '')}</td><td>${esc(c.no || '')}</td><td class="n">${money(c.amt)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="5">合計 ${sel.length} 張</td><td class="n">${money(sum(sel))}</td></tr></tfoot></table>`, { tip: '按 Ctrl+P 列印。' }); });
  el.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => { const c = store.get('checks_in', b.dataset.undo); const { col, ...rest } = c; delete rest.id; await store.save('checks_in', c.id, rest); toast('已退回待代收'); }));
}
function editCheck(c) {
  const d = c ? { ...c } : { name: '', bank: '', no: '', acct: '', due: '', amt: '', note: '', recv: today() };
  const hist = name => store.list('checks_in').filter(x => x.name === name).sort((a, b) => (b.recv || b.due || '').localeCompare(a.recv || a.due || ''));
  modal({
    title: c ? '修改客票' : '登記客票', width: 600,
    body: `<div class="grid"><div class="f" style="grid-column:1/-1"><label for="ck-name">客戶（發票人）</label><div class="combo"><input id="ck-name" value="${esc(d.name)}" placeholder="搜尋客戶或直接輸入" autofocus></div></div>
      <div class="f"><label for="ck-bank">付款銀行</label><input id="ck-bank" value="${esc(d.bank || '')}" list="ck-banks"><datalist id="ck-banks"></datalist></div><div class="f"><label for="ck-no">票號</label><input id="ck-no" class="mono" value="${esc(d.no || '')}"></div>
      <div class="f"><label for="ck-acct">帳號</label><input id="ck-acct" class="mono" value="${esc(d.acct || '')}"></div><div class="f"><label for="ck-due">到期日</label><input type="date" id="ck-due" value="${esc(d.due || '')}"></div>
      <div class="f"><label for="ck-amt">金額</label><input id="ck-amt" class="num" value="${d.amt !== '' ? money(d.amt) : ''}"></div><div class="f"><label for="ck-recv">收到日</label><input type="date" id="ck-recv" value="${esc(d.recv || '')}"></div>
      <div class="f" style="grid-column:1/-1"><label for="ck-note">備註</label><input id="ck-note" value="${esc(d.note || '')}"></div></div><div id="ck-hist" class="muted small"></div>`,
    footer: `${c ? '<button class="btn danger" id="ck-del">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>${c ? '取消' : '關閉'}</button><button class="btn pri" id="ck-ok">${c ? '儲存' : '登記並繼續'}</button>`,
    onOpen(el, close) {
      let cid = d.cid;
      const fill = name => { const h = hist(name); const banks = [...new Set(h.map(x => x.bank).filter(Boolean))]; $('#ck-banks', el).innerHTML = banks.map(b => `<option>${esc(b)}</option>`).join(''); if (h[0] && !c) { if (!$('#ck-bank', el).value) $('#ck-bank', el).value = h[0].bank || ''; if (!$('#ck-acct', el).value) $('#ck-acct', el).value = h[0].acct || ''; } $('#ck-hist', el).innerHTML = h.length ? `最近：${h.slice(0, 3).map(x => `${roc(x.due)} ${esc(x.bank || '')} ${money(x.amt)}`).join('、')}（共 ${h.length} 張）` : ''; };
      combo($('#ck-name', el), { items: () => { const names = new Map(); customers().forEach(x => names.set(x.short || x.name, { id: x.id, label: x.short || x.name, sub: x.name !== (x.short || x.name) ? x.name : '', text: [x.code, x.name, x.short, ...(x.aliases || [])].join(' ') })); store.list('checks_in').forEach(x => { if (x.name && !names.has(x.name)) names.set(x.name, { id: x.cid || null, label: x.name, sub: '', text: x.name }); }); return [...names.values()]; }, allowFree: true, onPick: it => { cid = it.id; fill(it.label); }, onBlur: v => fill(v) });
      if (d.name) fill(d.name);
      $('#ck-ok', el).onclick = async () => {
        const amt = parseNum($('#ck-amt', el).value); const name = $('#ck-name', el).value.trim();
        if (!name) return toast('請填客戶'); if (!(amt > 0)) return toast('金額要大於 0'); if (!$('#ck-due', el).value) return toast('請填到期日');
        const out = { ...d, cid, name, bank: $('#ck-bank', el).value.trim(), no: toHalf($('#ck-no', el).value).trim().toUpperCase(), acct: $('#ck-acct', el).value.trim(), due: $('#ck-due', el).value, amt, recv: $('#ck-recv', el).value, note: $('#ck-note', el).value.trim() }; delete out.id;
        await store.save('checks_in', d.id || uid('ci'), out); toast(`已登記 ${name} ${money(amt)}`);
        if (c) close(); else { ['ck-no', 'ck-amt', 'ck-note', 'ck-due'].forEach(id => $('#' + id, el).value = ''); $('#ck-name', el).focus(); }
      };
      $('#ck-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這張客票？', { danger: true, ok: '刪除' })) { await store.remove('checks_in', c.id); close(); } });
    },
  });
}
