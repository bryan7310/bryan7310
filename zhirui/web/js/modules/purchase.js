// 進貨：進貨單、進貨退出、採購單；送到應付帳款
import { esc, fmt, thisMonth, ymLabel } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, confirm } from '../core/ui.js';
import { billList, openBill, printBill } from './_bills.js';
import { calc, cshort } from '../core/calc.js';

const ui = {};
export default {
  id: 'purchase', name: '進貨／採購', group: '倉儲', icon: 'purchase',
  render(el, { params }) { this.el = el; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts') || ch.has('goods'))) draw(this.el); },
};
function draw(el) {
  billList(el, {
    key: 'purchase', title: '進貨／採購', types: ['PUR', 'PUR_RET', 'PO'], tabList: [['all', '全部'], ['PUR', '進貨單'], ['PUR_RET', '進貨退出'], ['PUR,PUR_RET', '進貨＋進貨退出'], ['PO', '採購單'], ['hist', '歷史（舊系統）']], histTypes: ['PUR', 'PUR_RET', 'PO'], newTypes: ['PUR', 'PO', 'PUR_RET'],
    actions: b => `<button class="btn xs" data-print="${b.id}">列印</button>`,
    bind(el2) { el2.querySelectorAll('[data-print]').forEach(x => x.addEventListener('click', () => printBill(store.get('bills', x.dataset.print)))); },
  }, ui);
}
