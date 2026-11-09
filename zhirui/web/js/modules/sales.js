// 銷貨：銷貨單、銷貨退回；開發票、列印出貨單
import { esc, fmt } from '../core/util.js';
import { store } from '../core/store.js';
import { toast } from '../core/ui.js';
import { billList, openBill, printBill } from './_bills.js';
import { calc } from '../core/calc.js';
import { makeInvoiceFromBill } from './invoices.js';

const ui = {};
export default {
  id: 'sales', name: '銷貨', group: '業務', icon: 'sales',
  render(el, { params }) { this.el = el; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts') || ch.has('goods') || ch.has('invoices'))) draw(this.el); },
};
function draw(el) {
  billList(el, {
    key: 'sales', title: '銷貨', types: ['SALE', 'SALE_RET'], tabList: [['all', '全部'], ['SALE', '銷貨單'], ['SALE_RET', '銷貨退回'], ['hist', '歷史（舊系統）']], histTypes: ['SALE', 'SALE_RET'], newTypes: ['SALE', 'SALE_RET'],
    actions: b => `<button class="btn xs" data-print="${b.id}">列印</button>${b.type === 'SALE' && !b.invNo && !b.hist ? ` <button class="btn xs" data-inv="${b.id}">開發票</button>` : ''}`,
    bind(el2) {
      el2.querySelectorAll('[data-print]').forEach(x => x.addEventListener('click', () => printBill(store.get('bills', x.dataset.print))));
      el2.querySelectorAll('[data-inv]').forEach(x => x.addEventListener('click', () => makeInvoiceFromBill(store.get('bills', x.dataset.inv))));
    },
  }, ui);
}
