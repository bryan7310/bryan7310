// 發票作業：銷項發票（由銷貨單開立）、待開清單、進項發票、套印
import { $, esc, fmt, money, today, thisMonth, ym25, range25, month25, roc, slash, parseNum, uid, cnMoney, ubnOk, shiftMonth, ymLabel, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, printHTML, pager, onSearch } from '../core/ui.js';
import { calc, customers, suppliers, cshort, totals, gname } from '../core/calc.js';
import { openBill } from './_bills.js';
import { printName } from '../core/names.js';

const ui = { tab: 'list', ym: thisMonth(), q: '', page: 0, pq: '', pPeriod: '' };
export default {
  id: 'invoices', name: '發票作業', group: '財務', icon: 'invoice',
  render(el, { sub }) { this.el = el; if (sub === 'pending') ui.tab = 'pending'; if (sub === 'purch') ui.tab = 'purch'; draw(el); },
  onChange(ch) { if (this.el?.isConnected && ['invoices', 'bills', 'purch_invoices', 'contacts', 'settings'].some(c => ch.has(c))) draw(this.el); },
  badge() { return { cnt: pendingBills().length }; },
};
export const pendingBills = () => calc().bills.filter(b => b.type === 'SALE' && !b.hist && !b.invNo && !b.noInv && (b.date || '') >= '2026-11-01');
const total = i => (+i.untaxed || 0) + (+i.tax || 0);
export function nextInvNo(hand = false) {
  let best = null;
  for (const i of store.list('invoices')) { if (!!i.hand !== hand) continue; const m = /^([A-Z]{2})(\d{8})$/.exec(i.no); if (!m) continue; if (!best || i.date > best.date || (i.date === best.date && +m[2] > best.n)) best = { p: m[1], n: +m[2], date: i.date }; }
  if (!best) return '';
  // 同一本（同字軌）裡最大的號碼＋1：日期較早的發票可能是後來才補開的，號碼反而比較大
  for (const i of store.list('invoices')) { if (!!i.hand !== hand) continue; const m = /^([A-Z]{2})(\d{8})$/.exec(i.no); if (m && m[1] === best.p && +m[2] > best.n) best.n = +m[2]; }
  return best.p + String(best.n + 1).padStart(8, '0');
}
function draw(el) {
  const TABS = [['list', '銷項發票'], ['pending', `待開 ${pendingBills().length || ''}`], ['purch', '進項發票']];
  el.innerHTML = `<div class="head"><h1>發票作業</h1><span class="sp"></span>${tabs('iv', TABS, ui.tab)}<button class="btn pri" id="ivNew">＋ 開發票</button></div><div id="ivBody"></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  $('#ivNew', el).addEventListener('click', () => editInvoice(null));
  const body = $('#ivBody', el);
  if (ui.tab === 'pending') drawPending(body); else if (ui.tab === 'purch') drawPurch(body); else drawList(body);
}
function drawList(el) {
  const q = qTerms(ui.q);
  const list = store.list('invoices').filter(i => (!ui.ym || (i.date || '').startsWith(ui.ym)) && (!q.length || matchQ([i.no, i.name, i.buyer].join(' '), q))).sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.no).localeCompare(String(a.no)));
  const [s, e, pg] = pager('iv', list.length, ui.page);
  const live = list.filter(i => !i.void); const sumU = live.reduce((a, i) => a + (+i.untaxed || 0), 0), sumT = live.reduce((a, i) => a + (+i.tax || 0), 0);   // 作廢的不算金額
  el.innerHTML = `<div class="panel"><div class="tools"><input type="month" id="ivYm" value="${ui.ym}"><input type="search" id="ivQ" placeholder="搜尋發票號碼、買受人、統編" value="${esc(ui.q)}"><span class="muted small">${list.length} 張・銷售額 ${money(sumU)}・稅 ${money(sumT)}・合計 ${money(sumU + sumT)}</span><span class="sp"></span><button class="btn sm" id="ivPrintAll" ${list.length ? '' : 'disabled'}>列印本月明細</button></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>日期</th><th>發票號碼</th><th>買受人</th><th>統編</th><th class="n">銷售額</th><th class="n">稅額</th><th class="n">總計</th><th>來源</th><th></th></tr></thead><tbody>${list.slice(s, e).map(i => `<tr class="row" data-no="${esc(i.no)}"><td class="nowrap">${esc(slash(i.date))}</td><td class="mono">${esc(i.no)}${i.void ? ' <span class="pill bad">作廢</span>' : ''}</td><td style="min-width:9em"><a href="#" data-who="${esc(i.no)}" title="看這個客戶今年的發票">${esc(i.cid ? cshort(i.cid) : i.name)}</a></td><td class="mono">${esc(i.buyer || '')}</td><td class="n">${money(i.untaxed)}</td><td class="n">${money(i.tax)}</td><td class="n">${money(total(i))}</td><td class="muted small">${(i.hand ? (i.billId ? '手開・銷貨單' : '手開') : i.billId ? '銷貨單' : i.legacy ? '匯入' : '手開') + (i.billIds?.length > 1 ? ` ${i.billIds.length} 張` : '')}</td><td class="nowrap"><button class="btn xs" data-edit="${esc(i.no)}">修改</button> <button class="btn xs" data-print="${esc(i.no)}">套印</button> <button class="btn xs ghost" data-rm="${esc(i.no)}" style="color:var(--bad)">刪除</button></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty"><b>這個月沒有發票</b></div></td></tr>'}</tbody></table></div>${pg}</div>`;
  $('#ivYm', el).addEventListener('change', ev => { ui.ym = ev.target.value; ui.page = 0; drawList(el); });
  onSearch($('#ivQ', el), v => { ui.q = v; ui.page = 0; drawList(el); const i = $('#ivQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; drawList(el); }));
  el.querySelectorAll('[data-who]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); custYear(store.get('invoices', a.dataset.who)); }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editInvoice(store.get('invoices', b.dataset.edit))));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button,a')) return; editInvoice(store.get('invoices', tr.dataset.no)); }));
  el.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => printInvoices([store.get('invoices', b.dataset.print)], 'form')));
  el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeInvoice(b.dataset.rm)));
  $('#ivPrintAll', el).addEventListener('click', () => printInvoices(list, 'list'));
}
const billYm = b => b.arYm || ym25(b.date);   // 這張銷貨單算哪個月（25 日結；有指定應收月份的照指定）
const isRet = b => b.type === 'SALE_RET';
const sNet = b => (isRet(b) ? -1 : 1) * totals(b).net;   // 銷貨退回算負的
const sumNet = bs => bs.reduce((a, b) => a + sNet(b), 0);
const invTax = bs => bs.length === 1 && bs[0].tax && !isRet(bs[0]) ? totals(bs[0]).tax : Math.round(sumNet(bs) * 0.05);
// 還沒處理的銷貨退回：跟同一個客戶同一個結帳月的銷貨單一起算，發票金額直接扣掉
const pendingRets = () => calc().bills.filter(b => isRet(b) && !b.hist && !b.invNo && !b.noInv && (b.date || '') >= '2026-11-01');
/** 待開：同一個結帳月（上月 26 日～本月 25 日）、同一個客戶的銷貨單加總成一列，一次開一張發票 */
export function pendingGroups(ym) {
  const m = new Map();
  for (const b of [...pendingBills(), ...pendingRets()]) { if (ym && billYm(b) !== ym) continue; const k = billYm(b) + '|' + (b.cid || 'b:' + b.id); if (!m.has(k)) m.set(k, { key: k, ym: billYm(b), cid: b.cid || '', bills: [] }); m.get(k).bills.push(b); }
  return [...m.values()].map(g => { g.bills.sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.no).localeCompare(String(b.no))); g.net = sumNet(g.bills); g.ret = -sumNet(g.bills.filter(isRet)); g.tax = invTax(g.bills); return g; });
}
function drawPending(el) {
  const C = calc(); const yms = [...new Set([...pendingBills(), ...pendingRets()].map(billYm))].sort().reverse();
  if (!yms.includes(ui.pym)) ui.pym = yms.includes(month25()) ? month25() : (yms[0] || month25());
  const [d1, d2] = range25(ui.pym);
  const list = pendingGroups(ui.pym).sort((a, b) => b.net - a.net || (a.bills[0].date || '').localeCompare(b.bills[0].date || ''));   // 金額大的排前面
  const sumN = list.reduce((a, g) => a + g.net, 0), sumT = list.reduce((a, g) => a + g.tax, 0), nb = list.reduce((a, g) => a + g.bills.length, 0);
  el.innerHTML = `<div class="panel"><p class="muted" style="margin:0 0 10px">還沒開發票的銷貨單，照 25 日結帳（上月 26 日～本月 25 日）把同一個客戶的加總成一列，當月的銷貨退回會直接扣掉。按「開發票」會把這個客戶這個月的銷貨單開成一張；已經用手寫發票開好的按「手開」；不需要開的按「不開」。只想開其中一張，到「出貨銷貨」那張單右邊按「開發票」。</p>
    <div class="tools" style="margin-bottom:10px">${yms.length > 1 ? `<div class="tabs" id="ivPym">${yms.map(y => `<button type="button" data-v="${y}" class="${y === ui.pym ? 'on' : ''}">${+y.slice(5)} 月</button>`).join('')}</div>` : ''}<span class="muted small">${esc(slash(d1))}～${esc(slash(d2))}・${list.length} 家・${nb} 張銷貨單・未稅 ${money(sumN)}・稅 ${money(sumT)}・合計 ${money(sumN + sumT)}</span></div>
    <div class="tw"><table><thead><tr><th>客戶</th><th>統編</th><th>銷貨單</th><th class="n">張數</th><th class="n">未稅</th><th class="n">稅</th><th class="n">合計</th><th></th></tr></thead><tbody>${list.map(g => { const c = C.ct[g.cid]; return `<tr><td style="min-width:9em">${esc(c?.name || (g.bills[0].retail ? '門市銷售' : '（沒有客戶）'))}</td><td class="mono ${c?.taxId ? '' : 'muted'}">${esc(c?.taxId || '（無）')}</td><td class="small" style="white-space:normal;max-width:30em">${g.bills.map(b => `<a href="#" class="mono" data-open="${b.id}" title="${esc(slash(b.date))}　${isRet(b) ? '銷貨退回 ' : '未稅 '}${money(sNet(b))}"${isRet(b) ? ' style="color:var(--bad)"' : ''}>${esc(b.no)}${isRet(b) ? '（退）' : ''}</a>`).join('、')}<div class="muted">${esc(slash(g.bills[0].date).slice(5))}${g.bills.length > 1 ? '～' + esc(slash(g.bills[g.bills.length - 1].date).slice(5)) : ''}</div></td><td class="n">${g.bills.length}</td><td class="n">${money(g.net)}${g.ret ? `<div class="small" style="color:var(--bad)">已扣退回 ${money(g.ret)}</div>` : ''}</td><td class="n">${money(g.tax)}</td><td class="n"><b>${money(g.net + g.tax)}</b></td><td class="nowrap"><button class="btn xs pri" data-inv="${esc(g.key)}" ${g.net > 0 ? '' : 'disabled title="扣掉退回後沒有金額可以開"'}>開發票</button> <button class="btn xs" data-hand="${esc(g.key)}" ${g.net > 0 ? '' : 'disabled'}>手開</button> <button class="btn xs ghost" data-skip="${esc(g.key)}">不開</button></td></tr>`; }).join('') || '<tr><td colspan="8"><div class="empty"><b>沒有待開發票的銷貨單 ✓</b></div></td></tr>'}</tbody></table></div></div>`;
  const grp = k => list.find(g => g.key === k);
  el.querySelectorAll('#ivPym button').forEach(b => b.addEventListener('click', () => { ui.pym = b.dataset.v; drawPending(el); }));
  el.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openBill(null, a.dataset.open); }));
  el.querySelectorAll('[data-inv]').forEach(b => b.addEventListener('click', () => makeInvoiceFromBill(grp(b.dataset.inv).bills)));
  el.querySelectorAll('[data-hand]').forEach(b => b.addEventListener('click', () => makeInvoiceFromBill(grp(b.dataset.hand).bills, true)));
  el.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', async () => { const g = grp(b.dataset.skip); if (g.bills.length > 1 && !(await confirm(`${C.ct[g.cid]?.name || ''} 這 ${g.bills.length} 張（未稅 ${money(g.net)}）都不開發票？`))) return; await store.batch(g.bills.map(x => ({ col: 'bills', id: x.id, data: { ...store.get('bills', x.id), noInv: true } }))); }));
}
// ---------- 品名寫法（照原本 Excel 開發票的習慣）----------
// s＝只寫一行「螺絲」（數量＝未稅金額、單價 1）；c＝分「螺絲／螺帽／華司」三類；d＝列明細（規格＋螺絲、下一行客戶料號、最後一行採購單號）
export const INV_STYLES = [['s', '只寫「螺絲」'], ['c', '分螺絲／螺帽／華司'], ['d', '列明細（規格、客戶料號、採購單）']];
// 種類看品名（規格前面那段）最後的字：「半圓華司內六角螺絲」是螺絲，不是華司
const invKind = full => { const head = String(full || '').trim().split(/\s{2,}|　/)[0]; const k = (/^(.*?[\u4e00-\u9fff])(?:M\d|\d)/.exec(head) || [0, head])[1]; const all = [...k.matchAll(/螺絲|螺栓|螺釘|螺帽|螺母|華司|墊圈|墊片/g)].map(m => m[0]); const w = all[all.length - 1] || ''; return /華司|墊/.test(w) ? '華司' : /帽|母/.test(w) ? '螺帽' : w ? '螺絲' : ''; };
const invCat = n => invKind(n) || '螺絲';
/** 發票上的簡短品名：「半圓華司內六角螺絲3/16*22  錏黑合金」→「3/16X22螺絲」；華司、螺帽留種類＋規格 */
export function invShortName(full) {
  const head = String(full || '').trim().split(/\s{2,}|　/)[0].trim(); if (!head) return '';
  const m = /^(.*?[\u4e00-\u9fff⊕])((?:M\d|\d)[^\u4e00-\u9fff]*)/.exec(head); if (!m) return head;
  const kind = m[1]; const size = m[2].trim().split(/\s/)[0].replace(/\*/g, 'X').replace(/x/g, 'X').replace(/\(.*$/, ''); const k = invKind(head);
  if (k === '華司') return (/彈簧/.test(kind) ? '彈簧華司' : /平華司/.test(kind) ? '平華司' : '華司') + size;
  if (k === '螺帽') return '螺帽' + size;
  if (k === '螺絲') return size + '螺絲';
  return head;
}
export function invItems(b, style) {   // b 可以是一張銷貨單，或同一個客戶的好幾張（合開一張發票）
  const bs = Array.isArray(b) ? b : [b]; const t = { net: sumNet(bs) };
  b = { lines: bs.flatMap(x => isRet(x) ? (x.lines || []).map(l => l.txt !== undefined ? l : { ...l, qty: -(+l.qty || 0) }) : x.lines || []), cpo: bs.map(x => x.cpo || '').filter(Boolean).join(' ') }; const goods = (b.lines || []).filter(l => l.txt === undefined);
  const amt = l => Math.round((+l.qty || 0) * (+l.price || 0)); const nm = l => l.gid ? gname(l.gid) : l.n || '';
  if (style === 'c') {
    const sum = { 螺絲: 0, 螺帽: 0, 華司: 0 }; for (const l of goods) sum[invCat(nm(l))] += amt(l);
    const keys = Object.keys(sum).filter(k => sum[k]); const diff = t.net - keys.reduce((a, k) => a + sum[k], 0); if (keys.length) sum[keys[0]] += diff;   // 折扣、尾差算在第一類
    return keys.length ? keys.map(k => ({ name: k, qty: sum[k], price: 1, amount: sum[k] })) : [{ name: '螺絲', qty: t.net, price: 1, amount: t.net }];
  }
  if (style === 'd') {
    const out = []; const pos = []; const L = b.lines || [];
    L.forEach((l, i) => {
      if (l.txt !== undefined || !amt(l)) return;   // 沒有金額的（贈品、樣品）不列
      out.push({ name: invShortName(nm(l)) || nm(l), qty: +l.qty || 0, price: +l.price || 0, amount: amt(l) });
      const nx = L[i + 1]; const g = l.gid ? store.get('goods', l.gid) : null;
      const cno = String((nx && nx.txt !== undefined ? nx.txt : '') || g?.spec || '').trim(); if (cno) out.push({ name: cno, qty: '', price: '', amount: '' });
      for (const x of String(l.memo || '').split(/[\s,，、]+/)) if (x && !pos.includes(x)) pos.push(x);
    });
    for (const x of String(b.cpo || '').split(/[\s,，、]+/)) if (x && !pos.includes(x)) pos.push(x);
    for (let i = 0; i < pos.length; i += 3) out.push({ name: (i ? '' : '採購單 : ') + pos.slice(i, i + 3).join(' '), qty: '', price: '', amount: '' });
    return out;
  }
  return [{ name: '螺絲', qty: t.net, price: 1, amount: t.net }];
}
/** 這個客戶習慣的寫法：客戶資料記的 → 上一張發票的樣子 → 只寫螺絲 */
export function invStyleOf(cid) {
  const c = cid ? store.get('contacts', cid) : null; if (c?.invStyle) return c.invStyle;
  if (!cid) return 's';
  const cnt = { s: 0, c: 0, d: 0 };
  for (const i of store.list('invoices').filter(i => i.cid === cid && !i.void && (i.items || []).length).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6)) {
    const names = i.items.map(x => String(x.name || '').trim());
    cnt[names.every(n => n === '螺絲') ? 's' : names.length > 1 && names.every(n => ['螺絲', '螺帽', '華司'].includes(n)) ? 'c' : 'd']++;
  }
  return cnt.d > cnt.s && cnt.d >= cnt.c ? 'd' : cnt.c > cnt.s ? 'c' : 's';
}
/** 這個客戶某一年的發票總明細（同一個客戶＝同客戶資料，或同統編，或同抬頭） */
function custYear(inv, year) {
  if (!inv) return; year = year || (inv.date || today()).slice(0, 4);
  const same = i => inv.cid ? i.cid === inv.cid || (!i.cid && inv.buyer && i.buyer === inv.buyer) : inv.buyer ? i.buyer === inv.buyer : i.name === inv.name;
  const all = store.list('invoices').filter(same); const years = [...new Set(all.map(i => (i.date || '').slice(0, 4)).filter(Boolean))].sort().reverse(); if (!years.includes(year)) years.unshift(year);
  const list = all.filter(i => (i.date || '').startsWith(year)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.no).localeCompare(String(b.no)));
  const live = list.filter(i => !i.void); const su = live.reduce((a, i) => a + (+i.untaxed || 0), 0), st = live.reduce((a, i) => a + (+i.tax || 0), 0);
  const who = inv.cid ? (store.get('contacts', inv.cid)?.name || inv.name) : inv.name;
  const byM = {}; for (const i of live) { const m = +(i.date || '').slice(5, 7); const k = Math.ceil(m / 2); (byM[k] = byM[k] || [0, 0, 0])[0]++; byM[k][1] += +i.untaxed || 0; byM[k][2] += +i.tax || 0; }
  const items = i => (i.items || []).map(x => `${esc(x.name)}${x.qty != null && x.price != null && !(x.price === 1 && x.qty === x.amount) ? ` <span class="muted">${fmt(x.qty)} × ${x.price}</span>` : ''}`).join('、');
  const m = modal({ title: `${who}　${+year - 1911} 年發票明細`, width: 980,
    body: `<div class="tools" style="margin-bottom:8px"><select id="cyY">${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${+y - 1911} 年（${y}）</option>`).join('')}</select><span class="muted small">統編 ${esc(inv.buyer || '（無）')}・${live.length} 張${list.length - live.length ? `（另有作廢 ${list.length - live.length} 張）` : ''}・銷售額 ${money(su)}・稅 ${money(st)}・合計 ${money(su + st)}</span></div>
      <div class="tools" style="margin-bottom:8px;gap:6px">${Object.keys(byM).sort((a, b) => a - b).map(k => `<span class="pill">${k * 2 - 1}～${k * 2} 月　${byM[k][0]} 張　${money(byM[k][1] + byM[k][2])}</span>`).join('')}</div>
      <div class="tw"><table><thead><tr><th>日期</th><th>發票號碼</th><th>品名</th><th class="n">銷售額</th><th class="n">稅額</th><th class="n">總計</th><th></th></tr></thead><tbody>${list.map(i => `<tr><td class="nowrap">${esc(slash(i.date))}</td><td class="mono nowrap">${esc(i.no)}${i.void ? ' <span class="pill bad">作廢</span>' : ''}</td><td class="small" style="white-space:normal">${items(i)}</td><td class="n">${money(i.untaxed)}</td><td class="n">${money(i.tax)}</td><td class="n">${money(total(i))}</td><td class="nowrap"><button class="btn xs" data-cy="${esc(i.no)}">修改</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty"><b>這一年沒有發票</b></div></td></tr>'}</tbody>
      ${list.length ? `<tfoot><tr><td colspan="3"><b>合計 ${live.length} 張</b></td><td class="n"><b>${money(su)}</b></td><td class="n"><b>${money(st)}</b></td><td class="n"><b>${money(su + st)}</b></td><td></td></tr></tfoot>` : ''}</table></div>`,
    footer: '<button class="btn" id="cyPrint">列印</button><span class="sp"></span><button class="btn" data-close>關閉</button>',
    onOpen(el, close) {
      $('#cyY', el).onchange = () => { const y = $('#cyY', el).value; close(); custYear(inv, y); };
      el.querySelectorAll('[data-cy]').forEach(b => b.onclick = () => { close(); editInvoice(store.get('invoices', b.dataset.cy)); });
      $('#cyPrint', el).onclick = () => { const o = ui.ym; printInvoices(live, 'list', `${who}　${+year - 1911} 年`); ui.ym = o; };
    } });
}
/** 刪除發票（打錯、重複登記用；真的開出去又作廢的請用「作廢」）。對應的銷貨單會回到「待開」 */
const invBillIds = inv => inv.billIds?.length ? inv.billIds : inv.billId ? [inv.billId] : [];
async function removeInvoice(no) {
  const inv = store.get('invoices', no); if (!inv) return false;
  const back = invBillIds(inv).map(id => store.get('bills', id)).filter(b => b && b.invNo === no);
  if (!(await confirm(`刪除發票 ${no}${inv.name ? '（' + inv.name + '　' + money(total(inv)) + '）' : ''}？${back.length ? `銷貨單 ${back.map(b => b.no).join('、')} 會回到「待開」。` : ''}實際開出去又作廢的發票請用「作廢」，不要刪除。`, { danger: true, ok: '刪除' }))) return false;
  const ops = [{ col: 'invoices', id: no, delete: true }];
  for (const b of back) { const nb = { ...b }; delete nb.invNo; ops.push({ col: 'bills', id: b.id, data: nb }); }
  await store.batch(ops); store.log('刪除', `發票 ${no} ${inv.name || ''} ${money(total(inv))}`); toast(`發票 ${no} 已刪除`); return true;
}
export function makeInvoiceFromBill(b, hand = false) {   // b：一張銷貨單，或同一個客戶同一個結帳月的好幾張
  const bs = Array.isArray(b) ? b : [b]; const b0 = bs[0]; const C = calc(); const c = C.ct[b0.cid] || {};
  const style = invStyleOf(b0.cid); const items = invItems(bs, style);
  editInvoice({ no: nextInvNo(hand), hand, style, date: bs.length > 1 ? today() : b0.date, buyer: c.taxId || '', name: c.name ? printName(c.name) : '', cid: b0.cid, items, untaxed: sumNet(bs), tax: invTax(bs), billId: b0.id, billIds: bs.map(x => x.id), billNo: bs.length > 1 ? `${b0.no} 等 ${bs.length} 張${bs.some(isRet) ? `（含銷貨退回 ${bs.filter(isRet).length} 張，已扣 ${money(-sumNet(bs.filter(isRet)))}）` : ''}` : b0.no }, true);
}
function editInvoice(inv, isNew) {
  const d = inv || { no: nextInvNo(), date: today(), buyer: '', name: '', items: [{ name: '螺絲', qty: '', price: '', amount: '' }], untaxed: 0, tax: 0 };
  isNew = isNew || !inv;
  const draw2 = () => {
    const rows = (d.items || []).map((it, i) => `<tr><td class="c-g"><input data-f="name" data-i="${i}" value="${esc(it.name)}"></td><td class="c-q"><input data-f="qty" data-i="${i}" class="num" value="${esc(it.qty ?? '')}"></td><td class="c-p"><input data-f="price" data-i="${i}" class="num" value="${esc(it.price ?? '')}"></td><td class="c-s"><input data-f="amount" data-i="${i}" class="num" value="${esc(it.amount ?? '')}"></td><td class="c-del"><button class="icon-btn" data-del="${i}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td></tr>`).join('');
    return `<div class="grid">
      <div class="f"><label for="iv-no">發票號碼</label><input id="iv-no" class="mono" value="${esc(d.no)}" placeholder="例如 GF14518253" ${!isNew ? 'readonly' : ''}></div>
      <div class="f"><label for="iv-date">日期</label><input type="date" id="iv-date" value="${esc(d.date)}"></div>
      <div class="f" style="grid-column:span 2"><label for="iv-name">買受人</label><div class="combo"><input id="iv-name" value="${esc(d.name)}" placeholder="搜尋客戶或直接輸入"></div></div>
      <div class="f"><label for="iv-buyer">統一編號</label><input id="iv-buyer" class="mono" value="${esc(d.buyer || '')}" maxlength="8"></div>
      ${d.billNo ? `<div class="f"><label>來源</label><div>銷貨單 ${esc(d.billNo)}</div></div>` : ''}
      ${d.billId && isNew ? `<div class="f" style="grid-column:span 2"><label for="iv-style">品名寫法（會記住這個客戶）</label><select id="iv-style">${INV_STYLES.map(([k, n]) => `<option value="${k}" ${d.style === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}</div>
      ${d.hand && isNew ? '<p class="muted small" style="margin:0 0 8px">手寫發票已經開好的，照發票上的號碼、日期、金額填，按「儲存」就會記到銷項發票（不用套印）。</p>' : ''}
      <div class="tw"><table class="lines"><thead><tr><th>品名</th><th class="r" style="width:90px">數量</th><th class="r" style="width:100px">單價</th><th class="r" style="width:110px">金額</th><th style="width:30px"></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="tools"><button class="btn sm" id="iv-add">＋ 加一行</button><span class="sp"></span><label class="check"><input type="checkbox" id="iv-incl" ${d.taxMode === 'in' ? 'checked' : ''}> 金額為含稅（反推）</label></div>
      <div class="totals"><div><span>銷售額</span> <input id="iv-untaxed" class="num" value="${money(d.untaxed)}" style="width:110px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;text-align:right"></div><div><span>稅額</span> <input id="iv-tax" class="num" value="${money(d.tax)}" style="width:90px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;text-align:right"></div><div class="big"><span>總計</span> <b id="iv-total">${money(total(d))}</b></div></div>
      ${(d.items || []).length > FORM_LINES ? `<div class="err">品名有 ${d.items.length} 行，三聯式發票只印得下 ${FORM_LINES} 行，請刪減或分兩張開。</div>` : ''}<div class="muted small" id="iv-cn">${cnMoney(total(d))}</div><div class="err" id="iv-err"></div>`;
  };
  const m = modal({
    title: isNew ? (d.hand ? '手開發票（登記）' : '開立發票') : `發票 ${d.no}`, width: 760, body: draw2(),
    footer: `${!isNew ? `<button class="btn danger" id="iv-void">${d.void ? '取消作廢' : '作廢'}</button><button class="btn" id="iv-print">套印</button><button class="btn ghost" id="iv-rm" style="color:var(--bad)">刪除</button>` : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="iv-ok">儲存</button>`,
    onOpen(el, close) {
      const recalc = () => {
        let sum = 0; for (const it of d.items) { if (it.qty !== '' && it.price !== '' && it.amount === '') it.amount = Math.round((+it.qty || 0) * (+it.price || 0)); sum += +it.amount || 0; }
        if (sum) { if ($('#iv-incl', el).checked) { d.untaxed = Math.round(sum / 1.05); d.tax = sum - d.untaxed; } else { d.untaxed = sum; d.tax = Math.round(sum * 0.05); } $('#iv-untaxed', el).value = money(d.untaxed); $('#iv-tax', el).value = money(d.tax); }
        $('#iv-total', el).textContent = money(total(d)); $('#iv-cn', el).textContent = cnMoney(total(d));
      };
      const bind = () => {
        el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => { const it = d.items[+inp.dataset.i]; it[inp.dataset.f] = inp.dataset.f === 'name' ? inp.value : inp.value; if (inp.dataset.f === 'qty' || inp.dataset.f === 'price') { it.amount = ''; } recalc(); }));
        el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { d.items.splice(+b.dataset.del, 1); el.querySelector('.mb').innerHTML = draw2(); bind(); }));
        $('#iv-add', el).onclick = () => { d.items.push({ name: '', qty: '', price: '', amount: '' }); el.querySelector('.mb').innerHTML = draw2(); bind(); };
        if ($('#iv-style', el)) $('#iv-style', el).onchange = () => {   // 換寫法：品項照銷貨單重新帶
          const b = invBillIds(d).map(id => store.get('bills', id)).filter(Boolean); if (!b.length) return;
          d.style = $('#iv-style', el).value; d.items = invItems(b, d.style); d.no = $('#iv-no', el).value; d.date = $('#iv-date', el).value; d.name = $('#iv-name', el).value; d.buyer = $('#iv-buyer', el).value;
          el.querySelector('.mb').innerHTML = draw2(); bind();
        };
        $('#iv-incl', el).onchange = () => { d.taxMode = $('#iv-incl', el).checked ? 'in' : 'ex'; d.items.forEach(it => { if (it.qty !== '' && it.price !== '') it.amount = ''; }); recalc(); };
        $('#iv-untaxed', el).addEventListener('change', () => { d.untaxed = parseNum($('#iv-untaxed', el).value) || 0; d.tax = Math.round(d.untaxed * 0.05); $('#iv-tax', el).value = money(d.tax); $('#iv-total', el).textContent = money(total(d)); });
        $('#iv-tax', el).addEventListener('change', () => { d.tax = parseNum($('#iv-tax', el).value) || 0; $('#iv-total', el).textContent = money(total(d)); });
        combo($('#iv-name', el), { items: () => customers().map(c => ({ id: c.id, label: c.name, sub: c.taxId || '', text: [c.code, c.name, c.short, c.taxId, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { const c = store.get('contacts', it.id); d.cid = c.id; d.name = printName(c.name); if (c.taxId) $('#iv-buyer', el).value = c.taxId; }, onBlur: v => { d.name = v; } });
      };
      bind();
      $('#iv-ok', el).onclick = async () => {
        const no = $('#iv-no', el).value.trim().toUpperCase(); const buyer = $('#iv-buyer', el).value.trim();
        if (!/^[A-Z]{2}\d{8}$/.test(no)) return $('#iv-err', el).textContent = '發票號碼格式：2 個英文字母＋8 碼數字';
        if (isNew && store.get('invoices', no)) return $('#iv-err', el).textContent = '這個發票號碼已經開過';
        if (buyer && !ubnOk(buyer)) { if (!await confirm(`統一編號 ${buyer} 檢查碼不符，仍要儲存？`)) return; }
        const out = { no, date: $('#iv-date', el).value, buyer, name: $('#iv-name', el).value.trim(), cid: d.cid || null, items: d.items.filter(it => it.name).map(it => ({ name: it.name, qty: it.qty === '' ? null : +it.qty, price: it.price === '' ? null : +it.price, amount: +it.amount || 0 })), untaxed: parseNum($('#iv-untaxed', el).value) || 0, tax: parseNum($('#iv-tax', el).value) || 0, taxMode: d.taxMode || 'ex', billId: d.billId || null, billIds: d.billIds?.length > 1 ? d.billIds : null, hand: !!d.hand, void: d.void || false, createdAt: d.createdAt || Date.now() };
        const ops = [{ col: 'invoices', id: no, data: out }];
        for (const id of invBillIds(d)) { const b = store.get('bills', id); if (b && b.invNo !== no) ops.push({ col: 'bills', id: b.id, data: { ...b, invNo: no } }); }
        if (d.cid) {   // 客戶沒有統編的補上；記住這個客戶的品名寫法
          const c = store.get('contacts', d.cid); const st = isNew && d.billId && d.style && d.style !== c?.invStyle ? d.style : null;
          if (c && ((buyer && !c.taxId) || st)) ops.push({ col: 'contacts', id: c.id, data: { ...c, ...(buyer && !c.taxId ? { taxId: buyer } : {}), ...(st ? { invStyle: st } : {}) } });
        }
        await store.batch(ops); store.log(isNew ? '開立' : '修改', `發票 ${no} ${out.name} ${money(total(out))}`); close(); toast(`發票 ${no} 已儲存`);
      };
      $('#iv-void', el)?.addEventListener('click', async () => { if (await confirm(d.void ? '取消作廢？' : `作廢發票 ${d.no}？`, { danger: !d.void })) { await store.save('invoices', d.no, { ...store.get('invoices', d.no), void: !d.void }); close(); } });
      $('#iv-rm', el)?.addEventListener('click', async () => { if (await removeInvoice(d.no)) close(); });
      $('#iv-print', el)?.addEventListener('click', () => printInvoices([d], 'form'));
    },
  });
}
// ---------- 套印：三聯式手開發票（3×5.5 吋）或 A4 明細 ----------
// 位置是 2026/11/24 拿正式發票（Excel 印的 GF14518257）跟套印試印的照片，用紙邊孔距（12.7mm）量出來對的：
// 行距 3.864mm；X 是各欄位置（公司名左緣＝0）：to＝日期、買受人左緣，item＝品名左緣，qty／price／amt＝數量、單價、金額的中心，tot＝銷售額／稅／總計的右緣。
// 這台點陣印表機橫向會印成約 0.855 倍，X 已經除回去了（所以比尺量的大）。
// 11/24 第二次：印在正式發票（GF14518258）上，日期／買受人高了約 2.5mm、總計高了約 3.3mm → 整體下移、行距 3.864 → 3.905
const ROW = 3.905, X = { co: 0, to: 13.0, item: 7.0, qty: 29.65, price: 42.8, amt: 56.7, tot: 47.9 }, FORM_TOP = 21.7, FORM_LEFT = 6.1, FORM_LINES = 11, TOT_DY = 1.2;   // TOT_DY：銷售額／稅／總計再往下（11/24 第三次試印後加）
// 套印字體：點陣印表機印明體，橫的細筆畫會斷掉，所以預設用筆畫一樣粗的黑體
export const INV_FONTS = { hei: ['黑體（筆畫一樣粗，點陣印表機清楚）', '11pt/1 "Microsoft JhengHei","微軟正黑體","Noto Sans TC",sans-serif'], heib: ['黑體加粗（更黑）', 'bold 11pt/1 "Microsoft JhengHei","微軟正黑體","Noto Sans TC",sans-serif'], ming: ['明體（原本的，雷射／噴墨用）', '11pt/1 "PMingLiU","新細明體","MingLiU","Noto Serif TC",serif'] };
export function printInvoices(list, mode, head) {
  const co = store.setting('company'); const ps = store.setting('invoice_print');
  const n0 = v => v == null || v === '' ? '' : Math.round(+v).toLocaleString('en-US'); const n2 = v => v == null || v === '' ? '' : (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  if (mode === 'form') {
    const f = (row, x, text, al, dy = 0) => text === '' || text == null ? '' : `<span class="f ${al || ''}" style="top:${((row - 1) * ROW + dy).toFixed(3)}mm;left:${x.toFixed(2)}mm">${esc(text)}</span>`;
    const sheets = list.map(inv => {
      let h = f(1, X.co, co.name || '') + f(2, X.co, co.addr || '') + f(3, X.co, `${co.phone ? '電話:' + co.phone + ' ' : ''}統編:${co.taxId || ''}`) + f(4, X.to, slash(inv.date)) + f(5, X.to, inv.name) + f(6, X.to, inv.buyer ? '買受人統編:' + inv.buyer : '') + f(8, X.item, '品名') + f(8, X.qty, '數量', 'c') + f(8, X.price, '單價', 'c') + f(8, X.amt, '金額', 'c');
      (inv.items || []).slice(0, FORM_LINES).forEach((it, k) => { const r = 9 + k; h += f(r, X.item, it.name) + f(r, X.qty, n0(it.qty), 'c') + f(r, X.price, n2(it.price), 'c') + f(r, X.amt, it.qty != null && it.price != null ? n0(it.amount) : '', 'c'); });
      const td = TOT_DY + (+ps.tdy || 0); h += f(24, X.tot, n0(inv.untaxed), 'r', td) + f(25, X.tot, n0(inv.tax), 'r', td) + f(26, X.tot, n0(total(inv)), 'r', td);
      return `<div class="sheet"><div class="frm" style="top:${FORM_TOP + (+ps.dy || 0)}mm;left:${FORM_LEFT + (+ps.dx || 0)}mm">${h}</div></div>`;
    }).join('');
    printHTML('發票套印', `@page{size:3in 5.5in;margin:0}body{margin:0}.sheet{position:relative;width:76.2mm;height:139.4mm;page-break-after:always;overflow:hidden}.frm{position:absolute;width:64.2mm;color:#000;font:${INV_FONTS[ps.font]?.[1] || INV_FONTS.hei[1]}}.frm .f{position:absolute;white-space:nowrap;height:${ROW}mm;line-height:${ROW}mm}.frm .f.c{transform:translateX(-50%)}.frm .f.r{transform:translateX(-100%)}`, sheets, { tip: `把三聯式發票放進印表機，紙張選 3×5.5 吋、邊界「無」、縮放 100%。位置偏了可到「設定備份 → 發票套印」調整（目前位移 ${ps.dx || 0}, ${ps.dy || 0} mm）。` });
  } else {
    const rows = list.map(i => `<tr><td>${esc(slash(i.date))}</td><td>${esc(i.no)}</td><td>${esc(i.name)}</td><td>${esc(i.buyer || '')}</td><td class="n">${n0(i.untaxed)}</td><td class="n">${n0(i.tax)}</td><td class="n">${n0(total(i))}</td></tr>`).join('');
    const su = list.reduce((a, i) => a + (+i.untaxed || 0), 0), st = list.reduce((a, i) => a + (+i.tax || 0), 0);
    printHTML('發票明細', `@page{size:A4;margin:12mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:10pt;margin:0}h1{font-size:15pt;text-align:center}table{width:100%;border-collapse:collapse}th,td{border-bottom:.4pt solid #999;padding:1.2mm 1.5mm;text-align:left}th{border-top:1pt solid #000;border-bottom:1pt solid #000}td.n,th.n{text-align:right}tfoot td{font-weight:bold;border-top:1pt solid #000}`, `<h1>${esc(co.name || '')} 銷項發票明細 ${esc(head || ymLabel(ui.ym))}</h1><table><thead><tr><th>日期</th><th>發票號碼</th><th>買受人</th><th>統編</th><th class="n">銷售額</th><th class="n">稅額</th><th class="n">總計</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4">合計 ${list.length} 張</td><td class="n">${n0(su)}</td><td class="n">${n0(st)}</td><td class="n">${n0(su + st)}</td></tr></tfoot></table>`, { tip: '按 Ctrl+P 列印，A4。' });
  }
}
// ---------- 進項發票 ----------
function drawPurch(el) {
  const q = qTerms(ui.pq);
  const list = store.list('purch_invoices').filter(p => (!ui.pPeriod || p.period === ui.pPeriod) && (!q.length || matchQ([p.no, p.name, p.note].join(' '), q))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const periods = [...new Set(store.list('purch_invoices').map(p => p.period).filter(Boolean))].sort().reverse();
  const su = list.reduce((a, p) => a + (+p.untaxed || 0), 0), st = list.reduce((a, p) => a + (+p.tax || 0), 0);
  el.innerHTML = `<div class="panel"><div class="tools"><select id="pvP"><option value="">全部期別</option>${periods.map(p => `<option ${p === ui.pPeriod ? 'selected' : ''}>${p}</option>`).join('')}</select><input type="search" id="pvQ" placeholder="搜尋廠商、發票號碼" value="${esc(ui.pq)}"><span class="muted small">${list.length} 張・未稅 ${money(su)}・稅 ${money(st)}</span><span class="sp"></span><button class="btn sm pri" id="pvAdd">＋ 新增進項發票</button></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>期別</th><th>日期</th><th>廠商</th><th>發票號碼</th><th>類別</th><th class="n">未稅</th><th class="n">稅額</th><th class="n">總計</th><th></th></tr></thead><tbody>${list.map(p => `<tr class="row" data-id="${p.id}"><td>${esc(p.period || '')}</td><td class="nowrap">${esc(slash(p.date))}</td><td style="min-width:9em">${esc(p.name)}</td><td class="mono">${esc(p.no)}</td><td>${esc(p.kind || '')}</td><td class="n">${money(p.untaxed)}</td><td class="n">${money(p.tax)}</td><td class="n">${money(p.total ?? (+p.untaxed + +p.tax))}</td><td></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty"><b>沒有進項發票</b></div></td></tr>'}</tbody></table></div></div>`;
  $('#pvP', el).addEventListener('change', ev => { ui.pPeriod = ev.target.value; drawPurch(el); });
  onSearch($('#pvQ', el), v => { ui.pq = v; drawPurch(el); const i = $('#pvQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#pvAdd', el).addEventListener('click', () => editPurch(null));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => editPurch(store.get('purch_invoices', tr.dataset.id))));
}
export function editPurch(p) {   // p 沒有 id＝預填新增（AI 助理辨識發票後用）
  const d = p || { period: thisMonth(), date: today(), name: '', no: '', untaxed: '', tax: '', kind: '進項', note: '' };
  modal({
    title: p?.id ? `進項發票 ${p.no}` : '新增進項發票', width: 560,
    body: `<div class="grid"><div class="f"><label for="pu-period">期別（申報月）</label><input type="month" id="pu-period" value="${esc(d.period)}"></div><div class="f"><label for="pu-date">發票日期</label><input type="date" id="pu-date" value="${esc(d.date)}"></div>
      <div class="f" style="grid-column:span 2"><label for="pu-name">廠商</label><div class="combo"><input id="pu-name" value="${esc(d.name)}"></div></div><div class="f"><label for="pu-no">發票號碼</label><input id="pu-no" class="mono" value="${esc(d.no)}"></div><div class="f"><label for="pu-kind">類別</label><select id="pu-kind">${['進項', '固定資產', '不可扣抵', '其他'].map(k => `<option ${k === d.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
      <div class="f"><label for="pu-untaxed">未稅</label><input id="pu-untaxed" class="num" value="${d.untaxed !== '' ? money(d.untaxed) : ''}"></div><div class="f"><label for="pu-tax">稅額</label><input id="pu-tax" class="num" value="${d.tax !== '' ? money(d.tax) : ''}"></div><div class="f" style="grid-column:1/-1"><label for="pu-note">備註</label><input id="pu-note" value="${esc(d.note || '')}"></div></div>`,
    footer: `${p?.id ? '<button class="btn danger" id="pu-del">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="pu-ok">儲存</button>`,
    onOpen(el, close) {
      let cid = d.cid;
      combo($('#pu-name', el), { items: () => suppliers().map(c => ({ id: c.id, label: c.name, sub: c.short || '', text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { cid = it.id; } });
      $('#pu-untaxed', el).addEventListener('change', () => { const u = parseNum($('#pu-untaxed', el).value); if (u && !$('#pu-tax', el).value) $('#pu-tax', el).value = money(Math.round(u * 0.05)); });
      $('#pu-ok', el).onclick = async () => {
        const untaxed = parseNum($('#pu-untaxed', el).value) || 0, tax = parseNum($('#pu-tax', el).value) || 0;
        if (!$('#pu-name', el).value.trim()) return toast('請填廠商');
        await store.save('purch_invoices', d.id || uid('pi'), { ...d, id: undefined, cid, period: $('#pu-period', el).value, date: $('#pu-date', el).value, name: $('#pu-name', el).value.trim(), no: $('#pu-no', el).value.trim().toUpperCase(), kind: $('#pu-kind', el).value, untaxed, tax, total: untaxed + tax, note: $('#pu-note', el).value.trim() }); close(); toast('已儲存');
      };
      $('#pu-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這張進項發票？', { danger: true, ok: '刪除' })) { await store.remove('purch_invoices', p.id); close(); } });
    },
  });
}
