// 庫存：各倉庫數量、低於安全庫存、其他出入庫、調撥
import { $, esc, fmt, fmtQ, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { tabs, pager, onSearch, printHTML, toast, confirm, modal } from '../core/ui.js';
import { today, slash, uid } from '../core/util.js';
import { abcList, countedOk, abcCustomers } from '../core/abc.js';
import { calc, goodsLabel, TYPES, nextNo } from '../core/calc.js';
import { billList, openBill } from './_bills.js';
import { openMaster } from './master.js';

const ui = { tab: 'qty', q: '', page: 0, bills: {}, ccls: 'S', csort: 'code', ccid: '', ctodo: false, cedit: false, cvals: {}, cwid: '', cdate: '' };   // cedit＝正在輸入盤點結果，cvals＝{ 商品 id: { q, w } }
const STABS = [['qty', '庫存數量'], ['low', '低於安全庫存'], ['count', '盤點表'], ['moves', '出入庫／調撥／組包']];
export default {
  id: 'stock', name: '庫存數量', group: '倉儲', icon: 'stock',
  render(el, { sub, params }) { this.el = el; if (sub === 'low') ui.tab = 'low'; if (sub === 'moves') ui.tab = 'moves'; if (sub === 'count') ui.tab = 'count'; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (ui.tab === 'count' && ui.cedit) return;   // 正在打盤點數字：別人改資料不重畫（游標會跑掉）
    if (this.el?.isConnected && (ch.has('bills') || ch.has('goods') || ch.has('warehouses'))) draw(this.el); },
};
function draw(el) {
  if (ui.tab === 'count') return drawCount(el);
  if (ui.tab === 'moves') {
    const box = document.createElement('div'); box.style.display = 'grid'; box.style.gap = '16px';
    el.innerHTML = ''; el.append(box);
    billList(box, { key: 'moves', title: '庫存異動', types: ['IN', 'OUT', 'TRANSFER', 'ASM'], tabList: [['all', '全部'], ['IN', '其他入庫'], ['OUT', '其他出庫'], ['TRANSFER', '調撥單'], ['ASM', '組包單']], newTypes: ['IN', 'OUT', 'TRANSFER', 'ASM'], extraHead: tabs('s', STABS, 'moves') }, ui.bills);
    el.addEventListener('tab', ev => { if (ev.detail.key === 's') { ui.tab = ev.detail.val; draw(el); } }, { once: true });
    return;
  }
  const C = calc(); const whs = store.list('warehouses'); const q = qTerms(ui.q);
  let list = store.list('goods').filter(g => matchQ(goodsLabel(g) + ' ' + (g.cat || '') + ' ' + (g.alias || ''), q)).sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));
  const all = g => Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0);
  if (ui.tab === 'low') list = list.filter(g => +g.safety > 0 && all(g) < +g.safety);
  else if (!ui.q) list = list.filter(g => all(g) !== 0);
  const tv = list.reduce((s, g) => s + all(g) * (C.cost[g.id]?.avg || +g.purPrice || 0), 0);
  const [s, e, pg] = pager('st', list.length, ui.page);
  el.innerHTML = `<div class="head"><h1>庫存</h1><span class="sp"></span><button class="btn" data-new="IN">＋ 其他入庫</button><button class="btn" data-new="OUT">＋ 其他出庫</button><button class="btn" data-new="TRANSFER">＋ 調撥</button><button class="btn" data-new="ASM" title="螺絲包：依配方扣零件、成品加庫存">＋ 組包</button></div>
    <div class="panel"><div class="tools">${tabs('s', STABS, ui.tab)}<input type="search" id="sq" placeholder="搜尋料號、品名、規格" value="${esc(ui.q)}"><span class="muted small">${list.length} 項${ui.tab === 'qty' && !ui.q ? '（有庫存的）' : ''}・庫存金額約 ${fmt(tv)}</span></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>料號</th><th>品名規格</th>${whs.map(w => `<th class="n">${esc(w.name)}</th>`).join('')}<th class="n">合計</th><th>單位</th><th class="n">安全庫存</th><th class="n">平均成本</th></tr></thead>
    <tbody>${list.slice(s, e).map(g => { const t = all(g); return `<tr class="row" data-id="${g.id}"><td class="mono">${esc(g.code)}</td><td>${esc(g.name)} <span class="muted">${esc(g.spec || '')}</span></td>${whs.map(w => `<td class="n">${fmtQ((C.stock[g.id] || {})[w.id] || 0)}</td>`).join('')}<td class="n" style="${+g.safety > 0 && t < +g.safety ? 'color:var(--bad);font-weight:600' : ''}">${fmtQ(t)}</td><td>${esc(g.unit || '')}</td><td class="n muted">${g.safety ? fmtQ(g.safety) : ''}</td><td class="n muted">${C.cost[g.id]?.avg ? fmtQ(C.cost[g.id].avg) : ''}</td></tr>`; }).join('') || `<tr><td colspan="${6 + whs.length}"><div class="empty"><b>${ui.tab === 'low' ? '沒有低於安全庫存的商品' : '沒有庫存紀錄'}</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; draw(el); }, { once: true });
  onSearch($('#sq', el), v => { ui.q = v; ui.page = 0; draw(el); const i = $('#sq', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openBill(b.dataset.new)));
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => openMaster('goods', store.get('goods', tr.dataset.id))));
}

// ---------- 盤點表：近一年有出貨的商品分 A／B／C 類（core/abc.js），看哪些該盤、盤了沒 ----------
// 兩種盤法並行：① 手機 App「查商品 › 盤點表」掃盤點標籤逐項盤；② 這裡「列印盤點表（紙本）」→ 現場手填數量、單重 → 回來按「輸入盤點結果」照紙本順序打進去，一次寫入。
const CCLS = [['S', 'A★常出貨'], ['A', 'A 類'], ['B', 'B 類'], ['C', 'C 類'], ['all', '全部']];
const CSORT = [['code', '料號'], ['amt', '出貨金額'], ['last', '最近出貨日']];
const plainG = g => { const { id, _by, ...r } = g; return r; };
const numOf = v => { const t = String(v ?? '').trim().replace(/,/g, ''); return t === '' ? null : +t; };
let cseq = 0;
async function drawCount(el) {
  const seq = ++cseq;
  if (!el.querySelector('#cnt-box')) el.innerHTML = `<div class="head"><h1>庫存</h1></div><div class="panel"><div class="tools">${tabs('s', STABS, 'count')}</div><div id="cnt-box" class="muted" style="margin-top:12px">整理近一年的出貨資料…</div></div>`;
  let D; try { D = await abcList(); } catch (e) { D = { list: [], from: '' }; }
  if (seq !== cseq || !el.isConnected || ui.tab !== 'count') return;
  const C = calc(); const whs = store.list('warehouses'); const G = x => store.get('goods', x.gid);
  if (!whs.some(w => w.id === ui.cwid)) ui.cwid = (whs.find(w => w.name === '預設倉庫') || whs[0])?.id || '';
  const edit = ui.cedit; const V = ui.cvals;
  const custs = abcCustomers(D.list); if (ui.ccid && !custs.some(c => c.cid === ui.ccid)) ui.ccid = '';
  const base = ui.ccid ? D.list.filter(x => x.cids?.has(ui.ccid)) : D.list;   // 客戶篩選：只看這一年賣給這個客戶的商品
  const cname0 = custs.find(c => c.cid === ui.ccid)?.name || '';
  const cnt = k => base.filter(x => k === 'all' ? true : k === 'S' ? x.star : x.cls === k).length;
  let list = base.filter(x => ui.ccls === 'all' ? true : ui.ccls === 'S' ? x.star : x.cls === ui.ccls);
  const done = list.filter(x => countedOk(G(x), x.cls)).length; const n0 = list.length;
  if (ui.ctodo && !edit) list = list.filter(x => !countedOk(G(x), x.cls));
  if (ui.csort === 'code') list = [...list].sort((a, b) => String(G(a).code || '').localeCompare(String(G(b).code || '')));
  else if (ui.csort === 'last') list = [...list].sort((a, b) => b.last.localeCompare(a.last) || a.rank - b.rank);
  const all = g => Object.values(C.stock[g.id] || {}).reduce((a, b) => a + b, 0);
  const sysQ = g => (C.stock[g.id] || {})[ui.cwid] || 0;   // 輸入、紙本都看選定的倉庫
  const wname = whs.find(w => w.id === ui.cwid)?.name || '';
  const inp = 'style="width:90px;text-align:right;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--surface);color:var(--ink)"';
  const row = x => { const g = G(x); const ok = countedOk(g, x.cls); const v = V[g.id] || {};
    if (edit) return `<tr data-id="${g.id}" data-sys="${sysQ(g)}"><td>${x.cls}${x.star ? '★' : ''}</td><td class="mono">${esc(g.code)}</td><td>${esc(g.name)}</td><td class="n">${fmtQ(sysQ(g))}</td><td>${esc(g.unit || '')}</td><td class="n"><input data-q inputmode="decimal" value="${esc(v.q ?? '')}" ${inp}></td><td class="n" data-diff></td><td class="n"><input data-w inputmode="decimal" value="${esc(v.w ?? '')}" placeholder="${+g.wt > 0 ? esc(g.wt) : ''}" ${inp}></td><td>${g.cntAt ? esc(slash(g.cntAt)) : ''}</td></tr>`;
    return `<tr class="row" data-id="${g.id}"><td>${x.cls}${x.star ? '★' : ''}</td><td class="mono">${esc(g.code)}</td><td>${esc(g.name)}</td><td class="n">${+g.wt > 0 ? esc(g.wt) : ''}</td><td class="n">${fmtQ(all(g))}</td><td>${esc(g.unit || '')}</td><td class="n">${fmt(x.amt)}</td><td class="n">${x.n}</td><td>${esc(slash(x.last))}</td><td${ok ? ' style="color:var(--good,#1a7f37)"' : ''}>${g.cntAt ? esc(slash(g.cntAt)) : '<span class="muted">還沒盤過</span>'}</td></tr>`; };
  const whSel = `<select id="cnt-wh" title="盤哪一個倉庫">${whs.map(w => `<option value="${w.id}" ${w.id === ui.cwid ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="head"><h1>庫存</h1><span class="sp"></span>${edit
      ? `<span class="muted small" id="cnt-sum"></span><button class="btn" id="cnt-cancel">取消</button><button class="btn pri" id="cnt-save">儲存盤點結果</button>`
      : `<button class="btn" id="cnt-label" title="跟 App 一樣的盤點標籤（50×40：QR 碼＋品名＋單重），送到標籤機">印盤點標籤</button><button class="btn" id="cnt-print">列印盤點表（紙本）</button><button class="btn pri" id="cnt-edit">輸入盤點結果</button>`}</div>
    <div class="panel"><div class="tools">${tabs('s', STABS, 'count')}${tabs('cc', CCLS.map(([k, n]) => [k, `${n} ${cnt(k)}`]), ui.ccls)}<span class="muted small">排列</span>${tabs('cs', CSORT, ui.csort)}<select id="cnt-cust" title="只看這一年賣給這個客戶的商品" style="max-width:15em"><option value="">全部客戶</option>${custs.map(c => `<option value="${c.cid}" ${c.cid === ui.ccid ? 'selected' : ''}>${esc(c.name)}（${c.n}）</option>`).join('')}</select>${edit
      ? `<span class="muted small">倉庫</span>${whSel}<span class="muted small">盤點日期</span><input type="date" id="cnt-date" value="${esc(ui.cdate || today())}">`
      : `<label class="small"><input type="checkbox" id="cnt-todo" ${ui.ctodo ? 'checked' : ''}> 只看還沒盤的</label><span class="muted small">已盤 ${done}／${n0}</span>`}</div>
    <div class="muted small" style="margin:8px 0">${edit
      ? '照紙本的順序把「實際數量」打進去（Enter 或 ↓ 跳下一列），單重有量才填、空白＝不改。沒填數量的不動。按「儲存盤點結果」後，差異會自動開其他入庫／其他出庫補平，並記下盤點日期。切換分類、排列不會清掉已經打的數字。'
      : `依 ${slash(D.from)} 起近一年的出貨金額分類（新平台＋舊系統）：累計前 80%＝A 類每月盤、到 95%＝B 類每季盤、其餘 C 類半年盤；★＝A 類且出貨 6 次以上，最先盤。兩種盤法：手機 App「查商品 › 盤點表」掃盤點標籤；或在這裡印紙本、手填後按「輸入盤點結果」。`}</div>
    <div class="tw" id="cnt-box"><table><thead><tr>${edit
      ? `<th>類別</th><th>料號</th><th>品名規格</th><th class="n">系統庫存（${esc(wname)}）</th><th>單位</th><th class="n">實際數量</th><th class="n">差異</th><th class="n">單重 g</th><th>上次盤點</th>`
      : '<th>類別</th><th>料號</th><th>品名規格</th><th class="n">單重 g</th><th class="n">系統庫存</th><th>單位</th><th class="n">近一年出貨金額</th><th class="n">次數</th><th>最近出貨</th><th>上次盤點</th>'}</tr></thead>
    <tbody>${list.map(row).join('') || '<tr><td colspan="10"><div class="empty"><b>這個分類沒有要盤的商品</b></div></td></tr>'}</tbody></table></div></div>`;
  if (el._cntTab) el.removeEventListener('tab', el._cntTab);
  el._cntTab = ev => { el.removeEventListener('tab', el._cntTab); el._cntTab = null; const { key, val } = ev.detail;
    if (key === 's') { if (ui.cedit && Object.keys(ui.cvals).length && !window.confirm('盤點結果還沒儲存，要離開嗎？（已經打的數字會留著，回到盤點表還在）')) return drawCount(el); ui.tab = val; ui.page = 0; draw(el); }
    else { if (key === 'cc') ui.ccls = val; if (key === 'cs') ui.csort = val; drawCount(el); } };
  el.addEventListener('tab', el._cntTab);
  $('#cnt-cust', el).addEventListener('change', ev => { ui.ccid = ev.target.value; drawCount(el); });
  if (!edit) {
    // 印盤點標籤：跟 App 盤點表同一種標籤、同一台標籤機（主機的列印小幫手），照畫面上的清單一個商品一張
    $('#cnt-label', el).addEventListener('click', async ev => {
      if (!list.length) return toast('清單是空的');
      const btn = ev.currentTarget; let M, L; try { [M, L] = await Promise.all([import('../m/count.js'), import('../m/label.js')]); } catch (e) { return toast('載入失敗：' + (e.message || e)); }
      const pr = L.curPrinter(); const range = `${cname0 ? cname0 + '・' : ''}${CCLS.find(c => c[0] === ui.ccls)[1]}${ui.ctodo ? '（還沒盤的）' : ''}`;
      const reset = () => { if (btn.isConnected) { btn.disabled = false; btn.textContent = '印盤點標籤'; } };
      // 送到主機的標籤機（列印小幫手），每 20 張一份工作
      const toHost = async () => { let sent = 0; btn.disabled = true;
        try { for (let i = 0; i < list.length; i += 20) {
            const part = list.slice(i, i + 20); const labels = [];
            for (const x of part) { const cv = document.createElement('canvas'); await M.drawCountLabel(cv, G(x)); labels.push({ cv, copies: 1 }); }
            btn.textContent = `送出中 ${Math.min(i + 20, list.length)}／${list.length}…`;
            await L.queueLabels(labels, `盤點標籤 ${i + 1}～${i + part.length}（共 ${list.length} 張）`); sent += part.length; }
          toast(`已送出 ${sent} 張盤點標籤，到「${pr.name}」拿`);
        } catch (e) { toast(`送出 ${sent} 張之後失敗：${e.message || e}`); }
        reset(); };
      // 本機列印：開列印視窗，用這台電腦接的印表機印（一張標籤一頁，50×40mm）
      const toLocal = async win => { btn.disabled = true; btn.textContent = '準備標籤…';
        try { const imgs = []; for (const x of list) { const cv = document.createElement('canvas'); await M.drawCountLabel(cv, G(x)); imgs.push(cv.toDataURL('image/png')); }
          printHTML('盤點標籤', '@page{size:50mm 40mm;margin:0}html,body{margin:0;padding:0}.lb{width:50mm;height:40mm;break-after:page;page-break-after:always;overflow:hidden}.lb:last-child{break-after:auto;page-break-after:auto}.lb img{width:50mm;height:40mm;display:block}@media screen{body{background:#ddd}.lb{background:#fff;margin:3mm auto;box-shadow:0 0 0 1px #999}}',
            imgs.map(u => `<div class="lb"><img src="${u}"></div>`).join(''), { win, tip: `共 ${imgs.length} 張。按 Ctrl+P，印表機選這台電腦接的標籤機，紙張選 50×40mm、邊界「無」、縮放 100%。` });
        } catch (e) { try { win.close(); } catch (e2) { /* 已關 */ } toast('準備標籤失敗：' + (e.message || e)); }
        reset(); };
      modal({ title: '印盤點標籤', width: 520, body: `<p style="margin:0 0 8px">要印 <b>${list.length}</b> 張盤點標籤（50×40mm：QR 碼＋品名＋單重），一個商品一張，照目前的排列順序。</p><p class="muted small" style="margin:0">範圍：${esc(range)}</p>`,
        footer: `<button class="btn" data-close>取消</button><span class="sp"></span><button class="btn" id="lbLocal" title="用這台電腦接的印表機，會開列印視窗">本機列印</button><button class="btn pri" id="lbHost" title="送到主機電腦接的標籤機">主機標籤機「${esc(pr.name)}」</button>`,
        onOpen(m, close) {
          $('#lbHost', m).onclick = () => { close(); toHost(); };
          $('#lbLocal', m).onclick = () => { const win = window.open('', '_blank'); if (!win) return toast('瀏覽器擋住了新視窗，請允許彈出視窗'); try { win.document.write('<p style="font-family:sans-serif">準備標籤中…</p>'); } catch (e) { /* 不影響 */ } close(); toLocal(win); };
        } });
    });
    $('#cnt-todo', el).addEventListener('change', ev => { ui.ctodo = ev.target.checked; drawCount(el); });
    el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => openMaster('goods', store.get('goods', tr.dataset.id))));
    $('#cnt-edit', el).addEventListener('click', () => { ui.cedit = true; ui.cdate = today(); drawCount(el); });
    $('#cnt-print', el).addEventListener('click', () => printHTML('盤點表', '@page{size:A4;margin:10mm}body{font-family:"Microsoft JhengHei",sans-serif;font-size:11px}h2{margin:0 0 6px;font-size:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:5px;text-align:left}td.n,th.n{text-align:right}.mono{font-family:Consolas,monospace}thead{display:table-header-group}tr{break-inside:avoid}',
      `<h2>盤點表　${cname0 ? esc(cname0) + '・' : ''}${esc(CCLS.find(c => c[0] === ui.ccls)[1])}${ui.ctodo ? '（還沒盤的）' : ''}・依${esc(CSORT.find(c => c[0] === ui.csort)[1])}排列　${slash(today())}　共 ${list.length} 項　倉庫：${esc(wname)}　盤點人：＿＿＿＿＿</h2><table><thead><tr><th style="width:26px">#</th><th>類別</th><th>料號</th><th>品名規格</th><th class="n">系統庫存</th><th>單位</th><th style="width:80px">實際數量（手填）</th><th style="width:64px">單重 g（手填）</th><th>最近出貨</th></tr></thead><tbody>${list.map((x, i) => { const g = G(x); return `<tr><td>${i + 1}</td><td>${x.cls}${x.star ? '★' : ''}</td><td class="mono">${esc(g.code)}</td><td>${esc(g.name)}</td><td class="n">${fmtQ(sysQ(g))}</td><td>${esc(g.unit || '')}</td><td></td><td class="n" style="color:#777">${+g.wt > 0 ? esc(g.wt) : ''}</td><td>${esc(slash(x.last))}</td></tr>`; }).join('')}</tbody></table><p style="font-size:10px;color:#555">單重欄印的是系統目前的單重；現場有重新秤，直接劃掉改寫。回辦公室後到「庫存 › 盤點表 › 輸入盤點結果」，選同樣的分類和排列，照順序打進去。</p>`, { tip: '按 Ctrl+P 列印，紙張 A4。' }));
    return;
  }
  // ----- 輸入盤點結果 -----
  const box = $('#cnt-box', el);
  const sum = () => { const n = Object.values(V).filter(v => numOf(v.q) !== null).length; const w = Object.values(V).filter(v => numOf(v.w) !== null).length; $('#cnt-sum', el).textContent = n || w ? `已輸入數量 ${n} 項${w ? `、單重 ${w} 項` : ''}` : ''; };
  const showDiff = tr => { const q = numOf(tr.querySelector('[data-q]').value); const td = tr.querySelector('[data-diff]');
    if (q === null) { td.textContent = ''; return; } if (isNaN(q)) { td.textContent = '要填數字'; td.style.color = 'var(--bad)'; return; }
    const d = Math.round((q - +tr.dataset.sys) * 1000) / 1000; td.textContent = d === 0 ? '相符' : (d > 0 ? '+' : '') + fmtQ(d); td.style.color = d > 0 ? 'var(--good,#1a7f37)' : d < 0 ? 'var(--bad)' : ''; };
  box.querySelectorAll('tr[data-id]').forEach(showDiff); sum();
  box.addEventListener('input', ev => { const tr = ev.target.closest('tr[data-id]'); if (!tr) return; const id = tr.dataset.id; const v = V[id] || (V[id] = {});
    if (ev.target.matches('[data-q]')) { v.q = ev.target.value; showDiff(tr); } else if (ev.target.matches('[data-w]')) v.w = ev.target.value;
    if (String(v.q ?? '').trim() === '' && String(v.w ?? '').trim() === '') delete V[id]; sum(); });
  box.addEventListener('keydown', ev => { const k = ev.key; if (k !== 'Enter' && k !== 'ArrowDown' && k !== 'ArrowUp') return; const t = ev.target; const sel = t.matches('[data-q]') ? '[data-q]' : t.matches('[data-w]') ? '[data-w]' : ''; if (!sel) return;
    ev.preventDefault(); const tr = t.closest('tr'); const nx = k === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling; const i = nx?.querySelector(sel); if (i) { i.focus(); i.select(); } });
  $('#cnt-wh', el).addEventListener('change', ev => { ui.cwid = ev.target.value; drawCount(el); });
  $('#cnt-date', el).addEventListener('change', ev => { ui.cdate = ev.target.value; });
  $('#cnt-cancel', el).addEventListener('click', async () => { if (Object.keys(V).length && !await confirm('已經打的盤點數字要全部丟掉嗎？', { ok: '丟掉', danger: true })) return; ui.cvals = {}; ui.cedit = false; drawCount(el); });
  $('#cnt-save', el).addEventListener('click', () => saveCount(el));
  box.querySelector('[data-q]')?.focus();
}

/** 把「輸入盤點結果」打的數字寫進去：差異合併成一張其他入庫、一張其他出庫；商品記盤點日、單重有填就更新 */
async function saveCount(el) {
  const C = calc(); const V = ui.cvals; const date = ui.cdate || today(); const wid = ui.cwid; const wname = store.get('warehouses', wid)?.name || '';
  const ins = [], outs = [], gops = []; let same = 0, wn = 0; const bad = [];
  for (const [gid, v] of Object.entries(V)) {
    const g = store.get('goods', gid); if (!g) continue; const q = numOf(v.q), w = numOf(v.w);
    if ((q !== null && (isNaN(q) || q < 0)) || (w !== null && !(w > 0))) { bad.push(g.code || g.name); continue; }
    if (q === null && w === null) continue;
    const g1 = { ...plainG(g), updatedAt: Date.now() };
    if (q !== null) { const d = Math.round((q - ((C.stock[gid] || {})[wid] || 0)) * 1000) / 1000; if (d > 0) ins.push({ gid, qty: d, price: 0 }); else if (d < 0) outs.push({ gid, qty: -d, price: 0 }); else same++; g1.cntAt = date; }
    if (w !== null && w !== +g.wt) { g1.wt = w; wn++; }
    gops.push({ col: 'goods', id: gid, data: g1 });
  }
  if (bad.length) { toast(`這幾項的數字不對（數量不能是負的、單重要大於 0）：${bad.slice(0, 5).join('、')}${bad.length > 5 ? '…' : ''}`); return; }
  if (!gops.length) { toast('還沒有輸入任何數量或單重'); return; }
  const nq = ins.length + outs.length + same;
  if (!await confirm(`盤點日期 ${slash(date)}・倉庫「${wname}」\n\n數量：${nq} 項（盤盈 ${ins.length} 項、盤虧 ${outs.length} 項、相符 ${same} 項）\n單重更新：${wn} 項\n\n盤盈會開一張其他入庫、盤虧開一張其他出庫補平。確定寫入嗎？`, { title: '儲存盤點結果', ok: '寫入' })) return;
  const ops = []; const made = []; const now = Date.now();
  for (const [type, lines] of [['IN', ins], ['OUT', outs]]) {
    if (!lines.length) continue; const no = nextNo(type, date, [...store.list('bills'), ...ops.map(o => o.data)]);
    ops.push({ col: 'bills', id: uid('b'), data: { type, no, date, wid, lines, note: `盤點調整（盤點表輸入，${lines.length} 項）`, createdAt: now, updatedAt: now, createdBy: store.user.id } });
    made.push(`${TYPES[type].name} ${no}（${lines.length} 項）`);
  }
  const btn = $('#cnt-save', el); btn.disabled = true;
  try { await store.batch([...ops, ...gops]); } catch (e) { btn.disabled = false; toast('儲存失敗：' + (e.message || e)); return; }
  store.log('新增', `盤點表輸入：${slash(date)} ${wname} 數量 ${nq} 項（盤盈 ${ins.length}、盤虧 ${outs.length}、相符 ${same}）、單重 ${wn} 項${made.length ? '｜' + made.join('、') : ''}`);
  ui.cvals = {}; ui.cedit = false; toast(`盤點結果已寫入：${nq} 項${made.length ? '，' + made.join('、') : ''}`); drawCount(el);
}
