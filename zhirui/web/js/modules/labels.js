// 標籤列印：豐餘標籤（從銷貨單導入，依每包數量拆張）、一般標籤（品名／規格／數量／日期）、地址標籤（客戶／供應商，3+3 郵遞區號）
import { $, esc, fmtQ, today, uid, ls, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, printHTML } from '../core/ui.js';
import { calc, goodsLabel, bqty, customers, suppliers, cdisp } from '../core/calc.js';
import { api } from '../core/api.js';
import { qrSvg } from '../core/qr.js';

export const LBL_TYPES = [['fy', '豐餘標籤'], ['ry', '如陽標籤'], ['sq', '崧泉標籤'], ['fm', '豐民標籤'], ['cc', '朝程標籤'], ['yb', '元貝標籤'], ['gen', '一般標籤'], ['nl', '標籤機軟體']];
const LBL_READY = { fy: 1, ry: 1, sq: 1, gen: 1, nl: 1 };
const CUST = LBL_TYPES.filter(x => x[0] !== 'gen' && x[0] !== 'nl');   // 有客戶名稱的標籤：用下拉選
// 上方切換：一般標籤在最左邊，客戶標籤用下拉（括號是已導入幾項）
const typeBar = t => `${tabs('lt', [['gen', '一般標籤'], ['cust', '客戶標籤'], ['nl', '標籤機軟體']], t === 'gen' || t === 'nl' ? t : 'cust')}${t === 'gen' || t === 'nl' ? '' : `<select id="lbl-cust" style="width:auto;margin-left:8px" aria-label="客戶標籤種類">${CUST.map(([k, v]) => { const n = store.list('labels').filter(x => x.type === k).length; return `<option value="${k}" ${k === t ? 'selected' : ''}>${v}${n ? `（${n}）` : ''}</option>`; }).join('')}</select>`}`;
function bindTypeBar(el) {
  $('#lbl-cust', el)?.addEventListener('change', ev => { ui.tab = ui.cust = ev.target.value; draw(el); });
}
// 如陽標籤：品名去掉 ⊕Θ 等符號（「⊕皿頭螺絲4*10」→「皿頭螺絲」）；規格補 M 和 L（4*10 → M4*10L）
const ryName = name => genName(name).replace(/^[^\p{L}\p{N}]+/u, '');
const rySpec = name => { let x = genSpec(name).spec; if (/^\d+(\.\d+)?\*/.test(x)) x = 'M' + x; if (/^M[\d.]+\*[\d.]+$/.test(x)) x += 'L'; return x; };
const ui = { tab: 'fy', cust: 'fy', date: today(), genMode: 'goods', genF: { q: '', name: '', spec: '', qty: '', unit: 'PCS', copies: '1' } };
const cfg = () => store.setting('labels');
const size = () => cfg().size || '54';
export default {
  id: 'labels', name: '標籤列印', group: '倉儲', icon: 'labels',
  render(el, { sub }) { this.el = el; if (sub && LBL_TYPES.some(t => t[0] === sub)) ui.tab = sub; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('labels') || ch.has('settings'))) draw(this.el); },
  badge() { return { cnt: store.list('labels').length }; },
};
// 品名中的數字：「盤頭內六角單階螺絲4*10 耐落」→ 4*10
function lblNum(name) {
  const s = String(name || '').replace(/[＊×xX]/g, '*').replace(/／/g, '/');
  const m = s.match(/\d+(?:\.\d+)?(?:\/\d+)?(?:-\d+(?:\/\d+)?)?(?:\s*\*\s*\d+(?:\.\d+)?(?:\/\d+)?(?:-\d+(?:\/\d+)?)?)+/);
  if (m) return m[0].replace(/\s+/g, ''); const n = s.match(/\d+(?:\.\d+)?(?:\/\d+)?/); return n ? n[0] : '';
}
const kg = n => String(Math.round(n * 1000) / 1000);
// 依每包數量拆成多張：28000 支、每包 3000 → 9 張 3000、1 張 1000
function split(it) { const q = Math.round(+it.qty || 0), p = Math.round(+it.pack || 0); if (q <= 0) return []; if (p <= 0 || p >= q) return [{ n: 1, q }]; const full = Math.floor(q / p), r = q - full * p; const out = [{ n: full, q: p }]; if (r > 0) out.push({ n: 1, q: r }); return out; }
// 崧泉：內箱、外箱各自依每箱數量拆箱（箱號 1/5、2/5…）
const sqBoxes = (it, k) => { const out = []; for (const s of split({ qty: it.qty, pack: it[k] })) for (let i = 0; i < s.n; i++) out.push(s.q); return out; };
const sqWhich = () => cfg().sqWhich || 'both';
const sqCount = it => (sqWhich() !== 'out' ? sqBoxes(it, 'inn').length : 0) + (sqWhich() !== 'in' ? sqBoxes(it, 'out').length : 0);
function plan(it) {
  if (it.type === 'sq') { const a = sqBoxes(it, 'inn'), b = sqBoxes(it, 'out'); return a.length || b.length ? [sqWhich() !== 'out' ? `內箱 ${a.length} 張` : '', sqWhich() !== 'in' ? `外箱 ${b.length} 張` : ''].filter(Boolean).join('<br>') : '<span class="muted">—</span>'; }
  const sp = split(it), w = +it.wt || 0; let h = sp.length ? sp.map(s => `${s.n} 張 × ${fmtQ(s.q)}${w ? `（${kg(w * s.q / 1000)} kg）` : ''}`).join('<br>') : '<span class="muted">—</span>';
  const warn = []; if (w > 200) warn.push(`單重 ${w} g 偏大：請填「一支」幾公克，例如 1.12`); if (+it.pack > 0 && +it.qty > 0 && +it.pack >= +it.qty && sp.length) warn.push('每包數量 ≥ 總數量，只會印 1 張');
  return h + (warn.length ? `<div style="color:var(--bad);font-size:12px;white-space:normal">${warn.join('<br>')}</div>` : '');
}
const genSpec = name => { const s = String(name || '').replace(/[＊×xX]/g, '*').replace(/／/g, '/').replace(/＃/g, '#'); const N = '\\d+(?:\\.\\d+)?(?:\\/\\d+)?#?(?:-\\d+(?:\\/\\d+)?)?'; const m = s.match(new RegExp(`(?:M)?${N}(?:\\s*\\*\\s*${N})+`)) || s.match(new RegExp(`M?${N}`)); return m ? { spec: m[0].replace(/\s+/g, ''), at: m.index } : { spec: '', at: -1 }; };
const genName = name => { const s = String(name || ''); const { at } = genSpec(s); let n = (at > 0 ? s.slice(0, at) : s.split(/\s+/)[0]).trim(); const lead = (n.match(/^[^\p{L}\p{N}]+/u) || [''])[0]; let body = n.slice(lead.length); const ch = [...body]; if (ch.length > 7) body = ch.slice(-7).join(''); return lead + body; };

const tabOf = v => v === 'gen' || v === 'nl' ? v : ui.cust;
function draw(el) {
  if (ui.tab === 'nl') return nlView(el);
  if (ui.tab !== 'gen') ui.cust = ui.tab;
  const t = ui.tab; const items = store.list('labels').filter(x => x.type === t).sort((a, b) => (a.at || 0) - (b.at || 0)); const name = LBL_TYPES.find(x => x[0] === t)[1];
  const sizeSel = `<div class="f" style="width:130px"><label for="lbl-size">標籤尺寸</label><select id="lbl-size"><option value="54" ${size() === '54' ? 'selected' : ''}>5 × 4 cm</option><option value="88" ${size() === '88' ? 'selected' : ''}>8 × 8 cm</option></select></div>`;
  if (t === 'gen') {
    const F = ui.genF; let total = 0; items.forEach(x => total += Math.max(0, Math.round(+x.copies || 0)));
    const fld = (k, l, ph, attr = '') => `<div class="f" style="width:${k === 'name' ? 220 : k === 'spec' ? 180 : 110}px"><label for="gen-${k}">${l}</label><input id="gen-${k}" data-gen="${k}" value="${esc(F[k])}" placeholder="${ph}" ${attr}></div>`;
    el.innerHTML = `<div class="head"><h1>標籤列印</h1><span class="sp"></span>${typeBar(t)}</div>${addrBar()}
      <div class="panel" style="display:grid;gap:10px"><div class="ptitle">新增一般標籤</div>
        ${tabs('gm', [['goods', '從商品帶入'], ['manual', '自己填']], ui.genMode)}
        ${ui.genMode === 'goods' ? `<div class="f" style="max-width:640px"><label for="gen-q">找商品（料號、品名、規格，多個字用空白隔開）</label><div class="combo"><input id="gen-q" value="${esc(F.q)}" placeholder="例如：喇叭 8#"></div></div>` : ''}
        <div class="tools" style="align-items:flex-end">${fld('name', '品名', '')}${fld('spec', '規格', '')}${fld('qty', '數量', '例如 5000', 'inputmode="numeric"')}${fld('unit', '單位', 'PCS')}${fld('copies', '張數', '1', 'type="number" min="1"')}<button class="btn pri" id="genAdd">加入</button></div></div>
      <div class="panel" style="display:grid;gap:10px"><div class="tools"><div class="f" style="width:160px"><label for="lbl-date">打印日期</label><input type="date" id="lbl-date" value="${ui.date}"></div>${sizeSel}<span class="sp"></span>${items.length ? '<button class="btn" id="lblClear">清空一般標籤</button>' : ''}<button class="btn pri" id="lblPrint" ${items.length ? '' : 'disabled'}>列印 ${total} 張</button></div>
        <div class="tw"><table><thead><tr><th>品名</th><th>規格</th><th>數量</th><th>單位</th><th class="n">張數</th><th></th></tr></thead><tbody>${items.map(it => `<tr>${['name', 'spec', 'qty', 'unit'].map(k => `<td><input data-gi="${k}" data-id="${it.id}" value="${esc(it[k] ?? '')}" style="width:${k === 'name' ? 200 : k === 'spec' ? 160 : 90}px;border:1px solid var(--line);border-radius:6px;padding:4px 6px"></td>`).join('')}<td class="n"><input data-gi="copies" data-id="${it.id}" type="number" min="1" value="${esc(it.copies)}" class="num" style="width:70px;border:1px solid var(--line);border-radius:6px;padding:4px 6px"></td><td><button class="btn xs" data-del="${it.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty"><b>還沒有要印的標籤</b>在上面選商品或自己填，按「加入」。</div></td></tr>'}</tbody></table></div></div>`;
    el.addEventListener('tab', ev => { if (ev.detail.key === 'lt') { ui.tab = tabOf(ev.detail.val); } else { ui.genMode = ev.detail.val; } draw(el); }, { once: true }); bindTypeBar(el);
    el.querySelectorAll('[data-gen]').forEach(i => i.addEventListener('input', () => { F[i.dataset.gen] = i.value; }));
    el.querySelectorAll('[data-gen]').forEach(i => i.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); $('#genAdd', el).click(); } }));
    if ($('#gen-q', el)) combo($('#gen-q', el), { items: () => store.list('goods').map(g => ({ id: g.id, label: goodsLabel(g), sub: g.unit || '', text: goodsLabel(g) })), onPick: it => { const g = store.get('goods', it.id); F.q = goodsLabel(g); F.name = genName(g.name); F.spec = genSpec(g.name).spec; F.unit = !g.unit || String(g.unit).toUpperCase() === 'PCS' ? 'PCS' : g.unit; draw(el); setTimeout(() => $('#gen-qty', el)?.focus(), 0); } });
    $('#genAdd', el).onclick = async () => { if (!F.name.trim() && !F.spec.trim() && !F.qty.trim()) return toast('請至少填一個欄位'); await store.save('labels', uid('L'), { type: 'gen', name: F.name.trim(), spec: F.spec.trim(), qty: F.qty.trim(), unit: (F.unit || '').trim(), copies: String(Math.max(1, Math.round(+F.copies || 1))), at: Date.now() }); Object.assign(F, { q: '', name: '', spec: '', qty: '', unit: 'PCS', copies: '1' }); draw(el); setTimeout(() => $(ui.genMode === 'goods' ? '#gen-q' : '#gen-name', el)?.focus(), 0); };
    $('#lblPrint', el).onclick = () => printGen(items);
  } else {
    let total = 0; items.forEach(it => t === 'sq' ? total += sqCount(it) : split(it).forEach(s => total += s.n));
    const TF = t === 'sq' ? [['po', '採購單號', 130], ['pn', '料號（客料號）', 100], ['nm', '品名（崧泉）', 200], ['unit', '單位', 50]] : t === 'ry' ? [['pn', '編號（客料號）', 150], ['nm', '品名', 110], ['spec', '規格', 100], ['unit', '單位', 60]] : [['po', '單號（採購單號）', 120], ['pn', '料號（客料號）', 120], ['spec', '短文（品名數字）', 110]];
    const NF = t === 'sq' ? [['qty', '數量', '', ''], ['inn', '內箱每箱', '每箱幾支', ''], ['out', '外箱每箱', '每箱幾支', '']] : t === 'ry' ? [['qty', '數量', '', ''], ['pack', '每包數量', '空白＝印一張', '']] : [['qty', '數量', '', ''], ['wt', '單重 (g)', '每支幾克', 'step="any"'], ['pack', '每包數量', '每包幾支', '']];
    const C = calc();
    el.innerHTML = `<div class="head"><h1>標籤列印</h1><span class="sp"></span>${typeBar(t)}</div>${addrBar()}
      ${!LBL_READY[t] ? `<div class="banner">${esc(name)}的格式還沒定義。告訴我這種標籤要印哪些欄位和版面，就可以開始使用；已導入的商品會先保留在這裡。</div>` : ''}
      <div class="panel" style="display:grid;gap:10px"><div class="tools"><div class="f" style="width:160px"><label for="lbl-date">交貨日期</label><input type="date" id="lbl-date" value="${ui.date}"></div>${t === 'fy' ? `<div class="f" style="width:130px"><label for="lbl-vendor">廠商代號</label><input id="lbl-vendor" value="${esc(cfg().vendor || '501823')}"></div>` : ''}${t === 'sq' ? `<div class="f" style="width:110px"><label for="sq-vendor">廠商代號</label><input id="sq-vendor" value="${esc(cfg().sqVendor || '5B0001')}"></div><div class="f" style="width:130px"><label for="sq-which">箱別</label><select id="sq-which">${[['both', '內箱＋外箱'], ['in', '只印內箱'], ['out', '只印外箱']].map(([k, v]) => `<option value="${k}" ${sqWhich() === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="f" style="width:320px"><label for="sq-qr">QR 碼內容</label><input id="sq-qr" value="${esc(cfg().sqQr || SQ_QR)}" title="可用：{料號} {品名} {數量} {箱號} {總箱數} {箱別} {廠商} {日期} {採購單號}"></div>` : sizeSel}<span class="muted small" style="align-self:flex-end">在銷貨單按「標籤」勾選商品導入。${t === 'ry' ? '日期印在標籤上。' : ''}</span><span class="sp"></span>${items.length ? `<button class="btn" id="lblClear">清空${esc(name)}</button>` : ''}${LBL_READY[t] ? `<button class="btn pri" id="lblPrint" ${items.length ? '' : 'disabled'}>列印 <span id="lblTotal">${total}</span> 張</button>` : ''}</div>
        <div class="tw"><table><thead><tr><th>銷貨單／商品</th>${TF.map(f => `<th>${f[1]}</th>`).join('')}${NF.map(f => `<th class="n">${f[1]}</th>`).join('')}<th>會印出</th><th></th></tr></thead><tbody>
        ${items.map(it => `<tr><td class="muted small">${esc(it.billNo || '')}<br>${esc(it.name || '')}</td>${TF.map(([k, , w]) => `<td><input data-f="${k}" data-id="${it.id}" value="${esc(it[k] ?? '')}" style="width:${w}px;border:1px solid var(--line);border-radius:6px;padding:4px 6px"></td>`).join('')}${NF.map(([k, , ph, at]) => `<td class="n"><input data-f="${k}" data-id="${it.id}" type="number" ${at} value="${esc(it[k] ?? '')}" placeholder="${ph}" class="num" style="width:90px;border:1px solid var(--line);border-radius:6px;padding:4px 6px"></td>`).join('')}<td id="lp-${it.id}" class="small nowrap">${plan(it)}</td><td><button class="btn xs" data-del="${it.id}">✕</button></td></tr>`).join('') || `<tr><td colspan="${TF.length + NF.length + 3}"><div class="empty"><b>還沒有要印的標籤</b>打開一張銷貨單，按下方「標籤」，勾選要印的商品後導入。</div></td></tr>`}</tbody></table></div></div>`;
    el.addEventListener('tab', ev => { ui.tab = tabOf(ev.detail.val); draw(el); }, { once: true }); bindTypeBar(el);
    $('#lbl-vendor', el)?.addEventListener('change', ev => store.saveSetting('labels', { ...cfg(), vendor: ev.target.value.trim() }));
    el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', async () => {
      const it = store.get('labels', inp.dataset.id); if (!it) return; const k = inp.dataset.f; const d = { ...it, [k]: inp.value }; delete d.id;
      const ops = [{ col: 'labels', id: it.id, data: d }];
      if (it.gid && (k === 'wt' || k === 'pack' || k === 'inn' || k === 'out')) { const g = store.get('goods', it.gid); if (g) { const gd = { ...g, [{ wt: 'wt', pack: 'pack', inn: 'sqIn', out: 'sqOut' }[k]]: +inp.value || 0 }; delete gd.id; ops.push({ col: 'goods', id: g.id, data: gd }); } }
      await store.batch(ops);
    }));
    $('#lblPrint', el)?.addEventListener('click', () => t === 'sq' ? printSq(items) : t === 'ry' ? printRy(items) : printFy(items));
    $('#sq-vendor', el)?.addEventListener('change', ev => store.saveSetting('labels', { ...cfg(), sqVendor: ev.target.value.trim() }));
    $('#sq-qr', el)?.addEventListener('change', ev => store.saveSetting('labels', { ...cfg(), sqQr: ev.target.value.trim() }));
    $('#sq-which', el)?.addEventListener('change', async ev => { await store.saveSetting('labels', { ...cfg(), sqWhich: ev.target.value }); draw(el); });
  }
  $('#lbl-date', el).addEventListener('change', ev => { ui.date = ev.target.value; });
  $('#lbl-size', el)?.addEventListener('change', ev => store.saveSetting('labels', { ...cfg(), size: ev.target.value }));
  el.querySelectorAll('[data-gi]').forEach(inp => inp.addEventListener('change', async () => { const it = store.get('labels', inp.dataset.id); if (!it) return; const d = { ...it, [inp.dataset.gi]: inp.value }; delete d.id; await store.save('labels', it.id, d); }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => store.remove('labels', b.dataset.del)));
  bindAddr(el);
  $('#lblClear', el)?.addEventListener('click', async () => { if (await confirm(`清空${name}？`, { danger: true, ok: '清空' })) await store.batch(items.map(x => ({ col: 'labels', id: x.id, delete: true }))); });
}
// 8×8 cm：把 5×4 cm 的版面等比放大
function sized(css, tip) { if (size() !== '88') return [css, tip]; const k = 1.6; return [css.replace(/(\d*\.?\d+)(mm|pt)/g, (m, n, u) => String(Math.round(+n * k * 100) / 100) + u).replace('size:80mm 64mm', 'size:80mm 80mm').replace('width:80mm;height:64mm', 'width:80mm;height:80mm'), tip.replace('5 × 4 cm 標籤（寬 50 mm、高 40 mm）', '8 × 8 cm 標籤（寬 80 mm、高 80 mm）')]; }
const FIT = `<script>window.addEventListener('load',()=>{document.querySelectorAll('.lb>div').forEach(r=>{const w=r.clientWidth,s=r.scrollWidth;if(s>w){r.style.overflow='visible';r.style.transform='scaleX('+(w/s).toFixed(3)+')';}});});<\/script>`;
function printFy(items) {
  const bad = items.find(it => !(+it.wt > 0) || !(+it.pack > 0) || !(+it.qty > 0));
  if (bad) return toast(`「${bad.spec || bad.name}」的數量、單重或每包數量還沒填`);
  const md = String(ui.date || today()).split('-'); const d = `${+md[1]}/${+md[2]}`; const ven = cfg().vendor || '501823'; let html = '';
  for (const it of items) for (const s of split(it)) for (let k = 0; k < s.n; k++) html += `<div class="lb"><div><b>廠商:</b><i class="red">${esc(ven)}</i></div><div><b>交貨:</b><i class="red">${esc(d)}</i></div><div><b>單號:</b><i>${esc(it.po)}</i></div><div><b>數量:</b><i>${s.q}</i></div><div class="w"><b>料號:</b><i>${esc(it.pn)}</i></div><div class="w"><b>短文:</b><i>${esc(it.spec)}</i></div><div><b>單重(g):</b><i>${+it.wt}</i></div><div><b>檢驗日期:</b></div><div><b>總重(kg):</b><i>${kg(+it.wt * s.q / 1000)}</i></div><div><b>檢驗標章:</b></div></div>`;
  const [css, tip] = sized(`@page{size:50mm 40mm;margin:0}*{box-sizing:border-box}body{margin:0;color:#000;font-family:"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lb{width:50mm;height:40mm;padding:2mm 1.6mm;display:grid;grid-template-columns:27.5mm 1fr;grid-template-rows:repeat(6,1fr);align-items:center;column-gap:.6mm;page-break-after:always;overflow:hidden;font-size:9.5pt;line-height:1}.lb:last-child,.lb:not(:has(~ .lb)){page-break-after:auto}@media screen{.lb{border:1px dashed #999;margin:4mm;display:inline-grid;vertical-align:top}}
.lb>div{white-space:nowrap;overflow:hidden;transform-origin:left center}.lb .w{grid-column:1/3}.lb b{color:#e00;font-weight:900}.lb i{font-style:normal;color:#000;font-weight:bold;margin-left:.4mm;font-variant-numeric:tabular-nums;-webkit-text-stroke:.15pt #000}.lb i.red{color:#e00;-webkit-text-stroke:.15pt #e00}`, '列印方式：按 Ctrl+P，紙張選 5 × 4 cm 標籤（寬 50 mm、高 40 mm），邊界「無」，縮放 100%；黑白印表機紅字會印成黑色。');
  printHTML(`豐餘標籤 ${ui.date}`, css, html + FIT, { tip });
}
/** 如陽標籤 5×4 cm：編號（客料號）／品名／規格／數量／日期，底下紅框 ROHS；有填每包數量就依包拆張 */
function printRy(items) {
  const bad = items.find(it => !(+it.qty > 0)); if (bad) return toast(`「${bad.pn || bad.name}」的數量還沒填`);
  const dd = String(ui.date || today()).split('-'); const d = `${dd[0]}/${dd[1]}/${dd[2]}`; let html = '';
  for (const it of items) for (const s of split(it)) for (let k = 0; k < s.n; k++) html += `<div class="lb"><div><b>編號:</b>${esc(it.pn)}</div><div><b>品名:</b>${esc(it.nm ?? ryName(it.name))}</div><div><b>規格:</b>${esc(it.spec)}</div><div><b>數量:</b>${s.q} ${esc(it.unit || 'PCS')}</div><div><b>日期:</b>${esc(d)}</div><div class="rohs"><span>ROHS</span></div></div>`;
  const [css, tip] = sized(`@page{size:50mm 40mm;margin:0}*{box-sizing:border-box}body{margin:0;color:#000;font-family:Arial,"Helvetica","PMingLiU","MingLiU","新細明體",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lb{width:50mm;height:40mm;padding:1.6mm 2mm 1.6mm;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(5,1fr) 1.25fr;align-items:center;page-break-after:always;overflow:hidden;line-height:1}.lb:last-child,.lb:not(:has(~ .lb)){page-break-after:auto}@media screen{.lb{border:1px dashed #999;margin:4mm;display:inline-grid;vertical-align:top}}
.lb>div{white-space:nowrap;overflow:hidden;font-size:12pt;transform-origin:left center}.lb b{font-weight:normal;font-family:"PMingLiU","MingLiU","新細明體",serif;margin-right:.6mm}
.lb .rohs{display:flex;align-items:center;justify-content:center;border:.5mm solid #e00;color:#e00;height:85%;margin:0 1mm;font-size:15pt;letter-spacing:.5pt;transform:none!important}`, '列印方式：按 Ctrl+P，紙張選 5 × 4 cm 標籤（寬 50 mm、高 40 mm），邊界「無」，縮放 100%；黑白印表機紅字會印成黑色。');
  printHTML(`如陽標籤 ${ui.date}`, css, html + FIT, { tip });
}
/** 崧泉標籤 8×8 cm（照崧泉 B2B 的格式）：料號／品名／批號／數量／箱號（右邊小字廠商代號）／箱別（內箱、外箱）／備註（交貨日期），右下 QR 碼 */
const SQ_QR = '{料號}';   // 崧泉 B2B 標籤的 QR 碼只放料號（2026-11-17 對過 PDF）
async function printSq(items) {
  const W = sqWhich();
  const bad = items.find(it => !(+it.qty > 0) || (W !== 'out' && !(+it.inn > 0)) || (W !== 'in' && !(+it.out > 0)));
  if (bad) return toast(`「${bad.pn || bad.name}」的數量或每箱數量還沒填`);
  const win = window.open('', '_blank');   // 先開視窗（產生 QR 碼要一點時間，晚開會被擋）
  const day = String(ui.date || today()).replace(/-/g, ''); const ven = cfg().sqVendor || '5B0001'; const tpl = cfg().sqQr || SQ_QR;
  const q2 = n => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kinds = W === 'in' ? [['inn', '內箱']] : W === 'out' ? [['out', '外箱']] : [['inn', '內箱'], ['out', '外箱']];
  const cards = [];
  for (const [k, kn] of kinds) for (const it of items) { const bx = sqBoxes(it, k); bx.forEach((q, i) => cards.push({ it, q, no: i + 1, tot: bx.length, kn })); }
  const qrOf = {};
  for (const c of cards) { const v = { 料號: c.it.pn, 品名: c.it.nm || c.it.name, 數量: c.q, 箱號: c.no, 總箱數: c.tot, 箱別: c.kn, 廠商: ven, 日期: day, 採購單號: c.it.po || '' }; c.qt = tpl.replace(/\{(\S+?)\}/g, (m, x) => v[x] ?? ''); if (!qrOf[c.qt]) qrOf[c.qt] = await qrSvg(c.qt, { margin: 0 }); }
  const html = cards.map(c => `<div class="lb"><div class="r"><b>料號</b><i>${esc(c.it.pn)}</i></div><div class="r nm"><b>品名</b><i class="w">${esc(c.it.nm || c.it.name)}</i></div><div class="r"><b>批號</b><i></i></div>
    <div class="mid"><div class="l"><div class="r"><b>數量</b><i>${q2(c.q)} ${esc(c.it.unit || '')}</i></div><div class="r"><b>箱號</b><i>${c.no}/${c.tot}</i><s>${esc(ven)}</s></div><div class="r"><b>箱別</b><i>${c.kn}</i></div></div><div class="qr">${qrOf[c.qt]}</div></div>
    <div class="r"><b>備註</b><i>${esc(day)}</i></div></div>`).join('');
  const css = `@page{size:80mm 80mm;margin:0}*{box-sizing:border-box}body{margin:0;color:#000;font-family:"Times New Roman","PMingLiU","新細明體",serif}
.lb{width:80mm;height:80mm;padding:2.5mm;display:grid;grid-template-rows:8.5mm 1fr 8.5mm 27mm 8.5mm;page-break-after:always;overflow:hidden}.lb:last-child,.lb:not(:has(~ .lb)){page-break-after:auto}
@media screen{.lb{border:1px dashed #999;margin:4mm;display:inline-grid;vertical-align:top}}
.lb>*{border:.35mm solid #000;border-bottom:none;min-height:0}.lb>*:last-child{border-bottom:.35mm solid #000}
.r{display:flex;align-items:center;gap:3mm;padding:0 1.5mm;font-size:11.5pt;white-space:nowrap;overflow:hidden}.r b{font-weight:normal;flex:none}.r i{font-style:normal;overflow:hidden}.r s{text-decoration:none;font-size:6.5pt;margin-left:auto}
.nm{align-items:flex-start;padding-top:1.5mm}.nm i.w{white-space:normal;line-height:1.15;word-break:break-all}
.mid{display:flex;padding:0}.mid .l{flex:1;display:grid;grid-template-rows:1fr 1fr 1fr;min-width:0;border-right:.35mm solid #000}.mid .l .r+.r{border-top:.35mm solid #000}
.mid .qr{width:27mm;flex:none;padding:1.2mm;display:flex;align-items:center;justify-content:center}.mid .qr svg{width:100%;height:100%;display:block}`;
  printHTML(`崧泉標籤 ${ui.date}`, css, html, { tip: '列印方式：按 Ctrl+P，紙張選 8 × 8 cm 標籤（寬 80 mm、高 80 mm），邊界「無」，縮放 100%。', win });
}
function printGen(items) {
  const dd = String(ui.date || today()).split('-'); const d = `${dd[0]}/${+dd[1]}/${+dd[2]}`; let html = '';
  for (const it of items) for (let k = 0; k < Math.max(0, Math.round(+it.copies || 0)); k++) html += `<div class="lb"><div><b>品名:</b>${esc(it.name)}</div><div><b>規格:</b>${esc(it.spec)}</div><div><b>數量:</b>${esc(it.qty)}${it.unit ? `<span class="u">${esc(it.unit)}</span>` : ''}</div><div><b>日期:</b>${esc(d)}</div></div>`;
  if (!html) return toast('張數都是 0，沒有可列印的標籤');
  const [css, tip] = sized(`@page{size:50mm 40mm;margin:0}*{box-sizing:border-box}body{margin:0;color:#000;font-family:"PMingLiU","MingLiU","新細明體","細明體","Noto Serif TC","Songti TC",serif}
.lb{width:50mm;height:40mm;padding:3mm 1.8mm 3mm;display:grid;grid-template-rows:repeat(4,1fr);align-items:center;page-break-after:always;overflow:hidden;line-height:1}.lb:last-child,.lb:not(:has(~ .lb)){page-break-after:auto}@media screen{.lb{border:1px dashed #999;margin:4mm;display:inline-grid;vertical-align:top}}
.lb>div{white-space:nowrap;overflow:hidden;font-size:17pt;transform-origin:left center}.lb b{font-weight:normal}.lb .u{margin-left:5mm}`, '列印方式：按 Ctrl+P，紙張選 5 × 4 cm 標籤（寬 50 mm、高 40 mm），邊界「無」，縮放 100%。');
  printHTML(`一般標籤 ${d}`, css, html + FIT, { tip });
}
// ---------- 標籤機軟體：嵌入霹靂系統的標籤機（樣板設計、匯入 NiceLabel .lbl、條碼／QR、流水號） ----------
// 程式本體是 web/nl/label.html（霹靂專案 dist/標籤機.html 原封不動複製），用 iframe 嵌進來；
// 它透過 window.NL_HOST 讀平台的商品、公司資料，取走「銷貨單 › 標籤」導入的待印項目（labels 集合 type=nl）。
// 樣板存在 iframe 的 localStorage（nl-label-meta）；這裡同步到設定 nlmeta，換電腦、換瀏覽器也看得到同一份樣板。
const NL_KEY = 'nl-label-meta';
window.NL_HOST = {
  goods: () => store.list('goods').map(g => ({ id: g.id, code: g.code || '', name: g.name || '', spec: g.spec || '', unit: g.unit || '', salePrice: +g.price || 0, note: g.note || '' })),
  company: () => { const c = store.setting('company') || {}; return { name: c.name || '', short: c.short || c.name || '', tel: c.phone || c.tel || '', fax: c.fax || '', addr: c.addr || '', taxId: c.taxId || c.vat || '' }; },
  take: () => {
    const a = store.list('labels').filter(x => x.type === 'nl').sort((x, y) => (x.at || 0) - (y.at || 0));
    if (a.length) store.batch(a.map(x => ({ col: 'labels', id: x.id, delete: true })));
    return a.map(x => ({ gid: x.gid || '', name: x.name || '', pn: x.pn || '', spec: x.spec || '', po: x.po || '', qty: x.qty ?? '', billNo: x.billNo || '' }));
  },
};
let nlSaveT = 0;
window.addEventListener('storage', ev => {   // iframe 存樣板 → 同步到平台設定
  if (ev.key !== NL_KEY || ev.newValue == null) return;
  clearTimeout(nlSaveT);
  nlSaveT = setTimeout(() => { if (store.setting('nlmeta').json !== ev.newValue) store.saveSetting('nlmeta', { json: ev.newValue, at: Date.now(), by: store.user?.name || '' }).catch(e => toast('標籤樣板同步失敗：' + e.message)); }, 600);
});
function nlView(el) {
  const fr = $('#nl-frame', el);
  if (fr) { try { fr.contentWindow?.NL_PULL?.(); } catch (e) {} return; }   // 已經開著：不要重載（會丟掉正在編的東西），只拉新導入的項目
  const srv = store.setting('nlmeta').json;
  try {
    const loc = localStorage.getItem(NL_KEY);
    if (srv && srv !== loc) localStorage.setItem(NL_KEY, srv);   // 平台上的樣板為準
    else if (!srv && loc && loc !== '{}') store.saveSetting('nlmeta', { json: loc, at: Date.now(), by: store.user?.name || '' });   // 第一次：把這台電腦的樣板傳上去
  } catch (e) {}
  el.innerHTML = `<div class="head"><h1>標籤列印</h1><span class="sp"></span>${typeBar('nl')}</div>
    <iframe id="nl-frame" src="/nl/label.html" title="標籤機軟體" style="display:block;width:100%;height:calc(100vh - 140px);min-height:520px;border:0;border-radius:8px;background:#fff;box-shadow:0 0 0 1px var(--line)"></iframe>`;
  el.addEventListener('tab', ev => { if (ev.detail.key === 'lt') { ui.tab = tabOf(ev.detail.val); draw(el); } }, { once: true });
}

// 銷貨單裡的「標籤」：勾選商品導入
export function labelPicker(bill) {
  const C = calc(); const lines = (bill.lines || []).map((l, i) => ({ l, i })).filter(x => x.l.gid || x.l.n);
  if (!lines.length) return toast('這張單還沒有商品');
  const nm = l => { const g = C.g[l.gid]; return g ? goodsLabel(g) : String(l.n || ''); };
  modal({
    title: '選擇要印標籤的商品', width: 760,
    body: `<div class="f" style="max-width:220px"><label for="lp-type">標籤種類</label><select id="lp-type">${LBL_TYPES.map(([k, v]) => `<option value="${k}" ${k === ui.tab ? 'selected' : ''}>${v}${LBL_READY[k] ? '' : '（未定義）'}</option>`).join('')}</select></div>
      <div class="tw"><table><thead><tr><th><input type="checkbox" id="lp-all" checked></th><th>商品</th><th class="n">數量</th><th>採購單號</th></tr></thead><tbody>${lines.map(({ l, i }) => `<tr><td><input type="checkbox" class="lp-c" value="${i}" checked></td><td>${esc(nm(l))}</td><td class="n">${fmtQ(bqty(l, C.g[l.gid]))}</td><td>${esc(l.memo || bill.note || '')}</td></tr>`).join('')}</tbody></table></div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn" id="lp-add">導入標籤</button><button class="btn pri" id="lp-go">導入並前往標籤頁</button>',
    onOpen(el, close) {
      el.querySelector('#lp-all').onchange = ev => el.querySelectorAll('.lp-c').forEach(c => c.checked = ev.target.checked);
      const go = async nav => {
        const type = el.querySelector('#lp-type').value; const sel = [...el.querySelectorAll('.lp-c')].filter(c => c.checked).map(c => +c.value);
        if (!sel.length) return toast('請至少勾選一項');
        const ops = sel.map(i => { const l = bill.lines[i]; const g = C.g[l.gid]; return { col: 'labels', id: uid('L'), data: { type, gid: l.gid || '', billNo: bill.no || '', name: g ? g.name : String(l.n || ''), pn: g ? String(g.spec || '') : '', spec: type === 'ry' ? rySpec(g ? g.name : l.n) : lblNum(g ? g.name : l.n), ...(type === 'sq' ? { pn: l.sq?.pn || (g ? String(g.spec || '') : ''), nm: l.sq?.name ? [l.sq.name, l.sq.spec].filter(Boolean).join(' ') : (g?.custName || (g ? g.name : String(l.n || ''))), unit: l.sq?.unit || (!(l.u || g?.unit) || String(l.u || g?.unit).toUpperCase() === 'PCS' ? '支' : (l.u || g?.unit)), inn: g?.sqIn || '', out: g?.sqOut || '' } : {}), ...(type === 'ry' ? { nm: g?.custName || ryName(g ? g.name : l.n), unit: (l.u || g?.unit || 'PCS').toUpperCase() === 'PCS' ? 'PCS' : (l.u || g?.unit) } : {}), po: String(l.memo || bill.note || ''), qty: String(Math.round(bqty(l, g))), wt: g?.wt || '', pack: g?.pack || '', at: Date.now() } }; });
        await store.batch(ops); ui.tab = type; close(); toast(`已導入 ${sel.length} 項到${LBL_TYPES.find(x => x[0] === type)[1]}`);
        if (nav) { document.querySelector('#modals .modal-bg [data-close]')?.click(); location.hash = '#labels/' + type; }
      };
      el.querySelector('#lp-add').onclick = () => go(false); el.querySelector('#lp-go').onclick = () => go(true);
    },
  });
}

// ---------- 地址標籤：選客戶／供應商 → 向郵局查 3+3 郵遞區號 → 印 5×4 cm（郵遞區號／地址兩行／簡稱＋公司收） ----------
let addrPick = null;
const addrBar = () => `<div class="panel"><div class="tools" style="align-items:flex-end;gap:10px"><div class="f" style="width:min(420px,100%)"><label for="ad-c">地址標籤：客戶或供應商</label><div class="combo"><input id="ad-c" placeholder="打名稱、簡稱或編號搜尋" value="${esc(addrPick ? cdisp(store.get('contacts', addrPick)) : '')}"></div></div><button class="btn pri" id="adGo">地址列印</button><button class="btn" id="adOwn" title="志瑞自己的地址：412041 台中市大里區／現岱路88號／志瑞螺絲企業有限公司／04 24839193">志瑞地址</button><span class="muted small">會向郵局查 3+3 郵遞區號，印之前可以先看、可以改。</span></div></div>`;
// 志瑞自己的地址標籤（一鍵列印；手機版印標籤也有同一顆）
export const OWN_ADDR = { zip: '412041', zx: '台中市大里區', l2: '現岱路88號', l3: '志瑞螺絲企業有限公司', l4: '04 24839193' };
function bindAddr(el) {
  const inp = $('#ad-c', el); if (!inp) return;
  const kindName = c => c.kind === 'S' ? '供應商' : '客戶';
  combo(inp, { items: () => [...customers(), ...suppliers()].map(c => ({ id: c.id, label: cdisp(c), sub: `${kindName(c)}${c.addr ? '' : '・沒有地址'}`, text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), minWidth: 420, onPick: it => { addrPick = it.id; }, onClear: () => { addrPick = null; } });
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing && addrPick) setTimeout(() => $('#adGo', el)?.focus(), 0); });
  $('#adOwn', el)?.addEventListener('click', () => printAddr(OWN_ADDR, 1));
  $('#adGo', el).addEventListener('click', () => { const c = addrPick && store.get('contacts', addrPick); if (!c) { toast('請先選客戶或供應商'); inp.focus(); return; } addrDialog(c); });
}
// 地址拆兩行：郵局標準地址的「縣市區」＋「路段號」；查不到時自己切在鄉鎮市區後面
const splitAddr = a => { const m = String(a || '').match(/^(.{2,3}[縣市].{1,4}?[區鄉鎮市])(.+)$/); return m ? [m[1], m[2]] : [String(a || ''), '']; };
const stripZip = a => String(a || '').replace(/\s+/g, '').replace(/^\d{3,6}/, '');
export function addrDialog(c) {
  const F = { addr: stripZip(c.addr), zip: '', l2: '', l3: '', l4: `${cdisp(c)}公司收`, copies: '1' };
  [F.l2, F.l3] = splitAddr(F.addr);
  const who = c.kind === 'S' ? '供應商' : '客戶';
  modal({
    title: `地址標籤：${cdisp(c)}`, width: 640,
    body: `<div class="grid">
      <div class="f" style="grid-column:1/-1"><label for="ad-addr">地址（${c.addr ? `${who}資料上的地址，可以改` : `${who}資料沒有地址，請填`}）</label><div style="display:flex;gap:8px"><input id="ad-addr" value="${esc(F.addr)}" style="flex:1"><button type="button" class="btn" id="adQ">查郵遞區號</button></div><div class="small" id="adMsg" style="margin-top:4px"></div></div>
      <div class="f"><label for="ad-zip">第一行：郵遞區號 3+3</label><input id="ad-zip" data-k="zip" inputmode="numeric" maxlength="6" value=""></div>
      <div class="f"><label for="ad-copies">張數</label><input id="ad-copies" data-k="copies" type="number" min="1" value="1"></div>
      <div class="f" style="grid-column:1/-1"><label for="ad-l2">第二行</label><input id="ad-l2" data-k="l2" value="${esc(F.l2)}"></div>
      <div class="f" style="grid-column:1/-1"><label for="ad-l3">第三行</label><input id="ad-l3" data-k="l3" value="${esc(F.l3)}"></div>
      <div class="f" style="grid-column:1/-1"><label for="ad-l4">第四行</label><input id="ad-l4" data-k="l4" value="${esc(F.l4)}"></div>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" id="ad-save"> 把地址和郵遞區號存回${who}資料</label></div>
      <div class="muted small" style="margin-top:10px">預覽（5 × 4 cm）</div><div id="adPv" style="margin-top:4px"></div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="adPrint">列印</button>',
    onOpen(el, close) {
      const pv = () => { $('#adPv', el).innerHTML = `<div style="width:50mm;height:40mm;border:1px dashed #999;background:#fff;color:#000;overflow:hidden">${addrLabelHTML(F, true)}</div>`; };
      const msg = (t, bad) => { const m = $('#adMsg', el); m.textContent = t; m.style.color = bad ? 'var(--bad)' : 'var(--muted)'; };
      const saveBox = $('#ad-save', el);
      const syncSave = () => { const changed = stripZip(c.addr) !== F.addr || (!!F.zip && c.zip !== F.zip); saveBox.parentElement.style.display = changed && F.addr ? '' : 'none'; if (!c.addr && F.addr) saveBox.checked = true; };
      const query = async () => {
        F.addr = stripZip($('#ad-addr', el).value); if (!F.addr) { msg('請填地址', true); return; }
        msg('向郵局查詢中…');
        try {
          const r = await api.get('/api/zip33?addr=' + encodeURIComponent(F.addr));
          if (!r.ok) { msg('郵局查不到：' + (r.error || '') + '。請確認地址，或自己填郵遞區號。', true); [F.l2, F.l3] = splitAddr(F.addr); }
          else { F.zip = r.zip; F.l2 = r.city || splitAddr(F.addr)[0]; F.l3 = r.street || splitAddr(F.addr)[1]; msg(`郵局標準地址：${r.zip} ${r.city}${r.street}${r.cached ? '（之前查過）' : ''}`); }
        } catch (e) { msg((e.status === 404 || /not found/i.test(e.message) ? '伺服器還沒更新，請到「設定備份」重新啟動伺服器後再試。' : '查詢失敗：' + e.message + '。') + '也可以自己填郵遞區號。', true); [F.l2, F.l3] = splitAddr(F.addr); }
        for (const k of ['zip', 'l2', 'l3']) $('#ad-' + k, el).value = F[k];
        syncSave(); pv();
      };
      el.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => { F[i.dataset.k] = i.value.trim(); if (i.dataset.k === 'zip') syncSave(); pv(); }));
      $('#ad-addr', el).addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); query(); } });
      $('#ad-addr', el).addEventListener('input', () => { F.addr = stripZip($('#ad-addr', el).value); syncSave(); });
      $('#adQ', el).addEventListener('click', query);
      syncSave(); pv();
      if (F.addr) query(); else setTimeout(() => $('#ad-addr', el).focus(), 50);
      $('#adPrint', el).addEventListener('click', async () => {
        if (!F.l2 && !F.l3) return toast('沒有地址');
        if (F.zip && !/^\d{6}$/.test(F.zip) && !await confirm(`郵遞區號「${F.zip}」不是 6 碼，確定要印嗎？`, { ok: '照印' })) return;
        if (saveBox.checked && saveBox.parentElement.style.display !== 'none') {
          const d = { ...store.get('contacts', c.id) }; delete d.id; d.addr = F.addr; if (F.zip) d.zip = F.zip;
          await store.save('contacts', c.id, d); store.log('修改', `${who} ${c.name}：地址 ${F.zip} ${F.addr}（地址標籤）`);
        }
        printAddr(F, Math.max(1, Math.round(+F.copies || 1))); close();
      });
    },
  });
}
const ALB_CSS = `.alb{width:50mm;height:40mm;padding:3mm 3mm 2.6mm;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr 1fr auto;align-items:center;row-gap:.6mm;overflow:hidden;line-height:1.15;color:#000;font-family:"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif}
.alb>div{white-space:nowrap;overflow:hidden;transform-origin:left center}.alb .z{font-size:15pt;font-weight:bold;letter-spacing:1.5pt;font-family:Arial,Helvetica,sans-serif}.alb .zz{font-size:12.5pt;letter-spacing:.5pt}.alb .zx{font-size:inherit;letter-spacing:0;margin-left:2mm;font-family:"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif}.alb .a{font-size:12.5pt;font-weight:bold}.alb .n{font-size:16pt;font-weight:bold;text-align:right;transform-origin:right center}`;
function addrLabelHTML(F, screen) {
  return `${screen ? `<style>${ALB_CSS}</style>` : ''}<div class="alb"><div class="z${F.zx ? ' zz' : ''}">${esc(F.zip)}${F.zx ? `<span class="zx">${esc(F.zx)}</span>` : ''}</div><div class="a">${esc(F.l2)}</div><div class="a">${esc(F.l3)}</div><div class="n">${esc(F.l4)}</div></div>`;
}
function printAddr(F, n) {
  let html = ''; for (let k = 0; k < n; k++) html += addrLabelHTML(F);
  const [css, tip] = sized(`@page{size:50mm 40mm;margin:0}*{box-sizing:border-box}body{margin:0}
${ALB_CSS}
.alb{page-break-after:always}.alb:last-child,.alb:not(:has(~ .alb)){page-break-after:auto}@media screen{.alb{border:1px dashed #999;margin:4mm;display:inline-grid;vertical-align:top}}`, '列印方式：按 Ctrl+P，紙張選 5 × 4 cm 標籤（寬 50 mm、高 40 mm），邊界「無」，縮放 100%。');
  printHTML(`地址標籤 ${F.l4}`, css, html + FIT.replace('.lb>div', '.alb>div'), { tip });
}
