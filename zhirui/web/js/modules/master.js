// 基本資料：商品、客戶、供應商、倉庫、結算帳戶、名稱對應
import { $, esc, fmt, fmtQ, uid, matchQ, qTerms, money, downloadText, today } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, pager, field, selectField, formData, combo, onSearch } from '../core/ui.js';
import { calc, goodsLabel, qtyAll, customers, suppliers, costOf, cdisp } from '../core/calc.js';
import { api } from '../core/api.js';
import { SP_FIELDS, spLab, spParse, spGet, spDims, spSVG, spRows, spTable, spWeight } from '../core/spec.js';
import { loadHistPur, resetHistCache, goodsHistory } from './_bills.js';
import { loadXlsx } from './purchase_import.js';
import { shortName, suggestShorts } from '../core/names.js';
import { imageViewer } from '../core/imgview.js';
import { bomHTML, bomBind } from './assembly.js';

const ui = { tab: 'goods', q: '', page: 0 };
const TABS = [['goods', '商品'], ['customers', '客戶'], ['suppliers', '供應商'], ['warehouses', '倉庫'], ['accounts', '結算帳戶'], ['names', '名稱對應']];
export default {
  id: 'master', name: '基本資料', group: '管理', icon: 'master',
  render(el, { sub, params }) { this.el = el; if (sub && TABS.some(t => t[0] === sub)) ui.tab = sub; draw(el); if (params.id) { const col = ui.tab === 'customers' || ui.tab === 'suppliers' ? 'contacts' : ui.tab; const d = store.get(col, params.id); if (d) openMaster(col, d); } },
  onChange(ch) { if (this.el?.isConnected && ['goods', 'contacts', 'warehouses', 'accounts', 'bills', 'settings'].some(c => ch.has(c))) draw(this.el); },
};
function draw(el) {
  const C = calc(); const q = qTerms(ui.q); let head = [], rows = [], label = '', col = '', offN = 0;
  const t = ui.tab;
  if (t === 'goods') {
    col = 'goods'; label = '商品'; head = ['料號', '品名', '客料號', '廠商料號', '類別', '單位', '<span class="n">庫存</span>', '<span class="n">售價</span>', '<span class="n">進價</span>'];
    rows = store.list('goods').filter(g => matchQ([g.code, g.name, g.spec, g.cat, g.vcode].join(' '), q)).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name))).map(g => [g, [esc(g.code), esc(g.name), esc(g.spec), esc(g.vcode), esc(g.cat), esc(g.unit), `<span class="n">${fmtQ(qtyAll(g.id))}</span>`, `<span class="n">${g.salePrice ? fmtQ(g.salePrice) : ''}</span>`, `<span class="n">${g.purPrice ? fmtQ(g.purPrice) : ''}</span>`]]);
  } else if (t === 'customers' || t === 'suppliers') {
    col = 'contacts'; const C2 = t === 'customers'; label = C2 ? '客戶' : '供應商'; head = ['編號', '名稱', '簡稱／別名', '統編', '聯絡人', '電話', `<span class="n">${C2 ? '應收' : '應付'}餘額</span>`];
    const allC = C2 ? customers(true) : suppliers(true); offN = allC.filter(c => c.inactive).length;
    rows = allC.filter(c => (ui.off || !c.inactive) && matchQ([c.code, c.name, c.short, ...(c.aliases || []), c.taxId, c.phone, c.person].join(' '), q)).map(c => [c, [esc(c.code), esc(c.name) + (c.inactive ? ' <span class="pill">停用</span>' : ''), esc([c.short, ...(c.aliases || []).filter(a => a !== c.short)].filter(Boolean).join('、')), esc(c.taxId), esc(c.person), esc(c.phone), `<span class="n">${fmt(C.bal[c.id] || 0)}</span>`]]);
  } else if (t === 'warehouses') {
    col = 'warehouses'; label = '倉庫'; head = ['名稱', '預設', '<span class="n">庫存品項</span>'];
    const def = store.setting('prefs').defaultWh;
    rows = store.list('warehouses').map(w => [w, [esc(w.name), w.id === def ? '<span class="pill ok">預設</span>' : '', `<span class="n">${Object.values(C.stock).filter(s => s[w.id]).length}</span>`]]);
  } else if (t === 'accounts') {
    col = 'accounts'; label = '結算帳戶'; head = ['名稱', '<span class="n">期初</span>', '<span class="n">目前餘額</span>'];
    rows = store.list('accounts').map(a => [a, [esc(a.name), `<span class="n">${fmt(a.init)}</span>`, `<span class="n">${fmt(C.accBal[a.id] || 0)}</span>`]]);
  } else if (t === 'names') return drawNames(el);
  const [s, e, pg] = pager('m', rows.length, ui.page);
  el.innerHTML = `<div class="head"><h1>基本資料</h1><span class="sp"></span>${col === 'contacts' ? `<button class="btn" id="dupBtn" title="找出名稱重複的${label}，以舊系統那筆為主合併">檢查重複</button><button class="btn" id="shortBtn" title="幫還沒有簡稱的${label}從全名擷取簡稱（介面顯示用；列印一律用全名）">擷取簡稱</button><button class="btn" id="fillExp" title="匯出還沒停用、缺統編／電話／地址的${label}，填好後用「匯入${label}資料」匯回">匯出待補資料</button><button class="btn" id="fillImp">匯入${label}資料</button>` : ''}${t === 'goods' || col === 'contacts' ? `<button class="btn" id="expBtn">匯出 CSV</button>` : ''}<button class="btn pri" id="addBtn">＋ 新增${label}</button></div>
    <div class="panel"><div class="tools">${tabs('m', TABS, t)}<input type="search" id="mq" placeholder="搜尋${label}" value="${esc(ui.q)}"><span class="muted small">${rows.length} 筆</span>${offN ? `<button type="button" class="btn sm ${ui.off ? 'pri' : ''}" id="offBtn">${ui.off ? '隱藏' : '顯示'}停用（${offN}）</button>` : ''}</div>
    <div class="tw" style="margin-top:10px"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}${col === 'goods' ? '<th></th>' : ''}</tr></thead><tbody>${rows.slice(s, e).map(([d, cells]) => `<tr class="row" data-id="${d.id}">${cells.map(c => `<td>${c}</td>`).join('')}${col === 'goods' ? `<td class="r"><button type="button" class="btn sm" data-copy="${d.id}" title="用這個商品的資料新增一筆（料號要改成不一樣的）">複製</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${head.length}"><div class="empty"><b>沒有資料</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.q = ''; ui.page = 0; location.hash = '#master/' + ui.tab; }, { once: true });
  onSearch($('#mq', el), v => { ui.q = v; ui.page = 0; draw(el); const i = $('#mq', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => openMaster(col, store.get(col, tr.dataset.id))));
  el.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); copyGoods(store.get('goods', b.dataset.copy)); }));
  $('#addBtn', el).addEventListener('click', () => openMaster(col, null, t === 'suppliers' ? 'S' : 'C'));
  $('#offBtn', el)?.addEventListener('click', () => { ui.off = !ui.off; ui.page = 0; draw(el); });
  $('#shortBtn', el)?.addEventListener('click', () => extractShorts(t === 'customers' ? 'C' : 'S'));
  $('#dupBtn', el)?.addEventListener('click', () => dupCheck(t === 'customers' ? 'C' : 'S'));
  $('#fillExp', el)?.addEventListener('click', () => fillExport(t === 'customers' ? 'C' : 'S').catch(e => toast('匯出失敗：' + (e.message || e))));
  $('#fillImp', el)?.addEventListener('click', () => fillImport(t === 'customers' ? 'C' : 'S'));
  $('#expBtn', el)?.addEventListener('click', () => { const hs = head.map(h => h.replace(/<[^>]+>/g, '')); downloadText(`${label}.csv`, '﻿' + [hs.join(','), ...rows.map(([, cells]) => cells.map(c => '"' + c.replace(/<[^>]+>/g, '').replace(/"/g, '""') + '"').join(','))].join('\n'), 'text/csv'); });
}

const FIELDS = {
  goods: [['code', '料號'], ['name', '品名', 'req'], ['spec', '客料號'], ['spec2', '第二客料號'], ['custName', '客戶品名'], ['vcode', '廠商料號'], ['cat', '類別'], ['unit', '單位'], ['salePrice', '售價', 'num'], ['purPrice', '進價', 'num'], ['cost', '手動成本（進貨單、查價都找不到時用）', 'num'], ['safety', '安全庫存', 'num'], ['wt', '單重 g／支（空白＝自動估算）', 'num'], ['aunit', '大單位（例如 箱）'], ['arate', '大單位 = 幾個基本單位', 'num'], ['note', '備註']],
  C: [['code', '客戶編號'], ['name', '客戶名稱', 'req'], ['short', '簡稱'], ['taxId', '統一編號'], ['person', '聯絡人'], ['phone', '電話'], ['fax', '傳真'], ['zip', '郵遞區號'], ['addr', '地址'], ['payMethod', '付款方式（匯款、支票、扣趴…）'], ['init', '期初應收', 'num'], ['note', '備註']],
  S: [['code', '供應商編號'], ['name', '供應商名稱', 'req'], ['short', '簡稱'], ['checkPayee', '票據抬頭（開支票用的名稱；多個用逗號隔開，第一個是預設；填「不填」＝預設空白；欄位空白＝用正式全名）'], ['taxId', '統一編號'], ['person', '聯絡人'], ['phone', '電話'], ['fax', '傳真'], ['addr', '地址'], ['init', '期初應付', 'num'], ['note', '備註']],
  warehouses: [['name', '倉庫名稱', 'req']],
  accounts: [['name', '帳戶名稱', 'req'], ['bank', '銀行／帳號'], ['init', '期初餘額', 'num']],
};
/** 複製商品：帶入同樣的品名、規格、單位、價格等開「新增商品」，料號要改成不一樣的才能存（圖面、庫存不帶） */
export function copyGoods(g, onSaved) {
  if (!g) return;
  const tpl = {}; for (const [n] of FIELDS.goods) if (g[n] != null && g[n] !== '') tpl[n] = g[n];
  if (g.sp && Object.keys(g.sp).length) tpl.sp = { ...g.sp };
  if (g.bom?.length) { tpl.bom = g.bom.map(x => ({ ...x })); if (g.labor) tpl.labor = g.labor; if (g.cwid) tpl.cwid = g.cwid; }   // 螺絲包：配方一起複製
  openMaster('goods', null, null, onSaved, tpl);
}
const LABEL = { goods: '商品', C: '客戶', S: '供應商', warehouses: '倉庫', accounts: '結算帳戶' };
/** 下一個客戶／供應商編號：在還沒用到 999 號的開頭字母裡，挑用最多的那個（供應商 A、客戶 D），最大號 + 1，補滿 3 位 */
export function nextContactCode(kind) {
  const codes = store.list('contacts').filter(c => c.kind === kind).map(c => String(c.code || '').trim().toUpperCase());
  const by = {}; for (const x of codes) { const m = x.match(/^([A-Z]+)(\d+)$/); if (m) (by[m[1]] ??= []).push(+m[2]); }
  const pre = Object.keys(by).filter(p => Math.max(...by[p]) < 999).sort((a, b) => by[b].length - by[a].length)[0];
  if (!pre) return '';
  const used = new Set(codes); let n = Math.max(...by[pre]) + 1;
  while (used.has(pre + String(n).padStart(3, '0')) && n < 999) n++;
  return pre + String(n).padStart(3, '0');
}
/** opts.fromBill：從單據的「修改商品」打開；料號改成系統沒有的 → 提示後新建商品，不動原商品，onSaved(新id, {created:true}) */
export function openMaster(col, doc, kind, onSaved, tpl, opts = {}) {
  const k = col === 'contacts' ? (doc ? doc.kind : kind) : col;
  const fs = FIELDS[k]; const d = doc || {}; const v = doc ? d : { ...(tpl || {}) };   // v：表單預填值（複製時是來源商品）
  if (!doc && (k === 'C' || k === 'S') && !v.code) v.code = nextContactCode(k);   // 新增客戶／供應商：自動帶下一個編號
  const C = calc();
  const refs = doc ? refCount(col, doc.id) : 0;
  const body = `<div class="grid">${fs.map(([n, l, t]) => `<div class="f" ${n === 'addr' || n === 'note' || n === 'name' ? 'style="grid-column:1/-1"' : ''}><label for="f-${n}">${esc(l)}</label><input id="f-${n}" name="${n}" value="${esc(v[n] ?? '')}" ${t === 'num' ? 'class="num" inputmode="decimal"' : ''} ${t === 'req' ? 'required' : ''} ${n === 'unit' || n === 'aunit' ? 'list="unitList" autocomplete="off"' : ''}></div>`).join('')}${col === 'goods' ? `<datalist id="unitList">${['PCS', 'KG', '包', '組', '盒', '箱', '件', 'SET', 'H', 'K', '批', '袋'].map(u => `<option value="${u}">`).join('')}</datalist>` : ''}
    ${col === 'contacts' ? `<div class="f" style="grid-column:1/-1"><label for="f-aliases">別名（作業平台、支票、發票上用過的其他寫法，用逗號隔開）</label><input id="f-aliases" name="aliases" value="${esc((d.aliases || []).join('、'))}"></div>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" name="inactive" ${d.inactive ? 'checked' : ''}> 停用（開單、挑選${k === 'C' ? '客戶' : '供應商'}時不顯示；歷史單據、報表照常查得到）</label>` : ''}
    ${col === 'warehouses' && doc ? `<label class="check" style="grid-column:1/-1"><input type="checkbox" name="isDefault" ${store.setting('prefs').defaultWh === doc.id ? 'checked' : ''}> 設為預設倉庫</label>` : ''}</div>
    ${tpl ? `<div class="banner" style="margin-top:8px">從「${esc(tpl.code || tpl.name)}」複製，請把料號改成新的（料號相同無法建立）。</div>` : ''}
    ${col === 'goods' ? goodsExtraHTML(tpl && !doc ? { sp: tpl.sp } : d) : ''}
    ${col === 'goods' ? bomHTML(tpl && !doc ? (tpl.bom ? tpl : {}) : d) : ''}
    ${doc && col === 'goods' ? `<div class="muted small">各倉庫庫存：${store.list('warehouses').map(w => `${esc(w.name)} ${fmtQ((C.stock[doc.id] || {})[w.id] || 0)}`).join('、')}</div><div class="tools" style="gap:8px;margin-top:6px"><button type="button" class="btn sm" id="ghSale">歷史銷貨明細</button><button type="button" class="btn sm" id="ghPur">歷史進貨明細</button></div>` : ''}
    ${doc && col === 'contacts' ? `<div class="muted small">目前${k === 'C' ? '應收' : '應付'}餘額 ${fmt(C.bal[doc.id] || 0)}　<a href="#" id="histBtn">查看歷史單據</a></div><div id="histBox"></div>` : ''}
    <div class="err" id="mErr"></div>`;
  modal({
    title: `${doc ? '修改' : tpl ? '複製' : '新增'}${LABEL[k]}`, body, width: col === 'goods' ? 900 : 760,
    footer: `${doc ? `<button class="btn danger" id="mDel" ${refs ? `title="有 ${refs} 張單據用到，無法刪除" disabled` : ''}>刪除${refs ? `（${refs} 張單據用到）` : ''}</button>` : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="mSave">儲存</button>`,
    onOpen(el, close) {
      if (col === 'goods') goodsExtraBind(el, d);
      const bomRead = col === 'goods' ? bomBind(el, tpl && !doc ? (tpl.bom ? tpl : {}) : d) : null;
      if (tpl) setTimeout(() => { const ci = el.querySelector('#f-code'); ci?.focus(); ci?.select(); }, 50);   // 複製：游標停在料號，直接改
      if (col === 'contacts') {   // 簡稱欄：空白時灰字顯示會自動帶入的簡稱
        const sh = el.querySelector('#f-short'), nm = el.querySelector('#f-name'), al = el.querySelector('#f-aliases');
        const ph = () => { sh.placeholder = nm.value.trim() ? '空白＝自動：' + shortName(nm.value, String(al?.value || '').split(/[,，、]/)) : ''; };
        nm.addEventListener('input', ph); ph();
        el.querySelector('label[for="f-short"]').textContent = '簡稱（畫面顯示用，列印用全名）';
      }
      el.querySelector('#mSave').onclick = async () => {
        const f = formData(el); const out = { ...d };
        for (const [n, , t] of fs) out[n] = t === 'num' ? (f[n] === '' ? 0 : +String(f[n]).replace(/,/g, '') || 0) : String(f[n] ?? '').trim();
        if (!out.name) { el.querySelector('#mErr').textContent = '請填名稱'; return; }
        if (col === 'contacts') {
          out.kind = k; out.aliases = String(f.aliases || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
          if (f.inactive) out.inactive = true; else delete out.inactive;
          if (!out.short) out.short = shortName(out.name, out.aliases);   // 簡稱空白就自動擷取（畫面顯示用）
          if (out.code && store.list('contacts').some(c => c.code === out.code && c.id !== d.id)) { el.querySelector('#mErr').textContent = `編號 ${out.code} 已經有人用了`; return; }
        }
        if (col === 'goods') { const sp = spForm(el); if (Object.keys(sp).length) out.sp = sp; else delete out.sp; }
        if (bomRead) {   // 配方（螺絲包）
          const bm = bomRead(); if (bm.bad) { el.querySelector('#mErr').textContent = `配方有 ${bm.bad} 行沒填每包數量`; return; }
          if (bm.bom.length) { out.bom = bm.bom; if (bm.labor) out.labor = bm.labor; else delete out.labor; if (bm.cwid) out.cwid = bm.cwid; else delete out.cwid; }
          else { delete out.bom; delete out.labor; delete out.cwid; }
        }
        if (col === 'goods' && opts.fromBill && doc && out.code && out.code !== String(d.code || '').trim() && !store.list('goods').some(g => g.code === out.code)) {
          // 單據裡改成新料號：原商品可能還有其他單據在用，改成新建一個商品，這一行換成新商品
          if (!await confirm(`料號「${out.code}」系統裡沒有。\n要用這些資料新建一個商品，並把這一行換成新商品嗎？\n原本的「${d.code || ''} ${d.name}」不會被修改。`, { ok: '新建商品' })) return;
          const nd = {}; for (const [n] of fs) nd[n] = out[n]; if (out.sp) nd.sp = out.sp; nd.note = [nd.note, `由 ${d.code || d.name} 修改建立`].filter(Boolean).join('；');
          const nid = uid('g'); await store.save('goods', nid, nd);
          store.log('新增', `商品 ${nd.code} ${nd.name}（由 ${d.code || ''} 修改建立）`); close(); toast(`已新建商品 ${nd.code}`); onSaved && onSaved(nid, { created: true }); return;
        }
        if (col === 'goods' && out.code && store.list('goods').some(g => g.code === out.code && g.id !== d.id)) { el.querySelector('#mErr').textContent = `料號 ${out.code} 已經有了，請改成不一樣的料號`; const ci = el.querySelector('#f-code'); ci?.focus(); ci?.select(); return; }
        const id = d.id || uid(col === 'goods' ? 'g' : col === 'contacts' ? 'c' : 'w');
        delete out.id;
        await store.save(col, id, out);
        if (col === 'warehouses' && f.isDefault) await store.saveSetting('prefs', { ...store.setting('prefs'), defaultWh: id });
        store.log(doc ? '修改' : '新增', `${LABEL[k]} ${out.name}`); close(); toast('已儲存'); onSaved && onSaved(id);
      };
      el.querySelector('#mDel')?.addEventListener('click', async () => { if (await confirm(`確定刪除${LABEL[k]}「${d.name}」？`, { danger: true, ok: '刪除' })) { await store.remove(col, d.id); store.log('刪除', `${LABEL[k]} ${d.name}`); close(); toast('已刪除'); } });
      el.querySelector('#ghSale')?.addEventListener('click', () => goodsHistory(d.id, 'S'));
      el.querySelector('#ghPur')?.addEventListener('click', () => goodsHistory(d.id, 'P'));
      el.querySelector('#histBtn')?.addEventListener('click', async ev => {
        ev.preventDefault(); const box = el.querySelector('#histBox'); box.innerHTML = '<div class="muted">載入中…</div>';
        if (col === 'goods') {
          const r = await api.histPrices(d.id, 30);
          const live = C.bills.filter(b => (b.lines || []).some(l => l.gid === d.id)).flatMap(b => b.lines.filter(l => l.gid === d.id).map(l => ({ type: b.type, date: b.date, cid: b.cid, qty: l.qty, price: l.price, u: l.u, no: b.no })));
          const all = [...live, ...r.rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 40);
          box.innerHTML = `<div class="tw"><table><thead><tr><th>日期</th><th>單據</th><th>對象</th><th class="n">數量</th><th class="n">單價</th></tr></thead><tbody>${all.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.type === 'SALE' ? '銷' : x.type === 'PUR' ? '進' : x.type)} ${esc(x.no)}</td><td>${esc(cdisp(C.ct[x.cid]))}</td><td class="n">${fmtQ(x.qty)}</td><td class="n">${fmtQ(x.price)}${x.u ? '/' + esc(x.u) : ''}</td></tr>`).join('') || '<tr><td class="muted">沒有紀錄</td></tr>'}</tbody></table></div>`;
        } else {
          const r = await api.hist({ cid: d.id, limit: 30 });
          box.innerHTML = `<div class="tw"><table><thead><tr><th>日期</th><th>單號</th><th>種類</th><th class="n">金額</th></tr></thead><tbody>${r.rows.map(b => `<tr><td>${esc(b.date)}</td><td class="mono">${esc(b.no)}</td><td>${esc({ SALE: '銷貨', PUR: '進貨', PO: '採購', QUO: '報價' }[b.type] || b.type)}</td><td class="n">${fmt(b.oamt)}</td></tr>`).join('') || '<tr><td class="muted">沒有紀錄</td></tr>'}</tbody></table><div class="muted small">歷史單據共 ${r.total} 張（舊系統）</div></div>`;
        }
      });
    },
  });
}
// ---------- 商品：自動成本、規格與圖面、單重估算 ----------
function goodsExtraHTML(d) {
  const o = d.sp || {};
  const fld = ([k, l, list]) => list
    ? `<div class="f"><label for="sp-${k}">${l}</label><select id="sp-${k}" data-sp="${k}"><option value="">自動</option>${list.map(([x, t]) => `<option value="${x}" ${x === o[k] ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`
    : `<div class="f"><label for="sp-${k}">${l}</label><input id="sp-${k}" data-sp="${k}" value="${esc(o[k] ?? '')}"></div>`;
  return `<div class="gcost" id="gCost"><span class="muted">自動成本計算中…</span></div>
    <details class="spbox" open><summary><b>規格與圖面</b> <span class="muted small">（從品名自動帶入；認錯時到「修正規格」改）</span></summary>
      <div class="sppv"><div id="spSvg"></div><div class="spside"><table class="sprows" id="spRows"></table></div></div>
      <div id="spTbl"></div>
      <div class="dwgbar" id="dwgBar"></div>
      <details class="spfix" ${Object.keys(o).length ? 'open' : ''}><summary>修正規格 <span class="muted small">（空白＝用自動值，灰字是自動值）</span></summary><div class="grid">${SP_FIELDS.map(fld).join('')}</div></details>
    </details>`;
}
const spForm = el => { const o = {}; el.querySelectorAll('[data-sp]').forEach(i => { const v = i.value.trim(); if (v) o[i.dataset.sp] = v; }); return o; };
function goodsExtraBind(el, d) {
  const v = n => el.querySelector('#f-' + n)?.value ?? '';
  const cur = () => ({ ...d, code: v('code').trim(), name: v('name').trim(), cat: v('cat').trim(), unit: v('unit').trim(), cost: +String(v('cost')).replace(/,/g, '') || 0, wt: +String(v('wt')).replace(/,/g, '') || 0, sp: spForm(el) });
  const refreshSpec = () => {
    const g = cur(); const a = spParse(g);
    el.querySelectorAll('[data-sp]').forEach(i => { const k = i.dataset.sp; const f = SP_FIELDS.find(x => x[0] === k); if (f[2]) i.options[0].textContent = '自動：' + (a[k] ? spLab(f[2], a[k]) : '—'); else i.placeholder = a[k] != null && a[k] !== '' ? '自動：' + a[k] : ''; });
    const sp = spGet(g), dm = spDims(sp);
    el.querySelector('#spSvg').innerHTML = spSVG(sp, dm);
    el.querySelector('#spRows').innerHTML = spRows(sp, dm).map(([l, x]) => `<tr><th>${esc(l)}</th><td>${esc(x)}</td></tr>`).join('');
    el.querySelector('#spTbl').innerHTML = spTable(sp, dm);
    const w = spWeight({ ...sp, _wt: 0 }, dm); const wi = el.querySelector('#f-wt');
    if (wi) { wi.placeholder = w ? `自動估算：${w}` : '認不出規格，請填實測'; if (wi.value === '0') wi.value = ''; }
  };
  const refreshCost = () => {
    const box = el.querySelector('#gCost'); if (!box) return;
    const g = cur(); const C = calc(); const sameName = d.id && g.name === d.name && g.unit === d.unit;
    const tmp = { ...g, id: sameName ? d.id : 'tmp:' + g.name + '|' + g.unit };
    const gid = d.id || 'tmp:new';
    const r = costOf({ gid, qty: 1, price: 0 }, today(), C.purIdx, { ...C.g, [gid]: tmp }, C.poIdx, true);
    const ci = el.querySelector('#f-cost'); if (ci) { ci.placeholder = r && !r.manual ? `自動：${fp(r.c)}` : ''; if (ci.value === '0') ci.value = ''; }
    const recs = (C.purIdx[d.id] || []).slice().sort((x, y) => y.d - x.d).slice(0, 3);
    const unit = esc(g.unit || 'PCS');
    box.innerHTML = r
      ? `<b>自動成本 ${fp(r.c)} / ${unit}</b>　<span class="muted">來源：${esc(r.src)}</span>${r.manual ? ' <span class="pill warn">手動</span>' : /^查價/.test(r.src) ? ' <span class="pill blue">查價牌價</span>' : ' <span class="pill ok">進貨單</span>'}`
        + (recs.length ? `<div class="muted small">最近進貨：${recs.map(x => `${esc(x.date)} ${esc(cdisp(C.ct[x.cid]))} ${fp(x.per)}${x.cls === 'kg' ? '/KG' : ''}`).join('、')}</div>` : '')
      : `<b class="warn-t">找不到成本</b>　<span class="muted">進貨單、採購單、查價牌價都對不到，請填下面的「手動成本」。</span>`;
  };
  const fp = n => (Math.round(n * 10000) / 10000).toString();
  const refresh = () => { try { refreshSpec(); } catch (e) { console.error(e); } try { refreshCost(); } catch (e) { console.error(e); } };
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(refresh, 200); };
  el.addEventListener('input', ev => { if (ev.target.matches('#f-name,#f-code,#f-cat,#f-unit,#f-cost,#f-wt,[data-sp]')) later(); });
  el.addEventListener('change', ev => { if (ev.target.matches('[data-sp]')) later(); });
  dwgBind(el, d);
  refresh();
  loadHistPur().then(() => { if (el.isConnected) refreshCost(); }).catch(() => {});
}
// ---------- 擷取簡稱：沒有簡稱的客戶／供應商，從全名建議簡稱，可逐筆修改後存檔 ----------
function extractShorts(kind) {
  const lab = kind === 'C' ? '客戶' : '供應商';
  const all = store.list('contacts').filter(c => c.kind === kind);
  const miss = all.filter(c => !String(c.short || '').trim()).sort((a, b) => !!a.inactive - !!b.inactive || String(a.code || a.name).localeCompare(String(b.code || b.name)));
  if (!miss.length) return toast(`所有${lab}都有簡稱了`);
  const sug = suggestShorts(miss, all.filter(c => String(c.short || '').trim()));
  modal({
    title: `擷取${lab}簡稱`, width: 860,
    body: `<p class="muted" style="margin-top:0">${miss.length} 家${lab}還沒有簡稱。系統從全名建議簡稱（以前用過、又是全名開頭的別名優先），可以直接改；不想設的取消勾選。<b>簡稱只用在畫面顯示，單據、對帳單、支票、發票等列印一律用全名。</b></p>
      <div class="tools" style="align-items:center"><label class="check small"><input type="checkbox" id="esAll" checked> 全選</label><span class="muted small" id="esN"></span></div>
      <div class="tw" style="max-height:55vh;margin-top:6px"><table><thead><tr><th></th><th>編號</th><th>全名</th><th style="width:180px">簡稱</th><th></th></tr></thead><tbody>
      ${sug.map((x, i) => `<tr class="${x.c.inactive ? 'muted' : ''}"><td><input type="checkbox" data-es="${i}" checked></td><td class="mono nowrap">${esc(x.c.code || '')}</td><td>${esc(x.c.name)}${x.c.inactive ? ' <span class="pill">停用</span>' : ''}</td><td><input data-esv="${i}" value="${esc(x.short)}" style="width:100%"></td><td class="small" style="color:var(--warn)">${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>`,
    footer: `<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="esGo">儲存簡稱</button>`,
    onOpen(m, close) {
      const cnt = () => { const n = m.querySelectorAll('[data-es]:checked').length; m.querySelector('#esN').textContent = `已勾選 ${n} 家`; m.querySelector('#esGo').textContent = `儲存 ${n} 家簡稱`; };
      m.querySelector('#esAll').onchange = ev => { m.querySelectorAll('[data-es]').forEach(c => { c.checked = ev.target.checked; }); cnt(); };
      m.addEventListener('change', ev => { if (ev.target.matches('[data-es]')) cnt(); });
      cnt();
      m.querySelector('#esGo').onclick = async () => {
        const ops = [];
        m.querySelectorAll('[data-es]:checked').forEach(c => { const i = +c.dataset.es; const v = m.querySelector(`[data-esv="${i}"]`).value.trim(); if (!v) return; const { id, ...rest } = sug[i].c; ops.push({ col: 'contacts', id, data: { ...rest, short: v } }); });
        if (!ops.length) return toast('沒有要儲存的簡稱');
        await store.batch(ops); store.log('擷取簡稱', `${lab} ${ops.length} 家`); close(); toast(`已設定 ${ops.length} 家${lab}的簡稱`);
      };
    },
  });
}
// ---------- 客戶／供應商資料：匯出待補 Excel、匯入補好的資料 ----------
const FILL_COLS = [['id', '系統代號（勿改）'], ['code', '編號'], ['name', '名稱'], ['short', '簡稱'], ['taxId', '統一編號'], ['phone', '電話'], ['fax', '傳真'], ['zip', '郵遞區號'], ['addr', '地址'], ['person', '聯絡人'], ['payMethod', '付款方式'], ['note', '備註']];
const FILL_SYN = { id: ['系統代號（勿改）', '系統代號'], code: ['編號', '客戶編號', '供應商編號'], name: ['名稱', '客戶名稱', '供應商名稱', '公司名稱'], short: ['簡稱'], taxId: ['統一編號', '統編'], phone: ['電話'], fax: ['傳真'], zip: ['郵遞區號', '郵遞區號'], addr: ['地址', '送貨地址'], person: ['聯絡人'], payMethod: ['付款方式'], note: ['備註'] };
async function fillExport(kind) {
  const lab = kind === 'C' ? '客戶' : '供應商';
  const need = c => [!String(c.taxId || '').trim() && '統編', !String(c.phone || '').trim() && '電話', !String(c.addr || '').trim() && '地址'].filter(Boolean);
  const list = (kind === 'C' ? customers() : suppliers()).filter(c => need(c).length);
  if (!list.length) return toast(`所有使用中的${lab}統編、電話、地址都有了`);
  const XLSX = await loadXlsx();
  const aoa = [[...FILL_COLS.map(x => x[1]), '缺少']]; for (const c of list) aoa.push([...FILL_COLS.map(([k]) => String(c[k] ?? '')), need(c).join('、')]);
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [18, 8, 28, 10, 11, 14, 14, 8, 36, 10, 12, 20, 12].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `待補${lab}資料`);
  XLSX.writeFile(wb, `待補${lab}資料_${today()}.xlsx`);
  toast(`已匯出 ${list.length} 家${lab}；填好後按「匯入${lab}資料」`);
}
function fillImport(kind) {
  const lab = kind === 'C' ? '客戶' : '供應商';
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const XLSX = await loadXlsx(); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const h = rows.findIndex(r => r.some(x => FILL_SYN.name.includes(String(x).trim())));
      if (h < 0) return toast('找不到「名稱」欄，請用「匯出待補資料」的格式');
      const map = {}; rows[h].forEach((x, i) => { const s = String(x).trim(); for (const [k, syn] of Object.entries(FILL_SYN)) if (syn.includes(s) && map[k] == null) map[k] = i; });
      const all = store.list('contacts').filter(c => c.kind === kind);
      const byId = new Map(all.map(c => [c.id, c])), byCode = new Map(all.filter(c => c.code).map(c => [c.code, c])), byName = new Map(all.map(c => [String(c.name).trim(), c]));
      const changes = [], miss = [], warn = [];
      for (const r of rows.slice(h + 1)) {
        const v = k => map[k] != null ? String(r[map[k]] ?? '').trim() : '';
        if (!v('name') && !v('code') && !v('id')) continue;
        const c = byId.get(v('id')) || byCode.get(v('code')) || byName.get(v('name'));
        if (!c) { miss.push(v('code') + ' ' + v('name')); continue; }
        const patch = {};
        for (const [k] of FILL_COLS) { if (k === 'id' || k === 'code' || k === 'name') continue; const nv = v(k); if (nv && nv !== String(c[k] ?? '').trim()) patch[k] = nv; }
        if (patch.taxId && !/^\d{8}$/.test(patch.taxId.replace(/\s/g, ''))) { warn.push(`${c.name}：統編「${patch.taxId}」不是 8 位數字，已略過`); delete patch.taxId; }
        if (Object.keys(patch).length) changes.push({ c, patch });
      }
      const fname = { short: '簡稱', taxId: '統編', phone: '電話', fax: '傳真', zip: '郵遞區號', addr: '地址', person: '聯絡人', payMethod: '付款方式', note: '備註' };
      modal({
        title: `匯入${lab}資料`, width: 900,
        body: `<p class="muted">${esc(f.name)}：要更新 <b>${changes.length}</b> 家${lab}${miss.length ? `，對不到 ${miss.length} 列` : ''}。只會填入有寫的欄位，空白欄不會清掉原資料。</p>
          ${warn.length ? `<div class="banner">${warn.map(esc).join('<br>')}</div>` : ''}
          <div class="tw" style="max-height:50vh"><table><thead><tr><th>${lab}</th><th>欄位</th><th>原本</th><th>改成</th></tr></thead><tbody>${changes.flatMap(({ c, patch }) => Object.entries(patch).map(([k, nv], i) => `<tr><td>${i ? '' : esc((c.code ? c.code + ' ' : '') + c.name)}</td><td>${fname[k] || k}</td><td class="muted">${esc(c[k] || '')}</td><td><b>${esc(nv)}</b></td></tr>`)).join('') || '<tr><td colspan="4" class="muted">沒有要更新的資料</td></tr>'}</tbody></table></div>
          ${miss.length ? `<details style="margin-top:8px"><summary class="muted">對不到的列（${miss.length}）</summary><div class="muted small">${miss.map(esc).join('<br>')}</div></details>` : ''}`,
        footer: `<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="fiGo" ${changes.length ? '' : 'disabled'}>更新 ${changes.length} 家</button>`,
        onOpen(m, close) {
          m.querySelector('#fiGo').onclick = async () => {
            await store.batch(changes.map(({ c, patch }) => { const { id, ...rest } = c; return { col: 'contacts', id: c.id, data: { ...rest, ...patch } }; }));
            store.log('匯入', `${lab}資料 ${f.name}：更新 ${changes.length} 家`); close(); toast(`已更新 ${changes.length} 家${lab}`);
          };
        },
      });
    } catch (e) { toast('讀取失敗：' + (e.message || e)); }
  };
  inp.click();
}
// ---------- 客戶圖面：上傳到伺服器 data/files，商品上記 dwg {id,name,type,size,at} ----------
const fileUrl = (dw, dl) => `/api/files/${encodeURIComponent(dw.id)}?n=${encodeURIComponent(dw.name || '')}${dl ? '&dl=1' : ''}`;
async function shrinkImg(file) {   // 大圖縮到長邊 2400px 的 JPG（手機拍的照片常常 5～10MB）
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    let w = img.naturalWidth, h = img.naturalHeight; const mx = 2400;
    if (Math.max(w, h) <= mx && file.size < 1.5e6) return { blob: file, name: file.name };
    if (Math.max(w, h) > mx) { const f = mx / Math.max(w, h); w = Math.round(w * f); h = Math.round(h * f); }
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } finally { URL.revokeObjectURL(url); }
}
function dwgView(dw, title) {
  if (/pdf/.test(dw.type)) { window.open(fileUrl(dw), '_blank'); return; }
  imageViewer({ url: fileUrl(dw), title: `${title || ''}　客戶圖面`, name: dw.name || '', dl: fileUrl(dw, 1) });
}
function dwgBind(el, d) {
  const bar = el.querySelector('#dwgBar'); if (!bar) return;
  const draw = () => {
    const dw = d.dwg;
    bar.innerHTML = `${dw ? (/pdf/.test(dw.type) ? '<span class="dwgpdf">PDF</span>' : `<img class="dwgthumb" src="${fileUrl(dw)}" alt="" data-dwg-view>`) : ''}
      <span class="muted small sp">${dw ? `客戶圖面：${esc(dw.name)}${dw.size ? `（${dw.size >= 1048576 ? (dw.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(dw.size / 1024)) + ' KB'}）` : ''}` : '尚未附客戶圖面（可上傳 JPG／PNG 圖片或 PDF）'}</span>
      ${dw ? '<button type="button" class="btn sm" data-dwg-view>查看圖面</button>' : ''}
      <button type="button" class="btn sm" data-dwg-up>${dw ? '更換圖面' : '上傳圖面'}</button>
      ${dw ? '<button type="button" class="btn sm danger" data-dwg-del>移除</button>' : ''}
      <input type="file" accept="image/*,.pdf,application/pdf" hidden data-dwg-file>`;
  };
  // 已存在的商品：圖面一上傳就存到商品上；新商品：按「儲存」時一起存
  const persist = async dwg => {
    if (dwg) d.dwg = dwg; else delete d.dwg;
    if (!d.id) return;
    const cur = store.get('goods', d.id) || d; const { id, ...rest } = cur;
    if (dwg) rest.dwg = dwg; else delete rest.dwg;
    await store.save('goods', d.id, rest);
  };
  bar.addEventListener('click', async ev => {
    const t = ev.target;
    if (t.closest('[data-dwg-view]')) return dwgView(d.dwg, el.querySelector('#f-name')?.value || d.name);
    if (t.closest('[data-dwg-up]')) return bar.querySelector('[data-dwg-file]').click();
    if (t.closest('[data-dwg-del]')) {
      if (!await confirm(`移除客戶圖面「${d.dwg.name}」？`, { danger: true, ok: '移除' })) return;
      const old = d.dwg; await persist(null); api.post(`/api/files/${encodeURIComponent(old.id)}/delete`, {}).catch(() => {});
      store.log('移除圖面', `商品「${d.name || ''}」${old.name}`); draw(); toast('已移除圖面');
    }
  });
  bar.addEventListener('change', async ev => {
    const inp = ev.target.closest('[data-dwg-file]'); if (!inp || !inp.files[0]) return;
    const file = inp.files[0]; const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !/^image\//.test(file.type)) return toast('只接受圖片（JPG／PNG）或 PDF');
    const st = bar.querySelector('.sp'); st.textContent = '上傳中…';
    try {
      const up = isPdf ? { blob: file, name: file.name } : await shrinkImg(file);
      if (up.blob.size > 25 * 1024 * 1024) throw new Error('檔案超過 25 MB');
      const r = await fetch('/api/files?name=' + encodeURIComponent(up.name), { method: 'POST', body: up.blob, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const old = d.dwg; await persist({ id: j.id, name: j.name, type: j.type, size: j.size, at: Date.now() });
      if (old && old.id !== j.id) api.post(`/api/files/${encodeURIComponent(old.id)}/delete`, {}).catch(() => {});
      store.log('上傳圖面', `商品「${d.name || el.querySelector('#f-name')?.value || ''}」${j.name}`);
      draw(); toast(d.id ? '圖面已上傳並存到商品' : '圖面已上傳，按「儲存」後存到商品');
    } catch (e) { st.textContent = '上傳失敗：' + (e.message || e); }
  });
  draw();
}
function refCount(col, id) {
  const bills = store.list('bills');
  if (col === 'goods') return bills.filter(b => b.kit?.gid === id || (b.lines || []).some(l => l.gid === id)).length + store.list('goods').filter(g => (g.bom || []).some(x => x.gid === id)).length;
  if (col === 'contacts') return bills.filter(b => b.cid === id).length + store.list('receivables').filter(r => r.cid === id).length + store.list('payables').filter(r => r.cid === id).length;
  if (col === 'warehouses') return bills.filter(b => b.wid === id || b.toWid === id || b.cwid === id).length;
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
  el.querySelectorAll('[data-pick]').forEach(inp => { const r = rows[+inp.dataset.pick]; combo(inp, { items: () => (r.kind === 'C' ? customers(true) : suppliers(true)).map(c => ({ id: c.id, label: c.name, sub: [c.code, c.short].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => done(r, it.id) }); });
  el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', async () => { const r = rows[+b.dataset.new]; const id = uid('c'); await store.save('contacts', id, { kind: r.kind, code: '', name: r.name, short: r.name, aliases: [], init: 0, note: '由名稱對應新增' }); done(r, id); }));
  el.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => done(rows[+b.dataset.skip], null)));
}

// ---------- 檢查重複：名稱相同（或只差公司字樣、括號備註）的客戶／供應商，以舊系統那筆為主合併 ----------
async function dupCheck(kind) {
  const label = kind === 'C' ? '客戶' : '供應商';
  const m = modal({ title: `檢查重複${label}`, width: 980, closeOnBg: false, body: '<div class="muted">檢查中…</div>', footer: '<span class="muted small" id="dpSum"></span><span class="sp"></span><button class="btn" data-close>關閉</button><button class="btn pri" id="dpGo" disabled>合併勾選的</button>' });
  let groups = [];
  try { groups = (await api.get('/api/contacts/dups?kind=' + kind)).groups || []; } catch (e) { m.el.querySelector('.mb').innerHTML = `<div class="banner">${esc(e.message)}</div>`; return; }
  const mb = m.el.querySelector('.mb');
  if (!groups.length) { mb.innerHTML = `<div class="empty"><b>沒有重複的${label}</b>名稱相同或只差「股份有限公司」、括號備註的都檢查過了</div>`; return; }
  const tierCls = t => t === '舊系統' ? 'ok' : t === 'Access' ? 'blue' : '';
  mb.innerHTML = `<p class="muted small" style="margin:0">每一組預設保留「舊系統」那筆（同為舊系統時保留交易較多的），其他筆的電話、地址、統編等空欄會補進來，名稱放進別名，所有單據、帳款、支票、發票與舊系統歷史單據都改掛到保留的那筆，然後刪除。名稱只差 (1)(2)、(弟) 這類的可能是不同對象，預設不勾。</p>
    ${groups.map((g, gi) => `<div class="panel" style="padding:10px 12px;display:grid;gap:6px" data-g="${gi}">
      <label class="check"><input type="checkbox" data-gon="${gi}" ${g.suggest ? 'checked' : ''}> <b>第 ${gi + 1} 組</b>${g.strong ? '' : ' <span class="pill">名稱相近</span>'}${g.conflict ? ' <span class="pill bad">統編不同，請確認</span>' : ''}</label>
      <div class="tw"><table><thead><tr><th>保留</th><th>來源</th><th>編號</th><th>名稱</th><th>簡稱</th><th>統編</th><th>電話</th><th class="n">新平台單據</th><th class="n">舊系統單據</th></tr></thead><tbody>
      ${g.items.map((it, ii) => `<tr><td><input type="radio" name="dpk${gi}" value="${esc(it.id)}" ${ii === 0 ? 'checked' : ''} aria-label="保留這筆"></td><td><span class="pill ${tierCls(it.tier)}">${esc(it.tier)}</span></td><td class="mono">${esc(it.code)}</td><td>${esc(it.name)}${it.inactive ? ' <span class="pill">停用</span>' : ''}</td><td>${esc(it.short || '')}</td><td class="mono">${esc(it.taxId || '')}</td><td>${esc(it.phone || '')}</td><td class="n">${it.refs}</td><td class="n">${it.hist}</td></tr>`).join('')}
      </tbody></table></div></div>`).join('')}`;
  const go = m.el.querySelector('#dpGo');
  const sel = () => groups.map((g, gi) => ({ g, gi, on: mb.querySelector(`[data-gon="${gi}"]`).checked, keep: mb.querySelector(`input[name="dpk${gi}"]:checked`)?.value })).filter(x => x.on && x.keep);
  const upd = () => { const n = sel().length; go.disabled = !n; go.textContent = n ? `合併勾選的 ${n} 組` : '合併勾選的'; m.el.querySelector('#dpSum').textContent = `找到 ${groups.length} 組，勾選 ${n} 組`; };
  mb.addEventListener('change', upd); upd();
  go.onclick = async () => {
    const list = sel(); if (!list.length) return;
    const nOther = list.reduce((s, x) => s + x.g.ids.length - 1, 0);
    if (!await confirm(`合併 ${list.length} 組、共 ${nOther} 筆${label}到保留的那筆？\n合併後被併入的那筆會刪除，單據改掛到保留的那筆，無法一鍵復原（每天的自動備份仍可還原）。`, { ok: '合併', danger: true })) return;
    go.disabled = true; let ok = 0, docs = 0, hist = 0; const errs = [];
    for (const x of list) {
      go.textContent = `合併中 ${ok + errs.length + 1}／${list.length}…`;
      try { const r = await api.post('/api/contacts/merge', { keep: x.keep, merge: x.g.ids.filter(i => i !== x.keep) }); ok++; docs += r.docs || 0; hist += r.hist || 0; const k = x.g.items.find(i => i.id === x.keep); store.log('合併', `${label} ${k.code} ${k.name} ← ${x.g.items.filter(i => i.id !== x.keep).map(i => `${i.code} ${i.name}`).join('、')}`); }
      catch (e) { errs.push(`第 ${x.gi + 1} 組：${e.message}`); }
    }
    try { const st = await api.status(); resetHistCache(st.histVer); } catch (e) { resetHistCache(); }
    m.close();
    toast(`已合併 ${ok} 組（單據 ${docs} 筆、舊系統單據 ${hist} 張改掛）${errs.length ? `，${errs.length} 組失敗` : ''}`);
    if (errs.length) modal({ title: '部分合併失敗', width: 560, body: `<ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`, footer: '<span class="sp"></span><button class="btn" data-close>關閉</button>' });
  };
}
