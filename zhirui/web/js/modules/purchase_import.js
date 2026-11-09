// 匯入進貨單：讀廠商出貨表單（Excel／CSV）→ 自動配對商品 → 建立進貨單
// 比對方式：材質、品名、規格（直徑、長度、頭型）、電鍍，再用「單價和商品成本接近程度」加分；
// 廠商料號配對過一次會記在設定 vmap，下次直接對上。
import { $, esc, fmtQ, fp4, today, uid, toHalf, qTerms, pad, isoOf } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal } from '../core/ui.js';
import { calc, TYPES, costOf, suppliers, uRate } from '../core/calc.js';
import { diaValue, lenValue } from '../core/pricing.js';

const PI_COLS = {
  code: ['產品代號', '廠商料號', '料號', '代號', '貨號', '品號', '產品編號'], name: ['品名規格', '品名/規格', '品名', '商品名稱', '名稱', '品名及規格'], mat: ['材質'], spec: ['規格', '尺寸'], fin: ['電鍍', '表面處理', '處理', '電鍍處理'],
  qty: ['數量', '出貨數量'], unit: ['單位'], price: ['單價', '價格'], amt: ['金額', '小計'], date: ['貨單日期', '日期', '出貨日期', '單據日期'], no: ['貨單編號', '單號', '出貨單號', '單據編號'], memo: ['備註'],
};
let xlsxP = null;
const loadXlsx = () => xlsxP ||= new Promise((res, rej) => { if (window.XLSX) return res(window.XLSX); const s = document.createElement('script'); s.src = '/vendor/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error('Excel 元件載入失敗（web/vendor/xlsx.full.min.js）')); }; document.head.appendChild(s); });

// ---------- 文字正規化與分類 ----------
const piNorm = t => String(t || '').replace(/\s+/g, ' ').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[×xX＊]/g, '*').replace(/\(皿圓\)|皿圓/g, '皿頭').replace(/\(半圓\)/g, '半圓').replace(/六角華司(?!面)/g, '六角華司面').replace(/TP牙/g, '快速牙').replace(/皿\+喇叭頭?/g, '喇叭').replace(/有頭內六角/g, 'CAP內六角').replace(/六角帽/g, '六角螺帽').replace(/(\d)\s*邊/g, '$1').replace(/(\d)\s*厚/g, '$1').replace(/-(六角|螺帽|平華司|彈簧)/g, '$1');
function piText(r) { let t = [r.mat, r.name, r.spec, r.fin].filter(Boolean).join(' '); t = piNorm(t); if (/內六角/.test(t) && !/螺絲|螺栓|止付|螺帽/.test(t)) t += ' 螺絲'; return t; }
function matCls(t) { t = String(t || '').replace(/(紅|青)?古銅|鍍銅|銅底/g, ''); return /白鐵|不鏽|不銹|SUS/i.test(t) ? '不鏽鋼' : /合金|SCM/i.test(t) ? '合金鋼' : /中碳/.test(t) ? '中碳鋼' : /銅/.test(t) ? '銅' : /鋁/.test(t) ? '鋁' : /塑膠|尼龍(?!螺帽)|PVC/i.test(t) ? '塑膠' : /彈簧鋼/.test(t) ? '彈簧鋼' : '鐵'; }
function finCls(t) { t = String(t || ''); return /黑鎳/.test(t) ? '黑鎳' : /鎳/.test(t) ? '鍍鎳' : /五彩/.test(t) ? '五彩' : /三價|白鋅|鍍鋅|電鋅|錏(?!黑)/.test(t) ? '鍍鋅' : /黑身|白皮/.test(t) ? '黑身' : /錏黑/.test(t) ? '錏黑' : /染黑|發黑/.test(t) ? '染黑' : /鉻/.test(t) ? '鍍鉻' : ''; }
const PI_FEAT = [['nyl', /尼龍|DIN.?985/], ['fl', /法蘭|突緣/], ['thin', /薄/], ['cap', /蓋|袋帽|圓型長帽/], ['half', /半牙/], ['wf', /華司面|附墊/], ['tap', /鐵板|自攻|尖尾|割尾|鑽尾|木螺絲|快速牙|TP牙/], ['lock', /耐落|防鬆/]];
const piFeat = t => { const r = new Set(); for (const [k, re] of PI_FEAT) if (re.test(t)) r.add(k); return r; };
const TYPE_RE = [['nut', /螺帽|螺母|帽/], ['sw', /彈簧華司|彈簧墊/], ['fw', /華司|墊片|墊圈/], ['set', /止付|無頭/], ['cap', /CAP|內六角|杯頭|有頭/i], ['hex', /六角/], ['pan', /圓頭|盤頭|傘頭|半圓/], ['flat', /皿頭|大扁|平頭|沉頭/], ['truss', /喇叭|大圓/], ['rivet', /鉚/], ['pin', /梢|銷|針/]];
const DRIVE_RE = [['ph', /⊕|十字|PH/i], ['sl', /Θ|一字/], ['tx', /星型|梅花|T\d{2}|TX/i], ['hs', /內六角/]];
/** 從文字解析規格：直徑（mm）、長度（mm）、類型、驅動、牙系、華司外徑／厚度 */
function spParse(t) {
  const s = piNorm(t); const sp = { type: 'other', D: 0, L: 0, drive: '', th: '', s: 0, k: 0 };
  for (const [k, re] of TYPE_RE) if (re.test(s)) { sp.type = k; break; }
  for (const [k, re] of DRIVE_RE) if (re.test(s)) { sp.drive = k; break; }
  let m, rest = '';
  if ((m = s.match(/(?:^|[^A-Z0-9])(?:M|ST)(\d+(?:\.\d+)?)/i))) { sp.D = +m[1]; sp.th = 'M'; rest = s.slice(m.index + m[0].length); }
  else if ((m = s.match(/(\d+)#/))) { sp.D = diaValue(m[1] + '#'); sp.th = 'W'; rest = s.slice(m.index + m[0].length); }
  else if ((m = s.match(/(?:^|[^\d.\/])((?:\d+-)?\d+\/\d+)(?=["*\s]|$)/))) { sp.D = diaValue(m[1]); sp.th = 'W'; rest = s.slice(m.index + m[0].length); }
  else if ((m = s.match(/(?:^|[^A-Z0-9.])W?(\d+(?:\.\d+)?)\s*\*/i)) && sp.type !== 'other') { sp.D = +m[1]; sp.th = /W\d/.test(m[0]) ? 'W' : 'M'; rest = s.slice(m.index + m[0].length - 1); }
  if (!sp.th) sp.th = /英制|UNC|UNF|W粗牙|"/.test(s) ? 'W' : 'M';
  const nums = []; const re = /\*\s*((?:\d+-)?\d+(?:\.\d+)?(?:\/\d+)?"?)(?:\s*(mm|L|m\/m))?/gi; let x;
  while ((x = re.exec(rest))) nums.push(x[1]);
  const val = v => { const n = lenValue(v); return isFinite(n) ? n : 0; };
  if (sp.type === 'fw' || sp.type === 'sw' || sp.type === 'nut') { if (nums[0]) sp.s = val(nums[0]); if (nums[1]) sp.k = val(nums[1]); }
  else if (nums[0]) sp.L = val(nums[0]);
  return sp;
}
function piScore(sp, D, L, m, f, o) {
  let s = 0; const ft = sp._ft || new Set();
  for (const [k] of PI_FEAT) if (ft.has(k) !== o.ft.has(k)) s -= (k === 'half' ? 8 : 14);
  if (sp.type && sp.type !== 'other' && o.sp.type !== 'other') { if (sp.type === o.sp.type) s += 30; else s -= 25; }
  if (D && o.D) { if (Math.abs(D - o.D) < 0.06) s += 30; else return -999; }
  if (L && o.L) { if (Math.abs(L - o.L) < 0.06) s += 22; else if (Math.abs(L - o.L) <= 0.6) s += 6; else s -= 18; } else if (L || o.L) s -= 4;
  if (m === o.m) s += 15; else s -= 18;
  if (f && o.f) { if (f === o.f) s += 10; else s -= 6; } else if (f || o.f) s -= 2;
  if (sp.drive && o.sp.drive && sp.type === o.sp.type && sp.drive === o.sp.drive) s += 4;
  if (sp.th && o.sp.th && (sp.th === 'W') !== (o.sp.th === 'W')) s -= 10;
  const wsh = sp.type === 'fw' || sp.type === 'sw' || sp.type === 'nut';
  for (const k of ['s', 'k']) if (sp[k] && o.sp[k]) { if (Math.abs(+sp[k] - +o.sp[k]) < 0.06) s += wsh ? 10 : 5; else s -= wsh ? 35 : 5; }
  return s;
}
const piUnit = u => { u = String(u || '').trim(); return /^(H|百|百支|百個)$/i.test(u) ? 'H' : /^(K|千|千支|千個)$/i.test(u) ? 'K' : /^(kg|公斤)$/i.test(u) ? 'KG' : /^(支|只|片|個|顆|粒|pcs|PCS|件)$/.test(u) ? 'PCS' : u || 'PCS'; };
let PIX = null, PIXgen = -1;
function piIndex() {
  const C = calc(); if (PIX && PIXgen === store.gen) return PIX;
  const by = new Map(), all = [];
  for (const g of Object.values(C.g)) {
    const t = piNorm([g.name, g.spec].filter(Boolean).join(' ')); const sp = spParse(t);
    const o = { g, sp, D: sp.D, L: sp.L, m: matCls(g.name + ' ' + (g.cat || '')), f: finCls(g.name), ft: piFeat(t) };
    all.push(o); if (o.D) { const k = Math.round(o.D * 10); (by.get(k) || by.set(k, []).get(k)).push(o); }
  }
  PIX = { by, all }; PIXgen = store.gen; return PIX;
}
const vmap = () => store.setting('vmap').m || {};
function piRefCost(g, price, date, unit) { try { const l = { gid: g.id, qty: 1, price: +price || 0 }; if (unit === 'KG' && (g.unit || 'PCS') !== 'KG') l.u = 'KG'; const r = costOf(l, date); return r ? r.c : null; } catch (e) { return null; } }
function piMatch(r, cid) {
  const t = piText(r); const sp = spParse(t); sp._ft = piFeat(t);
  const D = sp.D, L = sp.L, m = matCls(t), f = finCls(t); const vm = (vmap()[cid] || {})[r.code];
  const X = piIndex(); const out = [];
  const pool = D ? (X.by.get(Math.round(D * 10)) || []) : X.all.filter(o => o.sp.type === sp.type);
  for (const o of pool) { const s = piScore(sp, D, L, m, f, o); if (s > 20) out.push({ o, s }); }
  if (r.code) for (const o of X.all) if ((o.g.code === r.code || o.g.vcode === r.code) && !out.some(x => x.o === o)) out.push({ o, s: 60 });
  for (const x of out) { if (r.code && x.o.g.vcode === r.code) x.s += 60; if (r.code && x.o.g.code === r.code) x.s += 40; if (r.code && String(x.o.g.name).includes(r.code)) x.s += 25; if (vm && x.o.g.id === vm) x.s += 100; }
  out.sort((a, b) => b.s - a.s);
  const top = out.slice(0, 8);
  for (const x of top) { const c = piRefCost(x.o.g, r.price, r.date, r.unit); x.c = c; if (c && r.price > 0) { const q = r.price / c; x.s += q > 0.75 && q < 1.33 ? 15 : q > 0.5 && q < 2 ? 5 : -8; } }
  top.sort((a, b) => b.s - a.s);
  return { sp, cands: top.slice(0, 6), vm };
}
function rocDate(v) {
  if (v instanceof Date) return isNaN(v) ? '' : isoOf(v);
  const s = String(v ?? '').trim(); let m;
  if ((m = s.match(/^(\d{2,3})[\/.-](\d{1,2})[\/.-](\d{1,2})$/))) { const y = +m[1] < 1000 ? +m[1] + 1911 : +m[1]; return `${y}-${pad(m[2])}-${pad(m[3])}`; }
  if ((m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if (/^\d{5}$/.test(s)) return isoOf(new Date(Math.round((+s - 25569) * 864e5)));
  return '';
}

// ---------- 讀檔 ----------
export function importPurchase(onDone) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { await importFromBuffer(await f.arrayBuffer(), f.name, onDone); } catch (e) { toast('讀取失敗：' + (e.message || e)); } };
  inp.click();
}
export async function importFromBuffer(buf, fname, onDone) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  let best = null; const allText = [fname];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
    allText.push(sn); rows.slice(0, 6).forEach(r => allText.push(r.join(' ')));
    for (let h = 0; h < Math.min(12, rows.length); h++) {
      const hdr = rows[h].map(x => String(x).trim()); const map = {};
      for (const [k, syn] of Object.entries(PI_COLS)) { const i = hdr.findIndex(x => syn.includes(x)); if (i >= 0) map[k] = i; }
      if (map.name == null && map.code == null) continue; if (map.qty == null) continue;
      const n = Object.keys(map).length; if (!best || n > best.n) best = { sn, h, map, rows, n };
    }
  }
  if (!best) return toast('找不到「品名」「數量」欄位，請確認表頭');
  const { map, rows, h } = best; const g = (r, k) => map[k] != null ? r[map[k]] : '';
  const items = [];
  for (const r of rows.slice(h + 1)) {
    const name = String(g(r, 'name') || '').trim(), code = String(g(r, 'code') || '').trim(); const qty = parseFloat(g(r, 'qty'));
    if (!(name || code) || !(qty > 0)) continue;
    const price = parseFloat(g(r, 'price')) || (parseFloat(g(r, 'amt')) && qty ? parseFloat(g(r, 'amt')) / qty : 0);
    let unit = piUnit(g(r, 'unit')), q2 = qty, p2 = price, conv = '';
    if (unit === 'H' || unit === 'K') { const f = unit === 'H' ? 100 : 1000; conv = `${fmtQ(qty)} ${String(g(r, 'unit')).trim()} × ${f} → ${fmtQ(qty * f)} PCS，單價 ${fp4(price)} ÷ ${f} → ${fp4(price / f)}`; q2 = qty * f; p2 = price / f; unit = 'PCS'; }
    items.push({ code, name, mat: String(g(r, 'mat') || '').trim(), spec: String(g(r, 'spec') || '').trim(), fin: String(g(r, 'fin') || '').trim(), qty: q2, unit, uRaw: conv ? 'PCS' : String(g(r, 'unit') || ''), conv, price: p2, amt: parseFloat(g(r, 'amt')) || Math.round(qty * price), date: rocDate(g(r, 'date')) || today(), no: String(g(r, 'no') || '').trim(), memo: String(g(r, 'memo') || '').trim() });
  }
  if (!items.length) return toast('表單裡沒有可匯入的明細');
  const txt = allText.join(' '); let sup = null, len = 0;
  for (const c of suppliers()) for (const n of [c.name, c.short]) { const v = String(n || '').trim(); if (v.length >= 2 && v.length > len && txt.includes(v)) { sup = c; len = v.length; } }
  const PI = { items, cid: sup?.id || '', fname, wid: store.list('warehouses')[0]?.id || '', f: 'all', q: '' };
  piRun(PI); piOpen(PI, onDone);
}
function piRun(PI) {
  for (const it of PI.items) {
    const r = piMatch(it, PI.cid); it.cands = r.cands; const b = r.cands[0]; const gap = b ? (b.s - (r.cands[1]?.s ?? 0)) : 0;
    it.conf = !b ? '無' : b.s >= 95 && gap >= 8 ? '高' : b.s >= 70 ? '中' : b.s >= 55 ? '低' : '無';
    it.pick = it.conf === '無' || it.conf === '低' ? 'new' : b.o.g.id;
  }
  const exist = new Set(store.list('bills').filter(b => b.type === 'PUR').map(b => (String(b.note || '').match(/廠商單號\s*(\S+)/) || [])[1]).filter(Boolean));
  for (const it of PI.items) it.dup = !!(it.no && exist.has(it.no));
}
function piCost(it) {
  const sel = it.pick !== 'new' && it.cands.find(x => x.o.g.id === it.pick); if (!sel || !sel.c || !(it.price > 0)) return null;
  const q = it.price / sel.c; const lvl = q >= 0.75 && q <= 1.33 ? 'ok' : q >= 0.5 && q <= 2 ? 'warn' : 'bad'; let hint = '';
  for (const [k, t] of [[100, '每百支'], [1000, '每千支']]) { if (Math.abs(q / k - 1) < 0.3) hint = `表單單價約為成本的 ${k} 倍，可能是${t}計價`; else if (Math.abs(q * k - 1) < 0.3) hint = `商品成本約為表單單價的 ${k} 倍，商品成本可能登成${t}`; }
  if (!hint && (q > 10 || q < 0.1)) hint = `相差 ${q > 1 ? Math.round(q) : Math.round(1 / q)} 倍，可能是單位不同或商品成本登錯`;
  if (!hint) hint = q > 1 ? `表單單價比成本高 ${Math.round((q - 1) * 100)}%` : `表單單價比成本低 ${Math.round((1 - q) * 100)}%`;
  return { q, c: sel.c, lvl, hint };
}
const piF = (it, k) => k === 'all' ? true : k === 'new' ? it.pick === 'new' : k === 'cost' ? (() => { const c = piCost(it); return !!c && c.lvl !== 'ok'; })() : k === 'chk' ? it.pick !== 'new' && (it.conf === '低' || (() => { const c = piCost(it); return !!c && c.lvl !== 'ok'; })()) : it.pick !== 'new' && it.conf === k;
const PI_SYN = [[/^(鐵板牙?|自攻|尖尾)$/, '(鐵板|自攻|尖尾|快速牙|TP牙|割尾|木螺絲)'], [/^(白鐵|不鏽鋼|不銹鋼|SUS)$/i, '(白鐵|不鏽|不銹|SUS)'], [/^(大扁)$/, '(大扁|BAN)'], [/^(華司|墊片)$/, '(華司|墊片)']];
function piShow(PI, it) {
  if (!piF(it, PI.f)) return false; const ts = qTerms(PI.q); if (!ts.length) return true;
  const sel = it.cands.find(x => x.o.g.id === it.pick); const txt = [it.code, it.mat, it.name, it.spec, it.fin, it.no, sel ? sel.o.g.name + ' ' + sel.o.g.code : ''].join(' ');
  return ts.every(t => { const syn = PI_SYN.find(([re]) => re.test(t)); return syn ? new RegExp(syn[1], 'i').test(txt) : txt.toLowerCase().includes(t); });
}

// ---------- 檢視與確認 ----------
function piOpen(PI, onDone) {
  modal({
    title: '匯入進貨單', width: 1500, closeOnBg: false,
    body: '<div id="pi-body" style="min-width:0;max-width:100%;overflow:auto"></div>',
    footer: '<span class="muted sp" id="pi-sum"></span><span class="err" id="pi-err" style="color:var(--bad)"></span><button class="btn" data-close>取消</button><button class="btn pri" id="pi-go">建立進貨單</button>',
    onOpen(m, close) {
      m.style.maxWidth = 'calc(100vw - 24px)'; m.style.width = 'min(100vw - 24px, 1500px)';
      const draw = () => {
        const its = PI.items; const confPill = c => `<span class="pill ${c === '高' ? 'ok' : c === '中' ? 'blue' : c === '低' ? 'warn' : 'bad'}">${c === '無' ? '無配對' : c}</span>`;
        const nNew = its.filter(x => x.pick === 'new' && !(x.skip ?? x.dup)).length, nDup = its.filter(x => x.dup).length; const vis = its.filter(x => piShow(PI, x));
        const bad = its.filter(x => piCost(x)?.lvl === 'bad').length, warn = its.filter(x => piCost(x)?.lvl === 'warn').length;
        const body = $('#pi-body', m); const sc = body.scrollTop;
        body.innerHTML = `<div class="muted small" style="margin-bottom:8px">${esc(PI.fname)}・${its.length} 項・${new Set(its.map(x => x.date + '|' + x.no)).size} 張單</div>
          <div class="grid"><div class="f"><label>供應商</label><select data-pif="cid"><option value="">（請選擇）</option>${suppliers().map(c => `<option value="${c.id}" ${c.id === PI.cid ? 'selected' : ''}>${esc(c.code ? c.code + ' ' : '')}${esc(c.name)}</option>`).join('')}</select></div>
            <div class="f"><label>入庫倉庫</label><select data-pif="wid">${store.list('warehouses').map(w => `<option value="${w.id}" ${w.id === PI.wid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div></div>
          <p class="muted small">系統依「材質、品名、規格、電鍍」比對商品，再用「單價」和商品成本接近程度加分。每行可改選其他候選或「新建商品」；新建的商品以廠商料號當料號，備註「匯入進貨單新增」。按「建立進貨單」後，同一張廠商單號會建成一張進貨單，配對結果會記住，下次同料號直接對上。</p>
          <div class="tools" style="align-items:center"><input type="search" id="pi-q" placeholder="篩選：關鍵字（例如 鐵板牙、白鐵、M4），多個字用逗號隔開" value="${esc(PI.q)}" style="max-width:420px">${[['all', '全部'], ['高', '信心高'], ['中', '信心中'], ['低', '信心低'], ['new', '新建'], ['cost', '成本異常'], ['chk', '需確認']].map(([k, l]) => `<button type="button" class="btn sm ${PI.f === k ? 'pri' : ''}" data-pif-f="${k}">${l}（${its.filter(x => piF(x, k)).length}）</button>`).join('')}<span class="muted small">顯示 ${vis.length} / ${its.length} 項</span></div>
          ${bad + warn ? `<div class="banner">成本異常 <b>${bad}</b> 項（單價和商品成本差 2 倍以上）、偏差 <b>${warn}</b> 項（差 25%～2 倍）。可能是配錯商品、單位不同，或商品成本登錯；滑鼠移到成本欄看原因。</div>` : ''}
          ${nDup ? `<div class="banner">有 ${nDup} 項的廠商單號已經匯入過（已預設略過，可取消勾選「略過」）。</div>` : ''}
          <div class="tw" style="margin-top:8px"><table><thead><tr><th class="nowrap"><label class="check small"><input type="checkbox" data-pi-all ${vis.length && vis.every(x => x.skip ?? x.dup) ? 'checked' : ''}> 略過</label></th><th>廠商單號／日期</th><th>廠商料號</th><th>品名規格</th><th class="n">數量</th><th>單位</th><th class="n">單價</th><th>配對商品</th><th>信心</th><th class="n">成本對照</th></tr></thead><tbody>
          ${its.map((it, i) => { if (!piShow(PI, it)) return ''; const sel = it.cands.find(x => x.o.g.id === it.pick); const skip = it.skip ?? it.dup; const ca = piCost(it);
            return `<tr class="${skip ? 'muted' : ''}" style="${ca && ca.lvl === 'bad' ? 'background:rgba(220,60,60,.10)' : ca && ca.lvl === 'warn' ? 'background:rgba(240,160,30,.12)' : ''}"><td><input type="checkbox" data-pis="${i}" ${skip ? 'checked' : ''}></td><td class="small">${esc(it.no)}<br><span class="muted">${esc(it.date)}</span></td><td class="mono">${esc(it.code)}</td><td style="white-space:normal;min-width:200px">${esc([it.mat, it.name, it.spec, it.fin].filter(Boolean).join(' '))}</td><td class="n">${fmtQ(it.qty)}${it.conv ? `<div class="muted small" title="${esc(it.conv)}">原 ${esc(it.conv.split(' →')[0])}</div>` : ''}</td><td>${esc(it.uRaw || it.unit)}</td><td class="n">${fp4(it.price)}</td>
              <td style="min-width:300px"><select data-pip="${i}" style="width:100%">${it.cands.map(x => `<option value="${x.o.g.id}" ${x.o.g.id === it.pick ? 'selected' : ''}>${esc(x.o.g.code)} ${esc(x.o.g.name)}（${Math.round(x.s)} 分）</option>`).join('')}<option value="new" ${it.pick === 'new' ? 'selected' : ''}>＋ 新建商品：${esc(it.code || '(無料號)')} ${esc(it.name)}</option></select></td>
              <td>${it.pick === 'new' ? `<span class="pill">新建</span>${it.conf === '低' ? '<br><span class="muted small">原配對信心低</span>' : ''}` : confPill(it.conf)}</td>
              <td class="n small" ${ca ? `title="${esc(ca.hint)}"` : ''}>${sel && sel.c ? `${fp4(sel.c)}<br>${ca ? `<span class="${ca.lvl === 'ok' ? 'muted' : 'pill ' + (ca.lvl === 'bad' ? 'bad' : 'warn')}">${Math.round(ca.q * 100)}%${ca.lvl !== 'ok' ? ' ' + (ca.lvl === 'bad' ? '異常' : '偏差') : ''}</span>` : ''}` : '<span class="muted">無成本</span>'}</td></tr>`; }).join('')}</tbody></table></div>`;
        body.scrollTop = sc;
        const use = its.filter(x => !(x.skip ?? x.dup));
        $('#pi-sum', m).textContent = `將建立 ${new Set(use.map(x => x.date + '|' + x.no)).size} 張進貨單（${use.length} 項，略過 ${its.length - use.length} 項）${nNew ? `、新建 ${nNew} 筆商品` : ''}`;
        body.querySelectorAll('[data-pif]').forEach(s => s.addEventListener('change', () => { PI[s.dataset.pif] = s.value; if (s.dataset.pif === 'cid') piRun(PI); draw(); }));
        body.querySelectorAll('[data-pif-f]').forEach(b => b.addEventListener('click', () => { PI.f = b.dataset.pifF; draw(); }));
        body.querySelectorAll('[data-pip]').forEach(s => s.addEventListener('change', () => { its[+s.dataset.pip].pick = s.value; draw(); }));
        body.querySelectorAll('[data-pis]').forEach(c => c.addEventListener('change', () => { its[+c.dataset.pis].skip = c.checked; draw(); }));
        body.querySelector('[data-pi-all]')?.addEventListener('change', ev => { for (const it of its) if (piShow(PI, it)) it.skip = ev.target.checked; draw(); });
        const qi = $('#pi-q', body); let timer; const go = () => { PI.q = qi.value; clearTimeout(timer); timer = setTimeout(() => { const pos = qi.selectionStart; draw(); const q2 = $('#pi-q', m); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} } }, 200); };
        qi.addEventListener('input', ev => { if (ev.isComposing) return; go(); }); qi.addEventListener('compositionend', go);
      };
      draw();
      $('#pi-go', m).onclick = () => piGo(PI, m, close, onDone);
    },
  });
}
async function piGo(PI, m, close, onDone) {
  const btn = $('#pi-go', m); const err = t => { $('#pi-err', m).textContent = t; };
  if (!PI.cid) return err('請選擇供應商'); if (!PI.wid) return err('請選擇入庫倉庫');
  const use = PI.items.filter(it => !(it.skip ?? it.dup)); if (!use.length) return err('沒有要匯入的項目');
  btn.disabled = true; btn.textContent = '建立中…';
  try {
    const C = calc(); const vm = JSON.parse(JSON.stringify(vmap())); const mine = vm[PI.cid] = vm[PI.cid] || {}; const madeByCode = {}; const vfill = new Map();
    const ops = []; let nG = 0, nB = 0; const newGoods = {};
    for (const it of use) {
      if (it.pick !== 'new') { if (it.code) { mine[it.code] = it.pick; const g = C.g[it.pick]; if (g && !g.vcode) vfill.set(g.id, it.code); } continue; }
      const key = it.code || it.name; if (madeByCode[key]) { it.pick = madeByCode[key]; continue; }
      const nm = [it.mat, it.name, it.spec, it.fin].filter(Boolean).join(' ').trim() || it.code; const t = piText(it);
      const doc = { code: it.code || '', vcode: it.code || '', name: nm, spec: '', cat: matCls(t), unit: it.unit === 'KG' ? 'KG' : 'PCS', purPrice: it.unit === 'KG' ? 0 : +it.price || 0, salePrice: 0, safety: 0, note: '匯入進貨單新增' };
      const id = uid('g'); ops.push({ col: 'goods', id, data: doc }); newGoods[id] = doc; it.pick = id; madeByCode[key] = id; if (it.code) mine[it.code] = id; nG++;
    }
    const used = new Set(store.list('bills').map(b => b.no)); const groups = new Map();
    for (const it of use) { const k = it.date + '|' + it.no; (groups.get(k) || groups.set(k, []).get(k)).push(it); }
    for (const arr of groups.values()) {
      const date = arr[0].date; const p = TYPES.PUR.pre + date.replace(/-/g, ''); let i = 1; while (used.has(p + String(i).padStart(3, '0'))) i++; const no = p + String(i).padStart(3, '0'); used.add(no);
      const lines = arr.map(it => { const g = C.g[it.pick] || newGoods[it.pick] || {}; const o = { gid: it.pick, qty: +it.qty, price: +it.price || 0 }; if (it.unit === 'KG' && (g.unit || 'PCS') !== 'KG') { o.u = 'KG'; const r = g.id ? uRate('KG', g) : null; if (r && r !== 1) o.rate = r; } if (it.memo) o.memo = it.memo; return o; });
      ops.push({ col: 'bills', id: uid('b'), data: { type: 'PUR', no, date, cid: PI.cid, wid: PI.wid, note: arr[0].no ? '廠商單號 ' + arr[0].no : '', lines, disc: 0, tax: false, paid: 0, aid: '', createdAt: Date.now(), updatedAt: Date.now(), imp: PI.fname } }); nB++;
    }
    ops.push({ col: 'settings', id: 'vmap', data: { m: vm } });
    for (const [gid, vc] of vfill) { const g = C.g[gid]; if (!g) continue; const { id, ...rest } = g; ops.push({ col: 'goods', id: gid, data: { ...rest, vcode: vc } }); }
    await store.batch(ops);
    store.log('匯入', `進貨表單 ${PI.fname}：${nB} 張進貨單、新建 ${nG} 筆商品`);
    toast(`已建立 ${nB} 張進貨單${nG ? `，新建 ${nG} 筆商品（備註「匯入進貨單新增」）` : ''}`);
    close(); onDone && onDone();
  } catch (e) { btn.disabled = false; btn.textContent = '建立進貨單'; err(e.message || String(e)); }
}
