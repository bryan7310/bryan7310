// 客戶訂單匯入：客戶給的未交貨／訂單 Excel（例如豐餘的「採購文件」報表）→ 依採購單號分成一張張客戶訂單。
// 欄位用表頭名稱自動找；客料號對商品的客料號欄（spec／spec2），對不到再用品名規格比對。
// 單價單位（每支／每百支／每千支）用這個客戶上次的單價自動判斷，也可以手動改。
// 同一個客戶、同一個採購單號已經匯入過的，預設不重複建立；勾選的話會用檔案裡的數量更新那張訂單（還沒出過貨才行）。
import { esc, fmtQ, fp4, slash, today, toHalf, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { modal, toast, combo } from '../core/ui.js';
import { calc, customers, cdisp, goodsLabel, lastSale, nextNo } from '../core/calc.js';
import { matchCo } from './faxin.js';
import { loadXlsx } from './purchase_import.js';
import { matchLine } from './order_in.js';
import { soShipped, preloadHist } from './_bills.js';
import { histSaleReady } from '../core/calc.js';

const COLS = {
  po: ['採購文件', '採購單號', '採購單', '訂單號碼', '訂單編號', '訂單號', 'PO', 'PO NO', '單號'],
  date: ['文件日期', '訂單日期', '採購日期', '單據日期', '日期'],
  part: ['物料', '料號', '品號', '客戶料號', '產品編號', '物料號碼', '料件編號'],
  old: ['舊物料號碼', '舊料號'],
  name: ['短文', '品名規格', '品名', '規格', '說明', '物料說明', '品名/規格'],
  qty: ['訂貨數量', '訂購數量', '採購數量', '數量'],
  left: ['仍待交貨〈數量〉', '仍待交貨', '未交數量', '待交數量', '未交量', '待交貨數量'],
  due: ['交貨日期', '交期', '預交日', '預定交貨日', '需求日'],
  price: ['淨價', '單價', '採購單價'],
  unit: ['單位', '計價單位'],
  pr: ['請購單', '請購單號'],
};
const H = s => toHalf(String(s ?? '')).replace(/\s+/g, '').replace(/[〈〉<>()（）]/g, '');
function findCols(head) {
  const out = {}; const hs = head.map(H);
  for (const [k, names] of Object.entries(COLS)) { for (const n of names) { const i = hs.indexOf(H(n)); if (i >= 0 && !Object.values(out).includes(i)) { out[k] = i; break; } } }
  return out;
}
const iso = v => { if (v instanceof Date && !isNaN(v)) { const p = n => String(n).padStart(2, '0'); return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`; } const s = toHalf(String(v ?? '')).trim(); let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = s.match(/^(\d{2,3})[-/.](\d{1,2})[-/.](\d{1,2})$/); if (m) return `${+m[1] + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; return ''; };
const num = v => { const n = +String(v ?? '').replace(/[,，\s]/g, ''); return isFinite(n) ? n : 0; };
const FACTORS = [[1, '每支'], [100, '每百支'], [1000, '每千支']];
/** 用客料號對到的商品，看哪個客戶買過最多項 */
function cusByGoods(items) {
  const gids = new Set(); for (const it of items) { const a = matchLine({ part_no: it.part_no, name: '' }, ''); if (a[0] && a[0].why === '客料號相同') gids.add(a[0].g.id); }
  if (!gids.size) return '';
  let best = '', bn = 0; for (const c of customers()) { let n = 0; for (const g of gids) if (lastSale(c.id, g)) n++; if (n > bn) { bn = n; best = c.id; } }
  return bn >= Math.min(2, gids.size) ? best : '';
}
/** 表頭附近的文字（含括號裡的）試著對客戶 */
function guessCus(rows) {
  for (const r of rows) for (const v of r) {
    const s = String(v || ''); const cands = [...(s.match(/[(（]([^)）]+)[)）]/g) || []).map(x => x.slice(1, -1)), ...(s.length <= 16 ? [s] : [])];
    for (const t of cands) { if (t.length < 2 || /志瑞/.test(t)) continue; const co = matchCo(t, ''); if (co && co.kind === 'C') return co.id; }
  }
  return '';
}

export function importSO(onDone) {
  const m = modal({ title: '匯入客戶訂單（Excel）', width: 1180, closeOnBg: false,
    body: `<div class="f"><label for="siFile">選客戶給的訂單 Excel（.xlsx／.xls／.csv）</label><input type="file" id="siFile" accept=".xlsx,.xls,.csv"></div><div id="siBody" class="muted small">表頭要有採購單號、料號或品名、數量這幾欄；欄位名稱會自動對。</div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>關閉</button>' });
  m.el.querySelector('#siFile').onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    const body = m.el.querySelector('#siBody'); body.textContent = '讀取中…';
    try {
      if (!histSaleReady()) { body.textContent = '載入歷史銷貨資料（第一次比較久）…'; await preloadHist(); }
      const XLSX = await loadXlsx(); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const hi = rows.findIndex(r => { const c = findCols(r); return c.qty != null && (c.part != null || c.name != null); });
      if (hi < 0) { body.innerHTML = '<div class="banner">找不到表頭（要有「數量」和「料號」或「品名」欄）。</div>'; return; }
      const head = rows[hi]; const c = findCols(head);
      const items = rows.slice(hi + 1).filter(r => r.some(v => v !== '' && v != null)).map(r => ({
        po: String(r[c.po] ?? '').trim(), date: iso(r[c.date]), part_no: String(r[c.part] ?? '').trim(), old: String(r[c.old] ?? '').trim(), name: String(r[c.name] ?? '').trim(),
        qty: num(r[c.qty]), left: c.left != null ? num(r[c.left]) : null, due: iso(r[c.due]), rawPrice: num(r[c.price]), unit: String(r[c.unit] ?? '').trim(), pr: String(r[c.pr] ?? '').trim(),
      })).filter(x => (x.part_no || x.name) && (x.qty > 0 || x.left > 0));
      if (!items.length) { body.innerHTML = '<div class="banner">檔案裡沒有讀到明細。</div>'; return; }
      // 客戶：記住這種表頭是哪個客戶；沒記過就用表裡的文字試著對
      const sig = head.map(H).filter(Boolean).join('|'); const mem = store.setting('soimp').m || {};
      let cid = mem[sig] && store.get('contacts', mem[sig]) ? mem[sig] : '';
      if (!cid) cid = cusByGoods(items) || guessCus(rows.slice(0, hi + 3));
      review(m, { f, items, cols: c, head, sig, cid, onDone });
    } catch (e) { body.innerHTML = `<div class="banner">讀檔失敗：${esc(e.message || e)}</div>`; }
  };
}

function review(m, S) {
  const C = calc();
  S.useLeft = S.cols.left != null; S.factor = 0;
  const match = () => { for (const it of S.items) { const a = matchLine({ part_no: it.part_no, name: it.name }, S.cid); let top = a[0]; if ((!top || top.conf === '低') && it.old) { const b = matchLine({ part_no: it.old, name: '' }, S.cid); if (b[0] && b[0].conf !== '低') { top = { ...b[0], why: '舊料號相同' }; a.unshift(top); } } it.cands = a; it.gid = top && top.conf !== '低' ? top.g.id : ''; it.top = top; } };
  // 單價單位：拿有上次單價的品項投票
  const guess = () => { const vote = { 1: 0, 100: 0, 1000: 0 }; for (const it of S.items) { if (!it.gid || !(it.rawPrice > 0) || !S.cid) continue; const ls = lastSale(S.cid, it.gid); if (!ls || ls.u) continue; for (const [f] of FACTORS) { const p = it.rawPrice / f; if (Math.abs(p - ls.price) / ls.price < 0.35) vote[f]++; } } const best = Object.entries(vote).sort((a, b) => b[1] - a[1])[0]; return best[1] > 0 ? +best[0] : 1; };
  match(); S.factor = guess();
  const exist = po => store.list('bills').find(b => b.type === 'SO' && b.cid === S.cid && b.cpo === po);
  const groups = () => { const g = new Map(); for (const it of S.items) { const k = it.po || '（沒有單號）'; (g.get(k) || g.set(k, []).get(k)).push(it); } return [...g.entries()].map(([po, list]) => ({ po, list, ex: S.cid ? exist(po) : null })); };
  S.pick = new Map();
  const paint = () => {
    const G = groups(); for (const g of G) if (!S.pick.has(g.po)) S.pick.set(g.po, !g.ex);
    const qOf = it => S.useLeft && it.left != null ? it.left : it.qty;
    const pOf = it => it.rawPrice > 0 ? Math.round(it.rawPrice / S.factor * 10000) / 10000 : '';
    const nSel = G.filter(g => S.pick.get(g.po)).length; const miss = S.items.filter(it => !it.gid && qOf(it) > 0).length;
    m.el.querySelector('.mb').innerHTML = `<div class="grid" style="grid-template-columns:2fr 1.4fr 1.4fr 2fr">
        <div class="f"><label for="siCus">客戶</label><input id="siCus" value="${esc(S.cid ? cdisp(C.ct[S.cid]) : '')}" placeholder="選這份訂單的客戶"></div>
        <div class="f"><label for="siQ">數量用哪一欄</label><select id="siQ" ${S.cols.left == null ? 'disabled' : ''}><option value="1" ${S.useLeft ? 'selected' : ''}>仍待交貨（還沒交的）</option><option value="0" ${!S.useLeft ? 'selected' : ''}>訂貨數量（整張訂單）</option></select></div>
        <div class="f"><label for="siF">單價（淨價）是</label><select id="siF">${FACTORS.map(([f, t]) => `<option value="${f}" ${S.factor === f ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="f"><label>檔案</label><div class="small">${esc(S.f.name)}・${S.items.length} 行・${G.length} 張採購單</div></div></div>
      ${miss ? `<div class="banner">有 ${miss} 行沒有對到商品，可以在下面選；沒選的會先用文字存在訂單上，出貨前要補選。</div>` : ''}
      <div class="tw" style="max-height:58vh;overflow:auto"><table><thead><tr><th style="width:30px"></th><th>客戶單號／料號</th><th>品名（單上寫的）</th><th style="min-width:280px">對到商品</th><th class="n">數量</th><th class="n">單價</th><th>交期</th></tr></thead><tbody>
      ${G.map(g => `<tr style="background:var(--sunken)"><td><input type="checkbox" data-po="${esc(g.po)}" ${S.pick.get(g.po) ? 'checked' : ''}></td><td colspan="6"><b class="mono">${esc(g.po)}</b>　<span class="muted small">${esc(g.list[0].date ? slash(g.list[0].date) : '')}・${g.list.length} 項</span>${g.ex ? `　<span class="pill warn">已匯入過：${esc(g.ex.no)}</span> <span class="muted small">${S.pick.get(g.po) ? (Object.keys(soShipped(g.ex)).length ? '已經出過貨，不會更新' : '會用這次的數量更新那張訂單') : '勾選＝用這次的數量更新'}</span>` : ''}</td></tr>
        ${g.list.map(it => { const i = S.items.indexOf(it); const gg = C.g[it.gid]; const q = qOf(it); return `<tr ${q > 0 ? '' : 'style="opacity:.45"'}><td></td><td class="mono small">${esc(it.part_no)}${it.old ? `<div class="muted">舊 ${esc(it.old)}</div>` : ''}</td><td class="small">${esc(it.name)}</td>
          <td><div class="combo"><input data-g="${i}" value="${esc(gg ? goodsLabel(gg, 'SALE') : '')}" placeholder="打料號、品名搜尋"></div><div class="small">${gg && it.top && it.top.g.id === it.gid ? `<span class="pill ${it.top.conf === '高' ? 'ok' : 'warn'}">${it.top.conf}</span> <span class="muted">${esc(it.top.why)}</span>` : gg ? '<span class="pill ok">手選</span>' : '<span class="pill bad">未對到</span>'}</div></td>
          <td class="n">${fmtQ(q)}${S.useLeft && it.left != null && it.left !== it.qty ? `<div class="muted small">訂 ${fmtQ(it.qty)}</div>` : ''}</td><td class="n">${pOf(it) !== '' ? fp4(pOf(it)) : ''}${gg && S.cid ? (ls => ls ? `<div class="muted small">上次 ${fp4(ls.price)}</div>` : '')(lastSale(S.cid, gg.id)) : ''}</td><td class="small nowrap">${esc(it.due ? slash(it.due) : '')}</td></tr>`; }).join('')}`).join('')}
      </tbody></table></div>`;
    m.el.querySelector('.mf').innerHTML = `<span class="muted small">勾選 ${nSel} 張</span><span class="sp"></span><button class="btn" data-close>關閉</button><button class="btn pri" id="siGo" ${nSel && S.cid ? '' : 'disabled'}>建立／更新 ${nSel} 張客戶訂單</button>`;
    m.el.querySelector('.mf [data-close]').onclick = () => m.close();
    combo(m.el.querySelector('#siCus'), { items: () => customers().map(c => ({ id: c.id, label: c.short || c.name, sub: [c.code, c.short ? c.name : ''].filter(Boolean).join(' '), text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: it => { S.cid = it.id; S.pick.clear(); match(); S.factor = guess(); paint(); }, onClear: () => { S.cid = ''; } });
    m.el.querySelector('#siQ').onchange = ev => { S.useLeft = ev.target.value === '1'; paint(); };
    m.el.querySelector('#siF').onchange = ev => { S.factor = +ev.target.value; paint(); };
    m.el.querySelectorAll('[data-po]').forEach(cb => cb.onchange = () => { S.pick.set(cb.dataset.po, cb.checked); paint(); });
    m.el.querySelectorAll('[data-g]').forEach(inp => { const i = +inp.dataset.g; combo(inp, { inline: true, items: () => store.list('goods').map(g => ({ id: g.id, label: goodsLabel(g, 'SALE'), sub: g.unit || '', text: goodsLabel(g) + ' ' + (g.spec || '') + ' ' + (g.spec2 || '') })), onPick: it => { S.items[i].gid = it.id; S.items[i].top = null; paint(); }, onClear: () => { S.items[i].gid = ''; } }); });
    m.el.querySelector('#siGo').onclick = () => save(qOf, pOf);
  };
  const save = async (qOf, pOf) => {
    const G = groups().filter(g => S.pick.get(g.po)); const ops = []; let nNew = 0, nUpd = 0, nSkip = 0; const all = store.list('bills').slice();
    for (const g of G) {
      const list = g.list.filter(it => qOf(it) > 0); if (!list.length) continue;
      const lines = list.map(it => { const memo = [it.due ? '交期 ' + slash(it.due) : '', it.pr ? '請購 ' + it.pr : ''].filter(Boolean).join(' '); const p = pOf(it); const l = it.gid ? { gid: it.gid, qty: qOf(it), price: p === '' ? 0 : p } : { gid: '', n: [it.part_no, it.name].filter(Boolean).join(' '), qty: qOf(it), price: p === '' ? 0 : p }; if (memo) l.memo = memo; if (!l.price && it.gid) { const ls = lastSale(S.cid, it.gid); if (ls) { l.price = ls.price; if (ls.u) l.u = ls.u; } } return l; });
      const dues = list.map(it => it.due).filter(Boolean).sort();
      if (g.ex) {
        if (Object.keys(soShipped(g.ex)).length) { nSkip++; continue; }
        const { id, ...rest } = g.ex; ops.push({ col: 'bills', id, data: { ...rest, lines, deliv: dues[0] || rest.deliv || '', updatedAt: Date.now(), updatedBy: store.user.id, note: `${rest.note ? rest.note.replace(/；?Excel 更新.*$/, '') + '；' : ''}Excel 更新 ${today()}` } }); nUpd++;
      } else {
        const date = list[0].date || today(); const no = nextNo('SO', today(), all); const id = uid('b');
        const doc = { type: 'SO', no, date, cid: S.cid, cpo: g.po === '（沒有單號）' ? '' : g.po, deliv: dues[0] || '', lines, disc: 0, tax: false, note: `Excel 匯入（${S.f.name}）`, createdAt: Date.now(), updatedAt: Date.now(), createdBy: store.user.id };
        all.push({ ...doc, id }); ops.push({ col: 'bills', id, data: doc }); nNew++;
      }
    }
    // 記住：這種表頭＝這個客戶；客料號對應
    const mem = { ...(store.setting('soimp').m || {}), [S.sig]: S.cid }; ops.push({ col: 'settings', id: 'soimp', data: { ...store.setting('soimp'), m: mem } });
    try { await store.batch(ops); } catch (e) { toast('儲存失敗：' + e.message); return; }
    store.log('匯入', `客戶訂單 Excel｜${cdisp(calc().ct[S.cid])}｜新增 ${nNew} 張、更新 ${nUpd} 張`);
    m.close(); toast(`客戶訂單：新增 ${nNew} 張${nUpd ? `、更新 ${nUpd} 張` : ''}${nSkip ? `（${nSkip} 張已出過貨，沒有更新）` : ''}`); S.onDone && S.onDone();
  };
  paint();
}
