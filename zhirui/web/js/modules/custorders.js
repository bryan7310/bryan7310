// 客戶訂單：客戶傳真、Email 下的訂單存在這裡（不動庫存、不進應收），出貨時按「出貨（轉銷貨單）」，可以分批出。
// 狀態依銷貨單的 fromSO 自動算：未出貨／部分出貨／已出貨；不再出的可以「結案」。
import { esc, slash, today, daysLeft } from '../core/util.js';
import { store } from '../core/store.js';
import { billList, openBill, soStatus, soLeft } from './_bills.js';

const ui = {};
const ST = { open: ['未出貨', ''], part: ['部分出貨', 'warn'], done: ['已出貨', 'ok'], closed: ['已結案', ''] };
export default {
  id: 'custorders', name: '客戶訂單', group: '業務', icon: 'quotes',
  render(el, { params }) { this.el = el; draw(el); if (params?.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts'))) draw(this.el); },
  badge() { const a = store.list('bills').filter(b => b.type === 'SO' && !b.hist && ['open', 'part'].includes(soStatus(b))); const late = a.filter(b => b.deliv && b.deliv < today()).length; return { cnt: a.length, alert: late > 0 }; },
};
function draw(el) {
  billList(el, {
    key: 'custorders', title: '客戶訂單', types: ['SO'], newTypes: ['SO'],
    extraHead: '<button class="btn" id="soImp">匯入 Excel</button><a class="btn" href="#faxin">從傳真轉入</a><a class="btn" href="#email">從 Email 轉入</a>',
    bind: el2 => el2.querySelector('#soImp')?.addEventListener('click', async () => { const { importSO } = await import('./so_import.js'); importSO(() => { if (el.isConnected) draw(el); }); }),
    cols: [
      { label: '客戶單號', cell: b => `<span class="mono">${esc(b.cpo || '')}</span>` },
      { label: '交期', cell: b => { if (!b.deliv) return ''; const s = soStatus(b); const d = daysLeft(b.deliv); const late = (s === 'open' || s === 'part') && d < 0; return `<span class="${late ? 'pill bad' : ''}">${esc(slash(b.deliv))}${late ? ` 逾期 ${-d} 天` : ''}</span>`; } },
    ],
    status: b => { const s = soStatus(b); const [t, c] = ST[s]; const left = s === 'part' ? soLeft(b).length : 0; return `<span class="pill ${c}">${t}${left ? `（剩 ${left} 項）` : ''}</span>`; },
  }, ui);
}
