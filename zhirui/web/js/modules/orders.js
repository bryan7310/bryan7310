// 訂貨排程：向廠商訂製產品，勾選訂貨、叫線、生產…進度；與採購單連動
import { $, esc, roc, today, daysLeft, uid, qTerms, matchQ, slash } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, onSearch } from '../core/ui.js';
import { suppliers, customers, cshort, calc, gname } from '../core/calc.js';
import { openBill } from './_bills.js';

export const STEPS = [['order', '訂貨'], ['mold', '開模'], ['wire', '叫線'], ['make', '生產'], ['lathe', '車修'], ['heat', '熱處理'], ['plate', '電鍍'], ['nylok', '耐落'], ['done', '已完成']];
const SOON = 10;
const ui = { tab: 'active', q: '', vendor: '' };
export default {
  id: 'orders', name: '訂貨排程', group: '業務', icon: 'orders',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('orders') || ch.has('bills') || ch.has('contacts'))) draw(this.el); },
  badge() { const a = store.list('orders').filter(o => !(o.steps || {}).done); const late = a.filter(o => o.due && o.due < today()).length; return { cnt: a.length, alert: late > 0 }; },
};
function draw(el) {
  const t = today(); const all = store.list('orders'); const q = qTerms(ui.q);
  const vn = o => o.cid ? cshort(o.cid) : (o.vendor || '');   // 畫面用簡稱
  // 採購單自動出現在排程（沒有對應列的）
  const poRows = calc().bills.filter(b => b.type === 'PO' && !b.received && !all.some(o => o.poId === b.id)).map(b => ({ id: 'po:' + b.id, poId: b.id, vendor: cshort(b.cid), date: b.date, prod: (b.lines || []).filter(l => l.gid || l.n).map(l => l.gid ? gname(l.gid) : l.n).join('、'), qty: (b.lines || []).reduce((s, l) => s + (+l.qty || 0), 0), due: b.deliv || '', steps: { order: true }, fromPO: true, note: b.note }));
  let list = [...all, ...poRows].filter(o => (ui.tab === 'active' ? !(o.steps || {}).done : (o.steps || {}).done) && (!ui.vendor || vn(o) === ui.vendor) && (!q.length || matchQ([vn(o), o.vendor, o.prod, o.cust, o.note, o.qty].join(' '), q)));
  list.sort((a, b) => ui.tab === 'active' ? (a.due || '9').localeCompare(b.due || '9') || (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || ''));
  const vendors = [...new Set([...all, ...poRows].map(vn).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const active = all.filter(o => !(o.steps || {}).done); const late = active.filter(o => o.due && o.due < t), soon = active.filter(o => o.due && o.due >= t && daysLeft(o.due) <= SOON);
  el.innerHTML = `<div class="head"><h1>訂貨排程</h1><span class="sp"></span>${tabs('od', [['active', `進行中 ${active.length + poRows.length}`], ['done', '已完成']], ui.tab)}<button class="btn pri" id="odNew">＋ 登記訂貨</button></div>
    ${ui.tab === 'active' ? `<div class="kpis"><div class="kpi ${late.length ? 'alert' : ''}"><span>逾期</span><b>${late.length}</b></div><div class="kpi"><span>${SOON} 天內到期</span><b>${soon.length}</b></div><div class="kpi"><span>進行中</span><b>${active.length + poRows.length}</b></div></div>` : ''}
    <div class="panel"><div class="tools"><select id="odV"><option value="">全部廠商</option>${vendors.map(v => `<option ${v === ui.vendor ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><input type="search" id="odQ" placeholder="搜尋產品、廠商、客戶" value="${esc(ui.q)}"><span class="muted small">${list.length} 筆</span></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>廠商</th><th>訂貨日</th><th>產品</th><th class="n">數量</th><th>客戶</th><th>交期</th><th>進度</th><th></th></tr></thead><tbody>${list.map((o, i) => { const dl = o.due ? daysLeft(o.due) : null; const tag = o.due && !(o.steps || {}).done ? (dl < 0 ? `<span class="pill bad">逾期 ${-dl} 天</span>` : dl <= SOON ? `<span class="pill warn">${dl === 0 ? '今天' : dl + ' 天後'}</span>` : '') : ''; return `<tr data-i="${i}"><td><b>${esc(vn(o))}</b>${o.fromPO ? ' <span class="pill blue">採購單</span>' : o.poId ? ' <span class="pill">PO</span>' : ''}</td><td class="nowrap">${esc(roc(o.date))}</td><td>${esc(o.prod)}${o.note ? `<span class="sub">${esc(o.note)}</span>` : ''}</td><td class="n">${esc(String(o.qty || ''))}</td><td>${esc(o.cust || '')}</td><td class="nowrap">${o.due ? esc(roc(o.due)) : ''} ${tag}</td><td><div class="steps">${STEPS.map(([k, l]) => `<label class="${(o.steps || {})[k] ? 'on' : ''}"><input type="checkbox" data-step="${k}" data-i="${i}" ${(o.steps || {})[k] ? 'checked' : ''}>${l}</label>`).join('')}</div></td><td class="nowrap"><button class="btn xs" data-edit="${i}">修改</button>${o.poId ? ` <button class="btn xs ghost" data-po="${o.poId}">採購單</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="8"><div class="empty"><b>${ui.tab === 'active' ? '沒有進行中的訂貨' : '沒有已完成的紀錄'}</b></div></td></tr>`}</tbody></table></div></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  $('#odV', el).addEventListener('change', ev => { ui.vendor = ev.target.value; draw(el); });
  onSearch($('#odQ', el), v => { ui.q = v; draw(el); const i = $('#odQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#odNew', el).addEventListener('click', () => editOrder(null));
  el.querySelectorAll('[data-step]').forEach(cb => cb.addEventListener('change', async () => {
    const o = list[+cb.dataset.i]; const steps = { ...(o.steps || {}) }; steps[cb.dataset.step] = cb.checked;
    if (cb.dataset.step === 'done' && cb.checked) steps.doneAt = today();
    const data = { ...o, steps }; delete data.id; delete data.fromPO;
    await store.save('orders', o.fromPO ? uid('o') : o.id, data);
    if (cb.dataset.step === 'done' && cb.checked && o.poId && !store.get('bills', o.poId)?.received) toast('已完成。記得到「進貨／採購」把採購單轉成進貨單。');
  }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editOrder(list[+b.dataset.edit])));
  el.querySelectorAll('[data-po]').forEach(b => b.addEventListener('click', () => openBill(null, b.dataset.po)));
}
function editOrder(o) {
  const d = o ? { ...o } : { vendor: '', date: today(), prod: '', qty: '', cust: '', due: '', note: '', steps: { order: true } };
  modal({
    title: o ? '修改訂貨' : '登記訂貨', width: 600,
    body: `<div class="grid"><div class="f"><label for="od-vendor">廠商</label><div class="combo"><input id="od-vendor" value="${esc(d.cid ? cshort(d.cid) : d.vendor)}" placeholder="搜尋供應商或直接輸入"></div></div><div class="f"><label for="od-date">訂貨日</label><input type="date" id="od-date" value="${esc(d.date)}"></div>
      <div class="f" style="grid-column:1/-1"><label for="od-prod">產品</label><input id="od-prod" value="${esc(d.prod)}" placeholder="例如 皿頭內六角M4*19"></div>
      <div class="f"><label for="od-qty">數量</label><input id="od-qty" class="num" value="${esc(d.qty)}"></div><div class="f"><label for="od-cust">客戶（選填）</label><div class="combo"><input id="od-cust" value="${esc(d.cust || '')}"></div></div>
      <div class="f"><label for="od-due">交期</label><input type="date" id="od-due" value="${esc(d.due || '')}"></div><div class="f" style="grid-column:1/-1"><label for="od-note">備註</label><input id="od-note" value="${esc(d.note || '')}"></div></div>
      <div class="steps">${STEPS.map(([k, l]) => `<label class="${(d.steps || {})[k] ? 'on' : ''}"><input type="checkbox" data-st="${k}" ${(d.steps || {})[k] ? 'checked' : ''}>${l}</label>`).join('')}</div>`,
    footer: `${o && !o.fromPO ? '<button class="btn danger" id="od-del">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="od-ok">儲存</button>`,
    onOpen(el, close) {
      let cid = d.cid;
      combo($('#od-vendor', el), { items: () => suppliers().map(c => ({ id: c.id, label: c.short || c.name, sub: c.name, text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { cid = it.id; } });
      combo($('#od-cust', el), { items: () => customers().map(c => ({ id: c.id, label: c.short || c.name, sub: c.name, text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: () => {} });
      el.querySelectorAll('[data-st]').forEach(cb => cb.addEventListener('change', () => cb.parentElement.classList.toggle('on', cb.checked)));
      $('#od-ok', el).onclick = async () => {
        const steps = {}; el.querySelectorAll('[data-st]').forEach(cb => { if (cb.checked) steps[cb.dataset.st] = true; });
        if (!$('#od-vendor', el).value.trim() || !$('#od-prod', el).value.trim()) return toast('請填廠商與產品');
        const out = { ...d, cid, vendor: $('#od-vendor', el).value.trim(), date: $('#od-date', el).value, prod: $('#od-prod', el).value.trim(), qty: $('#od-qty', el).value.trim(), cust: $('#od-cust', el).value.trim(), due: $('#od-due', el).value, note: $('#od-note', el).value.trim(), steps, created: d.created || new Date().toISOString() }; delete out.id; delete out.fromPO;
        await store.save('orders', o && !o.fromPO ? o.id : uid('o'), out); close(); toast('已儲存');
      };
      $('#od-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這筆訂貨？', { danger: true, ok: '刪除' })) { await store.remove('orders', o.id); close(); } });
    },
  });
}
