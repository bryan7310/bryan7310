// 螺絲查價：各供應商牌價、折數、淨價；加入報價單草稿；折數管理
import { $, esc, ls, qTerms, debounce, fmtQ } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, tabs, modal, confirm, onSearch } from '../core/ui.js';
import { FACETS, facetVal, matchFacets, sortFacetVals, searchText, itemFactor, fmtDisc, netPrice, fmtList, fmtP, attr, noteOf, origText, perKgText, dupGroup, supName, catById, parseDisc, discKey, itemDisc } from '../core/pricing.js';

const LIMIT = 150;
const flt = { sup: '', material: '', finish: '', group: '', head: '', system: '', dia: '', length: '', od: '', thick: '' };
const ui = { q: '', tab: 'search' };
export const cart = { get: () => ls.get('zr.cart', { lines: [], cid: '' }), set: v => ls.set('zr.cart', v) };

export default {
  id: 'pricing', name: '螺絲查價', group: '業務', icon: 'pricing',
  render(el, { sub, params }) { this.el = el; if (params.q) ui.q = params.q; if (sub === 'discounts') ui.tab = 'discounts'; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('pricing') || ch.has('discounts') || ch.has('pricing_cats'))) draw(this.el); },
  badge() { const n = cart.get().lines.length; return { cnt: n }; },
};
function draw(el) {
  if (ui.tab === 'discounts') return drawDiscounts(el);
  el.innerHTML = `<div class="head"><h1>螺絲查價</h1><span class="sub">${store.list('pricing').length.toLocaleString('zh-TW')} 筆牌價・一律以 1 支／個計價</span><span class="sp"></span>${tabs('pt', [['search', '查價'], ['discounts', '折數管理']], 'search')}<a class="btn pri" href="#quotes/draft">報價單草稿 <span id="cartN">${cart.get().lines.length || ''}</span></a></div>
    <div class="panel" style="display:grid;gap:10px">
      <div class="tools"><input type="search" id="pq" placeholder="輸入品名、規格、料號，例如 m4x20、皿頭 白鐵、盤頭 tp" value="${esc(ui.q)}" autofocus><button class="btn sm" id="fReset" hidden>清除篩選</button></div>
      <div class="facets" id="facets">${FACETS.map(([k, l]) => `<select id="f-${k}" aria-label="${l}" ${k === 'od' || k === 'thick' ? 'hidden' : ''}></select>`).join('')}</div>
    </div>
    <div class="panel" id="results"></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  $('#pq', el).addEventListener('input', debounce(() => { ui.q = $('#pq', el).value; renderSearch(el); }, 120));
  FACETS.forEach(([k]) => $('#f-' + k, el).addEventListener('change', ev => { flt[k] = ev.target.value; if (k === 'group' && !/^(華司|彈簧扣環)$/.test(flt.group)) flt.od = flt.thick = ''; renderSearch(el); }));
  $('#fReset', el).addEventListener('click', () => { FACETS.forEach(([k]) => flt[k] = ''); renderSearch(el); });
  $('#results', el).addEventListener('click', ev => {
    const b = ev.target.closest('[data-add]'); if (!b) return;
    const id = b.dataset.add; const qty = Math.max(1, parseFloat(el.querySelector(`[data-qty="${id}"]`).value) || 1);
    const c = cart.get(); const ex = c.lines.find(l => l.pid === id);
    if (ex) ex.qty += qty; else c.lines.push({ pid: id, qty });
    cart.set(c); $('#cartN', el).textContent = c.lines.length; toast('已加入報價單草稿');
  });
  renderSearch(el);
}
function renderFilters(el, base) {
  for (const [k, label] of FACETS) {
    const counts = new Map();
    base.forEach(it => { if (matchFacets(it, flt, k)) { const v = facetVal(it, k); if (v) counts.set(v, (counts.get(v) || 0) + 1); } });
    if (flt[k] && !counts.has(flt[k])) counts.set(flt[k], 0);
    const vals = sortFacetVals(k, [...counts.keys()]);
    const name = v => (k === 'od' || k === 'thick') ? v + ' mm' : k === 'length' && /^\d+(\.\d+)?$/.test(v) ? v + ' mm' : v;
    const sel = $('#f-' + k, el);
    sel.innerHTML = `<option value="">全部${label}</option>` + vals.map(v => `<option value="${esc(v)}">${esc(name(v))}　${counts.get(v)}</option>`).join('');
    sel.value = flt[k]; sel.classList.toggle('on', !!flt[k]); sel.disabled = !vals.length;
  }
  const ws = flt.group === '華司' || flt.group === '彈簧扣環';
  $('#f-od', el).hidden = $('#f-thick', el).hidden = !ws;
  $('#fReset', el).hidden = !FACETS.some(([k]) => flt[k]);
}
function renderSearch(el) {
  const items = store.list('pricing');
  const terms = qTerms(ui.q.replace(/[×xX*]/g, '×'));
  const base = terms.length ? items.filter(it => { const t = searchText(it); return terms.every(w => t.includes(w)); }) : items;
  renderFilters(el, base);
  const list = base.filter(it => matchFacets(it, flt));
  const box = $('#results', el);
  if (!list.length) { box.innerHTML = `<div class="empty"><b>找不到符合條件的品項</b>試試清除篩選或換個關鍵字</div>`; return; }
  const shown = list.slice(0, LIMIT);
  box.innerHTML = `<div class="res-head"><span>品項</span><span class="r">牌價</span><span class="r">折扣</span><span class="r">淨價</span><span></span></div>` +
    shown.map(it => {
      const { f, own } = itemFactor(it); const c = catById(it.cat);
      return `<div class="res">
        <div class="main"><div><span class="nm">${esc(it.name)}</span>${it.spec ? `<span class="spec">${esc(it.spec)}</span>` : ''}</div>
          <div class="meta">${noteOf(it) ? `<span class="src">${esc(noteOf(it))}</span>` : ''}${it.code ? `<span class="mono">${esc(it.code)}</span>` : ''}${[attr(it, 'material'), attr(it, 'finish'), attr(it, 'head'), attr(it, 'thread'), it.grade ? it.grade + ' 級' : '', c?.name, origText(it), perKgText(it)].filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('')}</div>${dupHtml(it)}</div>
        <div class="r"><span class="lbl">牌價</span><span class="num list">${fmtList(it.price)}</span></div>
        <div class="r"><span class="lbl">折扣</span><span class="disc${own ? ' own' : ''}" title="${own ? '此品項有個別折扣' : '類別折扣'}">${esc(fmtDisc(f))}</span></div>
        <div class="r"><span class="lbl">淨價${it.unit ? ' / ' + esc(it.unit) : ''}</span><span class="num net">${fmtP(netPrice(it))}</span></div>
        <div class="add"><input type="number" min="1" value="1" aria-label="數量" data-qty="${it.id}"><button class="btn sm pri" data-add="${it.id}">加入</button></div></div>`;
    }).join('') + `<div class="muted small" style="padding:10px 4px">${list.length > LIMIT ? `共 ${list.length} 筆，只顯示前 ${LIMIT} 筆，請輸入更多關鍵字縮小範圍` : `共 ${list.length} 筆`}</div>`;
}
function dupHtml(it) {
  const g = dupGroup(it); if (g.length < 2) return '';
  const rows = g.map(x => ({ x, net: netPrice(x) })).sort((a, b) => a.net - b.net); const low = rows[0].net;
  return `<div class="dup"><b>重複品項 ${g.length} 筆：</b>` + rows.map(({ x, net }) => `<span class="${x === it ? 'me' : ''}${net === low ? ' low' : ''}">${esc(supName(x))} ${esc(fmtDisc(itemFactor(x).f))} 淨價 ${fmtQ(net)}${net === low ? '（最低）' : ''}</span>`).join('') + '</div>';
}

// ---------- 折數管理：廠商 → 類別 → 品名群組，修改個別折數（全公司同步） ----------
const dm = { sup: '', q: '' };
function drawDiscounts(el) {
  const items = store.list('pricing');
  const sups = [...new Set(items.map(i => i.sup || '自行新增'))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  if (!dm.sup) dm.sup = sups[0] || '';
  const groups = new Map();
  for (const it of items) { if ((it.sup || '自行新增') !== dm.sup) continue; const key = discKey(it); let g = groups.get(key); if (!g) groups.set(key, g = { key, cat: it.cat, name: it.name, base: String(it.disc ?? '').trim(), items: [] }); g.items.push(it); }
  const edited = new Map(store.list('discounts').map(d => [d.key, d]));
  const list = [...groups.values()].filter(g => !dm.q || (g.name + ' ' + (catById(g.cat)?.name || '')).toLowerCase().includes(dm.q.toLowerCase()));
  const byCat = new Map(); for (const g of list) (byCat.get(g.cat) || byCat.set(g.cat, []).get(g.cat)).push(g);
  el.innerHTML = `<div class="head"><h1>螺絲查價</h1><span class="sp"></span>${tabs('pt', [['search', '查價'], ['discounts', '折數管理']], 'discounts')}</div>
    <div class="panel" style="display:grid;gap:12px">
      <p class="muted" style="margin:0">先選廠商，再改各品名的個別折數；沒有個別折數的品項套用類別折數。改好的折數所有電腦立即同步。清空輸入欄即恢復原牌價表的折數。</p>
      <div class="tools"><select id="dmSup">${sups.map(s => `<option ${s === dm.sup ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><input type="search" id="dmQ" placeholder="篩選品名、類別" value="${esc(dm.q)}"></div>
      ${[...byCat.entries()].map(([cat, gs]) => { const c = catById(cat); return `<div class="tw"><div class="ptitle">${esc(c?.name || cat)}<small>類別折數 <input data-cat="${esc(cat)}" value="${esc(c?.discount || '')}" placeholder="原價" style="width:80px;border:1px solid var(--line);border-radius:6px;padding:3px 6px;text-align:right" class="num"> ${esc(fmtDisc(parseDisc(c?.discount) ?? 1))}</small></div>
        <table><thead><tr><th>品名</th><th class="n">筆數</th><th>原折數</th><th>目前折數</th><th>例</th></tr></thead><tbody>${gs.map(g => { const e = edited.get(g.key); const cur = e ? e.disc : g.base; const ex = g.items[0]; return `<tr class="${e ? 'sel' : ''}"><td>${esc(g.name)}</td><td class="n">${g.items.length}</td><td class="muted">${esc(g.base || '（類別）')}</td><td><input data-key="${esc(g.key)}" value="${esc(cur)}" placeholder="${esc(g.base || '同類別')}" class="num" style="width:90px;border:1px solid var(--line);border-radius:6px;padding:4px 8px;text-align:right"></td><td class="muted small">${esc(ex.spec || '')} 牌價 ${fmtList(ex.price)} → 淨價 ${fmtQ(netPrice(ex))}</td></tr>`; }).join('')}</tbody></table></div>`; }).join('') || '<div class="empty">沒有品項</div>'}
    </div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  $('#dmSup', el).addEventListener('change', ev => { dm.sup = ev.target.value; drawDiscounts(el); });
  onSearch($('#dmQ', el), debounce(v => { dm.q = v; drawDiscounts(el); setTimeout(() => { const i = $('#dmQ', el); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, 250));
  el.querySelectorAll('[data-key]').forEach(inp => inp.addEventListener('change', async () => {
    const key = inp.dataset.key; const g = groups.get(key); const v = inp.value.trim();
    if (v && isNaN(parseDisc(v))) { toast('折數格式不對，例如 65、6.5、65 95'); inp.focus(); return; }
    const id = 'd' + btoa(unescape(encodeURIComponent(key))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const old = edited.get(key);
    if (!v || v === g.base) { if (old) await store.remove('discounts', old.id); }
    else await store.save('discounts', old?.id || id, { key, cat: g.cat, name: g.name, base: g.base, disc: v, at: Date.now() });
    store.log('折數', `${dm.sup} ${catById(g.cat)?.name || ''} ${g.name}：${old?.disc || g.base || '類別'} → ${v || g.base || '類別'}（${g.items.length} 筆）`);
    toast(`已更新「${g.name}」折數`);
  }));
  el.querySelectorAll('[data-cat]').forEach(inp => inp.addEventListener('change', async () => {
    const c = catById(inp.dataset.cat); const v = inp.value.trim();
    if (v && isNaN(parseDisc(v))) { toast('折數格式不對'); return; }
    await store.save('pricing_cats', c.id, { ...c, discount: v }); store.log('折數', `${dm.sup} 類別 ${c.name}：${c.discount || '原價'} → ${v || '原價'}`); toast('已更新類別折數');
  }));
}
