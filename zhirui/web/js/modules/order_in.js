// 訂單自動轉單：客戶傳真、Email 附件或信件內文 → 伺服器用 Claude Haiku 讀出客戶、單號、明細 →
// 這裡對客戶、對商品（客料號、之前選過的、品名規格比對），確認後開成銷貨單或報價單草稿（還沒存，按儲存才算）。
// 同一份文件辨識過會記在伺服器，再開不會重複花錢；「重新辨識」才會再讀一次。
import { esc, fmtQ, fp4, slash, today, toHalf } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { modal, toast, combo } from '../core/ui.js';
import { calc, customers, cdisp, goodsLabel, lastSale, unitPrice } from '../core/calc.js';
import { matchCo } from './faxin.js';
import { piMatch, piUnit } from './purchase_import.js';
import { openBill } from './_bills.js';

const cmap = () => store.setting('cmap').m || {};   // 客戶品項記憶：{cid: {客料號或品名: gid}}
const keyOf = r => String(r.part_no || r.name || '').trim().toUpperCase().replace(/\s+/g, '');
const N = x => String(x ?? '').trim().toUpperCase().replace(/\s+/g, '');
let SPEC = null, SPECgen = -1;
function specIdx() {   // 商品的客料號欄位（spec、spec2）→ 商品
  if (SPEC && SPECgen === store.gen) return SPEC;
  SPEC = new Map(); SPECgen = store.gen;
  for (const g of store.list('goods')) for (const k of [g.spec, g.spec2]) { const n = N(k); if (n.length >= 3) { const a = SPEC.get(n) || SPEC.set(n, []).get(n); a.push(g); } }
  return SPEC;
}
/** 一行辨識結果 → 候選商品（最可能的在前），每個附信心：高／中／低 */
export function matchLine(r, cid) {
  const C = calc(); const out = new Map(); const add = (g, s, why) => { if (!g) return; const o = out.get(g.id); if (!o || o.s < s) out.set(g.id, { g, s, why }); };
  const mem = cid && cmap()[cid]?.[keyOf(r)]; if (mem && C.g[mem]) add(C.g[mem], 300, '之前選過');
  if (r.part_no) for (const g of specIdx().get(N(r.part_no)) || []) add(g, 250, '客料號相同');
  try {
    const m = piMatch({ code: toHalf(r.part_no || ''), name: toHalf([r.name, r.material, r.finish].filter(Boolean).join(' ')), price: +r.price || 0, unit: piUnit(r.unit), date: today() }, null);
    for (const x of m.cands) add(x.o.g, x.s, '品名規格');
  } catch (e) { /* 比對失敗就只用客料號 */ }
  if (cid) for (const o of out.values()) if (o.why === '品名規格' && lastSale(cid, o.g.id)) { o.s += 25; o.why = '品名規格・這個客戶買過'; o.bought = true; }   // 這個客戶買過的加分
  const list = [...out.values()].sort((a, b) => b.s - a.s).slice(0, 6);
  for (const o of list) o.conf = o.s >= 200 || (o.bought && o.s >= 100) ? '高' : o.s >= 60 ? '中' : '低';
  if (list[1] && list[0].s < 200 && list[0].s - list[1].s < 10 && list[0].conf === '高') list[0].conf = '中';
  return list;
}

/** src：{fax: 檔名} 或 {mail: id, n: 附件編號（省略＝內文）}；title：對話框標題用 */
export async function orderFromDoc(src, title, hint) {
  const m = modal({ title: '轉成訂單' + (title ? '｜' + title : ''), width: 1100, closeOnBg: false, body: '<div class="muted" style="padding:20px 0">AI 正在讀這份訂單（約 5～20 秒）…</div>', footer: '<span class="sp"></span><button class="btn" data-close>關閉</button>' });
  let P;
  const load = async again => {
    try { P = await api.post('/api/ocr/order', { ...src, ...(again ? { again: 1 } : {}) }); }
    catch (e) { m.el.querySelector('.mb').innerHTML = `<div class="banner">${esc(e.message || e)}</div>`; return false; }
    return true;
  };
  if (!await load()) return;
  if (!m.el.isConnected) return;
  // 客戶：辨識到的公司名稱、傳真號碼對客戶資料；Email 再用寄件人名稱試
  let co = matchCo(P.buyer, P.buyer_fax); if ((!co || co.kind !== 'C') && hint?.name) { const c2 = matchCo(hint.name, ''); if (c2 && c2.kind === 'C') co = c2; }
  const st = { cid: co && co.kind === 'C' ? co.id : '', rows: [] };
  const build = () => {
    st.rows = (P.lines || []).map(r => {
      const cands = r.cancelled ? [] : matchLine(r, st.cid); const top = cands[0];
      return { r, cands, gid: top && top.conf !== '低' ? top.g.id : '', use: !r.cancelled && +r.qty > 0, qty: +r.qty || '', price: +r.price || '' };
    });
  };
  build();
  const C = () => calc();
  const paint = () => {
    const mb = m.el.querySelector('.mb'); const nOk = st.rows.filter(x => x.use && x.gid).length, nUse = st.rows.filter(x => x.use).length;
    mb.innerHTML = `<div class="grid" style="grid-template-columns:2fr 1fr 1fr 1fr">
        <div class="f"><label for="oiCus">客戶</label><input id="oiCus" value="${esc(st.cid ? cdisp(C().ct[st.cid]) : '')}" placeholder="打客戶名稱搜尋"><div class="muted small">單上寫：${esc(P.buyer || '（看不出來）')}${P.buyer_fax ? '・' + esc(P.buyer_fax) : ''}${P.contact ? '・' + esc(P.contact) : ''}</div></div>
        <div class="f"><label>單別</label><div>${esc(P.doc_type || '—')}</div></div>
        <div class="f"><label>客戶單號</label><div class="mono">${esc(P.po_no || '—')}</div></div>
        <div class="f"><label>單據日期</label><div>${esc(P.po_date ? slash(P.po_date) : '—')}</div></div></div>
      ${P.doubts ? `<div class="banner">AI 不確定的地方：${esc(P.doubts)}</div>` : ''}${P.remark ? `<div class="banner info">整張單備註：${esc(P.remark)}</div>` : ''}
      <div class="tw"><table><thead><tr><th style="width:34px"></th><th>單上寫的（客料號・品名）</th><th style="min-width:300px">對到商品</th><th class="n" style="width:110px">數量</th><th style="width:60px">單位</th><th class="n" style="width:100px">單價</th><th style="width:96px">交期</th></tr></thead><tbody>
      ${st.rows.map((x, i) => { const r = x.r; const g = C().g[x.gid]; const top = x.cands.find(c => c.g.id === x.gid);
        return `<tr ${r.cancelled ? 'style="opacity:.5"' : ''}><td><input type="checkbox" data-use="${i}" ${x.use ? 'checked' : ''} ${r.cancelled ? 'disabled title="單上已取消"' : ''}></td>
          <td>${r.part_no ? `<div class="mono small">${esc(r.part_no)}</div>` : ''}<div>${esc(r.name)}${r.material || r.finish ? ` <span class="muted small">${esc([r.material, r.finish].filter(Boolean).join(' '))}</span>` : ''}</div>${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}${r.cancelled ? '<span class="pill bad">已取消</span>' : ''}</td>
          <td>${r.cancelled ? '' : `<div class="combo"><input data-g="${i}" value="${esc(g ? goodsLabel(g, 'SALE') : '')}" placeholder="${x.cands.length ? '從建議選，或打料號、品名搜尋' : '沒有對到，請打料號、品名搜尋'}"></div>
            <div class="small" style="margin-top:3px">${g && top ? `<span class="pill ${top.conf === '高' ? 'ok' : top.conf === '中' ? 'warn' : 'bad'}">${top.conf}</span> <span class="muted">${esc(top.why)}</span>` : g ? '<span class="pill ok">手選</span>' : '<span class="pill bad">未對到</span>'}
            ${x.cands.filter(c => c.g.id !== x.gid).slice(0, 3).map(c => ` <a href="#" data-alt="${i}" data-gid="${c.g.id}" title="${esc(c.g.name)}">${esc(c.g.code || c.g.name)}</a>`).join('')}</div>`}</td>
          <td><input class="num" data-q="${i}" value="${esc(x.qty)}" inputmode="decimal" style="width:100%"></td><td>${esc(r.unit || '')}</td>
          <td><input class="num" data-p="${i}" value="${esc(x.price)}" inputmode="decimal" placeholder="${(lp => lp ? '上次 ' + fp4(lp.price) : '')(st.cid && x.gid ? lastSale(st.cid, x.gid) : null)}" style="width:100%"></td>
          <td class="small">${esc(r.due ? slash(r.due) : '')}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="muted small">已勾 ${nUse} 項，其中 ${nOk} 項對到商品。單價空白會自動帶這個客戶上次的單價。${P.cached ? '（這份之前辨識過，沒有再花錢）' : P._usd ? `（這次辨識約 NT$${(P._usd * 32).toFixed(2)}）` : ''}</div>`;
    m.el.querySelector('.mf').innerHTML = `<button class="btn" id="oiAgain" title="重新請 AI 讀一次（會再花一次錢）">重新辨識</button><span class="sp"></span><button class="btn" data-close>關閉</button><button class="btn" id="oiQuo" ${nUse ? '' : 'disabled'}>開成報價單</button><button class="btn pri" id="oiSale" ${nUse ? '' : 'disabled'}>開成銷貨單</button>`;
    m.el.querySelector('.mf [data-close]').onclick = () => m.close();
    combo(mb.querySelector('#oiCus'), { items: () => customers().map(c => ({ id: c.id, label: c.short || c.name, sub: [c.code, c.short ? c.name : ''].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { st.cid = it.id; build(); paint(); }, onClear: () => { st.cid = ''; } });
    mb.querySelectorAll('[data-g]').forEach(inp => { const i = +inp.dataset.g; combo(inp, { inline: true, items: () => store.list('goods').map(g => ({ id: g.id, label: goodsLabel(g, 'SALE'), sub: g.unit || '', text: goodsLabel(g) + ' ' + (g.spec || '') + ' ' + (g.spec2 || '') })), onPick: it => { st.rows[i].gid = it.id; paint(); }, onClear: () => { st.rows[i].gid = ''; } }); });
    mb.querySelectorAll('[data-alt]').forEach(a => a.onclick = ev => { ev.preventDefault(); st.rows[+a.dataset.alt].gid = a.dataset.gid; paint(); });
    mb.querySelectorAll('[data-use]').forEach(c => c.onchange = () => { st.rows[+c.dataset.use].use = c.checked; paint(); });
    mb.querySelectorAll('[data-q]').forEach(inp => inp.oninput = () => { st.rows[+inp.dataset.q].qty = inp.value; });
    mb.querySelectorAll('[data-p]').forEach(inp => inp.oninput = () => { st.rows[+inp.dataset.p].price = inp.value; });
    m.el.querySelector('#oiAgain').onclick = async () => { m.el.querySelector('.mb').innerHTML = '<div class="muted" style="padding:20px 0">重新辨識中…</div>'; if (await load(true)) { build(); paint(); } };
    m.el.querySelector('#oiSale').onclick = () => go('SALE');
    m.el.querySelector('#oiQuo').onclick = () => go('QUO');
  };
  const go = async type => {
    const rows = st.rows.filter(x => x.use);
    if (!st.cid) { toast('請先選客戶'); m.el.querySelector('#oiCus')?.focus(); return; }
    // 記住這個客戶的品項對應，下次直接對上
    const mem = { ...(store.setting('cmap').m || {}) }; const mine = { ...(mem[st.cid] || {}) }; let ch = 0;
    for (const x of rows) if (x.gid && keyOf(x.r) && mine[keyOf(x.r)] !== x.gid) { mine[keyOf(x.r)] = x.gid; ch++; }
    if (ch) { mem[st.cid] = mine; try { await store.saveSetting('cmap', { ...store.setting('cmap'), m: mem }); } catch (e) { /* 記不住也照樣開單 */ } }
    const G = calc().g; const po = String(P.po_no || '').trim();
    const lines = rows.map(x => {
      const g = G[x.gid]; const memo = [po, x.r.due ? '交期 ' + slash(x.r.due) : ''].filter(Boolean).join(' ');
      if (!g) return { gid: '', n: [x.r.part_no, x.r.name].filter(Boolean).join(' '), qty: +x.qty || '', price: +x.price || '', memo };
      const l = { gid: g.id, qty: +x.qty || '', price: +x.price || '', memo };
      const u = piUnit(x.r.unit); if (u && u !== 'PCS' && u.toUpperCase() !== String(g.unit || 'PCS').toUpperCase()) l.u = u;
      if (!(+l.price > 0)) { const ls = lastSale(st.cid, g.id); if (ls) { l.price = ls.price; if (ls.u && !l.u) l.u = ls.u; } else { const p2 = unitPrice(g, type); if (p2 !== '') l.price = p2; } }
      return l;
    });
    const note = [po ? `客戶單號 ${po}` : '', P.remark || ''].filter(Boolean).join('；');
    const preset = { cid: st.cid, lines, note };
    if (type === 'QUO' && P.contact) preset.attn = P.contact;
    m.close();
    openBill(type, null, null, preset);
    const miss = lines.filter(l => !l.gid).length;
    toast(`已開好${type === 'SALE' ? '銷貨單' : '報價單'}草稿（還沒存）${miss ? `，有 ${miss} 項沒對到商品，請在單上選` : ''}`);
  };
  paint();
}
