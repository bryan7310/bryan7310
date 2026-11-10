// 報表：應收帳款明細、客戶出貨明細、銷售利潤、商品銷售彙總、客戶對帳單、進貨統計、庫存金額
import { $, esc, fmt, fmtQ, fp4, money, today, thisMonth, slash, roc, downloadText, sum, ls, matchQ, isoOf } from '../core/util.js';
import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { tabs, combo, printHTML, toast, onSearch } from '../core/ui.js';
import { calc, TYPES, totals, lineAmt, cname, cshort, gname, customers, suppliers } from '../core/calc.js';
import { openBill } from './_bills.js';
import { printName } from '../core/names.js';
import { mailImport } from './mail.js';

const ui = { tab: 'ar', from: thisMonth() + '-01', to: today(), cid: '', q: '', gq: '', mail: new Set() };
// 應收帳款明細：勾選要統計的客戶（null＝全部），記在這台瀏覽器
let arSel = (() => { const v = ls.get('rp-ar-sel'); return Array.isArray(v) ? new Set(v) : null; })();
const arSave = () => ls.set('rp-ar-sel', arSel ? [...arSel] : null);
const arHas = id => !arSel || arSel.has(id);
export default {
  id: 'reports', name: '報表明細', group: '管理', icon: 'reports',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('goods') || ch.has('contacts'))) draw(this.el); },
};
const TABS = [['ar', '應收帳款明細'], ['ship', '客戶出貨明細'], ['sales', '銷售利潤'], ['goods', '商品銷售彙總'], ['customer', '客戶對帳單'], ['purchase', '進貨統計'], ['stock', '庫存金額']];
const NEED_CUST = { ship: 1, customer: 1 };
const NEED_GOODS = { ship: 1, goods: 1, stock: 1 };  // 這些報表可以用商品篩選
const dstr = d => isoOf(d);
function draw(el) {
  const hasRange = ui.tab !== 'stock';
  el.innerHTML = `<div class="head"><h1>報表</h1><span class="sp"></span>${tabs('rp', TABS, ui.tab)}</div>
    <div class="panel" style="display:grid;gap:12px"><div class="tools" style="align-items:center">${hasRange ? `<div class="f"><label for="rpFrom">從</label><input type="date" id="rpFrom" value="${ui.from}"></div><div class="f"><label for="rpTo">到</label><input type="date" id="rpTo" value="${ui.to}"></div><button class="btn sm" data-q="c25" title="上上月 26 日到上月 25 日">上月25結帳</button><button class="btn sm" data-q="cme" title="上月 1 日到上月底">上月底結</button>` : ''}${NEED_CUST[ui.tab] ? `<div class="f" style="flex:1 1 220px"><label for="rpC">客戶</label><div class="combo"><input id="rpC" value="${esc(ui.cid ? cshort(ui.cid) : '')}" placeholder="打客戶代號、名稱或簡稱"></div></div>` : ''}${NEED_GOODS[ui.tab] ? `<div class="f" style="flex:1 1 220px"><label for="rpG">商品篩選</label><input type="search" id="rpG" value="${esc(ui.gq)}" placeholder="料號、品名、客料號、廠商料號"></div>` : ''}<span class="sp"></span>${ui.tab === 'ar' ? `<span class="muted small">勾選 <b id="rpMailN">${ui.mail.size}</b> 家：</span><button class="btn sm" id="rpMail" ${ui.mail.size ? '' : 'disabled'}>導入郵寄掛號</button>` : ''}<button class="btn sm" id="rpCsv">匯出 Excel (CSV)</button><button class="btn sm" id="rpPrint">列印</button></div><div id="rpBody"></div></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  $('#rpFrom', el)?.addEventListener('change', ev => { ui.from = ev.target.value; body(el); });
  $('#rpTo', el)?.addEventListener('change', ev => { ui.to = ev.target.value; body(el); });
  el.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth();
    if (b.dataset.q === 'c25') { ui.from = dstr(new Date(y, m - 2, 26)); ui.to = dstr(new Date(y, m - 1, 25)); }
    else { ui.from = dstr(new Date(y, m - 1, 1)); ui.to = dstr(new Date(y, m, 0)); }
    draw(el);
  }));
  onSearch($('#rpG', el), v => { ui.gq = v; body(el); });
  if ($('#rpC', el)) combo($('#rpC', el), { items: () => customers(true).map(c => ({ id: c.id, label: c.short || c.name, sub: c.short ? c.name : '', text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { ui.cid = it.id; body(el); }, onClear: () => { ui.cid = ''; body(el); } });
  body(el);
}
let last = { title: '', head: [], rows: [], foot: [] };
let histCache = { key: '', rows: [] };
/** 期間內舊系統搬來的歷史出貨單（不在瀏覽器資料裡，向伺服器查） */
async function histSales(from, to) {
  const key = from + '~' + to;
  if (histCache.key === key) return histCache.rows;
  const out = [];
  for (const type of ['SALE', 'SALE_RET']) {
    let offset = 0;
    for (;;) {
      const r = await api.hist({ type, from, to, limit: 1000, offset });
      out.push(...r.rows.map(b => ({ ...b, hist: true })));
      offset += r.rows.length;
      if (!r.rows.length || offset >= r.total) break;
    }
  }
  histCache = { key, rows: out };
  return out;
}
const histTot = b => totals(b);
async function body(el) {
  const C = calc(); const inR = b => (b.date || '') >= ui.from && (b.date || '') <= ui.to;
  const gmatch = gid => { if (!ui.gq.trim()) return true; const g = C.g[gid]; return !!g && matchQ([g.code, g.name, g.spec, g.vcode].join(' '), ui.gq); };
  const box = $('#rpBody', el);
  const bindRows = () => box.querySelectorAll('tr[data-bid]').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('input,button')) return; if (tr.dataset.hist) return toast('舊系統的歷史單據，請到「基本資料 → 客戶」查看'); openBill(null, tr.dataset.bid); }));
  if (ui.tab === 'ar' || ui.tab === 'ship') {
    box.innerHTML = '<div class="muted">載入中…</div>';
    let hist;
    try { hist = await histSales(ui.from, ui.to); } catch (e) { hist = []; toast('歷史單據載入失敗：' + (e.message || e)); }
    if (!box.isConnected) return;
    const sales = [...C.bills.filter(b => (b.type === 'SALE' || b.type === 'SALE_RET') && inR(b)), ...hist];
    const totOf = b => b.hist ? histTot(b) : (C.tot[b.id] || totals(b));
    if (ui.tab === 'ar') {
      // 期間內各客戶出貨金額加總
      const cs = customers(true); const m = new Map();
      for (const b of sales) {
        if (!b.cid || !arHas(b.cid)) continue;
        const s = b.type === 'SALE' ? 1 : -1; const t = totOf(b);
        let r = m.get(b.cid); if (!r) m.set(b.cid, r = { c: C.ct[b.cid], n: 0, net: 0, tax: 0, total: 0 });
        r.n++; r.net += s * (t.net || 0); r.tax += s * (t.tax || 0); r.total += s * (t.total || 0);
      }
      const rows = [...m.values()].filter(r => r.c && Math.round(r.total) !== 0).sort((a, b) => b.total - a.total);
      const tot = rows.reduce((a, r) => ({ n: a.n + r.n, net: a.net + r.net, tax: a.tax + r.tax, total: a.total + r.total }), { n: 0, net: 0, tax: 0, total: 0 });
      for (const id of [...ui.mail]) if (!rows.some(r => r.c.id === id)) ui.mail.delete(id);
      const nSel = arSel ? cs.filter(c => arSel.has(c.id)).length : cs.length;
      last = { title: `應收帳款明細 ${ui.from}～${ui.to}`, head: ['代號', '客戶', '出貨單數', '未稅金額', '稅額', '合計'], rows: rows.map(r => [r.c.code || '', printName(r.c.name), String(r.n), fmt(r.net), fmt(r.tax), fmt(r.total)]), foot: ['合計', `${rows.length} 家`, String(tot.n), fmt(tot.net), fmt(tot.tax), fmt(tot.total)] };
      box.innerHTML = `<div class="grid2" style="grid-template-columns:minmax(240px,320px) 1fr;align-items:start;gap:12px">
        <div class="panel" style="padding:10px 12px"><div class="ptitle" style="padding:0 0 6px">客戶<small>已選 ${nSel} / ${cs.length}</small></div>
          <input id="arQ" type="search" placeholder="篩選客戶（代號、名稱、簡稱）" style="width:100%;margin-bottom:6px" value="${esc(ui.q)}">
          <div class="tools" style="margin:0 0 6px"><button class="btn sm" data-ar="all">全選</button><button class="btn sm" data-ar="none">全不選</button><button class="btn sm" data-ar="vis">勾選篩選結果</button></div>
          <div id="arList" style="max-height:60vh;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:4px 6px">${cs.map(c => `<label class="check ar-it" data-k="${esc([c.code, c.name, c.short, ...(c.aliases || [])].join(' '))}" style="display:${!ui.q || matchQ([c.code, c.name, c.short, ...(c.aliases || [])].join(' '), ui.q) ? 'flex' : 'none'};padding:3px 0"><input type="checkbox" data-arc="${c.id}" ${arHas(c.id) ? 'checked' : ''}> <span class="mono" style="min-width:52px">${esc(c.code || '')}</span> ${esc(c.short || c.name)}</label>`).join('')}</div></div>
        <div><div class="kpis"><div class="kpi"><span>客戶數</span><b>${rows.length}</b></div><div class="kpi"><span>出貨單數</span><b>${tot.n}</b></div><div class="kpi"><span>未稅金額</span><b>${fmt(tot.net)}</b></div><div class="kpi"><span>應收合計（含稅）</span><b>${fmt(tot.total)}</b></div></div>
          <div class="muted small" style="margin:6px 0">${ui.from} 至 ${ui.to}・金額由高到低・金額 0 不列出・點一列看該客戶出貨明細${hist.length ? `・含舊系統歷史出貨單 ${hist.length} 張` : ''}</div>
          ${rows.length ? `<div class="tw"><table><thead><tr><th style="width:34px"><input type="checkbox" id="arAll" aria-label="全選" ${rows.every(r => ui.mail.has(r.c.id)) ? 'checked' : ''}></th><th>代號</th><th>客戶</th><th class="n">出貨單數</th><th class="n">未稅金額</th><th class="n">稅額</th><th class="n">合計</th></tr></thead><tbody>
          ${rows.map(r => `<tr class="row" data-cid="${r.c.id}"><td><input type="checkbox" data-arm="${r.c.id}" ${ui.mail.has(r.c.id) ? 'checked' : ''} aria-label="勾選"></td><td class="mono">${esc(r.c.code || '')}</td><td>${esc(r.c.name)}</td><td class="n">${r.n}</td><td class="n">${fmt(r.net)}</td><td class="n">${fmt(r.tax)}</td><td class="n"><b>${fmt(r.total)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td></td><td colspan="2">合計（${rows.length} 家）</td><td class="n">${tot.n}</td><td class="n">${fmt(tot.net)}</td><td class="n">${fmt(tot.tax)}</td><td class="n">${fmt(tot.total)}</td></tr></tfoot></table></div>` : '<div class="empty"><b>期間內沒有出貨</b>調整日期或勾選的客戶。</div>'}</div></div>`;
      $('#arQ', box).addEventListener('input', ev => { ui.q = ev.target.value; const q = ui.q.trim(); box.querySelectorAll('#arList .ar-it').forEach(x => { x.style.display = !q || matchQ(x.dataset.k, q) ? 'flex' : 'none'; }); });
      box.querySelectorAll('[data-arc]').forEach(cb => cb.addEventListener('change', () => {
        if (!arSel) arSel = new Set(customers(true).map(c => c.id));
        cb.checked ? arSel.add(cb.dataset.arc) : arSel.delete(cb.dataset.arc);
        if (arSel.size === customers(true).length) arSel = null;
        arSave(); const sc = $('#arList', box).scrollTop; body(el).then(() => { const l = $('#arList', box); if (l) l.scrollTop = sc; });
      }));
      box.querySelectorAll('[data-ar]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.ar;
        if (a === 'all') arSel = null;
        else if (a === 'none') arSel = new Set();
        else { arSel = new Set([...box.querySelectorAll('#arList .ar-it')].filter(x => x.style.display !== 'none').map(x => x.querySelector('input').dataset.arc)); if (arSel.size === customers(true).length) arSel = null; }
        arSave(); body(el);
      }));
      const syncMail = () => { $('#rpMailN', el).textContent = ui.mail.size; $('#rpMail', el).disabled = !ui.mail.size; const all = $('#arAll', box); if (all) all.checked = rows.length && rows.every(r => ui.mail.has(r.c.id)); };
      box.querySelectorAll('[data-arm]').forEach(cb => cb.addEventListener('change', () => { cb.checked ? ui.mail.add(cb.dataset.arm) : ui.mail.delete(cb.dataset.arm); syncMail(); }));
      $('#arAll', box)?.addEventListener('change', ev => { rows.forEach(r => ev.target.checked ? ui.mail.add(r.c.id) : ui.mail.delete(r.c.id)); box.querySelectorAll('[data-arm]').forEach(cb => cb.checked = ev.target.checked); syncMail(); });
      box.querySelectorAll('tr[data-cid]').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('input')) return; ui.cid = tr.dataset.cid; ui.tab = 'ship'; draw(el); }));
      $('#rpMail', el).onclick = async () => { const ids = rows.map(r => r.c.id).filter(id => ui.mail.has(id)); const r = await mailImport(ids); ui.mail.clear(); toast(`已導入 ${r.add} 家到郵寄掛號${r.miss.length ? `；找不到地址：${r.miss.join('、')}` : ''}`); location.hash = '#mail'; };
    } else {
      // 單一客戶出貨明細
      if (!ui.cid) { box.innerHTML = '<div class="empty"><b>選擇客戶</b>打客戶代號、名稱或簡稱，從清單選一個，再選查詢期間。</div>'; last = { title: '', head: [], rows: [], foot: [] }; return; }
      const c = C.ct[ui.cid]; const out = [];
      const bills = sales.filter(b => b.cid === ui.cid).sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.no).localeCompare(String(b.no)));
      for (const b of bills) {
        const s = b.type === 'SALE' ? 1 : -1; const lines = (b.lines || []).filter(l => l.txt === undefined && (l.gid || l.n)).filter(l => !ui.gq.trim() || (l.gid ? gmatch(l.gid) : matchQ(String(l.n || ''), ui.gq)));
        lines.forEach((l, i) => { const g = C.g[l.gid]; out.push({ b, s, first: i === 0, pn: g?.spec || '', name: g ? g.name : String(l.n || ''), qty: s * (+l.qty || 0), unit: l.u || (l.unit === 'a' ? g?.aunit : g?.unit) || '', price: +l.price || 0, amt: s * lineAmt(l), memo: l.memo || (lines.every(x => !x.memo) && i === 0 ? b.note || '' : '') }); });
      }
      let sub = 0, tax = 0, total = 0;
      for (const r of out) sub += r.amt;
      for (const b of bills) { const s = b.type === 'SALE' ? 1 : -1; const t = totOf(b); tax += s * (t.tax || 0); total += s * (t.total || 0); }
      last = { title: `${printName(c.name)} 出貨明細 ${ui.from}～${ui.to}`, head: ['日期', '客料號', '品名', '數量', '單位', '單價', '金額', '採購單號'], rows: out.map(r => [r.first ? slash(r.b.date) + (r.s < 0 ? '（退）' : '') : '', r.pn, r.name, fmtQ(r.qty), r.unit, fp4(r.price), fmt(r.amt), r.memo]), foot: ['合計', `${bills.length} 張`, `${out.length} 筆`, '', '', tax ? `稅 ${fmt(tax)}` : '', fmt(total), ''], meta: { c, sub, tax, total, n: bills.length } };
      box.innerHTML = `<div class="kpis"><div class="kpi"><span>單據數（含退回）</span><b>${bills.length}</b></div><div class="kpi"><span>明細筆數</span><b>${out.length}</b></div><div class="kpi"><span>金額（未稅）</span><b>${fmt(sub)}</b></div><div class="kpi"><span>含稅合計</span><b>${fmt(total)}</b></div></div>
        <div class="muted small" style="margin:6px 0">${esc(c.code || '')} ${esc(printName(c.name))}　${ui.from} 至 ${ui.to}${bills.some(b => b.hist) ? '・含舊系統歷史出貨單' : ''}</div>
        ${out.length ? `<div class="tw"><table><thead><tr><th>日期</th><th>客料號</th><th>品名</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th class="n">金額</th><th>採購單號</th></tr></thead><tbody>
        ${out.map(r => `<tr class="row" data-bid="${r.b.id}" ${r.b.hist ? 'data-hist="1"' : ''} ${r.first ? 'style="border-top:2px solid var(--line)"' : ''}><td class="nowrap">${r.first ? slash(r.b.date) + (r.s < 0 ? ' <span class="pill bad">退回</span>' : '') : ''}</td><td>${esc(r.pn)}</td><td>${esc(r.name)}</td><td class="n">${fmtQ(r.qty)}</td><td class="muted">${esc(r.unit)}</td><td class="n">${fp4(r.price)}</td><td class="n">${fmt(r.amt)}</td><td class="muted">${esc(r.memo)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6">小計（未稅）</td><td class="n">${fmt(sub)}</td><td></td></tr>${tax ? `<tr><td colspan="6">稅額</td><td class="n">${fmt(tax)}</td><td></td></tr>` : ''}<tr><td colspan="6">合計</td><td class="n">${fmt(total)}</td><td></td></tr></tfoot></table></div>` : '<div class="empty"><b>期間內沒有出貨</b>調整查詢期間再看看。</div>'}`;
      bindRows();
    }
  } else if (ui.tab === 'sales') {
    const bills = C.bills.filter(b => (b.type === 'SALE' || b.type === 'SALE_RET') && inR(b)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let tn = 0, tc = 0, miss = 0;
    const rows = bills.map(b => { const s = b.type === 'SALE' ? 1 : -1; const net = s * (C.tot[b.id]?.net || 0), cg = s * (C.cogs[b.id] || 0); tn += net; tc += cg; miss += C.costMiss[b.id] || 0; return [slash(b.date), b.no + (s < 0 ? '（退回）' : ''), cshort(b.cid), fmt(net), fmt(cg), fmt(net - cg), net ? Math.round((net - cg) / net * 100) + '%' : '']; });
    last = { title: `銷售利潤 ${ui.from}～${ui.to}`, head: ['日期', '單號', '客戶', '未稅金額', '成本', '毛利', '毛利率'], rows, foot: ['合計', `${bills.length} 張`, '', fmt(tn), fmt(tc), fmt(tn - tc), tn ? Math.round((tn - tc) / tn * 100) + '%' : ''] };
    box.innerHTML = `<div class="kpis"><div class="kpi"><span>銷貨（未稅）</span><b>${fmt(tn)}</b></div><div class="kpi"><span>成本</span><b>${fmt(tc)}</b></div><div class="kpi ok"><span>毛利</span><b>${fmt(tn - tc)}</b><small>${tn ? Math.round((tn - tc) / tn * 100) + '%' : ''}</small></div></div>${miss ? `<div class="banner">期間內有 ${miss} 行商品找不到成本（進貨單、採購單、查價牌價都沒有），成本以 0 計，毛利會偏高。可到「基本資料 → 商品」填手動成本。</div>` : ''}<div class="muted small">只含新平台的出貨單；舊系統搬來的歷史單據沒有成本資料，不在此計算。</div>${table(last, bills.map(b => b.id))}`;
    bindRows();
  } else if (ui.tab === 'customer') {
    if (!ui.cid) { box.innerHTML = '<div class="empty"><b>請先選客戶</b></div>'; return; }
    const c = C.ct[ui.cid]; const bills = C.bills.filter(b => b.cid === ui.cid && !TYPES[b.type].doc && !b.hist && inR(b)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
    const before = C.bills.filter(b => b.cid === ui.cid && !TYPES[b.type].doc && !b.hist && (b.date || '') < ui.from).reduce((s, b) => s + (C.eff[b.id] || 0), +c.init || 0);
    let bal = before; const rows = bills.map(b => { const e = C.eff[b.id] || 0; bal += e; const T = TYPES[b.type]; return [slash(b.date), T.name, b.no, T.lines ? (b.lines || []).filter(l => l.gid).map(l => `${gname(l.gid)} ×${fmtQ(l.qty)}`).join('、').slice(0, 80) : (b.note || ''), e > 0 ? fmt(T.lines ? C.tot[b.id].total : 0) : '', e < 0 || (T.lines && +b.paid) ? fmt(T.lines ? +b.paid : b.amount) : '', fmt(bal)]; });
    last = { title: `${printName(c.name)} 對帳單 ${ui.from}～${ui.to}`, head: ['日期', '單據', '單號', '內容', '應收', '收款', '餘額'], rows: [['', '期初餘額', '', '', '', '', fmt(before)], ...rows], foot: ['期末餘額', '', '', '', '', '', fmt(bal)] };
    box.innerHTML = `<div class="kpis"><div class="kpi"><span>期初</span><b>${fmt(before)}</b></div><div class="kpi"><span>期間應收</span><b>${fmt(bills.reduce((s, b) => s + Math.max(0, C.eff[b.id] || 0), 0))}</b></div><div class="kpi"><span>期末餘額</span><b>${fmt(bal)}</b></div></div>${table(last, ['', ...bills.map(b => b.id)])}`;
    bindRows();
  } else if (ui.tab === 'goods') {
    const m = new Map();
    for (const b of C.bills) { if (b.type !== 'SALE' && b.type !== 'SALE_RET') continue; if (!inR(b)) continue; const s = b.type === 'SALE' ? 1 : -1; (b.lines || []).forEach((l, i) => { if (!l.gid) return; const x = m.get(l.gid) || m.set(l.gid, { q: 0, a: 0, c: 0, n: 0 }).get(l.gid); x.q += s * (+l.qty || 0); x.a += s * Math.round((+l.qty || 0) * (+l.price || 0)); x.c += s * ((C.lineCogs[b.id] || [])[i] || 0); x.n++; }); }
    for (const k of [...m.keys()]) if (!gmatch(k)) m.delete(k);
    const rows = [...m.entries()].sort((a, b) => b[1].a - a[1].a).map(([gid, x]) => [C.g[gid]?.code || '', gname(gid), fmtQ(x.q), fmt(x.a), fmt(x.c), fmt(x.a - x.c), x.a ? Math.round((x.a - x.c) / x.a * 100) + '%' : '', String(x.n)]);
    last = { title: `商品銷售彙總 ${ui.from}～${ui.to}`, head: ['料號', '商品', '銷售數量', '銷售金額', '成本', '毛利', '毛利率', '筆數'], rows, foot: ['合計', '', '', fmt(sum([...m.values()], x => x.a)), fmt(sum([...m.values()], x => x.c)), fmt(sum([...m.values()], x => x.a - x.c)), '', ''] };
    box.innerHTML = table(last);
  } else if (ui.tab === 'purchase') {
    const m = new Map();
    for (const b of C.bills) { if (b.type !== 'PUR' && b.type !== 'PUR_RET') continue; if (!inR(b)) continue; const s = b.type === 'PUR' ? 1 : -1; const x = m.get(b.cid) || m.set(b.cid, { a: 0, n: 0 }).get(b.cid); x.a += s * (C.tot[b.id]?.net || 0); x.n++; }
    const rows = [...m.entries()].sort((a, b) => b[1].a - a[1].a).map(([cid, x]) => [printName(cname(cid)), String(x.n), fmt(x.a)]);
    last = { title: `進貨統計 ${ui.from}～${ui.to}`, head: ['廠商', '單數', '進貨金額（未稅）'], rows, foot: ['合計', String(sum([...m.values()], x => x.n)), fmt(sum([...m.values()], x => x.a))] };
    box.innerHTML = table(last);
  } else if (ui.tab === 'stock') {
    const rows = []; let tv = 0;
    for (const g of store.list('goods')) { if (!gmatch(g.id)) continue; const q = Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0); if (!q) continue; const c = C.cost[g.id]?.avg || +g.purPrice || 0; tv += q * c; rows.push([g.code, g.name + ' ' + (g.spec || ''), fmtQ(q), g.unit || '', fmtQ(c), fmt(q * c)]); }
    rows.sort((a, b) => parseFloat(b[5].replace(/,/g, '')) - parseFloat(a[5].replace(/,/g, '')));
    last = { title: `庫存金額 ${today()}`, head: ['料號', '商品', '數量', '單位', '平均成本', '金額'], rows, foot: ['合計', `${rows.length} 項`, '', '', '', fmt(tv)] };
    box.innerHTML = table(last);
  }
  $('#rpCsv', el).onclick = () => { if (!last.rows.length) return toast('沒有資料可以匯出'); downloadText(last.title + '.csv', '﻿' + [last.head, ...last.rows, last.foot].map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n'), 'text/csv'); };
  $('#rpPrint', el).onclick = () => {
    if (!last.rows.length) return toast('沒有資料可以列印');
    const co = store.setting('company'); const meta = ui.tab === 'stock' ? `列印日期：${slash(today())}` : `期間：${slash(ui.from)} ～ ${slash(ui.to)}　列印日期：${slash(today())}`;
    const title = ui.tab === 'ar' ? '應收帳款明細' : ui.tab === 'ship' ? '客戶出貨明細表' : last.title.replace(/ \d{4}-\d{2}-\d{2}～.*$/, '');
    const sub = ui.tab === 'ship' && last.meta ? `<div class="meta"><span>客戶：${esc(last.meta.c.code || '')} ${esc(printName(last.meta.c.name))}</span><span>${meta}</span></div>` : `<div class="meta"><span>${meta}</span></div>`;
    printHTML(last.title, `@page{size:A4;margin:12mm 10mm}body{font-family:"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif;font-size:10pt;margin:0;color:#000}.co{text-align:center;font-weight:bold;font-size:11pt}h1{font-size:16pt;text-align:center;margin:0 0 2mm}.meta{display:flex;justify-content:space-between;margin:3mm 0 2mm}table{width:100%;border-collapse:collapse}th,td{border-bottom:.4pt solid #999;padding:1.2mm 1.5mm;text-align:left;vertical-align:top}th{border-top:1pt solid #000;border-bottom:1pt solid #000;white-space:nowrap}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}thead{display:table-header-group}tr{page-break-inside:avoid}tfoot td{font-weight:bold;border-top:1.2pt solid #000;border-bottom:none}`,
      `<div class="co">${esc(co.name || '志瑞螺絲企業有限公司')}</div><h1>${esc(title)}</h1>${sub}${table(last, null, true)}`, { tip: '按 Ctrl+P 列印，紙張 A4。' });
  };
}
const isNum = s => /^-?[\d,]+(\.\d+)?%?$/.test(String(s));
function table(t, ids, plain) {
  if (!t.rows.length) return '<div class="empty"><b>這段期間沒有資料</b></div>';
  return `<div class="tw"><table><thead><tr>${t.head.map((h, i) => `<th class="${t.rows[0] && isNum(t.rows[0][i]) ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r, ri) => `<tr ${ids && ids[ri] && !plain ? `class="row" data-bid="${ids[ri]}"` : ''}>${r.map(c => `<td class="${isNum(c) ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr>${t.foot.map(c => `<td class="${isNum(c) ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr></tfoot></table></div>`;
}
