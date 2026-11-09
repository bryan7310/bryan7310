// 收付款：收款單、付款單、其他收入／支出、帳戶餘額
import { esc, fmt } from '../core/util.js';
import { store } from '../core/store.js';
import { billList, openBill } from './_bills.js';
import { calc } from '../core/calc.js';

const ui = {};
export default {
  id: 'money', name: '收付款', group: '財務', icon: 'money',
  render(el, { params }) { this.el = el; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('accounts') || ch.has('contacts'))) draw(this.el); },
};
function draw(el) {
  const C = calc();
  const accts = store.list('accounts');
  billList(el, {
    key: 'money', title: '收付款', types: ['RCV', 'PAY', 'INC', 'EXP'], tabList: [['all', '全部'], ['RCV', '收款單'], ['PAY', '付款單'], ['INC', '其他收入'], ['EXP', '其他支出']], newTypes: ['RCV', 'PAY', 'INC', 'EXP'],
    extraHead: `<div class="kpis" style="flex-basis:100%">${accts.map(a => `<div class="kpi"><span>${esc(a.name)}</span><b>${fmt(C.accBal[a.id] || 0)}</b></div>`).join('')}</div>`,
  }, ui);
}
