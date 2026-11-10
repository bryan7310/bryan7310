// 門市銷售（簡易版）：只有日期和金額，輸入就開一張銷貨單；當天的明細列在下面
import { esc, fmt, today, slash } from '../core/util.js';
import { store } from '../core/store.js';
import { confirm } from '../core/ui.js';
import { calc } from '../core/calc.js';
import { createRetail, retailBills, retailCustomerExists } from './home.js';
import { openBill } from './_bills.js';

const ui = { date: '', focus: true };
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
      <div class="tools" style="align-items:flex-end;gap:14px"><div class="f"><label for="rsDate">日期</label><input type="date" id="rsDate" value="${esc(day)}" style="font-size:18px;padding:10px 12px"></div><div class="f" style="width:220px"><label for="rsAmt">金額</label><input id="rsAmt" class="num" inputmode="numeric" placeholder="例如 350" style="font-size:26px;padding:10px 14px"></div><button class="btn pri" id="rsAdd" style="font-size:18px;padding:12px 24px">登記</button></div>
      ${retailCustomerExists() ? '' : '<div class="banner" style="margin-top:10px">找不到客戶「門市銷售」，請先到基本資料新增。</div>'}
    </div>
    <div class="panel"><div class="ptitle">${esc(slash(day))} 門市銷售<small>${list.length} 筆・合計 ${fmt(sum)}</small></div>
      <div class="tw"><table><thead><tr><th>時間</th><th>單號</th><th class="n">金額</th><th>備註</th><th></th></tr></thead><tbody>
      ${list.map(b => `<tr><td class="nowrap">${hm(b.createdAt)}</td><td class="mono"><a href="#" data-open="${b.id}">${esc(b.no)}</a></td><td class="n" style="font-size:18px;font-weight:600">${fmt(C.tot[b.id]?.total || 0)}</td><td class="muted">${esc(b.note || '')}</td><td class="r"><button class="btn xs" data-del="${b.id}">刪除</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">這天還沒有門市銷售</td></tr>'}</tbody>
      ${list.length ? `<tfoot><tr><td colspan="2">合計 ${list.length} 筆</td><td class="n" style="font-size:18px">${fmt(sum)}</td><td colspan="2"></td></tr></tfoot>` : ''}</table></div></div>`;
  const amt = el.querySelector('#rsAmt');
  const go = async () => { const d = el.querySelector('#rsDate').value || today(); ui.date = d; ui.focus = true; const no = await createRetail(amt.value, '', d); if (no) amt.value = ''; };
  el.querySelector('#rsAdd').addEventListener('click', go);
  amt.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); go(); } });
  el.querySelector('#rsDate').addEventListener('change', ev => { ui.date = ev.target.value; ui.focus = true; draw(el); });
  el.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openBill(null, a.dataset.open); }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { const x = store.get('bills', b.dataset.del); if (!x) return; if (await confirm(`刪除門市銷售 ${fmt(C.tot[x.id]?.total || 0)} 元（${x.no}）？`, { danger: true, ok: '刪除' })) { await store.remove('bills', x.id); store.log('刪除', `銷貨單 ${x.no}｜門市銷售`); } }));
  if (ui.focus) { ui.focus = false; setTimeout(() => amt.focus(), 30); }
}
