// 出貨單：中一刀（241×140 mm）列印、格式設定、從 Excel 匯入明細、調整即時庫存、規格圖面快速檢視（移植自舊進銷存）
import { esc, fmt, fmtQ, today, ls, uid, lineSeq } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, printHTML } from '../core/ui.js';
import { calc, TYPES, totals, lineAmt, goodsLabel, goodsWt, lineKg, qtyAt, nextNo, defWh, unitPrice, lastSale } from '../core/calc.js';
import { printName } from '../core/names.js';
import { spGet, spDims, spSVG, spRows, spTable } from '../core/spec.js';
import { loadXlsx } from './purchase_import.js';
import { imageViewer } from '../core/imgview.js';
import { api } from '../core/api.js';

// ---------- 格式 ----------
const FONTS = { jh: ['微軟正黑體', '"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif'], ming: ['細明體', '"MingLiU","細明體","PMingLiU","新細明體",serif'], pming: ['新細明體', '"PMingLiU","新細明體","MingLiU",serif'], kai: ['標楷體', '"DFKai-SB","BiauKai","標楷體","Kaiti TC",serif'], times: ['Times New Roman＋新細明體', '"Times New Roman","PMingLiU","新細明體",serif'] };
const COLS = { pnname: '客料號＋品名', pn: '客料號', name: '品名', code: '料號', qty: '數量', unit: '單位', price: '單價', amt: '金額', memo: '採購單號（明細備註）', seq: '項次', batch: '批號', uwt: '單重 g', wtl: '重量 kg', cat: '類別', blank: '空白欄（自訂標題）' };
const ADD = { seq: { label: '項次', w: 9, align: 'center' }, batch: { label: '批號', w: 22, align: 'left' }, uwt: { label: '單重g', w: 14, align: 'right' }, wtl: { label: '重量kg', w: 16, align: 'right' }, cat: { label: '類別', w: 14, align: 'left' }, blank: { label: '檢驗', w: 16, align: 'center' }, code: { label: '料號', w: 25, align: 'left' }, pn: { label: '客料號', w: 25, align: 'left' }, name: { label: '品　　名', w: 0, align: 'left' } };
const TPL_DEF = {
  paperW: 241, paperH: 140, width: 192, height: 126, rows: 10, lineH: 7.3, font: 'jh', bold: true, dot: true,
  title: '出　　貨　　單', retTitle: '退　　貨　　單', titleSize: 19, headSize: 10.5, custSize: 12.5, bodySize: 13, footSize: 10.5, coSize: 13,
  hdr: { page: true, cust: true, date: true, no: true, phone: false, taxId: false, person: false, addr: false },
  cols: [{ k: 'pnname', label: '客料號　　　品　　名', w: 0, show: true, align: 'left' }, { k: 'pn', label: '客料號', w: 25, show: false, align: 'left' }, { k: 'name', label: '品　　名', w: 0, show: false, align: 'left' }, { k: 'code', label: '料號', w: 25, show: false, align: 'left' },
    { k: 'qty', label: '數　量', w: 18, show: true, align: 'right' }, { k: 'unit', label: '', w: 11, show: true, align: 'left' }, { k: 'price', label: '單價', w: 15, show: true, align: 'right' }, { k: 'amt', label: '金　額', w: 18, show: true, align: 'right' }, { k: 'memo', label: '採購單號', w: 28, show: true, align: 'left' }],
  noteMode: 'memo', showTot: true, showSign: true, extra: '', extraPos: 'foot', foot: { name: true, addr: true, tel: true, fax: true },
};
const OFF_DEF = { left: 6, top: 4 };
const offset = () => ({ ...OFF_DEF, ...(ls.get('zr.shipOffset', {}) || {}) });   // 列印位置：每台電腦各自
export function shipTpl() {
  const s = store.setting('shiptpl').t; const d = JSON.parse(JSON.stringify(TPL_DEF)); if (!s) return d;
  const t = { ...d, ...s, hdr: { ...d.hdr, ...(s.hdr || {}) }, foot: { ...d.foot, ...(s.foot || {}) } };
  if (Array.isArray(s.cols)) { const seen = new Set(); t.cols = s.cols.filter(c => COLS[c.k] && (c.k === 'blank' || !seen.has(c.k) && seen.add(c.k))).map(c => ({ ...d.cols.find(x => x.k === c.k), ...c })); for (const c of d.cols) if (!seen.has(c.k)) t.cols.push({ ...c, show: false }); }
  return t;
}

// ---------- 產生出貨單 ----------
/** opt：noAmt 不印金額、pn 品名前加客料號、tpl 指定格式、preview 預覽（不列印） */
/** 交給伺服器電腦的「列印小幫手」直接印中一刀（不用在瀏覽器選紙張；跟手機版同一條路，印表機在設定 mprint） */
export async function hostPrint(b, opt = {}) {
  const set = store.setting('mprint') || {};
  const o = { ...opt }; if (set.off) o.off = set.off;
  const d = shipDoc(b, o);
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>銷貨單 ${esc(b.no)}</title><style>${d.css}</style></head><body>${d.html}</body></html>`;
  const id = uid('pj');
  await store.save('printjobs', id, { status: 'queued', billId: b.id, no: b.no, type: b.type, fmt: o.pn ? (o.noAmt ? 'fy' : 'pn') : o.noAmt ? 'na' : 'std', printer: set.printer || 'EPSON LQ-310 ESC/P2 (云盒_75 USB3)', html, by: store.user.name, at: new Date().toISOString() });
  store.log('列印', `銷貨單 ${b.no}（電腦版，主機直接列印${o.label ? '，' + o.label : ''}）`);
  toast(`銷貨單 ${b.no} 已交給主機列印（約 10 秒後出紙）`);
  // 印完或失敗時提醒
  const t0 = Date.now(); const chk = () => { const j = store.get('printjobs', id); if (j?.status === 'done') return toast(`銷貨單 ${b.no} 已印出`); if (j?.status === 'failed') return toast(`銷貨單 ${b.no} 列印失敗：${j.msg || ''}`); if (Date.now() - t0 < 90000) setTimeout(chk, 3000); else toast('主機列印還沒完成：請確認伺服器電腦上的列印小幫手有在執行'); };
  setTimeout(chk, 3000);
  return id;
}
export function shipDoc(b, opt = {}) {
  const TP = opt.tpl || shipTpl(); const SO = opt.off || offset(); const NA = !!opt.noAmt, PN = !!opt.pn;
  const C = calc(); const c = C.ct[b.cid] || {}; const co = store.setting('company');
  const t = totals(b); const lines = (b.lines || []).filter(l => l.gid || l.n || (l.txt !== undefined && String(l.txt).trim()));
  const per = Math.max(1, +TP.rows || 10), pages = Math.max(1, Math.ceil(lines.length / per)); const e2 = s => esc(s ?? '');
  const unitOf = l => { const g = C.g[l.gid]; return l.u || (l.unit === 'a' ? g?.aunit : g?.unit) || l.unit || ''; };
  const fq = n => String(Math.round((+n || 0) * 100) / 100), fp = n => String(Math.round((+n || 0) * 10000) / 10000);
  const dt = String(b.date || '').split('-').map((x, i) => i ? String(+x) : x).join('/');
  const anyMemo = lines.some(l => String(l.memo || '').trim());
  const cols = TP.cols.filter(x => x.show && (PN || x.k !== 'pn')).map(x => !PN && x.k === 'pnname' ? { ...x, label: String(x.label).replace(/客料號[　\s]*/, '') || '品　　名' } : x);
  const seqs = lineSeq(lines);
  const val = (k, l, i) => {
    const g = C.g[l.gid];
    switch (k) {
      case 'pnname': return g ? (PN ? [g.spec, g.name].filter(Boolean).join('　') : g.name) : String(l.n || '');
      case 'pn': return g?.spec || ''; case 'name': return g ? g.name : String(l.n || ''); case 'code': return g?.code || '';
      case 'qty': return fq(l.qty); case 'unit': return unitOf(l); case 'price': return NA ? '' : fp(l.price); case 'amt': return NA ? '' : fmt(lineAmt(l));
      case 'memo': if (TP.blankMemo) return ''; return anyMemo ? (l.memo || '') : (TP.noteMode === 'memo' && i === 0 ? (b.note || '') : '');
      case 'seq': return String(seqs[i] || ''); case 'batch': return l.batch || ''; case 'cat': return g?.cat || ''; case 'blank': return '';
      case 'uwt': { if (!g) return ''; const w = goodsWt(g); return w ? String(w) : ''; }
      case 'wtl': { const w = lineKg(l, g); return w ? String(w >= 100 ? Math.round(w * 10) / 10 : Math.round(w * 1000) / 1000) : ''; }
    }
    return '';
  };
  const grid = cols.map(x => TP.tail && x.k === 'memo' ? 'var(--tail,8mm)' : +x.w > 0 ? `${+x.w}mm` : 'minmax(0,1fr)').join(' ');
  const H = TP.hdr, F = TP.foot; const ff = (FONTS[TP.font] || FONTS.jh)[1]; const ink = TP.dot ? '#000' : '#1f2f8f'; const wt = TP.bold ? 'bold' : 'normal';
  const extra = String(TP.extra || '').split('\n').map(x => x.trim()).filter(Boolean);
  const extraHtml = extra.length ? `<div class="ex">${extra.map(x => `<div>${e2(x)}</div>`).join('')}</div>` : '';
  const r3 = [H.phone && c.phone ? `<span><span class="lb">電話：</span>${e2(c.phone)}</span>` : '', H.taxId && c.taxId ? `<span><span class="lb">統一編號：</span>${e2(c.taxId)}</span>` : '', H.person && c.person ? `<span><span class="lb">聯絡人：</span>${e2(c.person)}</span>` : '', H.addr && c.addr ? `<span class="ad"><span class="lb">地址：</span>${e2(c.addr)}</span>` : ''].filter(Boolean).join('');
  const custName = c.name ? printName(c.name) : (b.cn || '');
  let html = '';
  for (let p = 0; p < pages; p++) {
    const rows = lines.slice(p * per, (p + 1) * per); const last = p === pages - 1;
    html += `<div class="page">
    <div class="title">${e2(b.type === 'SALE_RET' ? TP.retTitle : TP.title)}</div>
    ${H.page ? `<div class="r1"><span class="lb">頁　　次：</span><span class="pg">${p + 1} / ${pages}</span></div>` : ''}
    <div class="r2"><div>${H.cust ? `<span class="lb">客戶名稱：</span><span class="cn">${e2(custName)}</span>` : ''}</div>
      <div>${H.date ? `<span class="lb">貨單日期：</span><span class="v">${e2(dt)}</span>` : ''}${H.no ? `<span class="lb">貨單編號：</span><span class="v">${e2(b.no)}</span>` : ''}</div></div>
    ${r3 ? `<div class="r3">${r3}</div>` : ''}
    ${TP.extraPos === 'top' ? extraHtml : ''}
    <div class="dbl"></div>
    <div class="th">${cols.map(x => `<span class="lb" style="text-align:${x.align === 'right' && x.k !== 'pnname' ? 'right' : 'center'}">${e2(x.label)}</span>`).join('')}</div>
    <div class="dbl"></div>
    <div class="body">${rows.map((l, i) => l.txt !== undefined ? `<div class="ln"><span style="grid-column:1/-1"><i>${e2(l.txt)}</i></span></div>` : `<div class="ln">${cols.map(x => `<span class="a-${x.align}"><i>${e2(val(x.k, l, p * per + i))}</i></span>`).join('')}</div>`).join('')}
    ${!last ? '<div class="ln"><span>（續下頁）</span></div>' : ''}
    ${last && TP.noteMode === 'line' && b.note ? `<div class="bn"><span class="lb">備註：</span>${e2(b.note)}</div>` : ''}</div>
    ${TP.extraPos === 'body' ? extraHtml : ''}
    ${TP.showTot ? `<div class="dbl"></div><div class="tot"><span><span class="lb">合　　計：</span><span class="v">${last && !NA ? fmt(t.net) : ''}</span></span><span><span class="lb">稅　　額：</span><span class="v">${last && !NA && t.tax ? fmt(t.tax) : ''}</span></span><span><span class="lb">總　　計：</span><span class="v">${last && !NA ? fmt(t.total) : ''}</span></span>${TP.showSign ? '<span class="sg"><span class="lb">簽收：</span></span>' : ''}</div>` : ''}
    <div class="dbl"></div>
    ${TP.extraPos === 'foot' ? extraHtml : ''}
    <div class="foot">${F.name ? `<span class="co">${e2(co.name || '志瑞螺絲企業有限公司')}</span>` : ''}${F.addr && co.addr ? `<span>${e2(co.addr)}</span>` : ''}${F.tel && co.phone ? `<span><span class="lb">Tel：</span>${e2(co.phone)}</span>` : ''}${F.fax && co.fax ? `<span><span class="lb">Fax：</span>${e2(co.fax)}</span>` : ''}</div>
    </div>`;
  }
  const css = `@page{size:${+TP.paperW}mm ${+TP.paperH}mm;margin:0}
*{box-sizing:border-box}body{margin:0;color:#000;font-family:${ff};font-size:${+TP.headSize}pt;font-weight:${wt}}
.page{width:${+TP.width}mm;height:${+TP.height}mm;margin:${SO.top}mm 0 0 ${SO.left}mm;display:flex;flex-direction:column;page-break-after:always;overflow:hidden}.page:last-child{page-break-after:auto}
@media screen{.page{outline:1px dashed #bbb;margin-bottom:6mm}}
.lb{color:${ink}}
.title{text-align:center;font-size:${+TP.titleSize}pt;font-weight:bold;color:${ink};margin-top:1mm}
.r1{display:flex;justify-content:flex-end;gap:4mm;margin-top:1mm;padding-right:6mm}.pg{min-width:14mm;text-align:center}
.r2{display:flex;justify-content:space-between;align-items:baseline;gap:3mm;padding:0 1mm;margin-top:1mm;white-space:nowrap}.r2>div:first-child{flex:1;min-width:0;overflow:hidden}.r2>div:last-child{flex:none}.r2 .v{margin:0 2mm 0 1mm}
.r3{display:flex;gap:5mm;padding:0 1mm;margin-top:.8mm;white-space:nowrap;overflow:hidden}.r3 .ad{overflow:hidden;text-overflow:ellipsis}
.cn{font-size:${+TP.custSize}pt;font-weight:bold;margin-left:2mm}
.dbl{border-top:${TP.dot ? '1.2pt' : '1.8pt'} solid #000;border-bottom:${TP.dot ? '1.2pt' : '.8pt'} solid #000;height:${TP.dot ? '4pt' : '3.2pt'};margin:1mm 0}
.th,.ln{display:grid;grid-template-columns:${grid};align-items:baseline;column-gap:1.5mm}
.th{padding:.8mm 0;white-space:nowrap}.th>span{overflow:hidden}
.body{flex:1;padding-top:2mm;overflow:hidden}.ln{line-height:${+TP.lineH}mm;white-space:nowrap;font-size:${+TP.bodySize}pt;color:#000}.ln>span{overflow:hidden;min-width:0}.ln>span>i{font-style:normal;display:inline-block;transform-origin:left center}
.a-right{text-align:right;font-variant-numeric:tabular-nums}.a-right>i{transform-origin:right center!important}.a-center{text-align:center}.a-center>i{transform-origin:center!important}
.bn{font-size:${+TP.bodySize - 1}pt;padding:1mm 1mm 0;white-space:nowrap;overflow:hidden}
.tot{display:flex;gap:8mm;align-items:baseline;padding:1mm 2mm;white-space:nowrap}.tot .v{display:inline-block;min-width:22mm;margin-left:2mm}.tot .sg{margin-left:auto;min-width:40mm}
.ex{font-size:${+TP.footSize}pt;padding:.5mm 1mm;line-height:1.35}
.foot{display:flex;align-items:baseline;gap:4mm;padding:1mm 1mm 0;white-space:nowrap;overflow:hidden;font-size:${+TP.footSize}pt}.co{color:${ink};font-size:${+TP.coSize}pt;font-weight:bold;letter-spacing:.1em}`;
  // 太長的字自動壓扁塞進欄寬
  // 列印前自動調整：明細放不下（表頭、合計佔掉高度）就縮小行距，必要時一起縮字，確保這頁的每一筆都印得出來；太寬的字壓窄
  const fit = `<script>(()=>{const U=${TP.uniform ? 1 : 0};
function F(){const all=[...document.querySelectorAll('.ln')];all.forEach(x=>{x.style.lineHeight='';x.style.fontSize='';});const B=all.length?parseFloat(getComputedStyle(all[0]).fontSize):0;document.querySelectorAll('.ln>span>i').forEach(t=>t.style.transform='');
document.querySelectorAll('.page .body').forEach(b=>{const ls=b.querySelectorAll('.ln');if(!ls.length)return;const cs=getComputedStyle(ls[0]);let lh=parseFloat(cs.lineHeight),fs=parseFloat(cs.fontSize),n=0;while(b.scrollHeight>b.clientHeight+0.5&&n++<60){lh*=0.97;if(lh<fs*1.15)fs*=0.97;ls.forEach(x=>{x.style.lineHeight=lh+'px';x.style.fontSize=fs+'px';});}});
if(U&&all.length){let gv=Infinity,gw=Infinity;all.forEach(x=>{const f=parseFloat(getComputedStyle(x).fontSize);gv=Math.min(gv,f);x.querySelectorAll(':scope>span>i').forEach(t=>{const w=t.parentElement.clientWidth,s=t.offsetWidth;if(s>w+0.5)gw=Math.min(gw,f*w/s*0.985);});});const g=Math.min(gv,Math.max(gw,B*0.78));all.forEach(x=>x.style.fontSize=g+'px');}
document.querySelectorAll('.ln>span>i').forEach(t=>{const w=t.parentElement.clientWidth,s=t.offsetWidth;if(s>w+0.5)t.style.transform='scaleX('+(w/s).toFixed(3)+')';});}
const tl=document.getElementById('ryTail');if(tl){let v=8;try{const x=localStorage.getItem('zr.ryTail');if(x!==null&&x!==''&&!isNaN(+x))v=+x;}catch(e){}const set=k=>{v=Math.max(0,Math.min(60,Math.round(k*2)/2));tl.value=v;document.documentElement.style.setProperty('--tail',v+'mm');try{localStorage.setItem('zr.ryTail',v);}catch(e){}F();};
set(v);tl.addEventListener('change',()=>set(+tl.value||0));document.getElementById('ryTm').onclick=()=>set(v-2);document.getElementById('ryTp').onclick=()=>set(v+2);}
window.addEventListener('load',F);})();<\/script>`;
  const tailCtl = TP.tail ? `<div style="margin-bottom:6px"><b>行尾空白</b>（金額右邊留白）：<button id="ryTm" type="button">－</button> <input id="ryTail" type="number" min="0" max="60" step="0.5" style="width:60px"> mm <button id="ryTp" type="button">＋</button>　調整後按 Ctrl+P 再印；這台電腦會記住。每一行字一樣大，品名太長時整張一起縮小。</div>` : '';
  return { css, html: html + fit, tip: `${tailCtl}列印方式：按 Ctrl+P，紙張選 ${+TP.paperW}×${+TP.paperH} mm（中一刀為 241×140），邊界「無」，縮放「預設」或 100%，不要勾「頁首和頁尾」。虛線框是內容範圍；格式和位置可按出貨單上的「格式」修改。` };
}
/** 如陽列印：照如陽舊系統出貨單的樣子（Times New Roman＋新細明體、明細不加粗、欄名「品名規格」）；其他設定沿用出貨單格式 */
export function ruyangTpl() { const t = shipTpl(); t.font = 'times'; t.bold = false; t.blankMemo = true; t.uniform = true; t.tail = true; const c = t.cols.find(x => x.k === 'pnname'); if (c) c.label = '品　　名　　規　　格'; const m = t.cols.find(x => x.k === 'memo'); if (m) { m.show = true; m.label = ''; } return t; }
export function printShip(b, opt = {}) {
  const T = TYPES[b.type] || TYPES.SALE; const d = shipDoc(b, opt);
  printHTML(`${T.name} ${b.no}`, d.css, d.html, { tip: d.tip, delay: 500 });
  store.log('列印', `${T.name} ${b.no}${opt.label ? `（${opt.label}）` : opt.pn && opt.noAmt ? '（料號列印，不含金額）' : opt.noAmt ? '（不含金額）' : opt.pn ? '（料號列印）' : ''}`);
}

// ---------- 格式設定（全公司共用；列印位置每台電腦各自） ----------
function sample(cur) {
  if (cur && (cur.type === 'SALE' || cur.type === 'SALE_RET') && (cur.lines || []).some(l => l.gid || l.n)) return cur;
  const b = store.list('bills').filter(x => x.type === 'SALE' && (x.lines || []).length >= 2).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return b || { type: 'SALE', no: '2611060001', date: today(), cid: '', cn: '範例客戶股份有限公司', note: '範例備註', lines: [{ n: '範例商品 M4*10 鍍鋅鐵M', qty: 1000, price: 0.5, memo: 'PO-0001' }, { n: '範例商品 M5*12 白鐵', qty: 2000, price: 0.8 }] };
}
export function shipFormat(cur) {
  const S = { t: shipTpl(), so: offset() }; const smp = sample(cur);
  modal({
    title: '調整出貨單格式', width: 1500, closeOnBg: false,
    headExtra: '<span class="muted small">右邊即時預覽；格式全公司共用，列印位置（左／上邊界）每台電腦各自設定</span><button class="btn sm" id="stReset">恢復預設</button>',
    body: `<div class="stwrap"><div id="stForm" class="stform"></div><div class="stpv"><div class="muted small">預覽（${esc(smp.no || '')}）・虛線外框＝紙張</div><div id="stPv" class="stpvbox"></div></div></div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>關閉</button><button class="btn pri" id="stSave">儲存</button>',
    onOpen(m, close) {
      m.style.width = 'min(98vw, 1500px)'; m.style.height = '94vh';
      const form = m.querySelector('#stForm'), pv = m.querySelector('#stPv'); let timer = 0;
      const drawForm = () => {
        const t = S.t, so = S.so;
        const num = (k, l, step = 0.5) => `<div class="f"><label>${l}</label><input type="number" step="${step}" data-stn="${k}" value="${esc(t[k])}"></div>`;
        const chk = (grp, k, l) => `<label class="check"><input type="checkbox" data-stc="${grp}.${k}" ${(grp ? t[grp][k] : t[k]) ? 'checked' : ''}> ${l}</label>`;
        const sec = x => `<div class="ptitle" style="padding:10px 0 4px">${x}</div>`;
        form.innerHTML = `${sec('紙張與版面')}<div class="grid">${num('paperW', '紙張寬 mm', 1)}${num('paperH', '紙張高 mm', 1)}${num('width', '內容寬 mm', 1)}${num('height', '內容高 mm', 1)}${num('rows', '每頁明細行數', 1)}${num('lineH', '明細行高 mm', 0.1)}</div>
          ${sec('列印位置（這台電腦）')}<div class="muted small">只移動內容在紙上的位置；一般在 0～20 mm 之間微調。</div><div class="grid"><div class="f"><label>左邊界 mm（大＝往右）</label><input type="number" step="0.5" data-sto="left" value="${so.left}"></div><div class="f"><label>上邊界 mm（大＝往下）</label><input type="number" step="0.5" data-sto="top" value="${so.top}"></div></div>
          ${sec('字體')}<div class="grid"><div class="f"><label>字型</label><select data-sts="font">${Object.entries(FONTS).map(([k, v]) => `<option value="${k}" ${t.font === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div><div class="f"><label>&nbsp;</label>${chk('', 'bold', '粗體')}</div>
            ${num('titleSize', '標題字 pt')}${num('headSize', '抬頭字 pt')}${num('custSize', '客戶名稱字 pt')}${num('bodySize', '明細字 pt')}${num('footSize', '頁尾字 pt')}${num('coSize', '公司名稱字 pt')}</div>
          <div>${chk('', 'dot', '點陣印表機模式（全黑，不用藍色）')}</div>
          ${sec('標題')}<div class="grid"><div class="f"><label>出貨單標題</label><input data-stt="title" value="${esc(t.title)}"></div><div class="f"><label>退貨單標題</label><input data-stt="retTitle" value="${esc(t.retTitle)}"></div></div>
          ${sec('抬頭欄位')}<div class="chks">${chk('hdr', 'page', '頁次')}${chk('hdr', 'cust', '客戶名稱')}${chk('hdr', 'date', '貨單日期')}${chk('hdr', 'no', '貨單編號')}${chk('hdr', 'phone', '客戶電話')}${chk('hdr', 'taxId', '統一編號')}${chk('hdr', 'person', '聯絡人')}${chk('hdr', 'addr', '客戶地址')}</div>
          ${sec('明細欄位')}<div class="muted small" style="margin-bottom:4px">勾選要印的欄位；寬度 0＝自動填滿剩餘空間；用 ↑↓ 調整順序。</div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><select id="stAddK">${Object.keys(ADD).map(k => `<option value="${k}">${COLS[k]}</option>`).join('')}</select><button class="btn sm" id="stAdd">＋ 新增欄位</button></div>
          <table class="lines sttbl"><thead><tr><th>印</th><th>欄位</th><th>標題文字</th><th>寬 mm</th><th>對齊</th><th></th></tr></thead><tbody>
          ${t.cols.map((c, i) => `<tr><td><input type="checkbox" data-stcol="${i}" data-f="show" ${c.show ? 'checked' : ''}></td><td class="small">${COLS[c.k]}</td><td><input data-stcol="${i}" data-f="label" value="${esc(c.label)}"></td><td><input type="number" step="1" data-stcol="${i}" data-f="w" value="${c.w}"></td><td><select data-stcol="${i}" data-f="align"><option value="left" ${c.align === 'left' ? 'selected' : ''}>左</option><option value="center" ${c.align === 'center' ? 'selected' : ''}>中</option><option value="right" ${c.align === 'right' ? 'selected' : ''}>右</option></select></td><td class="nowrap"><button class="btn xs" data-stmv="${i}" data-d="-1" ${i ? '' : 'disabled'}>↑</button><button class="btn xs" data-stmv="${i}" data-d="1" ${i < t.cols.length - 1 ? '' : 'disabled'}>↓</button>${ADD[c.k] && !TPL_DEF.cols.some(d => d.k === c.k) ? `<button class="btn xs danger" data-stdel="${i}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>
          ${sec('備註')}<div class="f"><label>整張單備註印在哪裡</label><select data-sts="noteMode"><option value="memo" ${t.noteMode === 'memo' ? 'selected' : ''}>各行沒填備註時，印在第一行採購單號欄</option><option value="line" ${t.noteMode === 'line' ? 'selected' : ''}>明細下方另起一行「備註：…」</option><option value="none" ${t.noteMode === 'none' ? 'selected' : ''}>不印</option></select></div>
          <div class="f"><label>固定備註文字（每張都印，可多行，例如「貨品如有問題請於 7 日內通知」）</label><textarea data-stt="extra" rows="3">${esc(t.extra || '')}</textarea></div>
          <div class="f"><label>固定備註位置</label><select data-sts="extraPos"><option value="top" ${t.extraPos === 'top' ? 'selected' : ''}>抬頭下方</option><option value="body" ${t.extraPos === 'body' ? 'selected' : ''}>明細下方</option><option value="foot" ${t.extraPos === 'foot' ? 'selected' : ''}>公司資料上方</option></select></div>
          ${sec('合計與頁尾')}<div class="chks">${chk('', 'showTot', '合計／稅額／總計列')}${chk('', 'showSign', '簽收欄')}${chk('foot', 'name', '公司名稱')}${chk('foot', 'addr', '地址')}${chk('foot', 'tel', '電話')}${chk('foot', 'fax', '傳真')}</div>
          <div class="muted small" style="margin-top:8px">公司名稱、地址、電話在「設定備份 → 公司資料」修改。</div>`;
      };
      const preview = () => {
        clearTimeout(timer); timer = setTimeout(() => {
          const t = S.t; const d = shipDoc(smp, { tpl: t, off: S.so, pn: true });
          const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${d.css}html,body{background:#fff;overflow:hidden}</style></head><body>${d.html}</body></html>`;
          const pw = t.paperW * 3.7795, ph = t.paperH * 3.7795; const sc = Math.min(1.6, Math.max(0.3, (pv.clientWidth - 30) / pw));
          pv.innerHTML = `<div style="width:${pw * sc}px;height:${ph * sc}px;position:relative"><iframe title="出貨單預覽" style="position:absolute;left:0;top:0;width:${pw}px;height:${ph}px;border:1px dashed #889;background:#fff;transform:scale(${sc});transform-origin:0 0"></iframe></div>`;
          pv.querySelector('iframe').srcdoc = doc;
        }, 120);
      };
      const onInput = ev => {
        const x = ev.target, d = x.dataset || {}; const t = S.t;
        if (d.stn !== undefined) { const v = parseFloat(x.value); if (isFinite(v)) t[d.stn] = v; }
        else if (d.stt !== undefined) t[d.stt] = x.value;
        else if (d.sts !== undefined) t[d.sts] = x.value;
        else if (d.sto !== undefined) { const v = parseFloat(x.value); if (isFinite(v)) S.so[d.sto] = v; }
        else if (d.stc !== undefined) { const [g, k] = d.stc.split('.'); if (g) t[g][k] = x.checked; else t[k] = x.checked; }
        else if (d.stcol !== undefined) { const c = t.cols[+d.stcol]; if (d.f === 'show') c.show = x.checked; else if (d.f === 'w') { const v = parseFloat(x.value); c.w = isFinite(v) ? v : 0; } else c[d.f] = x.value; }
        else return;
        preview();
      };
      form.addEventListener('input', onInput); form.addEventListener('change', onInput);
      form.addEventListener('click', ev => {
        const b = ev.target.closest('button'); if (!b) return; const cs = S.t.cols;
        if (b.id === 'stAdd') { const k = form.querySelector('#stAddK').value; const ex = cs.find(c => c.k === k); if (ex && k !== 'blank') { ex.show = true; toast(`「${COLS[k]}」已經有了，已勾選列印`); } else { const d = ADD[k]; const at = cs.findIndex(c => c.k === 'memo'); cs.splice(at >= 0 ? at : cs.length, 0, { k, label: d.label, w: d.w, show: true, align: d.align }); } }
        else if (b.dataset.stmv !== undefined) { const i = +b.dataset.stmv, j = i + +b.dataset.d; [cs[i], cs[j]] = [cs[j], cs[i]]; }
        else if (b.dataset.stdel !== undefined) cs.splice(+b.dataset.stdel, 1);
        else return;
        drawForm(); preview();
      });
      m.querySelector('#stReset').onclick = async () => { if (!await confirm('格式恢復成預設值？（按儲存才會生效）', { ok: '恢復預設' })) return; S.t = JSON.parse(JSON.stringify(TPL_DEF)); S.so = { ...OFF_DEF }; drawForm(); preview(); };
      m.querySelector('#stSave').onclick = async () => {
        if (!S.t.cols.some(c => c.show)) return toast('至少要印一個明細欄位');
        ls.set('zr.shipOffset', { left: S.so.left, top: S.so.top });
        await store.saveSetting('shiptpl', { t: S.t }); store.log('修改', '出貨單格式'); toast('出貨單格式已儲存'); close();
      };
      drawForm(); preview();
    },
  });
}

// ---------- 從 Excel 匯入明細（客料號、數量、採購單號） ----------
export async function shipTemplateXlsx() {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([['客料號', '數量', '採購單號'], ['AH1-00002', 20000, '3200086466'], ['AH1-00003', 30000, '3200086222']]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '出貨明細'); XLSX.writeFile(wb, '出貨明細匯入範本.xlsx');
}
/** 讀 Excel，回傳要加入的明細 {add, miss, multi}；edit 是目前的單據（用來找上次單價） */
export async function shipImportLines(file, edit) {
  const XLSX = await loadXlsx(); const C = calc();
  const wb = XLSX.read(await file.arrayBuffer()); const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }).filter(r => r.some(c => String(c).trim() !== ''));
  const norm = x => String(x).replace(/[\s*＊:：]/g, '');
  const al = { spec: ['客料號', '客戶料號', '客户料号', '規格', '規格型號', '规格', '规格型号', '品號', '料號規格'], qty: ['數量', '数量', '出貨數量', '訂購數量', 'QTY'], po: ['採購單號', '采购单号', '訂單號碼', '訂單號', 'PO', 'PO號碼', '客戶訂單號'] };
  const hi = aoa.findIndex(r => r.some(c => al.spec.includes(norm(c)))); if (hi < 0) throw new Error('找不到「客料號」欄，第一列請寫：客料號、數量、採購單號');
  const head = aoa[hi].map(norm); const ix = {}; for (const k in al) ix[k] = head.findIndex(h => al[k].some(a => a.toUpperCase() === h.toUpperCase()));
  if (ix.qty < 0) throw new Error('找不到「數量」欄');
  const N = x => String(x ?? '').trim().toUpperCase();
  const goods = store.list('goods'); const bySpec = new Map(); for (const g of goods) for (const k0 of [g.spec, g.spec2]) { const k = N(k0); if (!k) continue; const a = bySpec.get(k) || bySpec.set(k, []).get(k); if (!a.includes(g)) a.push(g); }
  const byCode = new Map(); for (const g of goods) { const k = N(g.code); if (k && !byCode.has(k)) byCode.set(k, g); }
  const add = [], miss = [], multi = [];
  for (const r of aoa.slice(hi + 1)) {
    const sp = String(r[ix.spec] ?? '').trim(); const qty = +String(r[ix.qty] ?? '').replace(/,/g, '') || 0; const po = ix.po >= 0 ? String(r[ix.po] ?? '').trim() : '';
    if (!sp && !qty) continue;
    let cands = bySpec.get(N(sp)) || []; if (!cands.length && byCode.get(N(sp))) cands = [byCode.get(N(sp))];
    let g = null; if (cands.length === 1) g = cands[0]; else if (cands.length > 1) { g = cands.find(x => lastSale(edit.cid, x.id, edit.date, edit.id)) || cands[0]; multi.push(sp); }
    if (!g) { miss.push(sp); continue; }
    const l = { gid: g.id, qty, price: '', memo: po };
    const x = lastSale(edit.cid, g.id, edit.date, edit.id);
    if (x) { l.price = x.price; if (x.u) l.u = x.u; if (x.unit === 'a' && g.aunit) { l.unit = 'a'; l.rate = +g.arate || 1; } }
    else { const p = unitPrice(g, edit.type); if (p !== '') l.price = p; }
    add.push(l);
  }
  return { add, miss, multi, C };
}

// ---------- 調整即時庫存（出貨後盤點，差異開其他入庫／出庫單） ----------
export function stockAdjust(b) {
  const C = calc(); const wid = b.wid || defWh()?.id; const seen = new Set();
  const rows = (b.lines || []).filter(l => l.gid && C.g[l.gid] && !seen.has(l.gid) && seen.add(l.gid)).map(l => ({ gid: l.gid, g: C.g[l.gid], sys: qtyAt(l.gid, wid) }));
  if (!rows.length) return toast('這張單沒有可調整的商品');
  const prev = store.list('bills').filter(x => x.ref === b.id && (x.type === 'IN' || x.type === 'OUT'));
  const wn = C.wh[wid]?.name || '倉庫';
  modal({
    title: '調整即時庫存（出貨後盤點）', width: 860,
    body: `<div class="muted small">「系統庫存」是目前${esc(wn)}的數量（已扣掉這張出貨）。在「實際盤點數」填點到的數量，差異會自動開一張其他入庫／其他出庫單補平。${prev.length ? `<br><b>這張銷貨單已調整過 ${prev.length} 次：${prev.map(x => esc(x.no)).join('、')}</b>` : ''}</div>
      <div class="tw"><table><thead><tr><th>商品</th><th class="n">系統庫存</th><th class="n">實際盤點數</th><th class="n">差異</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${esc(goodsLabel(r.g))}</td><td class="n">${fmtQ(r.sys)} <span class="muted">${esc(r.g.unit || '')}</span></td><td class="n"><input class="num sk-q" data-i="${i}" inputmode="decimal" placeholder="${fmtQ(r.sys)}" style="width:120px"></td><td class="n" id="sk-d-${i}">—</td></tr>`).join('')}</tbody></table></div>
      <div class="muted small">沒填的商品不調整。</div>`,
    footer: '<span class="sp"></span><span class="err" id="skErr"></span><button class="btn" data-close>取消</button><button class="btn pri" id="skGo">確認調整</button>',
    onOpen(m, close) {
      m.addEventListener('input', ev => { const t = ev.target; if (!t.classList.contains('sk-q')) return; const i = +t.dataset.i; const d = m.querySelector('#sk-d-' + i); if (t.value === '') { d.textContent = '—'; d.style.color = ''; return; } const diff = (+t.value || 0) - rows[i].sys; d.textContent = (diff > 0 ? '+' : '') + fmtQ(diff); d.style.color = diff > 0 ? 'var(--ok)' : diff < 0 ? 'var(--bad)' : ''; });
      m.querySelector('#skGo').onclick = async ev => {
        const ins = [], outs = [];
        m.querySelectorAll('.sk-q').forEach(t => { if (t.value === '') return; const r = rows[+t.dataset.i]; const diff = Math.round(((+t.value || 0) - r.sys) * 1000) / 1000; if (diff > 0) ins.push({ gid: r.gid, qty: diff, price: 0 }); else if (diff < 0) outs.push({ gid: r.gid, qty: -diff, price: 0 }); });
        if (!ins.length && !outs.length) { m.querySelector('#skErr').textContent = '沒有差異，不需要調整'; return; }
        ev.target.disabled = true; const d = today(); const made = []; const ops = []; const used = store.list('bills');
        for (const [type, lines] of [['IN', ins], ['OUT', outs]]) {
          if (!lines.length) continue; const no = nextNo(type, d, [...used, ...ops.map(o => o.data)]);
          ops.push({ col: 'bills', id: uid('b'), data: { type, no, date: d, wid, lines, ref: b.id, note: `盤點調整（銷貨單 ${b.no}）`, createdAt: Date.now(), updatedAt: Date.now(), createdBy: store.user.id } });
          made.push(`${TYPES[type].name} ${no}`);
        }
        await store.batch(ops); store.log('新增', `${made.join('、')}｜盤點調整（銷貨單 ${b.no}）`); close(); toast('已調整：' + made.join('、'));
      };
      setTimeout(() => m.querySelector('.sk-q')?.focus(), 50);
    },
  });
}

// ---------- 規格・圖面 快速檢視 ----------
export function specView(g) {
  const sp = spGet(g), dm = spDims(sp);
  modal({
    title: `${g.code || ''} ${g.name}　規格・圖面`, width: 900,
    body: `<div class="sppv" style="margin:0"><div>${spSVG(sp, dm)}</div><div class="spside"><table class="sprows">${spRows(sp, dm).map(([l, x]) => `<tr><th>${esc(l)}</th><td>${esc(x)}</td></tr>`).join('')}</table></div></div>${spTable(sp, dm)}
      ${g.dwg ? `<div class="dwgbar">${/pdf/.test(g.dwg.type) ? '<span class="dwgpdf">PDF</span>' : `<img class="dwgthumb" src="/api/files/${encodeURIComponent(g.dwg.id)}?n=${encodeURIComponent(g.dwg.name || '')}" alt="" data-dwgv>`}<span class="muted small sp">客戶圖面：${esc(g.dwg.name)}</span>${/pdf/.test(g.dwg.type) ? `<a class="btn sm" target="_blank" href="/api/files/${encodeURIComponent(g.dwg.id)}?n=${encodeURIComponent(g.dwg.name || '')}">查看圖面</a>` : '<button type="button" class="btn sm" data-dwgv>查看圖面</button>'}</div>` : ''}`,
    footer: '<span class="sp"></span><button class="btn" data-close>關閉</button>',
    onOpen(el) {
      const u = g.dwg && `/api/files/${encodeURIComponent(g.dwg.id)}?n=${encodeURIComponent(g.dwg.name || '')}`;
      el.querySelectorAll('[data-dwgv]').forEach(b => b.addEventListener('click', () => imageViewer({ url: u, title: `${g.code || ''} ${g.name}　客戶圖面`, name: g.dwg.name || '', dl: u + '&dl=1' })));
    },
  });
}
/** 出貨單總重（kg），回傳 {kg, miss} */
export function billKg(b) { const C = calc(); let kg = 0, miss = 0; for (const l of b.lines || []) { if (!l.gid || l.txt !== undefined) continue; const w = lineKg(l, C.g[l.gid]); if (w > 0) kg += w; else miss++; } return { kg, miss }; }
export const kgText = ({ kg, miss }) => kg || !miss ? `${kg >= 100 ? Math.round(kg * 10) / 10 : Math.round(kg * 1000) / 1000} kg${miss ? `（${miss} 項無重量）` : ''}` : '—';

// ---------- 崧泉 ERP「訂單出貨憑證」PDF：伺服器拆成文字＋表格，這裡整理成單頭與明細 ----------
export async function songquanParse(file) {
  const r = await fetch('/api/pdf/parse', { method: 'POST', body: file, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  const text = j.pages.map(p => p.text).join('\n');
  if (!/訂單出貨憑證/.test(text)) throw new Error('這份 PDF 不是崧泉的「訂單出貨憑證」');
  const fld = k => { const m = text.match(new RegExp(k + '[:：][ \\t]*([^\\n]*)')); return m ? m[1].trim() : ''; };
  const head = { sn: fld('出貨單號'), date: fld('出貨日期'), inv: fld('發票號碼'), invDate: fld('發票日期'), addr: fld('送貨地址'), note: fld('備註'), vendor: fld('供應商名') };
  if (!head.sn) throw new Error('找不到出貨單號');
  // QR 碼（內容就是出貨單號）：第一頁上方、接近正方形的小圖，原圖存下來，崧泉列印照印
  const pg0 = j.pages[0] || {}; const ph = (pg0.size || [0, 842])[1];
  const qr = (pg0.images || []).find(im => im.rect && im.w && Math.abs(im.w - im.h) <= im.w * 0.1 && im.rect[1] < ph * 0.3);
  if (qr) head.qr = `data:image/${qr.ext === 'jpg' ? 'jpeg' : qr.ext};base64,${qr.data}`;
  // 儲存格裡的換行接回去：英數字接英數字中間補空白，其餘（中文、連字號結尾）直接接
  const J = x => String(x ?? '').split('\n').map(s => s.trim()).filter(Boolean).reduce((a, s) => a && /[A-Za-z0-9"]$/.test(a) && /^[A-Za-z0-9]/.test(s) ? a + ' ' + s : a + s, '');
  const num = x => +String(x ?? '').replace(/[,\s]/g, '') || 0;
  const KEYS = { po: '採購單號', item: '項次', pn: '品號', name: '品名', spec: '規格', unit: '單位', poQty: '採購數量', qty: '交貨數量' };
  const rows = []; let ix = null;
  for (const p of j.pages) for (const t of p.tables) {
    let body = t; const h = (t[0] || []).map(c => J(c).replace(/\s/g, ''));
    if (h.includes('採購單號') && h.includes('品號')) { ix = {}; for (const k in KEYS) ix[k] = h.indexOf(KEYS[k]); body = t.slice(1); }
    if (!ix) continue;
    for (const row of body) {
      const v = k => ix[k] >= 0 ? J(row[ix[k]]) : '';
      if (!v('pn') && !v('name')) continue;
      rows.push({ po: v('po'), item: v('item'), pn: v('pn'), name: v('name'), spec: v('spec'), unit: v('unit'), poQty: num(v('poQty')), qty: num(v('qty')) });
    }
  }
  if (!rows.length) throw new Error('PDF 裡找不到明細表');
  return { head, rows };
}
/** 崧泉明細 → 銷貨單的行：品號／規格比對商品的客料號、第二客料號；帶上次單價；原始資料存在 l.sq（重印用） */
export function songquanLines(P, edit) {
  const N = x => String(x ?? '').trim().toUpperCase();
  const idx = new Map(); const put = (k, g) => { k = N(k); if (!k) return; const a = idx.get(k) || idx.set(k, []).get(k); if (!a.includes(g)) a.push(g); };
  for (const g of store.list('goods')) { put(g.spec, g); put(g.spec2, g); }
  const add = [], miss = [], multi = [];
  for (const r of P.rows) {
    let cands = [...(idx.get(N(r.pn)) || [])]; if (!cands.length && r.spec) cands = [...(idx.get(N(r.spec)) || [])];
    let g = null; if (cands.length === 1) g = cands[0]; else if (cands.length > 1) { g = cands.find(x => lastSale(edit.cid, x.id, edit.date, edit.id)) || cands[0]; multi.push(r.pn); }
    const sq = { sn: P.head.sn, ...r };
    if (!g) { miss.push(r.pn || r.name); add.push({ gid: '', n: [r.pn, r.name].filter(Boolean).join(' '), qty: r.qty, price: '', memo: r.po, sq }); continue; }
    const l = { gid: g.id, qty: r.qty, price: '', memo: r.po, sq };
    const x = lastSale(edit.cid, g.id, edit.date, edit.id);
    if (x) { l.price = x.price; if (x.u) l.u = x.u; if (x.unit === 'a' && g.aunit) { l.unit = 'a'; l.rate = +g.arate || 1; } }
    else { const p = unitPrice(g, edit.type); if (p !== '') l.price = p; }
    add.push(l);
  }
  return { add, miss, multi };
}
/** 崧泉列印：一張 A4 直式印上下兩份（中間虛線可裁開），版面緊湊、字放大；一張崧泉出貨單一組，沒匯入的行另成一組 */
export function printSongquan(b) {
  const C = calc(); const co = store.setting('company'); const e2 = s => esc(s ?? '');
  const lines = (b.lines || []).filter(l => l.txt === undefined && (l.gid || l.n) && +l.qty > 0);
  const ships = (b.sq || []).filter(s => s && s.sn);
  const groups = ships.map(s => ({ s, ls: lines.filter(l => l.sq && l.sq.sn === s.sn) }));
  const rest = lines.filter(l => !l.sq || !ships.some(s => s.sn === l.sq.sn));
  if (rest.length) groups.push({ s: { sn: b.no, date: String(b.date || '').replace(/-/g, '/') }, ls: rest });
  const unitOf = l => { const g = C.g[l.gid]; return l.u || (l.unit === 'a' ? g?.aunit : g?.unit) || ''; };
  const q2 = n => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = l => { const g = C.g[l.gid]; const x = l.sq || {};
    return { po: x.po || l.memo || '', item: x.item || '', pn: x.pn || g?.spec || '', name: x.name || g?.custName || g?.name || l.n || '', spec: x.spec != null ? x.spec : (g?.spec2 || ''), unit: x.unit || unitOf(l), poQty: x.poQty != null ? x.poQty : +l.qty, qty: +l.qty }; };
  // 依品名實際寬度估每行高度：用列印字型量品名會折成幾行（品名欄約 21% 寬、10pt），每行至少 10mm（數量格下方留白可寫備註）
  const cv = document.createElement('canvas').getContext('2d'); cv.font = '13.33px "MingLiU","PMingLiU","新細明體",serif';
  const AVAIL = 190 * 3.7795 * 0.21 - 2.4 * 3.7795 - 2;
  const linesOf = t => { let n = 1, w = 0; for (const ch of String(t || '')) { const cw = cv.measureText(ch).width; if (w + cw > AVAIL && w > 0) { n++; w = cw; } else w += cw; } return n; };
  const rowH = r => Math.max(10, linesOf(r.name) * 4.42 + 1.9);
  const paginate = rs => { const out = []; let cur = [], h = 0; for (const r of rs) { const rh = rowH(r); if (cur.length && h + rh > 100) { out.push(cur); cur = []; h = 0; } cur.push(r); h += rh; } if (cur.length) out.push(cur); return out.length ? out : [[]]; };
  const copy = (s, rs, p, pages) => `<div class="cp"><div class="hdr"><div class="hl"><div class="top"><h1>訂單出貨憑證</h1><span class="pno">頁次:${p + 1}/${pages}</span></div>
    <div class="hd"><div>供應商名:${e2(co.name || '志瑞螺絲企業有限公司')}</div><div>出貨單號:<b>${e2(s.sn)}</b></div><div>出貨日期:${e2(s.date)}</div><div>發票號碼:${e2(s.inv || '')}</div><div>發票日期:${e2(s.invDate || '')}</div><div>送貨地址:${e2(s.addr || '')}</div>${s.note ? `<div class="w">備註:${e2(s.note)}</div>` : ''}</div></div>${s.qr ? `<img class="qr" src="${s.qr}" alt="QR">` : ''}</div>
    <table><thead><tr><th>採購單號</th><th>項次</th><th>品號</th><th>品名</th><th>規格</th><th>單位</th><th class="n">採購數量</th><th class="n">交貨數量</th></tr></thead><tbody>
    ${rs.map(r => `<tr><td>${e2(r.po)}</td><td class="c">${e2(r.item)}</td><td class="pn">${e2(r.pn)}</td><td class="nm">${e2(r.name)}</td><td>${e2(r.spec)}</td><td class="c">${e2(r.unit)}</td><td class="n">${q2(r.poQty)}</td><td class="n">${q2(r.qty)}</td></tr>`).join('')}
    </tbody></table><div class="sg"><span>收貨人員：____________________</span><span>廠商簽章：____________________</span></div></div>`;
  let html = '';
  for (const { s, ls } of groups.filter(g => g.ls.length)) {
    const parts = paginate(ls.map(row)); const pages = parts.length;
    parts.forEach((part, p) => { html += `<div class="pg">${copy(s, part, p, pages)}<div class="cut"></div>${copy(s, part, p, pages)}</div>`; });
  }
  const css = `@page{size:A4 portrait;margin:5mm 9mm}*{box-sizing:border-box}body{margin:0;font-family:"MingLiU","PMingLiU","新細明體",serif;font-size:13pt;color:#000}
.pg{display:flex;flex-direction:column;page-break-after:always;page-break-inside:avoid}.pg:last-child{page-break-after:auto}
@media screen{body{background:#eee}.pg{width:192mm;min-height:287mm;background:#fff;margin:0 auto 6mm;padding:0 2mm;box-shadow:0 0 0 1px #ccc}}
.cp{height:141mm;overflow:hidden;padding-top:2mm}.cp:last-child{height:auto;max-height:141mm}.hdr{display:flex;align-items:flex-start;gap:3mm}.hl{flex:1;min-width:0}.qr{width:17mm;height:17mm;image-rendering:pixelated;flex:none}.cut{border-top:1px dashed #888;margin:0 -2mm}
.top{display:flex;align-items:baseline;justify-content:center;position:relative}.top h1{font-size:15pt;font-weight:bold;margin:0 0 1.5mm;letter-spacing:3pt}.pno{position:absolute;right:0;top:0;font-size:10pt}
.hd{display:grid;grid-template-columns:repeat(3,max-content);justify-content:space-between;white-space:nowrap;row-gap:.8mm;column-gap:4mm;margin-bottom:1.8mm;font-size:10.5pt}.hd .w{grid-column:1/-1;white-space:normal}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12.5pt}th,td{border:1px solid #000;padding:.8mm 1.2mm;vertical-align:middle;text-align:left;font-weight:normal;word-break:break-all;line-height:1.25}
th{background:#f2f2f2;font-size:10.5pt;white-space:nowrap;padding-top:.5mm;padding-bottom:.5mm}th:nth-child(1){width:20%}th:nth-child(2){width:5.5%}th:nth-child(3){width:11%}th:nth-child(4){width:21%}th:nth-child(5){width:12%}th:nth-child(6){width:4.5%}th:nth-child(7),th:nth-child(8){width:13%}
td:nth-child(1),td:nth-child(3),td:nth-child(5),td.n{white-space:nowrap;overflow:hidden;word-break:normal;font-size:11pt}
tbody td{height:10mm;vertical-align:top}td.pn,td.n{font-weight:bold;font-size:11.5pt}td.nm{font-size:10pt}
.n{text-align:right}.c{text-align:center}.sg{display:flex;justify-content:space-around;margin-top:5mm}`;
  printHTML(`崧泉出貨憑證 ${b.no}`, css, html, { tip: '紙張 A4 直式、邊界選「預設」（已內建約 5mm 安全邊，不要選「無」，印表機印不到紙邊會切掉）、縮放「預設」100%。每張 A4 上下各印一份，中間虛線可裁開；每份放得下就放（約 9～10 項），放不下會續印下一張。' });
}

// ---------- 如陽採購單（採購憑單）：PDF 或照片交給 Claude 讀，產品編號＝客料號對商品 ----------
const fileB64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(r.error); r.readAsDataURL(f); });
const shrinkJpeg = (f, max = 2200, q = 0.88) => new Promise((ok, bad) => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src); ok(cv.toDataURL('image/jpeg', q).split(',')[1]); }; img.onerror = () => bad(new Error('讀不了這張圖片')); img.src = URL.createObjectURL(f); });
export async function ruyangRead(f) {
  const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  if (!pdf && !f.type.startsWith('image/')) throw new Error('請選 PDF 或照片');
  const data = pdf ? await fileB64(f) : await shrinkJpeg(f);
  const r = await api.post('/api/ocr/po', { data, media: pdf ? 'application/pdf' : 'image/jpeg' });
  if (!r || !Array.isArray(r.lines)) throw new Error('沒有讀到明細');
  return r;
}
export function ruyangLines(P, edit) {
  const N = x => String(x ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const idx = new Map(); const put = (k, g) => { k = N(k); if (!k) return; const a = idx.get(k) || idx.set(k, []).get(k); if (!a.includes(g)) a.push(g); };
  for (const g of store.list('goods')) { put(g.spec, g); put(g.spec2, g); }
  const add = [], miss = [], multi = [], cancelled = [];
  for (const r of P.lines) {
    if (r.cancelled) { cancelled.push(r.part_no || r.name); continue; }
    if (!(+r.qty > 0)) continue;
    const cands = idx.get(N(r.part_no)) || [];
    let g = null; if (cands.length === 1) g = cands[0]; else if (cands.length > 1) { g = cands.find(x => lastSale(edit.cid, x.id, edit.date, edit.id)) || cands[0]; multi.push(r.part_no); }
    const memo = String(P.po_no || '').trim();
    const price = +r.price > 0 ? +r.price : '';
    if (!g) { miss.push(r.part_no || r.name); add.push({ gid: '', n: [r.part_no, r.name].filter(Boolean).join(' '), qty: +r.qty, price, memo }); continue; }
    const l = { gid: g.id, qty: +r.qty, price, memo };
    if (price === '') { const x = lastSale(edit.cid, g.id, edit.date, edit.id); if (x) { l.price = x.price; if (x.u) l.u = x.u; } else { const p2 = unitPrice(g, edit.type); if (p2 !== '') l.price = p2; } }
    else if (r.unit && !/^pcs$/i.test(r.unit) && String(r.unit).toUpperCase() !== String(g.unit || '').toUpperCase()) l.u = r.unit;
    add.push(l);
  }
  return { add, miss, multi, cancelled };
}
