// 手機版：查庫存／查價。搜尋料號、品名、規格；表面處理篩選；點進去看庫存、售價、牌價、成本、毛利率、客戶上次成交價、供應商。
import { esc, fmt, fmtQ, today, qTerms, matchQ, ls, slash } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { calc, costOf, lastSale, uRate, cdisp, customers, goodsLabel } from '../core/calc.js';
import { platCost } from '../core/pricing.js';
import { qrSvg, scanQR } from '../core/qr.js';
import { addToBill } from './bill.js';

// 材質篩選（商品「類別」欄）：鐵、白鐵（不鏽鋼）、合金（合金鋼）、其他（中碳鋼、彈簧鋼、銅、鋁、代工…）
const MAIN = ['鐵', '不鏽鋼', '合金鋼'];
const FINS = [['', '全部'], ['鐵', '鐵', g => g.cat === '鐵'], ['白鐵', '白鐵', g => g.cat === '不鏽鋼'], ['合金', '合金', g => g.cat === '合金鋼'], ['其他', '其他', g => !MAIN.includes(g.cat)]];
const ui = { q: '', fin: '', scroll: 0 };
const custId = () => { const id = ls.get('zr.m.cid', ''); return id && store.get('contacts', id) ? id : ''; };
const p2 = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 4 });

// 料號＋品名＋規格的搜尋字串（資料有變才重建）
let IDX = null, IDXgen = -1;
function index() {
  if (IDX && IDXgen === store.gen) return IDX;
  IDXgen = store.gen; IDX = store.list('goods').filter(g => !g.nostock || g.salePrice).map(g => ({ g, t: goodsLabel(g) + ' ' + (g.spec2 || '') + ' ' + (g.vcode || '') }));
  return IDX;
}
const total = (C, gid) => Object.values(C.stock[gid] || {}).reduce((a, b) => a + b, 0);
function stockTag(C, g) {
  const has = !!C.stock[g.id]; const t = total(C, g.id);
  if (+g.safety > 0 && t < +g.safety) return t <= 0 ? '<span class="tag bad">缺貨</span>' : '<span class="tag warn">低於安全庫存</span>';
  if (has && t <= 0) return '<span class="tag bad">缺貨</span>';
  return '';
}
export function search(q, fin) {
  const ts = qTerms(q); const f = FINS.find(x => x[0] === fin)?.[2];
  if (!ts.length && !f) return [];
  const Q = String(q || '').trim().toUpperCase();
  const out = [];
  for (const x of index()) { if (f && !f(x.g)) continue; if (ts.length && !matchQ(x.t, ts)) continue; out.push(x.g); }
  const C = calc();
  const rank = g => (String(g.code).toUpperCase() === Q ? 0 : String(g.code).toUpperCase().startsWith(Q) ? 1 : 2) * 2 + (total(C, g.id) > 0 ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || String(a.code).localeCompare(String(b.code))).slice(0, 80);
}

// ---------- 清單頁 ----------
export function stockPage(view) {
  const cid = custId(); const c = cid ? store.get('contacts', cid) : null;
  view.innerHTML = `<div class="hd"><h1>查庫存</h1><span class="sp"></span><button class="chip" id="cust">${c ? '客戶：' + esc(cdisp(c)) : '選客戶（看上次成交價）'}</button></div>
    <div class="search srow"><input type="search" id="q" placeholder="規格或品名，例如 M6*20" value="${esc(ui.q)}" autocomplete="off" autocorrect="off" autocapitalize="off" enterkeyhint="search"><button type="button" class="scanbtn" id="scan" aria-label="掃 QR 碼"><svg viewBox="0 0 24 24"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M7 12h10"/></svg></button></div>
    <div class="chips">${FINS.map(([k, n]) => `<button class="chip ${ui.fin === k ? 'on' : ''}" data-fin="${k}">${n}</button>`).join('')}</div>
    <div id="res"></div>`;
  const q = view.querySelector('#q'), res = view.querySelector('#res');
  const draw = () => {
    const list = search(ui.q, ui.fin); const C = calc();
    if (!qTerms(ui.q).length && !ui.fin) { res.innerHTML = '<div class="note">輸入規格或品名開始搜尋，空白隔開多個字（例如「M6 20 鍍鋅」）。</div>'; return; }
    res.innerHTML = list.length ? `<div class="card list">${list.map(g => { const t = total(C, g.id); const lp = cid ? lastSale(cid, g.id, today()) : null; return `<a href="#g/${encodeURIComponent(g.id)}" class="gi"><div class="gm"><b>${esc(g.name)}</b><small>${esc(g.code)}${g.spec ? '・' + esc(g.spec) : ''}</small></div><div class="gr"><b>${C.stock[g.id] ? fmtQ(t) : '—'}</b><small>${esc(g.unit || '')}${lp ? `・上次 ${p2(lp.price)}` : +g.salePrice ? `・售 ${p2(g.salePrice)}` : ''}</small>${stockTag(C, g)}</div></a>`; }).join('')}</div>${list.length >= 80 ? '<div class="note">只列前 80 項，請再多打幾個字縮小範圍。</div>' : ''}`
      : '<div class="card ph"><b>找不到</b><span class="muted">換個寫法試試，例如「M6*20」或「6*20」。</span></div>';
  };
  let tm = 0;
  q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { ui.q = q.value; draw(); }, 150); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
  view.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => { ui.fin = b.dataset.fin; view.querySelectorAll('[data-fin]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  view.querySelector('#cust').onclick = () => pickCustomer(() => stockPage(view));
  view.querySelector('#scan').onclick = () => scanQR(text => { const g = findByCode(text); if (g) location.hash = '#g/' + encodeURIComponent(g.id); else { ui.q = text; stockPage(view); } }, { title: '掃商品 QR 碼' });
  draw();
  if (ui.scroll) { window.scrollTo(0, ui.scroll); ui.scroll = 0; }
}

/** QR 碼內容 → 商品：料號（不分大小寫）；也接受網址裡的 #g/商品 */
export function findByCode(text) {
  let t = String(text || '').trim(); const m = t.match(/#g\/([^?#]+)/); if (m) t = decodeURIComponent(m[1]);
  const u = t.toUpperCase();
  return store.get('goods', t) || store.list('goods').find(g => String(g.code || '').toUpperCase() === u) || null;
}

// ---------- 選客戶（全螢幕清單） ----------
/** 選客戶：沒給 onPick 時記成查庫存用的客戶；給了就把客戶 id（不選＝''）交給 onPick */
export function pickCustomer(done, onPick) {
  const pick = id => onPick ? onPick(id) : ls.set('zr.m.cid', id);
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>取消</button><b>選客戶</b><button class="link" data-clear>不選</button></div>
    <div class="search"><input type="search" id="cq" placeholder="客戶名稱、代號" autocomplete="off"></div><div class="card list" id="cl"></div>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); };
  const all = customers().map(c => ({ c, t: [c.code, c.name, c.short, ...(c.aliases || [])].filter(Boolean).join(' ') }));
  const draw = v => { const ts = qTerms(v); el.querySelector('#cl').innerHTML = all.filter(x => matchQ(x.t, ts)).slice(0, 60).map(x => `<a href="#" data-id="${x.c.id}"><span class="mono muted">${esc(x.c.code)}</span>${esc(cdisp(x.c))}</a>`).join('') || '<div class="row muted">找不到</div>'; };
  el.querySelector('#cq').addEventListener('input', e => draw(e.target.value)); draw('');
  el.querySelector('[data-x]').onclick = close;
  el.querySelector('[data-clear]').onclick = () => { pick(''); close(); done(); };
  el.querySelector('#cl').addEventListener('click', e => { const a = e.target.closest('[data-id]'); if (!a) return; e.preventDefault(); pick(a.dataset.id); close(); done(); });
}

// ---------- 商品明細 ----------
/** 每基本單位的價格（單價 ÷ 單位倍數，例如 H＝100 支） */
const perBase = (price, u, g, rate) => (+price || 0) / (+rate || (u ? uRate(u, g) || 1 : 1));
const margin = (p, c) => p > 0 && c > 0 ? ((p - c) / p * 100).toFixed(1) + '%' : '—';
export function goodsPage(view, gid) {
  const g = store.get('goods', gid) || store.list('goods').find(x => String(x.code).toUpperCase() === String(gid).toUpperCase());
  if (!g) { view.innerHTML = `<div class="hd"><a class="back" href="#stock">‹ 查庫存</a></div><div class="card ph"><b>找不到這個商品</b><span class="muted">${esc(gid)}</span></div>`; return; }
  const C = calc(); const cid = custId(); const c = cid ? store.get('contacts', cid) : null;
  const whs = store.list('warehouses'); const t = total(C, g.id);
  const cost = costOf({ gid: g.id, qty: 1, price: 0 }, today(), C.purIdx, C.g, C.poIdx, true);
  const plat = platCost(g);
  const sale = +g.salePrice || 0;
  const lp = cid ? lastSale(cid, g.id, today()) : null;
  const lpBase = lp ? perBase(lp.price, lp.u, g, lp.rate) : 0;
  // 最近進貨（供應商）：新平台＋舊系統進貨單（成本計算用的同一份）
  const purs = (C.purIdx[g.id] || []).slice().sort((a, b) => b.d - a.d);

  view.innerHTML = `<div class="hd"><a class="back" href="#stock">‹ 查庫存</a></div>
    <div class="card"><div class="gname">${esc(g.name)}</div><div class="muted mono">${esc(g.code)}${g.spec ? '　' + esc(g.spec) : ''}${g.cat ? '　' + esc(g.cat) : ''}</div></div>
    <p><button class="btn" id="tobill">加入出貨單</button></p>
    <div class="sec">庫存</div>
    <div class="card list">${whs.map(w => `<div class="row"><span>${esc(w.name)}</span><span class="go">${fmtQ((C.stock[g.id] || {})[w.id] || 0)} ${esc(g.unit || '')}</span></div>`).join('')}
      <div class="row"><b>合計</b><span class="go"><b>${C.stock[g.id] ? fmtQ(t) : '—'}</b> ${esc(g.unit || '')} ${stockTag(C, g)}</span></div>
      ${+g.safety > 0 ? `<div class="row muted"><span>安全庫存</span><span class="go">${fmtQ(g.safety)}</span></div>` : ''}${C.stock[g.id] ? '' : '<div class="row muted">新平台還沒有這項的進出貨紀錄</div>'}</div>
    <div class="sec">價格（每 ${esc(g.unit || '單位')}）</div>
    <div class="card list">
      ${sale ? `<div class="row"><span>售價（商品資料）</span><span class="go">${p2(sale)}</span></div><div class="row"><span>毛利率（售價）</span><span class="go">${margin(sale, cost?.c)}</span></div>` : ''}
      <div class="row"><span>成本</span><span class="go">${cost ? p2(cost.c) : '—'}</span></div>
      ${cost ? `<div class="row src">${esc(cost.src)}</div>` : ''}
      <div class="row"><span>牌價（查價表）</span><span class="go">${plat ? p2(plat.per) : '—'}</span></div>
      ${plat ? `<div class="row src">${esc(plat.src)}</div>` : ''}
      <div class="row"><span>毛利率（最近成交價）</span><span class="go" id="mg">…</span></div>
    </div>
    <div class="sec">${c ? esc(cdisp(c)) + ' 上次成交' : '客戶上次成交價'}</div>
    <div class="card list">${c ? (lp ? `<div class="row"><span>${esc(slash(lp.date))}　<span class="muted mono">${esc(lp.no || '')}</span></span><span class="go"><b>${p2(lp.price)}</b> / ${esc(lp.u || g.unit || '')}</span></div><div class="row"><span>毛利率（上次價）</span><span class="go">${margin(lpBase, cost?.c)}</span></div>` : '<div class="row muted">這個客戶沒買過這項</div>') : '<a href="#" id="pick">選客戶 ›</a>'}</div>
    <div class="sec">最近成交（每個客戶最近一次）</div><div class="card list" id="hs"><div class="row muted">載入中…</div></div>
    <div class="sec">供應商（最近進貨）</div>
    <div class="card list">${purs.slice(0, 3).map(x => `<div class="row"><span>${esc(x.cid ? cdisp(C.ct[x.cid]) : '—')}<small class="muted">　${esc(slash(x.date))}</small></span><span class="go">${p2(x.per)}${cost && (x.per > cost.c * 3 || x.per < cost.c / 3) ? '<small class="muted">（單位可能不同）</small>' : ''}</span></div>`).join('') || '<div class="row muted">查不到進貨紀錄</div>'}</div>
    <div class="sec">料號 QR 碼</div><div class="card qrbox" id="qr">…</div>
    `;
  view.querySelector('#tobill').onclick = () => { addToBill(g.id); location.hash = '#bill'; };
  view.querySelector('#pick')?.addEventListener('click', e => { e.preventDefault(); pickCustomer(() => goodsPage(view, gid)); });
  qrSvg(g.code).then(svg => { const b = view.querySelector('#qr'); if (b) b.innerHTML = svg + `<div class="mono">${esc(g.code)}</div>`; }).catch(e => { const b = view.querySelector('#qr'); if (b) b.textContent = e.message; });
  recentSales(view.querySelector('#hs'), g, C).then(rows => {
    const mg = view.querySelector('#mg'); if (!mg) return;
    // 有選客戶且買過：用他的上次價；不然用所有客戶最近一次
    const x = lp ? { price: lp.price, u: lp.u, rate: lp.rate, who: cdisp(c) } : rows[0] ? { ...rows[0], who: cdisp(C.ct[rows[0].cid]) || '' } : null;
    mg.innerHTML = x && cost ? `${margin(perBase(x.price, x.u, g, x.rate), cost.c)}<small class="muted">（${esc(x.who)} ${p2(x.price)}${x.u ? ' / ' + esc(x.u) : ''}）</small>` : '—';
  });
}
async function recentSales(box, g, C) {
  const rows = [];
  for (const b of C.bills) if (b.type === 'SALE') (b.lines || []).forEach(l => { if (l.gid === g.id && +l.price > 0) rows.push({ date: b.date, cid: b.cid, qty: l.qty, price: +l.price, u: l.u, no: b.no }); });
  try { const r = await api.histPrices(g.id, 30); for (const x of r.rows || []) if (x.type === 'SALE') rows.push(x); } catch (e) {}
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no)));
  const seen = new Set(), per = rows.filter(x => { const k = x.cid || '?'; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!box.isConnected) return rows;
  box.innerHTML = per.slice(0, 8).map(x => `<div class="row"><span>${esc(x.cid ? cdisp(C.ct[x.cid]) || '—' : '—')}<small class="muted">　${esc(slash(x.date))}・${fmtQ(x.qty)}</small></span><span class="go">${p2(x.price)}${x.u ? ' / ' + esc(x.u) : ''}</span></div>`).join('') || '<div class="row muted">沒有銷貨紀錄</div>';
  return rows;
}
