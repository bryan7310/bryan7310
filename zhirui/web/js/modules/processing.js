// 委託加工：委外加工的加工單（送電鍍、熱處理、耐落…給廠商的單子）。單據不動庫存、不進應付；
// 加工費照常用進貨單（Z01／Z03／Z04…加工料號）入帳。
import { store } from '../core/store.js';
import { billList, openBill, printBill } from './_bills.js';
import { faxDialog } from './faxes.js';

const ui = {};
export default {
  id: 'processing', name: '委託加工', icon: 'process',
  render(el, { params }) { this.el = el; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts') || ch.has('goods'))) draw(this.el); },
};
function draw(el) {
  billList(el, {
    key: 'processing', title: '委託加工', types: ['PRC'], tabList: [['all', '全部']], newTypes: ['PRC'],
    cols: [{ label: '加工內容', cell: b => (b.proc || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])) }, { label: '預計回廠', cls: 'nowrap', cell: b => b.deliv ? b.deliv.slice(5).replace('-', '/') : '' }],
    actions: b => `<button class="btn xs" data-print="${b.id}">列印</button><button class="btn xs" data-fax="${b.id}">傳真</button>`,
    bind(el2) {
      el2.querySelectorAll('[data-print]').forEach(x => x.addEventListener('click', ev => { ev.stopPropagation(); printBill(store.get('bills', x.dataset.print)); }));
      el2.querySelectorAll('[data-fax]').forEach(x => x.addEventListener('click', ev => { ev.stopPropagation(); faxDialog(store.get('bills', x.dataset.fax), () => draw(el)); }));
    },
  }, ui);
}
