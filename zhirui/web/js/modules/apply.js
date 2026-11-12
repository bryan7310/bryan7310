// 待確認匯入：Claude 整理好的資料（web/pending/<名稱>.json）先預覽，使用者按「確認寫入」才用自己的帳號寫入。
// 網址：#apply?f=<名稱>。不在側邊選單顯示；寫入後資料檔會被移除。
// 資料可含：newgoods（新建商品）、wt（補單重）、bills（新建進貨單）、updates（修改既有資料：{col,id,label,from,set}）、
// dwgs（商品掛客戶圖面：{gid,label,file,name,why}，file 是 web/pending 底下的圖檔）、
// newwh（新建倉庫：{name}，同名已有就沿用）、kits（螺絲包配方：{gid,label,bom:[{gid|code,qty,cust}],labor,cwh(客供倉名稱),custName}）、
// merges（商品合併：{keep,merge:[gid],why}；伺服器 /api/goods/merge 一次做完，單據與舊系統歷史單據改掛保留的料號）
import { $, esc, fmt, fmtQ, fp4, slash, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, totals, nextNo, defWh, cname } from '../core/calc.js';
import { toast, confirm } from '../core/ui.js';
import { api } from '../core/api.js';
import { resetHistCache } from './_bills.js';

export default {
  id: 'apply', name: '待確認匯入', icon: 'plus', hidden: true,
  render(el, { params }) { draw(el, String(params.f || '')); },
};

const FIELD = { date: '日期', no: '單號', note: '備註', name: '品名', code: '料號', cat: '類別', oldCodes: '舊料號' };
const show = (k, v) => k === 'date' ? slash(v) : Array.isArray(v) ? v.join('、') : String(v ?? '');
async function draw(el, f) {
  el.innerHTML = '<div class="head"><h1>待確認匯入</h1></div><div class="panel"><div class="muted">載入中…</div></div>';
  if (!/^[\w-]+$/.test(f)) { el.querySelector('.panel').innerHTML = '<div class="banner">網址少了資料名稱</div>'; return; }
  let P;
  try { const r = await fetch('/pending/' + f + '.json', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status === 404 ? '找不到這份資料（可能已經寫入並移除了）' : 'HTTP ' + r.status); P = await r.json(); }
  catch (e) { el.querySelector('.panel').innerHTML = `<div class="banner">${esc(e.message)}</div>`; return; }
  const C = calc(); const goods = store.list('goods');
  const errs = [];
  for (const g of P.newgoods || []) if (goods.some(x => x.code === g.code)) errs.push(`新商品料號 ${g.code} 已經存在`);
  for (const b of P.bills || []) { if (!C.ct[b.sup]) errs.push(`找不到廠商 ${b.sup}`); for (const l of b.lines) if (l.gid && !C.g[l.gid]) errs.push(`找不到商品 ${l.code}`); }
  // 同一張對帳單已經寫過（備註相同、同廠商的進貨單）就擋下，避免重複
  const dup = (P.bills || []).filter(b => store.list('bills').some(x => x.type === 'PUR' && x.cid === b.sup && x.note === b.note));
  if (dup.length) errs.push(`有 ${dup.length} 張進貨單已經建立過（備註相同），不能重複寫入`);
  // 修改既有資料：目前的值要跟 from 一樣才改（已經改過或被別人改過就擋下）
  // P.skipChanged：大批修改時，找不到／已改過／被別人改過的那幾筆略過就好，不擋整批
  const upSkip = [];
  for (const u of P.updates || []) {
    const doc = store.get(u.col, u.id); const keys = Object.keys(u.set);
    const eq = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    const why = !doc ? '找不到' : keys.every(k => eq(doc[k], u.set[k])) ? '已經改過了' : keys.some(k => k in u.from ? !eq(doc[k], u.from[k]) : false) ? '目前的內容和預期不同' : '';
    if (!why) continue;
    if (P.skipChanged) upSkip.push({ u, why }); else errs.push(`${u.label} ${why}${why === '目前的內容和預期不同' ? '，請重新確認' : ''}`);
  }
  const upTodo = (P.updates || []).filter(u => !upSkip.some(x => x.u === u));
  if (P.updates?.length && P.skipChanged && !upTodo.length) errs.push('這些資料都已經改過了');
  // 掛圖面：商品已經有同名圖面＝先前寫過（略過）；有別的圖面就擋下，不覆蓋
  const dwDone = new Set();
  for (const d of P.dwgs || []) {
    const g = C.g[d.gid];
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(d.file || '') || d.file.includes('..')) errs.push(`${d.label} 的圖檔路徑不正確`);
    else if (!g) errs.push(`找不到商品 ${d.label}`);
    else if (g.dwg && g.dwg.name === d.name) dwDone.add(d.gid);
    else if (g.dwg) errs.push(`${d.label} 已經有圖面（${g.dwg.name}），不會覆蓋`);
  }
  const dwTodo = (P.dwgs || []).filter(d => !dwDone.has(d.gid));
  // 螺絲包配方：商品已經有配方就不覆蓋
  const whByName = n => store.list('warehouses').find(w => w.name === n);
  const newCodes = new Set((P.newgoods || []).map(g => g.code));
  for (const k of P.kits || []) {
    const g = C.g[k.gid]; if (!g) { errs.push(`找不到商品 ${k.label}`); continue; }
    if ((g.bom || []).length) errs.push(`${k.label} 已經有配方，不會覆蓋（要改請到商品資料裡改）`);
    for (const x of k.bom) if (x.gid ? !C.g[x.gid] : !newCodes.has(x.code)) errs.push(`${k.label} 的配方零件 ${x.code || x.gid} 找不到`);
    if (k.cwh && !whByName(k.cwh) && !(P.newwh || []).some(w => w.name === k.cwh)) errs.push(`找不到客供倉 ${k.cwh}`);
  }
  const whTodo = (P.newwh || []).filter(w => !whByName(w.name));
  // 商品合併：保留的料號要在、被併入的料號都要在（已經不在＝合併過了）
  const mgDone = (P.merges || []).filter(m => m.merge.every(o => !C.g[o]) && C.g[m.keep]);
  for (const m of P.merges || []) {
    if (!C.g[m.keep]) errs.push(`找不到要保留的商品 ${m.keepLabel || m.keep}`);
    else if (!mgDone.includes(m) && m.merge.some(o => !C.g[o])) errs.push(`${m.keepLabel || m.keep} 那組有商品已經不在了，請重新整理清單`);
  }
  if (mgDone.length && mgDone.length === (P.merges || []).length) errs.push('這些商品已經合併過了');
  const mgTodo = (P.merges || []).filter(m => !mgDone.includes(m));
  const gLab = id => C.g[id] ? `${C.g[id].code} ${C.g[id].name}` : id;
  const newName = Object.fromEntries((P.newgoods || []).map(g => [g.code, g.name]));
  const gl = l => l.gid ? (C.g[l.gid]?.code + ' ' + C.g[l.gid]?.name) : newName[l.code] ? `${l.code} ${newName[l.code]}（新建）` : (l.n || '');
  const rows = (P.bills || []).map(b => { const t = totals({ lines: b.lines.map(l => ({ qty: l.qty, price: l.price })), tax: b.tax }); return { b, t, ok: t.sub === b.expect[0] && t.tax === b.expect[1] }; });
  const panel = el.querySelector('.panel');
  panel.innerHTML = `<p style="margin-top:0"><b>${esc(P.title || f)}</b></p>
    ${errs.length ? `<div class="banner">${errs.map(esc).join('<br>')}</div>` : ''}
    ${P.newgoods?.length ? `<h3>新建商品（${P.newgoods.length}）</h3><div class="tw"><table><thead><tr><th>料號</th><th>品名</th><th>類別</th><th>單位</th><th class="n">進價</th></tr></thead><tbody>${P.newgoods.map(g => `<tr><td class="mono">${esc(g.code)}</td><td>${esc(g.name)}</td><td>${esc(g.cat)}</td><td>${esc(g.unit)}</td><td class="n">${fp4(g.purPrice)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${P.wt ? `<h3>修改商品</h3><p>${esc(C.g[P.wt.gid]?.code + ' ' + C.g[P.wt.gid]?.name)}：單重填 ${P.wt.wt} g／支</p>` : ''}
    ${P.updates?.length ? (() => { const li = u => `<li>${esc(u.label)}：${Object.keys(u.set).map(k => `${esc(FIELD[k] || k)} ${esc(show(k, u.from[k]))} → <b>${esc(show(k, u.set[k]))}</b>`).join('、')}${u.why ? `<br><span class="muted small">${esc(u.why)}</span>` : ''}</li>`;
      return `<h3>修改既有資料（${upTodo.length}${upSkip.length ? `，另 ${upSkip.length} 筆略過` : ''}）</h3>${P.updatesNote ? `<p class="small muted">${esc(P.updatesNote)}</p>` : ''}<ul>${upTodo.slice(0, 40).map(li).join('')}</ul>${upTodo.length > 40 ? `<details><summary>其餘 ${upTodo.length - 40} 筆（點開看全部）</summary><ul>${upTodo.slice(40).map(li).join('')}</ul></details>` : ''}${upSkip.length ? `<details><summary class="muted">略過 ${upSkip.length} 筆</summary><ul>${upSkip.map(x => `<li>${esc(x.u.label)}：${esc(x.why)}</li>`).join('')}</ul></details>` : ''}`; })() : ''}
    ${P.dwgs?.length ? `<h3>掛客戶圖面（${dwTodo.length}${dwDone.size ? `，另 ${dwDone.size} 個已掛好` : ''}）</h3><div class="tw"><table><thead><tr><th>圖面</th><th>商品</th><th>圖檔</th><th>配對依據</th></tr></thead><tbody>${P.dwgs.map(d => `<tr${dwDone.has(d.gid) ? ' class="muted"' : ''}><td><a href="/pending/${esc(d.file)}" target="_blank" rel="noopener" title="開新分頁看大圖"><img src="/pending/${esc(d.file)}" alt="" loading="lazy" style="width:150px;height:110px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:6px"></a></td><td><b>${esc(C.g[d.gid]?.code || '')}</b><br>${esc(C.g[d.gid]?.name || d.label)}${dwDone.has(d.gid) ? '<br><span class="pill ok">已掛好</span>' : ''}</td><td class="small">${esc(d.name)}</td><td class="small muted">${esc(d.why || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${P.newwh?.length ? `<h3>新建倉庫</h3><ul>${P.newwh.map(w => `<li>${esc(w.name)}${whByName(w.name) ? ' <span class="pill ok">已經有了，沿用</span>' : ''}</li>`).join('')}</ul>` : ''}
    ${(P.kits || []).map(k => `<h3>螺絲包配方：${esc(C.g[k.gid]?.code || '')} ${esc(C.g[k.gid]?.name || k.label)}</h3>
      <p class="small">每包工錢 <b>${fp4(k.labor || 0)}</b> 元${k.laborNote ? `（${esc(k.laborNote)}）` : ''}　客供倉 <b>${esc(k.cwh || '未指定')}</b>${k.custName ? `　客戶品名 <b>${esc(k.custName)}</b>` : ''}</p>
      <div class="tw"><table><thead><tr><th>#</th><th>零件</th><th>來源</th><th class="n">每包</th><th>單位</th><th>說明</th></tr></thead><tbody>${k.bom.map((x, i) => { const g = x.gid ? C.g[x.gid] : (P.newgoods || []).find(n => n.code === x.code); return `<tr><td class="muted">${i + 1}</td><td>${esc(g ? g.code + ' ' + g.name : x.code || x.gid)}${x.gid ? '' : ' <span class="pill blue">新建</span>'}</td><td>${x.cust ? '<span class="pill warn">客供</span>' : '<span class="pill">自備</span>'}</td><td class="n">${fp4(x.qty)}</td><td>${esc(g?.unit || '')}</td><td class="small muted">${esc(x.why || '')}</td></tr>`; }).join('')}</tbody></table></div>`).join('')}
    ${P.merges?.length ? `<h3>合併商品（${mgTodo.length} 組，${mgTodo.reduce((a, m) => a + m.merge.length, 0)} 個料號併入保留的料號）</h3><p class="small muted">被併入的料號會刪除；它的單據、庫存、舊系統歷史單據、配方、對照設定都改掛到保留的料號；保留的料號空白欄位（客料號、售價、成本…）會用被併入的補上。</p>
      <div class="tw"><table><thead><tr><th>#</th><th>保留</th><th>併入（會刪除）</th><th>差在哪</th></tr></thead><tbody>${P.merges.map((m, i) => `<tr${mgDone.includes(m) ? ' class="muted"' : ''}><td class="muted">${i + 1}</td><td><b>${esc(gLab(m.keep))}</b>${C.g[m.keep]?.spec ? `<br><span class="small muted">客料號 ${esc(C.g[m.keep].spec)}</span>` : ''}</td><td>${m.merge.map(o => esc(C.g[o] ? gLab(o) : (m.labels?.[o] || o) + '（已併入）') + (C.g[o]?.spec ? `<br><span class="small muted">客料號 ${esc(C.g[o].spec)}</span>` : '')).join('<br>')}</td><td class="small">${esc(m.why || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${rows.length ? `<h3>進貨單（${rows.length}）</h3>` : ''}
    ${rows.map(({ b, t, ok }, i) => `<details class="panel" style="padding:8px 12px;margin:6px 0"><summary><b>${esc(cname(b.sup))}</b>　${esc(slash(b.date))}　合計 ${fmt(t.sub)}　稅 ${fmt(t.tax)}　總額 <b>${fmt(t.total)}</b>　${ok ? '<span class="pill ok">與對帳單一致</span>' : '<span class="pill bad">與對帳單不符</span>'}</summary>
      <p class="muted small">${esc(b.note)}</p>
      <div class="tw"><table><thead><tr><th>#</th><th>商品</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th class="n">金額</th><th>備註</th></tr></thead><tbody>${b.lines.map((l, k) => `<tr><td class="muted">${k + 1}</td><td>${esc(gl(l))}</td><td class="n">${fmtQ(l.qty)}</td><td>${esc(l.u || (l.gid ? C.g[l.gid]?.unit : P.newgoods.find(g => g.code === l.code)?.unit) || '')}</td><td class="n">${fp4(l.price)}</td><td class="n">${fmt(Math.round(l.qty * l.price + 1e-9))}</td><td class="small">${esc(l.memo || '')}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}
    <div class="tools" style="margin-top:12px"><span class="muted small">按下之前不會寫入任何資料。</span><span class="sp"></span><button class="btn pri" id="apGo" ${errs.length || rows.some(r => !r.ok) ? 'disabled' : ''}>確認寫入</button></div>
    <div id="apOut"></div>`;
  $('#apGo', el)?.addEventListener('click', async ev => {
    const what = [P.newgoods?.length ? `新建 ${P.newgoods.length} 個商品` : '', P.wt ? '修改 1 個商品' : '', rows.length ? `建立 ${rows.length} 張進貨單` : '', upTodo.length ? `修改 ${upTodo.length} 筆資料` : '', dwTodo.length ? `掛 ${dwTodo.length} 張客戶圖面` : '', whTodo.length ? `新建 ${whTodo.length} 個倉庫` : '', P.kits?.length ? `設定 ${P.kits.length} 個螺絲包配方` : '', mgTodo.length ? `合併 ${mgTodo.length} 組商品（${mgTodo.reduce((a, m) => a + m.merge.length, 0)} 個料號會刪除，無法一鍵復原；每天的自動備份仍可還原）` : ''].filter(Boolean).join('、');
    if (!await confirm(`確定寫入？\n${what}。`, { ok: '確認寫入' })) return;
    ev.target.disabled = true; ev.target.textContent = '寫入中…';
    const out = $('#apOut', el);
    try {
      const ops = []; const newId = {};
      for (const g of P.newgoods || []) { const id = uid('g'); newId[g.code] = id; ops.push({ col: 'goods', id, data: { code: g.code, name: g.name, spec: '', vcode: g.vcode || '', cat: g.cat, unit: g.unit, salePrice: 0, purPrice: g.purPrice, cost: 0, safety: 0, note: g.note || P.goodsNote || '' } }); }
      const whId = {}; for (const w of P.newwh || []) { const ex = whByName(w.name); if (ex) whId[w.name] = ex.id; else { const id = uid('w'); whId[w.name] = id; ops.push({ col: 'warehouses', id, data: { name: w.name } }); } }
      for (const k of P.kits || []) {
        const d = { ...store.get('goods', k.gid) }; delete d.id;
        d.bom = k.bom.map(x => ({ gid: x.gid || newId[x.code], qty: +x.qty, ...(x.cust ? { cust: true } : {}) }));
        if (+k.labor) d.labor = +k.labor;
        const cw = k.cwh && (whId[k.cwh] || whByName(k.cwh)?.id); if (cw) d.cwid = cw;
        if (k.custName && !d.custName) d.custName = k.custName;
        ops.push({ col: 'goods', id: k.gid, data: d });
      }
      if (P.wt) { const w = { ...store.get('goods', P.wt.gid) }; delete w.id; w.wt = P.wt.wt; ops.push({ col: 'goods', id: P.wt.gid, data: w }); }
      for (const u of upTodo) { const d = { ...store.get(u.col, u.id), ...u.set, updatedAt: Date.now(), updatedBy: store.user.id }; delete d.id; ops.push({ col: u.col, id: u.id, data: d }); }
      if (ops.length) await store.batch(ops);
      for (const w of whTodo) store.log('新增', `倉庫 ${w.name}（${P.title || f}）`);
      for (const k of P.kits || []) store.log('修改', `商品 ${k.label}：設定螺絲包配方 ${k.bom.length} 項（${P.title || f}）`);
      if (upTodo.length > 20) store.log('修改', `${P.title || f}：${upTodo.length} 筆（例如 ${upTodo.slice(0, 3).map(u => `${u.label} → ${Object.values(u.set).join(' ')}`).join('；')}）`);
      else for (const u of upTodo) store.log('修改', `${u.label}：${Object.keys(u.set).map(k => `${FIELD[k] || k} ${show(k, u.from[k])} → ${show(k, u.set[k])}`).join('、')}`);
      let mg = null;
      if (mgTodo.length) {
        mg = await api.post('/api/goods/merge', { groups: mgTodo.map(m => ({ keep: m.keep, merge: m.merge })) });
        for (const m of mgTodo) store.log('合併', `商品 ${gLab(m.keep)} ← ${m.merge.map(gLab).join('、')}（${P.title || f}）`);
        try { const st = await api.status(); resetHistCache(st.histVer); } catch (e) { resetHistCache(); }
      }
      let dwN = 0;
      for (const d of dwTodo) {
        const fr = await fetch('/pending/' + d.file, { cache: 'no-store' }); if (!fr.ok) throw new Error(`${d.label} 的圖檔讀不到（HTTP ${fr.status}）`);
        const body = await fr.blob(); let r;
        for (let k = 0; k < 3; k++) { r = await fetch('/api/files?name=' + encodeURIComponent(d.name), { method: 'POST', body, credentials: 'same-origin' }); if (r.status !== 401) break; await new Promise(ok => setTimeout(ok, 600)); }
        const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(`${d.label} 上傳失敗：${j.error || 'HTTP ' + r.status}`);
        const g = { ...store.get('goods', d.gid), dwg: { id: j.id, name: j.name, type: j.type, size: j.size, at: Date.now() } }; delete g.id;
        await store.save('goods', d.gid, g); store.log('上傳圖面', `商品「${g.name}」${j.name}（${P.title || f}）`); dwN++;
      }
      const wid = defWh()?.id || ''; const aid = store.list('accounts')[0]?.id || ''; const made = [];
      for (const b of P.bills || []) {
        const lines = b.lines.map(l => { const o = { gid: l.gid || newId[l.code] || '', qty: l.qty, price: l.price }; if (!o.gid) o.n = l.n || l.code; if (l.u) o.u = l.u; if (l.memo) o.memo = l.memo; return o; });
        const no = nextNo('PUR', b.date); const id = uid('b');
        const doc = { type: 'PUR', no, date: b.date, note: b.note, createdAt: Date.now(), updatedAt: Date.now(), cid: b.sup, wid, lines, disc: 0, tax: !!b.tax, paid: 0, aid, createdBy: store.user.id };
        await store.save('bills', id, doc);
        const t = totals(doc); made.push({ no, b, t, ok: t.sub === b.expect[0] && t.tax === b.expect[1] });
        store.log('新增', `進貨單 ${no}｜${cname(b.sup)}｜${fmt(t.total)} 元（${P.title || f}）`);
      }
      out.innerHTML = `<div class="banner info" style="margin-top:12px">已寫入。${upTodo.length ? (upTodo.length > 40 ? `<br>已修改 ${upTodo.length} 筆` : `<br>已修改：${upTodo.map(u => esc(u.label)).join('、')}`) : ''}${dwN ? `<br>已掛客戶圖面 ${dwN} 張` : ''}${whTodo.length ? `<br>已新建倉庫：${whTodo.map(w => esc(w.name)).join('、')}` : ''}${P.kits?.length ? `<br>已設定配方：${P.kits.map(k => esc(k.label)).join('、')}` : ''}${mg ? `<br>已合併商品 ${mg.keeps} 組、刪除 ${mg.merged} 個料號；改掛單據 ${Object.values(mg.moved || {}).reduce((a, b) => a + b, 0)} 筆、舊系統歷史單據 ${mg.hist} 張` : ''}${made.length ? '<br>進貨單：<br>' : ''}${made.map(m => `${esc(m.no)}　${esc(cname(m.b.sup))}　合計 ${fmt(m.t.sub)}　稅 ${fmt(m.t.tax)}　總額 ${fmt(m.t.total)}　${m.ok ? '✓' : '✗ 與對帳單不符'}`).join('<br>')}</div>`;
      ev.target.textContent = '已寫入'; toast('已寫入');
    } catch (e) { out.innerHTML = `<div class="banner">寫入中斷：${esc(e.message)}。請把這個畫面截圖給 Claude，不要再按一次。</div>`; ev.target.textContent = '已中斷'; }
  });
}
