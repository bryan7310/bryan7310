// 客戶訂單：客戶傳真、Email 下的訂單存在這裡（不動庫存、不進應收），出貨時按「出貨（轉銷貨單）」，可以分批出。
// 狀態依銷貨單的 fromSO 自動算：未出貨／部分出貨／已出貨；不再出的可以「結案」。
// 崧泉平台（鼎新 B2B）：主機上的崧泉小幫手（server/b2b_helper.py）把未回覆的採購單做成待確認檔，這一頁顯示連結和連線狀態。
import { esc, slash, today, daysLeft } from '../core/util.js';
import { store } from '../core/store.js';
import { billList, openBill, soStatus, soLeft, soToSaleMulti } from './_bills.js';
import { modal, toast } from '../core/ui.js';
import { calc, cdisp } from '../core/calc.js';
import { fmtQ } from '../core/util.js';

const ui = {};
/** 合併出貨：勾同一個客戶的好幾張訂單，還沒出的品項一起轉成一張銷貨單 */
function mergeShip(onDone) {
  const C = calc();
  const live = store.list('bills').filter(b => b.type === 'SO' && !b.hist && ['open', 'part'].includes(soStatus(b)));
  if (!live.length) return toast('沒有還沒出貨的客戶訂單');
  const byCus = new Map(); for (const b of live) (byCus.get(b.cid) || byCus.set(b.cid, []).get(b.cid)).push(b);
  const groups = [...byCus.entries()].map(([cid, list]) => ({ cid, name: cdisp(C.ct[cid]) || '（沒有客戶）', list: list.sort((a, b) => (a.deliv || '9') < (b.deliv || '9') ? -1 : 1) })).sort((a, b) => b.list.length - a.list.length);
  const pick = new Set(); let cid = '';
  const m = modal({ title: '合併出貨：勾選要一起出的客戶訂單', width: 900, body: '', footer: '' });
  const paint = () => {
    const top = m.el.querySelector('.mb .tw')?.scrollTop || 0;   // 重畫後捲回原位，清單長的時候才不會跳回最上面
    m.el.querySelector('.mb').innerHTML = `<p class="muted small" style="margin-top:0">勾同一個客戶的訂單，還沒出的品項會放進同一張銷貨單；數量可以在銷貨單上再改（分批出）。</p>
      <div class="tw" style="max-height:60vh;overflow:auto"><table><thead><tr><th style="width:30px"></th><th>訂單</th><th>客戶單號</th><th>交期</th><th>還沒出的品項</th></tr></thead><tbody>
      ${groups.map(g => `<tr style="background:var(--sunken)"><td></td><td colspan="4"><b>${esc(g.name)}</b>　<span class="muted small">${g.list.length} 張</span></td></tr>
        ${g.list.map(b => { const left = soLeft(b); const off = cid && cid !== b.cid; return `<tr ${off ? 'style="opacity:.4"' : ''}><td><input type="checkbox" data-so="${esc(b.id)}" ${pick.has(b.id) ? 'checked' : ''} ${off ? 'disabled' : ''}></td><td class="mono nowrap">${esc(b.no)}</td><td class="mono">${esc(b.cpo || '')}</td><td class="nowrap">${esc(b.deliv ? slash(b.deliv) : '')}</td>
          <td class="small">${left.map(x => `${esc(x.l.gid ? (C.g[x.l.gid]?.name || '') : (x.l.n || '') + '（沒對到商品）')} × ${fmtQ(x.left)}`).join('<br>')}</td></tr>`; }).join('')}`).join('')}
      </tbody></table></div>`;
    m.el.querySelector('.mf').innerHTML = `<span class="muted small">${pick.size ? `已勾 ${pick.size} 張` : '還沒勾'}</span><span class="sp"></span><button class="btn" data-close>關閉</button><button class="btn pri" id="msGo" ${pick.size ? '' : 'disabled'}>轉成一張銷貨單</button>`;
    m.el.querySelector('.mf [data-close]').onclick = () => m.close();
    const tw = m.el.querySelector('.mb .tw'); if (tw) tw.scrollTop = top;
    m.el.querySelectorAll('[data-so]').forEach(cb => cb.onchange = () => { const b = store.get('bills', cb.dataset.so); if (cb.checked) { pick.add(b.id); cid = b.cid; } else { pick.delete(b.id); if (!pick.size) cid = ''; } paint(); });
    m.el.querySelector('#msGo').onclick = () => { const sos = live.filter(b => pick.has(b.id)); m.close(); soToSaleMulti(sos, onDone); };
  };
  paint();
}
const ST = { open: ['未出貨', ''], part: ['部分出貨', 'warn'], done: ['已出貨', 'ok'], closed: ['已結案', ''] };
export default {
  id: 'custorders', name: '客戶訂單', group: '業務', icon: 'quotes',
  render(el, { params }) { this.el = el; draw(el); if (params?.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts'))) draw(this.el); },
  badge() { const a = store.list('bills').filter(b => b.type === 'SO' && !b.hist && ['open', 'part'].includes(soStatus(b))); const late = a.filter(b => b.deliv && b.deliv < today()).length; return { cnt: a.length, alert: late > 0 }; },
};
/** 崧泉小幫手的狀態：沒裝小幫手（讀不到狀態檔）就什麼都不顯示 */
async function b2bBox(box) {
  let s; try { const r = await fetch('/pending/b2b_status.json', { cache: 'no-store' }); if (!r.ok) return; s = await r.json(); } catch (e) { return; }
  if (!box.isConnected) return;
  const mins = Math.round((Date.now() - (s.at || 0)) / 60000); const stale = mins > 40;
  const ago = mins < 1 ? '剛剛' : mins < 60 ? `${mins} 分鐘前` : mins < 1440 ? `${Math.round(mins / 60)} 小時前` : `${Math.round(mins / 1440)} 天前`;
  const done = (s.ships || []).filter(x => x.st === 'done').slice(0, 5);
  const errs = [...(s.shipErr || []), ...(s.ships || []).filter(x => x.st === 'unknown').map(x => `銷貨單 ${x.no}：${x.msg}`)];
  const bad = stale || s.needLogin || !s.ok;
  box.innerHTML = `<div class="banner ${bad || s.attn ? '' : 'info'}" style="margin:0 0 10px">
    <b>崧泉平台</b>　${stale ? `崧泉小幫手已經 ${ago}沒有回報，請看主機上有沒有在執行（啟動崧泉小幫手.bat）` : s.needLogin || !s.ok ? esc(s.msg || '連線有問題') : `${ago}抓過：未回覆採購單 ${s.unreplied ?? 0} 張`}
    ${s.pending && !stale ? `　<a class="btn pri" href="#apply?f=b2b_songquan">有 ${(s.new || 0) + (s.upd || 0)} 張待確認${s.miss ? `（${s.miss} 項沒對到商品）` : ''} →</a>` : ''}
    ${s.msg && s.ok && !s.needLogin && !stale ? `<div style="margin-top:6px">${esc(s.msg)}</div>` : ''}
    ${s.replied ? `<div class="small" style="margin-top:6px">已到崧泉平台回覆交期：${esc(s.replied)}</div>` : ''}
    ${s.shipWait ? `<div class="small" style="margin-top:6px">${s.shipWait} 張銷貨單剛存檔，幾分鐘後會自動建崧泉出貨單。</div>` : ''}
    ${errs.length ? `<div style="margin-top:6px">${errs.map(x => '・' + esc(x)).join('<br>')}</div>` : ''}
    ${done.length ? `<div class="small muted" style="margin-top:6px">已建崧泉出貨單：${done.map(x => `銷貨單 ${esc(x.no || '')} → ${esc(x.ship || '')}${/^b2b_labels\/[\w-]+\.pdf$/.test(x.label || '') ? ` <a href="/pending/${esc(x.label)}" target="_blank" rel="noopener">🏷 印標籤</a>` : ''}`).join('、')}</div>` : ''}
    ${s.dry ? '<div class="small muted" style="margin-top:6px">（演練模式：不會真的建出貨單）</div>' : ''}</div>`;
}
function draw(el) {
  billList(el, {
    key: 'custorders', title: '客戶訂單', types: ['SO'], newTypes: ['SO'],
    extraHead: '<button class="btn" id="soMerge" title="勾同一個客戶的好幾張訂單，一起轉成一張銷貨單">合併出貨…</button><button class="btn" id="soImp">匯入 Excel</button><a class="btn" href="#faxin">從傳真轉入</a><a class="btn" href="#email">從 Email 轉入</a>',
    bind: el2 => {
      el2.querySelector('#soImp')?.addEventListener('click', async () => { const { importSO } = await import('./so_import.js'); importSO(() => { if (el.isConnected) draw(el); }); });
      el2.querySelector('#soMerge')?.addEventListener('click', () => mergeShip(() => { if (el.isConnected) draw(el); }));
      const head = el2.querySelector('.head'); if (head && !el2.querySelector('#b2bBox')) { const box = document.createElement('div'); box.id = 'b2bBox'; head.after(box); b2bBox(box); }
    },
    cols: [
      { label: '客戶單號', cell: b => `<span class="mono">${esc(b.cpo || '')}</span>` },
      { label: '交期', cell: b => { if (!b.deliv) return ''; const s = soStatus(b); const d = daysLeft(b.deliv); const late = (s === 'open' || s === 'part') && d < 0; return `<span class="${late ? 'pill bad' : ''}">${esc(slash(b.deliv))}${late ? ` 逾期 ${-d} 天` : ''}</span>`; } },
    ],
    status: b => { const s = soStatus(b); const [t, c] = ST[s]; const left = s === 'part' ? soLeft(b).length : 0; return `<span class="pill ${c}">${t}${left ? `（剩 ${left} 項）` : ''}</span>`; },
  }, ui);
}
