// 手機版：經營報表（只看不改）。近 6 個月營收（未稅）長條圖與毛利率、本月客戶排行（金額＋毛利）、缺貨提醒。
// 新平台銷貨單用電腦版同一套成本（C.cogs）；舊系統搬來的銷貨單（2026/11/04 以前）向伺服器查，成本用同樣的推算方式。
import { esc, fmt, money, thisMonth, shiftMonth, fmtQ, today } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { calc, totals, costOf, cdisp } from '../core/calc.js';
import { apYm, apRange } from '../modules/payables.js';
import { histTot } from '../modules/receivables.js';
// 月份一律 25 結（上月 26 日～本月 25 日），跟應收帳款同一套；銷貨單有指定應收月份的照指定
const ymOf = b => b.arYm || apYm(b.date || '');

let HIST = { key: '', rows: null, busy: null };
async function histSales(from, to) {
  const key = from + '~' + to + '|' + (store.histVer || '');
  if (HIST.key === key && HIST.rows) return HIST.rows;
  if (HIST.key === key && HIST.busy) return HIST.busy;
  HIST = { key, rows: null, busy: (async () => {
    const out = [];
    for (const type of ['SALE', 'SALE_RET']) {
      let offset = 0;
      for (;;) { const r = await api.hist({ type, from, to, limit: 1000, offset }); out.push(...r.rows); offset += r.rows.length; if (!r.rows.length || offset >= r.total) break; }
    }
    HIST.rows = out; return out;
  })() };
  return HIST.busy;
}
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return ym + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0'); };

function compute(hist) {
  const C = calc(); const cur = apYm(today()); const months = Array.from({ length: 6 }, (_, i) => shiftMonth(cur, i - 5));
  const M = Object.fromEntries(months.map(m => [m, { m, net: 0, cost: 0, n: 0, hn: 0, hnet: 0, miss: 0 }]));
  const cust = new Map(); const miss = new Map();
  const addM = (b, l) => { if (!l.gid || !C.g[l.gid]) return; const x = miss.get(l.gid) || miss.set(l.gid, { gid: l.gid, n: 0, amt: 0, last: null }).get(l.gid); x.n++; x.amt += Math.round((+l.qty || 0) * (+l.price || 0)); if (!x.last || (b.date || '') > x.last.date) x.last = { date: b.date || '', price: +l.price || 0, u: l.u || '' }; };
  const addC = (cid, net, cost) => { const x = cust.get(cid) || cust.set(cid, { cid, net: 0, cost: 0 }).get(cid); x.net += net; x.cost += cost; };
  for (const b of C.bills) {
    if (b.type !== 'SALE' && b.type !== 'SALE_RET') continue; const x = M[ymOf(b)]; if (!x) continue;
    const s = b.type === 'SALE' ? 1 : -1; const net = s * (C.tot[b.id]?.net || 0), cost = s * (C.cogs[b.id] || 0);
    x.net += net; x.cost += cost; x.n++; x.miss += C.costMiss[b.id] || 0; if (x.m === cur) addC(b.cid, net, cost);
    (b.lines || []).forEach((l, i) => { if (l.gid && !(C.costLn[b.id] || [])[i]) addM(b, l); });
  }
  for (const b of hist || []) {
    const x = M[ymOf(b)]; if (!x) continue; const s = b.type === 'SALE' ? 1 : -1;
    const net = s * histTot(b).net; let cost = 0;
    for (const l of b.lines || []) { if (!l.gid) continue; const r = costOf(l, b.date, C.purIdx, C.g, C.poIdx); if (r) cost += s * r.c * (+l.qty || 0); else { x.miss++; addM(b, l); } }
    x.net += net; x.cost += cost; x.n++; x.hn++; x.hnet += net; if (x.m === cur && b.cid) addC(b.cid, net, cost);
  }
  const low = store.list('goods').filter(g => +g.safety > 0).map(g => ({ g, q: Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0) })).filter(x => x.q < +x.g.safety).sort((a, b) => a.q / a.g.safety - b.q / b.g.safety);
  return { months: months.map(m => M[m]), cust: [...cust.values()].sort((a, b) => b.net - a.net), low, C, miss: [...miss.values()].sort((a, b) => (b.last?.date || '').localeCompare(a.last?.date || '') || b.amt - a.amt) };   // 最近有出貨的排最上面
}

const pct = (p, n) => n ? (p / n * 100).toFixed(1) + '%' : '—';
const short = n => Math.abs(n) >= 1e4 ? (n / 1e4).toFixed(Math.abs(n) >= 1e6 ? 0 : 1) + '萬' : fmt(n);
function chart(ms) {
  const W = 340, H = 170, top = 22, bot = 26, left = 4, gap = 14;
  const max = Math.max(1, ...ms.map(x => x.net)); const bw = (W - left * 2 - gap * (ms.length - 1)) / ms.length; const ph = H - top - bot;
  const bars = ms.map((x, i) => {
    const h = Math.max(0, x.net) / max * ph; const xx = left + i * (bw + gap); const y = top + ph - h; const r = Math.min(4, h, bw / 2);
    const path = h > 0 ? `M${xx},${top + ph} V${y + r} Q${xx},${y} ${xx + r},${y} H${xx + bw - r} Q${xx + bw},${y} ${xx + bw},${y + r} V${top + ph} Z` : '';
    const last = i === ms.length - 1;
    return `<g class="bar${last ? ' cur' : ''}" data-i="${i}"><rect x="${xx - gap / 2}" y="0" width="${bw + gap}" height="${H}" fill="transparent"/>${path ? `<path d="${path}"/>` : ''}
      ${last ? `<text x="${xx + bw / 2}" y="${y - 6}" text-anchor="middle" class="val">${short(x.net)}</text>` : ''}
      <text x="${xx + bw / 2}" y="${H - 8}" text-anchor="middle" class="ax">${+x.m.slice(5)}月</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="近 6 個月營收長條圖"><line x1="0" x2="${W}" y1="${top + ph}" y2="${top + ph}" class="base"/>${bars}</svg>`;
}
export async function reportPage(view) {
  const cur = apYm(today()); const from = apRange(shiftMonth(cur, -6))[0], to = apRange(shiftMonth(cur, 1))[1];   // 前後多抓一個月：指定應收月份的單可能跨月
  const draw = hist => {
    const k = compute(hist); const ms = k.months; const now = ms[ms.length - 1];
    view.innerHTML = `<div class="hd"><a class="back" href="#home">‹ 首頁</a><span class="sp"></span><span class="sub">只看不改</span></div>
      <div class="hd" style="margin-top:0"><h1>經營報表</h1></div>
      <div class="kpis"><div class="card kpi"><span>本月營收（未稅）</span><b>${fmt(now.net)}</b><small>${now.n} 張</small></div>
        <div class="card kpi good"><span>本月毛利</span><b>${fmt(now.net - now.cost)}</b><small>毛利率 ${pct(now.net - now.cost, now.net)}</small></div></div>
      <div class="sec">近 6 個月營收（未稅・25 結）</div>
      <div class="card">${hist ? chart(ms) : '<div class="muted" style="padding:40px 0;text-align:center">載入舊系統資料中…</div>'}<div class="tip" id="tip">點長條看金額</div></div>
      <div class="card list" style="margin-top:8px">${ms.slice().reverse().map(x => `<div class="row"><span>${+x.m.slice(0, 4) - 1911} 年 ${+x.m.slice(5)} 月<small class="muted">　${x.n} 張</small></span><span class="go">${fmt(x.net)}<small class="muted">　毛利率 ${pct(x.net - x.cost, x.net)}</small></span></div>`).join('')}</div>
      ${now.hn ? `<div class="note" style="text-align:left">本月（${apRange(cur).map(d => +d.slice(5, 7) + '/' + +d.slice(8)).join('～')}）含舊系統 ${now.hn} 張（${fmt(now.hnet)} 元），跟首頁、應收帳款一樣新舊一起算。</div>` : ''}
      ${ms.some(x => x.miss) ? `<div class="note" style="text-align:left">有些品項查不到成本（算 0），那幾個月的毛利率會偏高。</div>` : ''}
      <div class="sec">本月客戶排行</div>
      <div class="card list">${k.cust.slice(0, 15).map((x, i) => `<div class="row"><span><span class="muted">${i + 1}.</span> ${esc(cdisp(k.C.ct[x.cid]) || '—')}</span><span class="go">${fmt(x.net)}<small class="muted">　${x.cost ? `毛利 ${fmt(x.net - x.cost)}（${pct(x.net - x.cost, x.net)}）` : '查不到成本'}</small></span></div>`).join('') || '<div class="row muted">本月還沒有銷貨</div>'}</div>
      <div class="sec">缺貨提醒 <span class="muted">${k.low.length} 項低於安全庫存</span></div>
      <div class="card list">${k.low.slice(0, 20).map(x => `<a href="#g/${encodeURIComponent(x.g.id)}"><div class="gm"><b>${esc(x.g.name)}</b><small>${esc(x.g.code)}・安全庫存 ${fmtQ(x.g.safety)}</small></div><span class="go ${x.q <= 0 ? 'bad' : ''}">${fmtQ(x.q)} ›</span></a>`).join('') || '<div class="row muted">沒有低於安全庫存的商品 ✓</div>'}</div>
      <div class="sec" id="nocost">查不到成本的商品 <span class="muted">${k.miss.length} 項・近 6 個月</span></div>
      ${k.miss.length ? `<div class="note" style="text-align:left;margin:0 0 8px">這些商品找不到進貨單、採購單或查價牌價，毛利把成本算成 0。填「每 1 單位的成本」按儲存，會存到商品的「手動成本」（跟電腦版商品資料同一欄），毛利馬上重算。依最近出貨日排序，最近出過貨的在最上面。</div>` : ''}
      <div id="ncl">${k.miss.slice(0, 60).map(x => { const g = k.C.g[x.gid]; return `<div class="card ln" data-g="${x.gid}"><div class="gm"><b>${esc(g.name)}</b><small>${esc(g.code || '')}・${x.n} 筆・${fmt(x.amt)} 元${x.last?.date ? `・最近出貨 ${esc(x.last.date.slice(5).replace('-', '/'))}` : ''}${x.last ? `・最近售價 ${x.last.price}${x.last.u ? '/' + esc(x.last.u) : ''}` : ''}</small></div>
        <div class="lnr nc"><label>成本（每 ${esc(g.unit || '單位')}）<input inputmode="decimal" data-c="${x.gid}" placeholder="例如 0.35"></label><button class="btn ghost" data-sv="${x.gid}">儲存</button></div></div>`; }).join('') || '<div class="card"><div class="row muted">都查得到成本 ✓</div></div>'}</div>
      ${k.miss.length > 60 ? `<div class="note">只列前 60 項（共 ${k.miss.length} 項），填完會自動補上下一批。</div>` : ''}`;
    view.querySelector('#ncl').addEventListener('click', async ev => {
      const b = ev.target.closest('[data-sv]'); if (!b) return; const gid = b.dataset.sv; const inp = view.querySelector(`[data-c="${gid}"]`);
      const v = +String(inp.value).replace(/[,\s]/g, ''); if (!(v > 0)) { inp.focus(); return; }
      const g = store.get('goods', gid); if (!g) return; const { id, ...rest } = g; b.disabled = true;
      try { await store.save('goods', id, { ...rest, cost: v }); store.log('修改', `商品「${g.name}」手動成本 ${v}（手機報表）`); }
      catch (e) { b.disabled = false; alert('儲存失敗：' + e.message); return; }
      const y = window.scrollY; draw(hist); window.scrollTo(0, y);
    });
    const tip = view.querySelector('#tip');
    view.querySelectorAll('.chart .bar').forEach(g => g.addEventListener('click', () => {
      const x = ms[+g.dataset.i]; view.querySelectorAll('.chart .bar').forEach(b => b.classList.toggle('on', b === g));
      tip.textContent = `${+x.m.slice(5)} 月：營收 ${fmt(x.net)}・毛利 ${fmt(x.net - x.cost)}（${pct(x.net - x.cost, x.net)}）・${x.n} 張${x.hn ? `（舊系統 ${x.hn} 張）` : ''}`;
    }));
  };
  draw(HIST.rows && HIST.key.startsWith(from + '~' + to) ? HIST.rows : null);
  try { const h = await histSales(from, to); if (view.isConnected && location.hash.startsWith('#rep')) draw(h); }
  catch (e) { const t = view.querySelector('#tip'); if (t) t.textContent = '舊系統資料載入失敗：' + e.message; }
}
