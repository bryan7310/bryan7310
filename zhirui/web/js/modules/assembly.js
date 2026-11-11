// 螺絲包（組合品）：商品的「配方」區塊、組包單
// 配方存在商品上：goods.bom = [{ gid, qty(每包), cust(客供) }]、goods.labor(每包工錢)、goods.cwid(預設客供倉)
// 組包單 bills.type='ASM'：kit {gid, qty}、wid(自備零件扣這倉、成品入這倉)、cwid(客供倉)、lines 零件總數量（存檔當下依配方展開）
import { $, esc, fmt, fmtQ, fp4, uid, today, parseNum } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, combo } from '../core/ui.js';
import { calc, goodsLabel, nextNo, defWh, bomCost, wname } from '../core/calc.js';

const goodsItems = () => store.list('goods').map(g => ({ id: g.id, label: goodsLabel(g), sub: g.unit || '', text: goodsLabel(g) + ' ' + (g.spec2 || '') + ' ' + (g.custName || '') }));
const whOpts = (sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + store.list('warehouses').map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
const qAt = (gid, wid) => ((calc().stock[gid] || {})[wid] || 0);

// ---------- 商品資料：配方區塊 ----------
export function bomHTML(d) {
  const has = (d.bom || []).length > 0;
  return `<details class="spbox bombox" id="bomBox" ${has ? 'open' : ''}><summary><b>配方（螺絲包／組合品）</b> <span class="muted small">這個商品是用哪些零件包成的；開「組包單」時依配方扣零件庫存</span></summary>
    <div class="tw"><table class="bomt"><thead><tr><th style="width:44px">#</th><th>零件</th><th class="n" style="width:110px">每包數量</th><th style="width:70px">客供</th><th class="n" style="width:110px">庫存</th><th style="width:40px"></th></tr></thead><tbody id="bomRows"></tbody></table></div>
    <div class="tools" style="gap:12px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn sm" id="bomAdd">＋ 加零件</button>
      <label class="small">工錢（每包，算成本用）<input id="bomLabor" class="num" inputmode="decimal" style="width:90px" value="${esc(d.labor || '')}"></label>
      <label class="small">客供倉 <select id="bomCwid">${whOpts(d.cwid, '（未指定）')}</select></label>
      <span class="muted small" id="bomCost"></span></div>
    <div class="muted small" style="margin-top:4px">包材（塑膠袋、外袋）也當成一項零件加進來；客供件打勾，組包時從客供倉扣、不算成本。</div>
  </details>`;
}
/** 綁定配方區塊；回傳 read() 取得 { bom, labor, cwid } */
export function bomBind(el, d) {
  const rows = (d.bom || []).map(x => ({ ...x }));
  const tb = $('#bomRows', el), costEl = $('#bomCost', el);
  const showCost = () => {
    const C = calc(); const g = { ...d, bom: rows.filter(r => r.gid && +r.qty > 0), labor: parseNum($('#bomLabor', el).value) || 0 };
    if (!g.bom.length) { costEl.textContent = ''; return; }
    const r = bomCost(g, today(), C.purIdx, C.g, C.poIdx);
    costEl.textContent = `每包成本約 ${fp4(r.c)} 元（自備 ${r.n} 項${r.miss ? `，${r.miss} 項查不到成本` : ''}；客供 ${g.bom.filter(x => x.cust).length} 項不算）`;
  };
  const draw = () => {
    const cw = $('#bomCwid', el).value; const wid = defWh()?.id;
    tb.innerHTML = rows.map((r, i) => { const g = r.gid && store.get('goods', r.gid);
      const st = g ? (r.cust ? (cw ? `${fmtQ(qAt(r.gid, cw))}<div class="muted small">${esc(wname(cw))}</div>` : '<span class="muted small">未指定客供倉</span>') : fmtQ(qAt(r.gid, wid))) : '';
      return `<tr data-i="${i}"><td class="muted">${i + 1}</td><td><div class="combo"><input data-g="${i}" value="${esc(g ? goodsLabel(g) : '')}" placeholder="打料號、品名搜尋"></div></td><td><input data-q="${i}" class="num" inputmode="decimal" value="${esc(r.qty ?? '')}" style="width:100%">${g ? `<div class="muted small" style="text-align:right">${esc(g.unit || '')}</div>` : ''}</td><td style="text-align:center"><input type="checkbox" data-c="${i}" ${r.cust ? 'checked' : ''}></td><td class="n">${st}</td><td><button type="button" class="icon-btn" data-x="${i}" title="刪除這一行">✕</button></td></tr>`; }).join('')
      || '<tr><td colspan="6" class="muted">還沒有零件。按「＋ 加零件」開始。</td></tr>';
    tb.querySelectorAll('[data-g]').forEach(inp => { const i = +inp.dataset.g; combo(inp, { items: goodsItems, minWidth: 420, onPick: it => { if (it.id === d.id) return toast('不能把自己放進配方'); rows[i].gid = it.id; draw(); tb.querySelector(`[data-q="${i}"]`)?.focus(); } }); });
    tb.querySelectorAll('[data-q]').forEach(inp => inp.addEventListener('input', () => { rows[+inp.dataset.q].qty = parseNum(inp.value) || ''; showCost(); }));
    tb.querySelectorAll('[data-c]').forEach(cb => cb.addEventListener('change', () => { rows[+cb.dataset.c].cust = cb.checked; draw(); }));
    tb.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => { rows.splice(+b.dataset.x, 1); draw(); }));
    showCost();
  };
  $('#bomAdd', el).addEventListener('click', () => { rows.push({ gid: '', qty: '' }); $('#bomBox', el).open = true; draw(); tb.querySelector(`[data-g="${rows.length - 1}"]`)?.focus(); });
  $('#bomLabor', el).addEventListener('input', showCost);
  $('#bomCwid', el).addEventListener('change', draw);
  draw();
  return () => ({
    bom: rows.filter(r => r.gid && +r.qty > 0).map(r => ({ gid: r.gid, qty: +r.qty, ...(r.cust ? { cust: true } : {}) })),
    labor: parseNum($('#bomLabor', el).value) || 0, cwid: $('#bomCwid', el).value || '',
    bad: rows.filter(r => r.gid && !(+r.qty > 0)).length,
  });
}

// ---------- 組包單 ----------
/** 依配方算 packs 包要用的零件 */
export const expandBom = (kit, packs) => (kit?.bom || []).map(x => ({ gid: x.gid, per: +x.qty || 0, qty: Math.round((+x.qty || 0) * packs * 1e6) / 1e6, ...(x.cust ? { cust: true } : {}) }));

export function asmContent(b) {
  const g = b.kit?.gid && store.get('goods', b.kit.gid);
  return `${esc(g ? goodsLabel(g) : '（成品已刪除）')} × ${fmtQ(b.kit?.qty)}${b.cwid ? ` <span class="muted small">客供倉 ${esc(wname(b.cwid))}</span>` : ''}`;
}

export function openAsm(id, presetGid) {
  const old = id ? store.get('bills', id) : null;
  if (id && !old) return toast('找不到這張組包單');
  const e = old ? JSON.parse(JSON.stringify(old)) : { type: 'ASM', date: today(), no: nextNo('ASM', today()), wid: defWh()?.id || '', cwid: '', kit: { gid: presetGid || '', qty: '' }, lines: [], note: '' };
  if (!old && presetGid) e.cwid = store.get('goods', presetGid)?.cwid || '';
  const kits = () => store.list('goods').filter(g => (g.bom || []).length).map(g => ({ id: g.id, label: goodsLabel(g), sub: `${g.bom.length} 種零件`, text: goodsLabel(g) + ' ' + (g.custName || '') }));
  const kitG = () => e.kit.gid && store.get('goods', e.kit.gid);
  let fresh = !old;   // 舊單沒改數量、成品前，照存檔時的明細顯示
  // 編輯舊單時，可用量要把這張單原本扣掉的加回來
  const back = (gid, wid) => { if (!old) return 0; let q = 0; for (const l of old.lines || []) if (l.gid === gid && (l.cust ? (old.cwid || old.wid) : old.wid) === wid) q += +l.qty || 0; if (old.kit?.gid === gid && old.wid === wid) q -= +old.kit.qty || 0; return q; };
  const avail = (gid, wid) => qAt(gid, wid) + back(gid, wid);
  const body = `<div class="grid">
      <div class="f" style="grid-column:1/-1"><label for="as-kit">成品（有設定配方的商品）</label><div class="combo"><input id="as-kit" value="${esc(kitG() ? goodsLabel(kitG()) : '')}" placeholder="打料號、品名搜尋螺絲包"></div></div>
      <div class="f"><label for="as-qty">組幾包</label><input id="as-qty" class="num" inputmode="decimal" value="${esc(e.kit.qty ?? '')}"></div>
      <div class="f"><label for="as-date">日期</label><input id="as-date" type="date" value="${esc(e.date)}"></div>
      <div class="f"><label for="as-no">單號</label><input id="as-no" value="${esc(e.no)}"></div>
      <div class="f"><label for="as-wid">倉庫（自備零件扣這倉、成品放這倉）</label><select id="as-wid">${whOpts(e.wid)}</select></div>
      <div class="f"><label for="as-cwid">客供倉（客供零件扣這倉）</label><select id="as-cwid">${whOpts(e.cwid, '（未指定）')}</select></div>
      <div class="f" style="grid-column:1/-1"><label for="as-note">備註</label><input id="as-note" value="${esc(e.note || '')}"></div></div>
    <div id="asTbl" style="margin-top:10px"></div><div class="err" id="asErr"></div>`;
  modal({
    title: `${old ? '修改' : '新增'}組包單`, body, width: 900,
    footer: `${old ? '<button class="btn danger" id="asDel">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="asSave">儲存</button>`,
    onOpen(el, close) {
      const tbl = $('#asTbl', el);
      const lines = () => { const k = kitG(); return fresh || !old ? expandBom(k, +e.kit.qty || 0) : (e.lines || []).map(l => ({ ...l, per: l.per ?? (+e.kit.qty ? l.qty / +e.kit.qty : 0) })); };
      const draw = () => {
        const k = kitG(); if (!k) { tbl.innerHTML = '<div class="empty"><b>先選成品</b>只列出有設定配方的商品；配方在「基本資料 → 商品」最下面設定。</div>'; return; }
        const ls = lines(); const packs = +e.kit.qty || 0;
        let maxN = Infinity, limit = '';
        const rows = ls.map((l, i) => {
          const g = store.get('goods', l.gid); const w = l.cust ? e.cwid : e.wid; const have = w ? avail(l.gid, w) : 0; const short = !w || have < l.qty;
          if (l.per > 0) { const n = Math.floor((w ? have : 0) / l.per + 1e-9); if (n < maxN) { maxN = n; limit = g ? goodsLabel(g) : ''; } }
          return `<tr><td class="muted">${i + 1}</td><td>${esc(g ? goodsLabel(g) : '（已刪除商品）')}</td><td>${l.cust ? '<span class="pill warn">客供</span>' : '<span class="pill">自備</span>'}</td><td class="n">${fmtQ(l.per)}</td><td class="n"><b>${fmtQ(l.qty)}</b> <span class="muted small">${esc(g?.unit || '')}</span></td><td class="n">${w ? fmtQ(have) : '<span class="muted small">未指定倉庫</span>'}</td><td class="n" style="${short ? 'color:var(--bad);font-weight:600' : ''}">${w ? fmtQ(have - l.qty) : ''}</td></tr>`;
        }).join('');
        const C = calc(); const bc = bomCost(k, e.date, C.purIdx, C.g, C.poIdx);
        const shortN = ls.filter(l => { const w = l.cust ? e.cwid : e.wid; return !w || avail(l.gid, w) < l.qty; }).length;
        tbl.innerHTML = `<div class="tools" style="gap:12px;flex-wrap:wrap"><span>依目前庫存最多可組 <b>${maxN === Infinity ? '—' : fmtQ(Math.max(0, maxN))}</b> 包${limit && maxN !== Infinity ? `<span class="muted small">（卡在 ${esc(limit)}）</span>` : ''}</span>
            <span class="muted small">每包成本約 ${fp4(bc.c)} 元${bc.miss ? `（${bc.miss} 項查不到成本）` : ''}</span>${!old || fresh ? '' : '<span class="muted small">（顯示存檔時的明細；改數量或成品會依目前配方重算）</span>'}</div>
          <div class="tw" style="margin-top:6px"><table><thead><tr><th>#</th><th>零件</th><th>來源</th><th class="n">每包</th><th class="n">共需</th><th class="n">現有庫存</th><th class="n">組完剩</th></tr></thead><tbody>${rows}</tbody></table></div>
          ${packs > 0 && shortN ? `<div class="banner" style="margin-top:8px">有 ${shortN} 項零件庫存不夠（紅字）。還是可以存檔，庫存會變負數，之後補入庫就會回正。</div>` : ''}
          ${ls.some(l => l.cust) && !e.cwid ? '<div class="banner" style="margin-top:8px">這個螺絲包有客供零件，請選「客供倉」（沒有的話先到「基本資料 → 倉庫」新增，例如「客供－新能」）。</div>' : ''}`;
      };
      combo($('#as-kit', el), { items: kits, minWidth: 460, onPick: it => { e.kit.gid = it.id; fresh = true; const k = kitG(); if (k?.cwid && !e.cwid) { e.cwid = k.cwid; $('#as-cwid', el).value = k.cwid; } draw(); $('#as-qty', el).focus(); } });
      $('#as-qty', el).addEventListener('input', ev => { e.kit.qty = parseNum(ev.target.value) || ''; fresh = true; draw(); });
      $('#as-date', el).addEventListener('change', ev => { e.date = ev.target.value; if (!old) { e.no = nextNo('ASM', e.date); $('#as-no', el).value = e.no; } draw(); });
      $('#as-wid', el).addEventListener('change', ev => { e.wid = ev.target.value; draw(); });
      $('#as-cwid', el).addEventListener('change', ev => { e.cwid = ev.target.value; draw(); });
      draw();
      $('#asSave', el).addEventListener('click', async () => {
        const err = m => { $('#asErr', el).textContent = m; };
        const k = kitG(); const packs = +e.kit.qty || 0; const no = $('#as-no', el).value.trim();
        if (!k) return err('請選成品');
        if (!(packs > 0)) return err('請填組幾包');
        if (!e.date) return err('請填日期');
        if (!no) return err('請填單號');
        if (store.list('bills').some(b => b.no === no && b.id !== id)) return err(`單號 ${no} 已經有了`);
        if (!e.wid) return err('請選倉庫');
        const ls = lines();
        if (ls.some(l => l.cust) && !e.cwid) return err('有客供零件，請選客供倉');
        const shortN = ls.filter(l => avail(l.gid, l.cust ? e.cwid : e.wid) < l.qty).length;
        if (shortN && !await confirm(`有 ${shortN} 項零件庫存不夠，存檔後庫存會變負數。\n確定要存嗎？`, { ok: '仍要存檔' })) return;
        const doc = { type: 'ASM', no, date: e.date, wid: e.wid, kit: { gid: k.id, qty: packs }, lines: ls.map(l => ({ gid: l.gid, qty: l.qty, per: l.per, ...(l.cust ? { cust: true } : {}) })), note: $('#as-note', el).value.trim(), createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() };
        doc.createdBy = old?.createdBy || store.user?.id; if (old) doc.updatedBy = store.user?.id;
        if (e.cwid) doc.cwid = e.cwid;
        if (+k.labor) doc.labor = +k.labor;
        const nid = id || uid('b');
        try { await store.save('bills', nid, doc); } catch (er) { return toast('儲存失敗：' + er.message); }
        store.log(old ? '修改' : '新增', `組包單 ${no}｜${goodsLabel(k)} × ${fmtQ(packs)}`);
        close(); toast('已儲存組包單');
      });
      $('#asDel', el)?.addEventListener('click', async () => {
        if (!await confirm(`確定刪除組包單 ${old.no}？\n零件和成品的庫存會回到組包前。`, { danger: true, ok: '刪除' })) return;
        await store.remove('bills', id); store.log('刪除', `組包單 ${old.no}`); close(); toast('已刪除');
      });
    },
  });
}
