// 手機版：客戶訂單（跟電腦版「客戶訂單」同一份資料）。#so 清單、#so/v/<id> 明細；出貨（轉銷貨單）在電腦版做
import { esc, fmt, fmtQ, fp4, slash, today, daysLeft, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { calc, cdisp, gname, totals } from '../core/calc.js';
import { soStatus, soLeft, soShipped, srcUrl } from '../modules/_bills.js';

const ui = { tab: 'open', q: '' };
const ST = { open: ['未出貨', ''], part: ['部分出貨', 'warn'], done: ['已出貨', 'good'], closed: ['已結案', 'muted'] };
const live = s => s === 'open' || s === 'part';
const all = () => store.list('bills').filter(b => b.type === 'SO' && !b.hist);
export const soOpenCount = () => all().filter(b => live(soStatus(b))).length;
export const soLateCount = () => all().filter(b => live(soStatus(b)) && b.deliv && b.deliv < today()).length;

export function soPage(view, sub, id) {
  if (sub === 'v' && id) return detail(view, decodeURIComponent(id));
  const C = calc();
  const paint = () => {
    const ts = qTerms(ui.q);
    const L = all().filter(b => (ui.tab === 'all' || live(soStatus(b))) && (!ts.length || matchQ([b.no, b.cpo, cdisp(C.ct[b.cid]), C.ct[b.cid]?.name, b.note, ...(b.lines || []).map(l => l.gid ? gname(l.gid) : l.n)].join(' '), ts)))
      .sort((a, b) => ui.tab === 'open' ? (a.deliv || '9').localeCompare(b.deliv || '9') : (b.date || '').localeCompare(a.date || ''));
    view.innerHTML = `<div class="hd"><a class="back" href="#home">‹ 首頁</a></div><div class="hd" style="margin-top:0"><h1>客戶訂單</h1><span class="sp"></span><button class="chip ${ui.tab === 'open' ? 'on' : ''}" data-t="open">進行中 ${soOpenCount()}</button><button class="chip ${ui.tab === 'all' ? 'on' : ''}" data-t="all">全部</button></div>
      <div class="search"><input type="search" id="sq" placeholder="客戶、客戶單號、品名" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="card list">${L.slice(0, 150).map(b => { const s = soStatus(b); const d = b.deliv ? daysLeft(b.deliv) : null; const late = live(s) && d != null && d < 0; const left = s === 'part' ? soLeft(b).length : 0; const n = (b.lines || []).filter(l => l.txt === undefined).length;
        return `<a href="#so/v/${encodeURIComponent(b.id)}"><div class="gm"><b>${esc(cdisp(C.ct[b.cid]) || '—')}</b><small>${esc(b.cpo || b.no)}・${n} 項・${fmt(totals(b).total)} 元</small><small>${b.deliv ? `<span class="${late ? 'bad' : ''}">交期 ${esc(slash(b.deliv))}${late ? `（逾期 ${-d} 天）` : d != null && live(s) && d <= 7 ? `（${d} 天後）` : ''}</span>` : '沒填交期'}</small></div><span class="go"><small class="${ST[s][1]}">${ST[s][0]}${left ? `（剩 ${left}）` : ''}</small> ›</span></a>`; }).join('') || `<div class="row muted">${ui.q ? '沒有符合的訂單' : ui.tab === 'open' ? '沒有進行中的客戶訂單' : '還沒有客戶訂單'}</div>`}</div>
      <div class="note">客戶訂單在電腦版「客戶訂單」新增、匯入或從傳真轉入；出貨時在電腦版轉成銷貨單。</div>`;
    view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { ui.tab = b.dataset.t; paint(); });
    const q = view.querySelector('#sq'); let tm = 0;
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { ui.q = q.value; const pos = q.selectionStart; paint(); const q2 = view.querySelector('#sq'); q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }, 250); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') q.blur(); });
  };
  paint();
}

function detail(view, id) {
  const b = store.get('bills', id); const C = calc();
  if (!b) { view.innerHTML = '<div class="hd"><a class="back" href="#so">‹ 客戶訂單</a></div><div class="card ph"><b>找不到這張客戶訂單</b></div>'; return; }
  const s = soStatus(b); const got = soShipped(b); const left = new Map(soLeft(b).map(x => [x.l, x.left]));
  const d = b.deliv ? daysLeft(b.deliv) : null; const late = live(s) && d != null && d < 0;
  const lines = (b.lines || []).filter(l => l.txt === undefined);
  view.innerHTML = `<div class="hd"><a class="back" href="#so">‹ 客戶訂單</a></div>
    <div class="card"><b style="font-size:17px">${esc(cdisp(C.ct[b.cid]) || '—')}</b>
      <div class="small">客戶單號 <b class="mono">${esc(b.cpo || '—')}</b>　<span class="muted">${esc(b.no)}</span></div>
      <div class="small">訂單日期 ${esc(slash(b.date))}${b.deliv ? `　<span class="${late ? 'bad' : ''}">交期 ${esc(slash(b.deliv))}${late ? `（逾期 ${-d} 天）` : ''}</span>` : ''}</div>
      <div class="small">狀態 <b class="${ST[s][1]}">${ST[s][0]}</b>・${lines.length} 項・${fmt(totals(b).total)} 元${b.attn ? '・聯絡人 ' + esc(b.attn) : ''}</div>
      ${b.note ? `<div class="muted small">${esc(b.note)}</div>` : ''}
      ${b.src ? `<div style="margin-top:6px"><a class="chip" href="${esc(b.src.fax ? srcUrl(b.src) : b.src.n != null && b.src.n !== '' ? srcUrl(b.src) : '#em')}" ${b.src.fax || (b.src.n != null && b.src.n !== '') ? 'target="_blank" rel="noopener"' : ''}>看原始單</a></div>` : ''}</div>
    <div class="sec">品項</div>
    <div class="card list">${lines.map(l => { const q = +l.qty || 0; const lf = left.has(l) ? left.get(l) : 0; const shipped = q - lf;
      return `<div class="row"><div class="gm"><b>${esc(l.gid ? gname(l.gid) : l.n || '')}</b><small>${fmtQ(q)} ${esc(l.u || C.g[l.gid]?.unit || '')} × ${fp4(+l.price || 0)}${l.memo ? '・' + esc(l.memo) : ''}</small>${!l.gid ? '<small class="bad">還沒對到商品</small>' : ''}</div><span class="go">${lf <= 0 ? '<small class="good">已出完</small>' : shipped > 0 ? `<small class="warn">已出 ${fmtQ(shipped)}，剩 ${fmtQ(lf)}</small>` : '<small>未出貨</small>'}</span></div>`; }).join('')}</div>
    <p><a class="btn ghost" href="/#custorders?open=${encodeURIComponent(b.id)}">在電腦版打開（出貨、修改）</a></p>`;
}
