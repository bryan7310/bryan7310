// 待確認匯入：Claude 整理好的資料（web/pending/<名稱>.json）先預覽，使用者按「確認寫入」才用自己的帳號寫入。
// 網址：#apply?f=<名稱>。不在側邊選單顯示；寫入後資料檔會被移除。
// 資料可含：newgoods（新建商品）、wt（補單重）、bills（新建進貨單）、updates（修改既有資料：{col,id,label,from,set}）
import { $, esc, fmt, fmtQ, fp4, slash, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, totals, nextNo, defWh, cname } from '../core/calc.js';
import { toast, confirm } from '../core/ui.js';

export default {
  id: 'apply', name: '待確認匯入', icon: 'plus', hidden: true,
  render(el, { params }) { draw(el, String(params.f || '')); },
};

const FIELD = { date: '日期', no: '單號', note: '備註' };
const show = (k, v) => k === 'date' ? slash(v) : String(v ?? '');
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
  for (const u of P.updates || []) {
    const doc = store.get(u.col, u.id); if (!doc) { errs.push(`找不到 ${u.label}`); continue; }
    const keys = Object.keys(u.set);
    if (keys.every(k => doc[k] === u.set[k])) errs.push(`${u.label} 已經改過了`);
    else if (keys.some(k => doc[k] !== u.from[k])) errs.push(`${u.label} 目前的內容和預期不同，請重新確認`);
  }
  const newName = Object.fromEntries((P.newgoods || []).map(g => [g.code, g.name]));
  const gl = l => l.gid ? (C.g[l.gid]?.code + ' ' + C.g[l.gid]?.name) : newName[l.code] ? `${l.code} ${newName[l.code]}（新建）` : (l.n || '');
  const rows = (P.bills || []).map(b => { const t = totals({ lines: b.lines.map(l => ({ qty: l.qty, price: l.price })), tax: b.tax }); return { b, t, ok: t.sub === b.expect[0] && t.tax === b.expect[1] }; });
  const panel = el.querySelector('.panel');
  panel.innerHTML = `<p style="margin-top:0"><b>${esc(P.title || f)}</b></p>
    ${errs.length ? `<div class="banner">${errs.map(esc).join('<br>')}</div>` : ''}
    ${P.newgoods?.length ? `<h3>新建商品（${P.newgoods.length}）</h3><div class="tw"><table><thead><tr><th>料號</th><th>品名</th><th>類別</th><th>單位</th><th class="n">進價</th></tr></thead><tbody>${P.newgoods.map(g => `<tr><td class="mono">${esc(g.code)}</td><td>${esc(g.name)}</td><td>${esc(g.cat)}</td><td>${esc(g.unit)}</td><td class="n">${fp4(g.purPrice)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${P.wt ? `<h3>修改商品</h3><p>${esc(C.g[P.wt.gid]?.code + ' ' + C.g[P.wt.gid]?.name)}：單重填 ${P.wt.wt} g／支</p>` : ''}
    ${P.updates?.length ? `<h3>修改既有資料（${P.updates.length}）</h3><ul>${P.updates.map(u => `<li>${esc(u.label)}：${Object.keys(u.set).map(k => `${esc(FIELD[k] || k)} ${esc(show(k, u.from[k]))} → <b>${esc(show(k, u.set[k]))}</b>`).join('、')}${u.why ? `<br><span class="muted small">${esc(u.why)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${rows.length ? `<h3>進貨單（${rows.length}）</h3>` : ''}
    ${rows.map(({ b, t, ok }, i) => `<details class="panel" style="padding:8px 12px;margin:6px 0"><summary><b>${esc(cname(b.sup))}</b>　${esc(slash(b.date))}　合計 ${fmt(t.sub)}　稅 ${fmt(t.tax)}　總額 <b>${fmt(t.total)}</b>　${ok ? '<span class="pill ok">與對帳單一致</span>' : '<span class="pill bad">與對帳單不符</span>'}</summary>
      <p class="muted small">${esc(b.note)}</p>
      <div class="tw"><table><thead><tr><th>#</th><th>商品</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th class="n">金額</th><th>備註</th></tr></thead><tbody>${b.lines.map((l, k) => `<tr><td class="muted">${k + 1}</td><td>${esc(gl(l))}</td><td class="n">${fmtQ(l.qty)}</td><td>${esc(l.u || (l.gid ? C.g[l.gid]?.unit : P.newgoods.find(g => g.code === l.code)?.unit) || '')}</td><td class="n">${fp4(l.price)}</td><td class="n">${fmt(Math.round(l.qty * l.price + 1e-9))}</td><td class="small">${esc(l.memo || '')}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}
    <div class="tools" style="margin-top:12px"><span class="muted small">按下之前不會寫入任何資料。</span><span class="sp"></span><button class="btn pri" id="apGo" ${errs.length || rows.some(r => !r.ok) ? 'disabled' : ''}>確認寫入</button></div>
    <div id="apOut"></div>`;
  $('#apGo', el)?.addEventListener('click', async ev => {
    const what = [P.newgoods?.length ? `新建 ${P.newgoods.length} 個商品` : '', P.wt ? '修改 1 個商品' : '', rows.length ? `建立 ${rows.length} 張進貨單` : '', P.updates?.length ? `修改 ${P.updates.length} 筆資料` : ''].filter(Boolean).join('、');
    if (!await confirm(`確定寫入？\n${what}。`, { ok: '確認寫入' })) return;
    ev.target.disabled = true; ev.target.textContent = '寫入中…';
    const out = $('#apOut', el);
    try {
      const ops = []; const newId = {};
      for (const g of P.newgoods || []) { const id = uid('g'); newId[g.code] = id; ops.push({ col: 'goods', id, data: { code: g.code, name: g.name, spec: '', vcode: '', cat: g.cat, unit: g.unit, salePrice: 0, purPrice: g.purPrice, cost: 0, safety: 0, note: P.goodsNote || '' } }); }
      if (P.wt) { const w = { ...store.get('goods', P.wt.gid) }; delete w.id; w.wt = P.wt.wt; ops.push({ col: 'goods', id: P.wt.gid, data: w }); }
      for (const u of P.updates || []) { const d = { ...store.get(u.col, u.id), ...u.set, updatedAt: Date.now(), updatedBy: store.user.id }; delete d.id; ops.push({ col: u.col, id: u.id, data: d }); }
      if (ops.length) await store.batch(ops);
      for (const u of P.updates || []) store.log('修改', `${u.label}：${Object.keys(u.set).map(k => `${FIELD[k] || k} ${show(k, u.from[k])} → ${show(k, u.set[k])}`).join('、')}`);
      const wid = defWh()?.id || ''; const aid = store.list('accounts')[0]?.id || ''; const made = [];
      for (const b of P.bills || []) {
        const lines = b.lines.map(l => { const o = { gid: l.gid || newId[l.code] || '', qty: l.qty, price: l.price }; if (!o.gid) o.n = l.n || l.code; if (l.u) o.u = l.u; if (l.memo) o.memo = l.memo; return o; });
        const no = nextNo('PUR', b.date); const id = uid('b');
        const doc = { type: 'PUR', no, date: b.date, note: b.note, createdAt: Date.now(), updatedAt: Date.now(), cid: b.sup, wid, lines, disc: 0, tax: !!b.tax, paid: 0, aid, createdBy: store.user.id };
        await store.save('bills', id, doc);
        const t = totals(doc); made.push({ no, b, t, ok: t.sub === b.expect[0] && t.tax === b.expect[1] });
        store.log('新增', `進貨單 ${no}｜${cname(b.sup)}｜${fmt(t.total)} 元（${P.title || f}）`);
      }
      out.innerHTML = `<div class="banner info" style="margin-top:12px">已寫入。${P.updates?.length ? `<br>已修改：${P.updates.map(u => esc(u.label)).join('、')}` : ''}${made.length ? '<br>進貨單：<br>' : ''}${made.map(m => `${esc(m.no)}　${esc(cname(m.b.sup))}　合計 ${fmt(m.t.sub)}　稅 ${fmt(m.t.tax)}　總額 ${fmt(m.t.total)}　${m.ok ? '✓' : '✗ 與對帳單不符'}`).join('<br>')}</div>`;
      ev.target.textContent = '已寫入'; toast('已寫入');
    } catch (e) { out.innerHTML = `<div class="banner">寫入中斷：${esc(e.message)}。請把這個畫面截圖給 Claude，不要再按一次。</div>`; ev.target.textContent = '已中斷'; }
  });
}
