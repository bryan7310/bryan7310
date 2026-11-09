// 基本資料：商品、客戶、供應商、倉庫、結算帳戶、名稱對應
import { $, esc, fmt, fmtQ, uid, matchQ, qTerms, money, downloadText } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, pager, field, selectField, formData, combo } from '../core/ui.js';
import { calc, goodsLabel, qtyAll, customers, suppliers } from '../core/calc.js';
import { api } from '../core/api.js';

const ui = { tab: 'goods', q: '', page: 0 };
const TABS = [['goods', '商品'], ['customers', '客戶'], ['suppliers', '供應商'], ['warehouses', '倉庫'], ['accounts', '結算帳戶'], ['names', '名稱對應']];
export default {
  id: 'master', name: '基本資料', group: '管理', icon: 'master',
  render(el, { sub, params }) { this.el = el; if (sub && TABS.some(t => t[0] === sub)) ui.tab = sub; draw(el); if (params.id) { const col = ui.tab === 'customers' || ui.tab === 'suppliers' ? 'contacts' : ui.tab; const d = store.get(col, params.id); if (d) openMaster(col, d); } },
  onChange(ch) { if (this.el?.isConnected && ['goods', 'contacts', 'warehouses', 'accounts', 'bills', 'settings'].some(c => ch.has(c))) draw(this.el); },
};
function draw(el) {
  const C = calc(); const q = qTerms(ui.q); let head = [], rows = [], label = '', col = '';
  const t = ui.tab;
  if (t === 'goods') {
    col = 'goods'; label = '商品'; head = ['料號', '品名', '規格', '類別', '單位', '<span class="n">庫存</span>', '<span class="n">售價</span>', '<span class="n">進價</span>'];
    rows = store.list('goods').filter(g => matchQ([g.code, g.name, g.spec, g.cat, g.vcode].join(' '), q)).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name))).map(g => [g, [esc(g.code), esc(g.name), esc(g.spec), esc(g.cat), esc(g.unit), `<span class="n">${fmtQ(qtyAll(g.id))}</span>`, `<span class="n">${g.salePrice ? fmtQ(g.salePrice) : ''}</span>`, `<span class="n">${g.purPrice ? fmtQ(g.purPrice) : ''}</span>`]]);
  } else if (t === 'customers' || t === 'suppliers') {
    col = 'contacts'; const C2 = t === 'customers'; label = C2 ? '客戶' : '供應商'; head = ['編號', '名稱', '簡稱／別名', '統編', '聯絡人', '電話', `<span class="n">${C2 ? '應收' : '應付'}餘額</span>`];
    rows = (C2 ? customers() : suppliers()).filter(c => matchQ([c.code, c.name, c.short, ...(c.aliases || []), c.taxId, c.phone, c.person].join(' '), q)).map(c => [c, [esc(c.code), esc(c.name), esc([c.short, ...(c.aliases || []).filter(a => a !== c.short)].filter(Boolean).join('、')), esc(c.taxId), esc(c.person), esc(c.phone), `<span class="n">${fmt(C.bal[c.id] || 0)}</span>`]]);
  } else if (t === 'warehouses') {
    col = 'warehouses'; label = '倉庫'; head = ['名稱', '預設', '<span class="n">庫存品項</span>'];
    const def = store.setting('prefs').defaultWh;
    rows = store.list('warehouses').map(w => [w, [esc(w.name), w.id === def ? '<span class="pill ok">預設</span>' : '', `<span class="n">${Object.values(C.stock).filter(s => s[w.id]).length}</span>`]]);
  } else if (t === 'accounts') {
    col = 'accounts'; label = '結算帳戶'; head = ['名稱', '<span class="n">期初</span>', '<span class="n">目前餘額</span>'];
    rows = store.list('accounts').map(a => [a, [esc(a.name), `<span class="n">${fmt(a.init)}</span>`, `<span class="n">${fmt(C.accBal[a.id] || 0)}</span>`]]);
  } else if (t === 'names') return drawNames(el);
  const [s, e, pg] = pager('m', rows.length, ui.page);
  el.innerHTML = `<div class="head"><h1>基本資料</h1><span class="sp"></span>${t === 'goods' || col === 'contacts' ? `<button class="btn" id="expBtn">匯出 CSV</button>` : ''}<button class="btn pri" id="addBtn">＋ 新增${label}</button></div>
    <div class="panel"><div class="tools">${tabs('m', TABS, t)}<input type="search" id="mq" placeholder="搜尋${label}" value="${esc(ui.q)}"><span class="muted small">${rows.length} 筆</span></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.slice(s, e).map(([d, cells]) => `<tr class="row" data-id="${d.id}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}"><div class="empty"><b>沒有資料</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.q = ''; ui.page = 0; location.hash = '#master/' + ui.tab; }, { once: true });
  $('#mq', el).addEventListener('input', ev => { ui.q = ev.target.value; ui.page = 0; draw(el); const i = $('#mq', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => openMaster(col, store.get(col, tr.dataset.id))));
  $('#addBtn', el).addEventListener('click', () => openMaster(col, null, t === 'suppliers' ? 'S' : 'C'));
  $('#expBtn', el)?.addEventListener('click', () => { const hs = head.map(h => h.replace(/<[^>]+>/g, '')); downloadText(`${label}.csv`, '﻿' + [hs.join(','), ...rows.map(([, cells]) => cells.map(c => '"' + c.replace(/<[^>]+>/g, '').replace(/"/g, '""') + '"').join(','))].join('\n'), 'text/csv'); });
}

const FIELDS = {
  goods: [['code', '料號'], ['name', '品名', 'req'], ['spec', '規格'], ['cat', '類別'], ['unit', '單位'], ['vcode', '客料號'], ['salePrice', '售價', 'num'], ['purPrice', '進價', 'num'], ['cost', '手動成本（找不到進貨單時用）', 'num'], ['safety', '安全庫存', 'num'], ['wt', '單重 g', 'num'], ['aunit', '大單位（例如 箱）'], ['arate', '大單位 = 幾個基本單位', 'num'], ['note', '備註']],
  C: [['code', '客戶編號'], ['name', '客戶名稱', 'req'], ['short', '簡稱'], ['taxId', '統一編號'], ['person', '聯絡人'], ['phone', '電話'], ['fax', '傳真'], ['zip', '郵遞區號'], ['addr', '地址'], ['payMethod', '付款方式（匯款、支票、扣趴…）'], ['init', '期初應收', 'num'], ['note', '備註']],
  S: [['code', '供應商編號'], ['name', '供應商名稱', 'req'], ['short', '簡稱'], ['taxId', '統一編號'], ['person', '聯絡人'], ['phone', '電話'], ['fax', '傳真'], ['addr', '地址'], ['init', '期初應付', 'num'], ['note', '備註']],
  warehouses: [['name', '倉庫名稱', 'req']],
  accounts: [['name', '帳戶名稱', 'req'], ['bank', '銀行／帳號'], ['init', '期初餘額', 'num']],
};
const LABEL = { goods: '商品', C: '客戶', S: '供應商', warehouses: '倉庫', accounts: '結算帳戶' };
export function openMaster(col, doc, kind) {
  const k = col === 'contacts' ? (doc ? doc.kind : kind) : col;
  const fs = FIELDS[k]; const d = doc || {};
  const C = calc();
  const refs = doc ? refCount(col, doc.id) : 0;
  const body = `<div class="grid">${fs.map(([n, l, t]) => `<div class="f" ${n === 'addr' || n === 'note' || n === 'name' ? 'style="grid-column:1/-1"' : ''}><label for="f-${n}">${esc(l)}</label><input id="f-${n}" name="${n}" value="${esc(d[n] ?? '')}" ${t === 'num' ? 'class="num" inputmode="decimal"' : ''} ${t === 'req' ? 'required' : ''}></div>`).join('')}
    ${col === 'contacts' ? `<div class="f" style="grid-column:1/-1"><label for="f-aliases">別名（作業平台、支票、發票上用過的其他寫法，用逗號隔開）</label><input id="f-aliases" name="aliases" value="${esc((d.aliases || []).join('、'))}"></div>` : ''}
    ${col === 'warehouses' && doc ? `<label class="check" style="grid-column:1/-1"><input type="checkbox" name="isDefault" ${store.setting('prefs').defaultWh === doc.id ? 'checked' : ''}> 設為預設倉庫</label>` : ''}</div>
    ${doc && col === 'goods' ? `<div class="muted small">各倉庫庫存：${store.list('warehouses').map(w => `${esc(w.name)} ${fmtQ((C.stock[doc.id] || {})[w.id] || 0)}`).join('、')}　<a href="#" id="histBtn">查看歷史單價</a></div><div id="histBox"></div>` : ''}
    ${doc && col === 'contacts' ? `<div class="muted small">目前${k === 'C' ? '應收' : '應付'}餘額 ${fmt(C.bal[doc.id] || 0)}　<a href="#" id="histBtn">查看歷史單據</a></div><div id="histBox"></div>` : ''}
    <div class="err" id="mErr"></div>`;
  modal({
    title: `${doc ? '修改' : '新增'}${LABEL[k]}`, body, width: 760,
    footer: `${doc ? `<button class="btn danger" id="mDel" ${refs ? `title="有 ${refs} 張單據用到，無法刪除" disabled` : ''}>刪除${refs ? `（${refs} 張單據用到）` : ''}</button>` : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="mSave">儲存</button>`,
    onOpen(el, close) {
      el.querySelector('#mSave').onclick = async () => {
        const f = formData(el); const out = { ...d };
        for (const [n, , t] of fs) out[n] = t === 'num' ? (f[n] === '' ? 0 : +String(f[n]).replace(/,/g, '') || 0) : String(f[n] ?? '').trim();
        if (!out.name) { el.querySelector('#mErr').textContent = '請填名稱'; return; }
        if (col === 'contacts') { out.kind = k; out.aliases = String(f.aliases || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean); }
        if (col === 'goods' && out.code && store.list('goods').some(g => g.code === out.code && g.id !== d.id)) { el.querySelector('#mErr').textContent = '料號重複'; return; }
        const id = d.id || uid(col === 'goods' ? 'g' : col === 'contacts' ? 'c' : 'w');
        delete out.id;
        await store.save(col, id, out);
        if (col === 'warehouses' && f.isDefault) await store.saveSetting('prefs', { ...store.setting('prefs'), defaultWh: id });
        store.log(doc ? '修改' : '新增', `${LABEL[k]} ${out.name}`); close(); toast('已儲存');
      };
      el.querySelector('#mDel')?.addEventListener('click', async () => { if (await confirm(`確定刪除${LABEL[k]}「${d.name}」？`, { danger: true, ok: '刪除' })) { await store.remove(col, d.id); store.log('刪除', `${LABEL[k]} ${d.name}`); close(); toast('已刪除'); } });
      el.querySelector('#histBtn')?.addEventListener('click', async ev => {
        ev.preventDefault(); const box = el.querySelector('#histBox'); box.innerHTML = '<div class="muted">載入中…</div>';
        if (col === 'goods') {
          const r = await api.histPrices(d.id, 30);
          const live = C.bills.filter(b => (b.lines || []).some(l => l.gid === d.id)).flatMap(b => b.lines.filter(l => l.gid === d.id).map(l => ({ type: b.type, date: b.date, cid: b.cid, qty: l.qty, price: l.price, u: l.u, no: b.no })));
          const all = [...live, ...r.rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 40);
          box.innerHTML = `<div class="tw"><table><thead><tr><th>日期</th><th>單據</th><th>對象</th><th class="n">數量</th><th class="n">單價</th></tr></thead><tbody>${all.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.type === 'SALE' ? '銷' : x.type === 'PUR' ? '進' : x.type)} ${esc(x.no)}</td><td>${esc(C.ct[x.cid]?.short || C.ct[x.cid]?.name || '')}</td><td class="n">${fmtQ(x.qty)}</td><td class="n">${fmtQ(x.price)}${x.u ? '/' + esc(x.u) : ''}</td></tr>`).join('') || '<tr><td class="muted">沒有紀錄</td></tr>'}</tbody></table></div>`;
        } else {
          const r = await api.hist({ cid: d.id, limit: 30 });
          box.innerHTML = `<div class="tw"><table><thead><tr><th>日期</th><th>單號</th><th>種類</th><th class="n">金額</th></tr></thead><tbody>${r.rows.map(b => `<tr><td>${esc(b.date)}</td><td class="mono">${esc(b.no)}</td><td>${esc({ SALE: '銷貨', PUR: '進貨', PO: '採購', QUO: '報價' }[b.type] || b.type)}</td><td class="n">${fmt(b.oamt)}</td></tr>`).join('') || '<tr><td class="muted">沒有紀錄</td></tr>'}</tbody></table><div class="muted small">歷史單據共 ${r.total} 張（舊系統）</div></div>`;
        }
      });
    },
  });
}
function refCount(col, id) {
  const bills = store.list('bills');
  if (col === 'goods') return bills.filter(b => (b.lines || []).some(l => l.gid === id)).length;
  if (col === 'contacts') return bills.filter(b => b.cid === id).length + store.list('receivables').filter(r => r.cid === id).length + store.list('payables').filter(r => r.cid === id).length;
  if (col === 'warehouses') return bills.filter(b => b.wid === id || b.toWid === id).length;
  if (col === 'accounts') return bills.filter(b => b.aid === id).length;
  return 0;
}

// ---------- 名稱對應：舊作業平台對不上的名字 → 客戶／供應商 ----------
function drawNames(el) {
  const un = store.setting('unmatched_names');
  const groups = [['receivables', '應收帳款的客戶', 'C'], ['checks_in', '支票登記的客戶', 'C'], ['payables', '應付帳款的廠商', 'S'], ['checks_out', '支票抬頭的廠商', 'S'], ['orders', '訂貨排程的廠商', 'S']];
  const rows = groups.flatMap(([k, lab, kind]) => (un[k] || []).map(n => ({ k, lab, kind, name: n })));
  el.innerHTML = `<div class="head"><h1>基本資料</h1></div>
    <div class="panel"><div class="tools">${tabs('m', TABS, 'names')}</div>
    <p class="muted">舊作業平台裡這些名字對不到客戶／供應商。每個名字選一個對應的客戶／供應商（會加到它的別名），或按「新增」直接建成新的。對應後，應收、應付、支票登記等資料會自動連到該客戶。</p>
    ${rows.length ? `<div class="tw"><table><thead><tr><th>來源</th><th>名稱</th><th style="width:40%">對應到</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr data-i="${i}"><td class="muted">${esc(r.lab)}</td><td><b>${esc(r.name)}</b></td><td><div class="combo"><input data-pick="${i}" placeholder="搜尋${r.kind === 'C' ? '客戶' : '供應商'}"></div></td><td class="nowrap"><button class="btn sm" data-new="${i}">新增為${r.kind === 'C' ? '客戶' : '供應商'}</button> <button class="btn sm ghost" data-skip="${i}">忽略</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>全部都對應好了 ✓</b></div>'}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; location.hash = '#master/' + ui.tab; }, { once: true });
  const done = async (r, cid) => {
    const list = (un[r.k] || []).filter(n => n !== r.name);
    const ops = [{ col: 'settings', id: 'unmatched_names', data: { ...un, [r.k]: list } }];
    if (cid) {
      const c = store.get('contacts', cid); const aliases = [...new Set([...(c.aliases || []), r.name])];
      ops.push({ col: 'contacts', id: cid, data: { ...c, aliases } });
      // 把用這個名字的資料連上
      const link = (col, f) => store.list(col).filter(x => !x.cid && x[f] === r.name).forEach(x => ops.push({ col, id: x.id, data: { ...x, cid } }));
      link('receivables', 'cust'); link('payables', 'vendor'); link('checks_in', 'name'); link('checks_out', 'payee'); link('orders', 'vendor');
    }
    await store.batch(ops); toast(cid ? `「${r.name}」已對應到 ${store.get('contacts', cid).name}` : `已忽略「${r.name}」`);
  };
  el.querySelectorAll('[data-pick]').forEach(inp => { const r = rows[+inp.dataset.pick]; combo(inp, { items: () => (r.kind === 'C' ? customers() : suppliers()).map(c => ({ id: c.id, label: c.name, sub: [c.code, c.short].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => done(r, it.id) }); });
  el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', async () => { const r = rows[+b.dataset.new]; const id = uid('c'); await store.save('contacts', id, { kind: r.kind, code: '', name: r.name, short: r.name, aliases: [], init: 0, note: '由名稱對應新增' }); done(r, id); }));
  el.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => done(rows[+b.dataset.skip], null)));
}
