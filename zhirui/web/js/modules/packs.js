// 包裝螺絲排程：要包裝的商品排程——商品、數量、預交日期、客戶；勾「包裝中」「已完成」。
//   資料存 packs（一列一筆）：{ gid, prod（沒選到商品時自己打的品名）, qty, unit, due, cid, cust（客戶名稱）, note, date（登記日）, steps: { pack, done, doneAt, doneTime },
//     logs: [{ qty, at（ISO 時間）, date, by }]（分次包裝的登記：員工在 App／平板「包裝排程」每次包多少登記一筆，累計到數量就算完成） }
import { $, esc, today, daysLeft, uid, qTerms, matchQ, slash, fmtQ } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, onSearch } from '../core/ui.js';
import { customers, cshort, calc, goodsLabel } from '../core/calc.js';
import { packBom } from '../core/packbom.js';
import { stockBtn, bindStockBtns } from './stockadj.js';

const SOON = 3;   // 幾天內到期算「快到了」
const ui = { tab: 'active', q: '', cust: '' };
const isDone = o => !!(o.steps || {}).done;
const cn = o => o.cid ? cshort(o.cid) : (o.cust || '');
const pname = o => o.gid ? (store.get('goods', o.gid)?.name || o.prod || '（商品已刪除）') : (o.prod || '');
const num = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
const packed = o => (o.logs || []).reduce((a, l) => a + num(l.qty), 0);
const logTime = l => { const d = new Date(l.at); return isNaN(d) ? (l.date || '') : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const pcode = o => o.gid ? (store.get('goods', o.gid)?.code || '') : '';

export default {
  id: 'packs', name: '包裝螺絲', group: '業務', icon: 'orders',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('packs') || ch.has('goods') || ch.has('contacts') || ch.has('bills'))) draw(this.el); },
  badge() { const a = store.list('packs').filter(o => !isDone(o)); const late = a.filter(o => o.due && o.due < today()).length; return { cnt: a.length, alert: late > 0 }; },
};

function draw(el) {
  const t = today(); const all = store.list('packs'); const q = qTerms(ui.q); const C = calc();
  const stockOf = gid => gid ? Object.values(C.stock[gid] || {}).reduce((a, b) => a + b, 0) : null;
  const inTab = o => (ui.tab === 'active') === !isDone(o);
  const ccnt = {}; for (const o of all) if (inTab(o)) { const v = cn(o); if (v) ccnt[v] = (ccnt[v] || 0) + 1; }
  const custs = Object.keys(ccnt).sort((a, b) => ccnt[b] - ccnt[a] || a.localeCompare(b, 'zh-Hant'));
  if (ui.cust && !ccnt[ui.cust]) custs.push(ui.cust);
  const list = all.filter(o => inTab(o) && (!ui.cust || cn(o) === ui.cust) && (!q.length || matchQ([cn(o), o.cust, pname(o), pcode(o), store.get('goods', o.gid)?.alias, o.note, o.qty].join(' '), q)));
  list.sort((a, b) => ui.tab === 'active' ? (a.due || '9').localeCompare(b.due || '9') || (a.date || '').localeCompare(b.date || '') : ((b.steps || {}).doneAt || b.date || '').localeCompare((a.steps || {}).doneAt || a.date || ''));
  const active = all.filter(o => !isDone(o)); const late = active.filter(o => o.due && o.due < t), soon = active.filter(o => o.due && o.due >= t && daysLeft(o.due) <= SOON);
  el.innerHTML = `<div class="head"><h1>包裝螺絲排程</h1><span class="sp"></span>${tabs('pk', [['active', `進行中 ${active.length}`], ['done', '已完成']], ui.tab)}<button class="btn pri" id="pkNew">＋ 新增排程</button></div>
    ${ui.tab === 'active' ? `<div class="kpis k3"><div class="kpi ${late.length ? 'alert' : ''}"><span>逾期</span><b>${late.length}</b></div><div class="kpi"><span>${SOON} 天內要交</span><b>${soon.length}</b></div><div class="kpi"><span>進行中</span><b>${active.length}</b></div></div>` : ''}
    <div class="panel"><div class="tools"><input type="search" id="pkQ" style="width:240px;flex:none" placeholder="搜尋商品、料號、客戶" value="${esc(ui.q)}"><span class="muted small nowrap">${list.length} 筆</span><div class="od-vs"><button type="button" class="od-v${ui.cust ? '' : ' on'}" data-v="">全部</button>${custs.map(v => `<button type="button" class="od-v${v === ui.cust ? ' on' : ''}" data-v="${esc(v)}">${esc(v)}<i>${ccnt[v] || 0}</i></button>`).join('')}</div></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>預交日期</th><th>客戶</th><th>商品</th><th class="n">數量</th><th class="n">庫存</th><th>已包／還剩</th><th>進度</th><th>備註</th><th></th></tr></thead><tbody>${list.map((o, i) => {
      const dl = o.due ? daysLeft(o.due) : null; const st = o.steps || {};
      const tag = o.due && !st.done ? (dl < 0 ? `<span class="pill bad">逾期 ${-dl} 天</span>` : dl <= SOON ? `<span class="pill warn">${dl === 0 ? '今天' : dl + ' 天後'}</span>` : '') : '';
      const sq = stockOf(o.gid); const need = parseFloat(String(o.qty).replace(/,/g, '')) || 0; const short = sq !== null && !st.done && need > 0 && sq < need;
      return `<tr data-i="${i}"><td class="nowrap">${o.due ? esc(slash(o.due)) : '<span class="muted">沒填</span>'} ${tag}</td><td class="nowrap"><b>${esc(cn(o)) || '<span class="muted">—</span>'}</b></td>
        <td>${o.gid ? `<button type="button" class="link" data-bom="${i}" title="點一下看這個螺絲包的配方（零件、每包數量、庫存）" style="text-align:left;font:inherit">${esc(pname(o))}</button>` : esc(pname(o))}${pcode(o) ? `<div class="muted small mono">${esc(pcode(o))}</div>` : o.gid ? '' : '<div class="muted small">（沒有對到商品資料）</div>'}</td>
        <td class="n nowrap"><b>${esc(need ? fmtQ(need) : o.qty || '')}</b> ${esc(o.unit || '')}</td>
        <td class="n nowrap">${sq === null ? '<span class="muted">—</span>' : stockBtn(o.gid, sq, short ? 'bad' : '', (short ? '庫存不夠這一筆要包的數量' : '目前所有倉庫合計') + '；點一下調整庫存')}</td>
        <td class="nowrap">${(() => { const got = packed(o); const logs = o.logs || []; if (!logs.length) return '<span class="muted">還沒登記</span>'; const last = logs[logs.length - 1]; const left = Math.max(0, +(need - got).toPrecision(10)); return `<b>${fmtQ(got)}</b>${need ? `／${fmtQ(need)}` : ''}${st.done ? '' : `　還剩 <b>${fmtQ(left)}</b>`}<div class="muted small" title="${esc(logs.map(l => `${logTime(l)}　${fmtQ(num(l.qty))}　${l.by || ''}`).join('\n'))}">${logs.length} 筆・最後 ${esc(logTime(last))} ${esc(last.by || '')}</div>`; })()}</td>
        <td class="nowrap"><div class="steps" style="margin:0"><label class="${st.pack ? 'on' : ''}"><input type="checkbox" data-step="pack" data-i="${i}" ${st.pack ? 'checked' : ''}>包裝中</label><label class="${st.done ? 'on' : ''}"><input type="checkbox" data-step="done" data-i="${i}" ${st.done ? 'checked' : ''}>已完成</label></div>${st.done && st.doneAt ? `<div class="muted small">${esc(slash(st.doneAt))} 完成</div>` : ''}</td>
        <td class="muted small">${esc(o.note || '')}</td><td class="nowrap"><button class="btn xs" data-edit="${i}">修改</button></td></tr>`;
    }).join('') || `<tr><td colspan="9" class="muted" style="text-align:center;padding:26px">${all.length || ui.q || ui.cust ? '沒有符合的排程' : '還沒有排程，按右上角「＋ 新增排程」'}</td></tr>`}</tbody></table></div></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  el.querySelectorAll('.od-v').forEach(b => b.addEventListener('click', () => { ui.cust = b.dataset.v === ui.cust ? '' : b.dataset.v; draw(el); }));
  onSearch($('#pkQ', el), v => { ui.q = v; draw(el); const i = $('#pkQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#pkNew', el).addEventListener('click', () => editPack(null));
  el.querySelectorAll('[data-step]').forEach(cb => cb.addEventListener('change', async () => {
    const o = list[+cb.dataset.i]; const steps = { ...(o.steps || {}) }; steps[cb.dataset.step] = cb.checked;
    if (cb.dataset.step === 'done') { if (cb.checked) { steps.doneAt = today(); steps.doneTime = new Date().toISOString(); } else { delete steps.doneAt; delete steps.doneTime; } }
    const data = { ...o, steps }; delete data.id;
    try { await store.save('packs', o.id, data); } catch (e) { toast(saveErr(e)); draw(el); }
  }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editPack(list[+b.dataset.edit])));
  bindStockBtns(el, () => draw(el));
  el.querySelectorAll('[data-bom]').forEach(b => b.addEventListener('click', () => showBom(list[+b.dataset.bom])));
}
const saveErr = e => /不認識|集合|col/i.test(e.message || '') ? '存不進去：伺服器還是舊版，請到「設定備份 › 備份」按「重新啟動伺服器」' : '儲存失敗：' + (e.message || e);

/** 點品名：看配方（每包幾個、這筆共需、還要用、庫存） */
function showBom(o) {
  const B = packBom(o); const g = B.g; const u = o.unit || '';
  modal({
    title: `配方：${g?.name || pname(o)}`, width: 760,
    body: `<p class="muted small" style="margin:0 0 8px">${esc(g?.code || '')}　排程 <b>${fmtQ(B.need)}</b> ${esc(u)}${B.left !== B.need ? `，還剩 <b>${fmtQ(B.left)}</b> ${esc(u)}` : ''}${cn(o) ? `　客戶 ${esc(cn(o))}` : ''}${o.due ? `　預交 ${esc(slash(o.due))}` : ''}</p>
      ${B.rows.length ? `<div class="tw"><table><thead><tr><th>#</th><th>零件</th><th class="n">每包</th><th class="n">共需</th><th class="n">還要用</th><th class="n">庫存</th></tr></thead><tbody>${B.rows.map((r, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(r.name)}${r.cust ? ' <span class="pill blue">客供</span>' : ''}<div class="muted small mono">${esc(r.code)}</div></td><td class="n">${fmtQ(r.per)}</td><td class="n">${fmtQ(r.total)}</td><td class="n"><b>${fmtQ(r.rest)}</b></td><td class="n nowrap">${stockBtn(r.gid, r.stock, r.short ? 'bad' : '')}${r.short ? ` <span class="pill bad">不夠 ${fmtQ(+(r.rest - Math.max(0, r.stock)).toPrecision(10))}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small" style="margin:8px 0 0">共 ${B.rows.length} 種零件${B.rows.some(r => r.short) ? `，<b class="bad">${B.rows.filter(r => r.short).length} 種庫存不夠</b>` : '，庫存都夠'}${B.labor ? `　工錢每包 ${B.labor}` : ''}。「還要用」＝每包數量 × 還剩的包數；客供件看客供倉的庫存。點庫存數字可以調整庫存。配方在「基本資料 › 商品」裡改。</p>`
        : '<div class="banner info">這個商品還沒有設定配方。到「基本資料 › 商品」打開這個商品，在「配方（螺絲包／組合品）」加零件。</div>'}`,
    footer: '<span class="sp"></span><button class="btn pri" data-close>關閉</button>',
    onOpen(el, close) { bindStockBtns(el, () => { close(); showBom(store.get('packs', o.id) || o); }); },
  });
}
function editPack(o) {
  const d = o ? { ...o } : { gid: '', prod: '', qty: '', unit: '', due: '', cid: '', cust: ui.cust || '', note: '', date: today(), steps: {} };
  modal({
    title: o ? '修改包裝排程' : '新增包裝排程', width: 620,
    body: `<div class="grid">
      <div class="f" style="grid-column:1/-1"><label for="pk-prod">商品</label><div class="combo"><input id="pk-prod" value="${esc(d.gid ? goodsLabel(store.get('goods', d.gid) || { name: d.prod }) : d.prod)}" placeholder="打料號、品名或規格搜尋"></div><div class="muted small" id="pk-ginfo"></div></div>
      <div class="f"><label for="pk-qty">數量</label><input id="pk-qty" class="num" inputmode="decimal" value="${esc(d.qty)}"></div><div class="f"><label for="pk-unit">單位</label><input id="pk-unit" value="${esc(d.unit || '')}" placeholder="PCS" list="pk-units"><datalist id="pk-units"><option value="PCS"><option value="包"><option value="盒"><option value="箱"><option value="KG"></datalist></div>
      <div class="f"><label for="pk-due">預交日期</label><input type="date" id="pk-due" value="${esc(d.due || '')}"></div><div class="f"><label for="pk-cust">客戶</label><div class="combo"><input id="pk-cust" value="${esc(d.cid ? cshort(d.cid) : d.cust || '')}" placeholder="搜尋客戶或直接輸入"></div></div>
      <div class="f" style="grid-column:1/-1"><label for="pk-note">備註（選填）</label><input id="pk-note" value="${esc(d.note || '')}" placeholder="例如 每包 100 支、貼客戶標籤"></div></div>
      ${o ? `<div class="f" style="margin-top:10px"><label>包裝紀錄（員工在 App、平板「包裝排程」登記的；這裡也可以補登、刪除）</label><div id="pk-logs"></div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><input id="pk-ln" class="num" inputmode="decimal" placeholder="補登數量" style="width:130px"><button type="button" class="btn" id="pk-ladd">＋ 補登一筆</button><span class="muted small">時間記現在</span></div></div>` : ''}<div class="err" id="pk-err"></div>`,
    footer: `${o ? '<button class="btn danger" id="pk-del">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button>${o ? '' : '<button class="btn" id="pk-next" title="存好以後留在這個視窗，客戶和預交日期留著，繼續加下一個商品">儲存，再加一筆</button>'}<button class="btn pri" id="pk-ok">儲存</button>`,
    onOpen(el, close) {
      let gid = d.gid || '', cid = d.cid || ''; let gtxt = $('#pk-prod', el).value, ctxt = $('#pk-cust', el).value;
      const ginfo = () => { const g = gid ? store.get('goods', gid) : null; const box = $('#pk-ginfo', el); box.innerHTML = g ? `目前庫存 ${stockBtn(g.id, Object.values(calc().stock[g.id] || {}).reduce((a, b) => a + b, 0))} ${esc(g.unit || '')}（點數字可以調整）` : ''; bindStockBtns(box, ginfo); };
      combo($('#pk-prod', el), { items: () => store.list('goods').map(g => ({ id: g.id, label: goodsLabel(g), sub: g.unit || '', text: goodsLabel(g) + ' ' + (g.vcode || '') + ' ' + (g.alias || '') })), allowFree: true,
        onPick: it => { gid = it.id; gtxt = $('#pk-prod', el).value; const g = store.get('goods', gid); if (g && !$('#pk-unit', el).value.trim()) $('#pk-unit', el).value = g.unit || 'PCS'; ginfo(); setTimeout(() => $('#pk-qty', el).focus(), 0); } });
      combo($('#pk-cust', el), { items: () => customers().map(c => ({ id: c.id, label: c.short || c.name, sub: c.name, text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { cid = it.id; ctxt = $('#pk-cust', el).value; } });
      ginfo();
      d.logs = [...(d.logs || [])];
      const drawLogs = () => { const box = $('#pk-logs', el); if (!box) return; const got = packed(d); box.innerHTML = d.logs.length ? `<table class="mini"><tbody>${d.logs.map((l, i) => `<tr><td class="nowrap">${esc(logTime(l))}</td><td class="n"><b>${fmtQ(num(l.qty))}</b> ${esc(d.unit || '')}</td><td>${esc(l.by || '')}</td><td><button type="button" class="btn xs danger" data-ldel="${i}">刪除</button></td></tr>`).join('')}</tbody></table><div class="muted small">已包合計 ${fmtQ(got)}${num(d.qty) ? `／${fmtQ(num(d.qty))}，還剩 ${fmtQ(Math.max(0, +(num(d.qty) - got).toPrecision(10)))}` : ''}</div>` : '<span class="muted small">還沒有登記</span>';
        box.querySelectorAll('[data-ldel]').forEach(b => b.onclick = () => { d.logs.splice(+b.dataset.ldel, 1); drawLogs(); }); };
      drawLogs();
      $('#pk-ladd', el)?.addEventListener('click', () => { const v = num($('#pk-ln', el).value); if (!(v > 0)) return toast('先填補登的數量'); d.logs.push({ qty: v, at: new Date().toISOString(), date: today(), by: store.user?.name || '' }); $('#pk-ln', el).value = ''; drawLogs(); });
      const save = async again => {
        const prod = $('#pk-prod', el).value.trim(), cust = $('#pk-cust', el).value.trim(); const err = $('#pk-err', el); err.textContent = '';
        if (prod !== gtxt.trim()) gid = '';   // 選好以後又改了字：當成自己打的品名
        if (cust !== ctxt.trim()) cid = '';
        const qty = $('#pk-qty', el).value.trim().replace(/,/g, '');
        if (!prod) { err.textContent = '請選商品'; return; }
        if (!(parseFloat(qty) > 0)) { err.textContent = '請填數量'; return; }
        if (!$('#pk-due', el).value) { err.textContent = '請填預交日期'; return; }
        const g = gid ? store.get('goods', gid) : null;
        const out = { ...d, gid, prod: g ? g.name : prod, qty, unit: $('#pk-unit', el).value.trim() || g?.unit || 'PCS', due: $('#pk-due', el).value, cid, cust: cid ? (store.get('contacts', cid)?.name || cust) : cust, note: $('#pk-note', el).value.trim(), date: d.date || today(), steps: d.steps || {}, ...(d.logs.length || o?.logs ? { logs: d.logs } : {}), created: d.created || new Date().toISOString() }; delete out.id;
        try { await store.save('packs', o ? o.id : uid('pk'), out); } catch (e) { err.textContent = saveErr(e); return; }
        toast('已儲存');
        if (!again) return close();
        gid = ''; gtxt = ''; $('#pk-prod', el).value = ''; $('#pk-qty', el).value = ''; $('#pk-unit', el).value = ''; $('#pk-note', el).value = ''; ginfo(); $('#pk-prod', el).focus();
      };
      $('#pk-ok', el).onclick = () => save(false);
      $('#pk-next', el)?.addEventListener('click', () => save(true));
      $('#pk-del', el)?.addEventListener('click', async () => { if (await confirm(`刪除這筆包裝排程？\n${pname(o)}　${o.qty} ${o.unit || ''}`, { danger: true, ok: '刪除' })) { await store.remove('packs', o.id); close(); } });
    },
  });
}
