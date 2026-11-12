// 門市銷售（簡易版）：只有日期和金額，輸入就開一張銷貨單；當天的明細列在下面
import { esc, fmt, today, slash, addDays } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { confirm } from '../core/ui.js';
import { calc } from '../core/calc.js';
import { createRetail, retailBills, retailCustomerExists, retailCustomerId } from './home.js';
import { openBill } from './_bills.js';

const ui = { date: '', focus: true, year: 0 };
// 年度彙總：新平台的門市銷售單＋舊系統搬來的歷史單據（向伺服器查，依年份快取）
const HIST = new Map();
async function histYear(cid, y) {
  const key = cid + '|' + y + '|' + (store.histVer || '');
  if (!HIST.has(key)) HIST.set(key, (async () => { const out = []; let offset = 0; for (;;) { const r = await api.hist({ cid, from: `${y}-01-01`, to: `${y}-12-31`, limit: 1000, offset }); out.push(...r.rows.filter(b => b.type === 'SALE' || b.type === 'SALE_RET')); offset += r.rows.length; if (!r.rows.length || offset >= r.total) break; } return out; })().catch(e => { HIST.delete(key); throw e; }));
  return HIST.get(key);
}
async function yearMonths(C, cid, y) {
  const m = Array.from({ length: 12 }, () => ({ n: 0, amt: 0 }));
  const add = (b, amt) => { const k = +String(b.date || '').slice(5, 7) - 1; if (k < 0 || k > 11) return; const s = b.type === 'SALE_RET' ? -1 : 1; m[k].n += s > 0 ? 1 : 0; m[k].amt += s * amt; };
  for (const b of C.bills) if ((b.type === 'SALE' || b.type === 'SALE_RET') && b.cid === cid && !b.hist && String(b.date || '').startsWith(y + '-')) add(b, C.tot[b.id]?.total || 0);
  for (const b of await histYear(cid, y)) add(b, Math.round(+b.oamt || 0));
  return m;
}
async function drawYear(el, C) {
  const box = el.querySelector('#rsYear'); if (!box) return; const cid = retailCustomerId(); if (!cid) { box.innerHTML = ''; return; }
  const y = ui.year; box.querySelector('#rsYearBody').innerHTML = '<div class="muted" style="padding:10px 0">載入中…</div>';
  let cur, prev;
  try { [cur, prev] = await Promise.all([yearMonths(C, cid, y), yearMonths(C, cid, y - 1)]); }
  catch (e) { box.querySelector('#rsYearBody').innerHTML = `<div class="banner">舊系統資料載入失敗：${esc(e.message || e)}</div>`; return; }
  if (!box.isConnected || ui.year !== y) return;
  const tn = cur.reduce((s, x) => s + x.n, 0), ta = cur.reduce((s, x) => s + x.amt, 0), pa = prev.reduce((s, x) => s + x.amt, 0);
  const nowM = y === +today().slice(0, 4) ? +today().slice(5, 7) : 12;
  const diff = (a, b) => !b ? (a ? '<span class="muted">—</span>' : '') : `<span style="color:${a >= b ? 'var(--ok,#1a7f37)' : 'var(--bad,#c62828)'}">${a >= b ? '+' : ''}${Math.round((a - b) / b * 100)}%</span>`;
  box.querySelector('.ptitle small').textContent = `全年 ${tn} 筆・合計 ${fmt(ta)}`;
  box.querySelector('#rsYearBody').innerHTML = `<div class="tw"><table><thead><tr><th>月份</th><th class="n">筆數</th><th class="n">金額</th><th class="n">${y - 1} 年同月</th><th class="n">增減</th></tr></thead><tbody>
    ${cur.map((x, i) => `<tr ${i + 1 > nowM ? 'class="muted"' : ''}><td>${i + 1} 月</td><td class="n">${x.n || ''}</td><td class="n" style="font-weight:600">${x.amt ? fmt(x.amt) : ''}</td><td class="n muted">${prev[i].amt ? fmt(prev[i].amt) : ''}</td><td class="n">${i + 1 <= nowM ? diff(x.amt, prev[i].amt) : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>全年</td><td class="n">${tn}</td><td class="n" style="font-size:18px">${fmt(ta)}</td><td class="n">${fmt(pa)}</td><td class="n">${diff(ta, pa)}</td></tr>
    <tr><td>月平均</td><td class="n"></td><td class="n">${fmt(Math.round(ta / Math.max(1, nowM)))}</td><td class="n">${fmt(Math.round(pa / 12))}</td><td></td></tr></tfoot></table></div>
    <div class="muted small" style="margin-top:6px">含舊系統搬來的門市銷售單；退回單會扣掉。${y === +today().slice(0, 4) ? '今年月平均以已過的月份計算。' : ''}</div>`;
}
export default {
  id: 'retail', name: '門市銷售', icon: 'money',
  render(el) { this.el = el; ui.focus = true; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts') || ch.has('goods'))) draw(this.el); },
};
function draw(el) {
  const C = calc(); const day = ui.date || today(); const list = retailBills(C, day); const sum = list.reduce((s, b) => s + (C.tot[b.id]?.total || 0), 0);
  const hm = ms => { if (!ms) return ''; const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  el.innerHTML = `<div class="head"><h1>門市銷售</h1><span class="sub">輸入金額、按 Enter，就自動開一張出貨單（客戶 門市銷售、單價 1 元、現金收訖）</span></div>
    <div class="panel">
      <div class="tools" style="align-items:flex-end;gap:14px"><div class="f"><label for="rsDate">日期</label><input type="date" id="rsDate" value="${esc(day)}" style="font-size:20px;padding:0 12px;height:56px;box-sizing:border-box"></div><div style="display:flex;gap:6px"><button class="btn" data-day="-1" style="height:56px;padding:0 14px" title="前一天">‹ 前一天</button><button class="btn" data-day="1" style="height:56px;padding:0 14px" title="後一天">後一天 ›</button>${day !== today() ? '<button class="btn" data-day="0" style="height:56px;padding:0 14px">今天</button>' : ''}</div><div class="f" style="width:220px"><label for="rsAmt">金額</label><input id="rsAmt" class="num" inputmode="numeric" placeholder="例如 350" style="font-size:26px;padding:0 14px;height:56px;box-sizing:border-box"></div><button class="btn pri" id="rsAdd" style="font-size:18px;padding:0 24px;height:56px;box-sizing:border-box">登記</button></div>
      ${retailCustomerExists() ? '' : '<div class="banner" style="margin-top:10px">找不到客戶「門市銷售」，請先到基本資料新增。</div>'}
    </div>
    <div class="panel"><div class="ptitle">${esc(slash(day))} 門市銷售<small>${list.length} 筆・合計 ${fmt(sum)}</small></div>
      <div class="tw"><table><thead><tr><th>時間</th><th>單號</th><th class="n">金額</th><th>備註</th><th></th></tr></thead><tbody>
      ${list.map(b => `<tr><td class="nowrap">${hm(b.createdAt)}</td><td class="mono"><a href="#" data-open="${b.id}">${esc(b.no)}</a></td><td class="n" style="font-size:18px;font-weight:600">${fmt(C.tot[b.id]?.total || 0)}</td><td class="muted">${esc(b.note || '')}</td><td class="r"><button class="btn xs" data-del="${b.id}">刪除</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">這天還沒有門市銷售</td></tr>'}</tbody>
      ${list.length ? `<tfoot><tr><td colspan="2">合計 ${list.length} 筆</td><td class="n" style="font-size:18px">${fmt(sum)}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div></div>
    <div class="panel" id="rsYear"><div class="ptitle" style="display:flex;align-items:center;gap:8px">年度彙總 <button class="btn sm" data-yr="-1">‹</button><b>${ui.year || +day.slice(0, 4)} 年</b><button class="btn sm" data-yr="1">›</button><small></small></div><div id="rsYearBody"></div></div>`;
  if (!ui.year) ui.year = +day.slice(0, 4);
  el.querySelectorAll('[data-yr]').forEach(b => b.addEventListener('click', () => { ui.year += +b.dataset.yr; draw(el); }));
  drawYear(el, C);
  const amt = el.querySelector('#rsAmt');
  const go = async () => { const d = el.querySelector('#rsDate').value || today(); ui.date = d; ui.focus = true; const no = await createRetail(amt.value, '', d); if (no) amt.value = ''; };
  el.querySelector('#rsAdd').addEventListener('click', go);
  amt.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); go(); } });
  el.querySelector('#rsDate').addEventListener('change', ev => { ui.date = ev.target.value; ui.focus = true; draw(el); });
  el.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { const n = +b.dataset.day; ui.date = n ? addDays(ui.date || today(), n) : today(); ui.focus = true; draw(el); }));
  el.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openBill(null, a.dataset.open); }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { const x = store.get('bills', b.dataset.del); if (!x) return; if (await confirm(`刪除門市銷售 ${fmt(C.tot[x.id]?.total || 0)} 元（${x.no}）？`, { danger: true, ok: '刪除' })) { await store.remove('bills', x.id); store.log('刪除', `銷貨單 ${x.no}｜門市銷售`); } }));
  if (ui.focus) { ui.focus = false; setTimeout(() => amt.focus(), 30); }
}
