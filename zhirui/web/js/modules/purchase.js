// 進貨：進貨單、進貨退出、採購單；送到應付帳款
import { $ } from '../core/util.js';
import { store } from '../core/store.js';
import { billList, openBill, printBill } from './_bills.js';
import { faxDialog } from './faxes.js';
import { importPurchase } from './purchase_import.js';

const ui = {};
export default {
  id: 'purchase', name: '進貨採購', group: '倉儲', icon: 'purchase',
  render(el, { params }) { this.el = el; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts') || ch.has('goods'))) draw(this.el); },
};
function draw(el) {
  billList(el, {
    key: 'purchase', title: '進貨／採購', types: ['PUR', 'PUR_RET', 'PO'], tabList: [['all', '全部'], ['PUR', '進貨單'], ['PUR_RET', '進貨退出'], ['PUR,PUR_RET', '進貨＋進貨退出'], ['PO', '採購單']], histTypes: ['PUR', 'PUR_RET', 'PO'], newTypes: ['PUR', 'PO', 'PUR_RET'],
    extraHead: '<button class="btn" id="piImport" title="匯入廠商出貨單 Excel，自動配對商品">匯入進貨單</button>',
    actions: b => b.type === 'PO' ? `<button class="btn xs" data-fax="${b.id}">傳真</button>` : `<button class="btn xs" data-print="${b.id}">列印</button>`,   // 採購單直接傳真給廠商
    bind(el2) {
      el2.querySelectorAll('[data-print]').forEach(x => x.addEventListener('click', () => printBill(store.get('bills', x.dataset.print))));
      el2.querySelectorAll('[data-fax]').forEach(x => x.addEventListener('click', () => faxDialog(store.get('bills', x.dataset.fax), () => draw(el))));
      $('#piImport', el2)?.addEventListener('click', () => importPurchase(() => { ui.tab = 'PUR'; ui.from = ''; ui.to = ''; draw(el); }));
    },
  }, ui);
}
