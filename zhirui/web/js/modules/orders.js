// 訂貨排程：向廠商訂製產品，勾選訂貨、叫線、生產…進度；與採購單連動
import { $, esc, roc, today, daysLeft, uid, qTerms, matchQ, slash } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, onSearch } from '../core/ui.js';
import { suppliers, customers, cshort, calc, gname } from '../core/calc.js';
import { openBill } from './_bills.js';
import { shortProd, abbrList, ABBR_DEFAULT } from '../core/shortname.js';

export const STEPS = [['order', '訂貨'], ['mold', '開模'], ['wire', '叫線'], ['make', '生產'], ['lathe', '車修'], ['heat', '熱處理'], ['plate', '電鍍'], ['nylok', '耐落'], ['done', '已完成']];
const SOON = 10;
const ui = { tab: 'active', q: '', vendor: '', full: false };   // full：產品欄顯示完整品名
export default {
  id: 'orders', name: '訂貨排程', group: '業務', icon: 'orders',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('orders') || ch.has('bills') || ch.has('contacts'))) draw(this.el); },
  badge() { const a = store.list('orders').filter(o => !(o.steps || {}).done); const late = a.filter(o => o.due && o.due < today()).length; return { cnt: a.length, alert: late > 0 }; },
};
function draw(el) {
  const t = today(); const all = store.list('orders'); const q = qTerms(ui.q);
  const vn = o => o.cid ? cshort(o.cid) : (o.vendor || '');   // 畫面用簡稱
  // 採購單自動出現在排程：每一項商品各一列、各自勾進度（勾過才存成一筆；以前整張存一筆的舊紀錄照舊）
  const poRows = calc().bills.filter(b => b.type === 'PO' && !b.received && !all.some(o => o.poId === b.id && !o.pk)).flatMap(b => {
    const seen = {};
    return (b.lines || []).filter(l => l.txt === undefined && (l.gid || l.n)).map(l => {
      const k0 = l.gid || 'n:' + l.n; seen[k0] = (seen[k0] || 0) + 1; const pk = seen[k0] > 1 ? `${k0}#${seen[k0]}` : k0;
      return { id: `po:${b.id}:${pk}`, poId: b.id, pk, cid: b.cid, vendor: cshort(b.cid), date: b.date, prod: l.gid ? gname(l.gid) : l.n, qty: +l.qty || '', due: b.deliv || '', steps: { order: true }, fromPO: true, note: l.memo || b.note };
    }).filter(r => !all.some(o => o.poId === b.id && o.pk === r.pk));
  });
  let list = [...all, ...poRows].filter(o => (ui.tab === 'active' ? !(o.steps || {}).done : (o.steps || {}).done) && (!ui.vendor || vn(o) === ui.vendor) && (!q.length || matchQ([vn(o), o.vendor, o.prod, o.cust, o.note, o.qty].join(' '), q)));
  list.sort((a, b) => ui.tab === 'active' ? (a.due || '9').localeCompare(b.due || '9') || (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || ''));
  const vcnt = {}; for (const o of [...all, ...poRows]) { if ((ui.tab === 'active') === !(o.steps || {}).done) { const v = vn(o); if (v) vcnt[v] = (vcnt[v] || 0) + 1; } }
  const vendors = Object.keys(vcnt).sort((a, b) => vcnt[b] - vcnt[a] || a.localeCompare(b, 'zh-Hant'));
  if (ui.vendor && !vcnt[ui.vendor]) vendors.push(ui.vendor);   // 篩選中的廠商在這個分頁沒有單，也留著按鈕才取消得掉
  const active = all.filter(o => !(o.steps || {}).done); const late = active.filter(o => o.due && o.due < t), soon = active.filter(o => o.due && o.due >= t && daysLeft(o.due) <= SOON);
  const restS = {}; for (const o of list) { const x = shortProd(o.prod); (restS[x.s] ??= new Set()).add(x.rest); } const dupS = new Set(Object.keys(restS).filter(k => restS[k].size > 1));   // 簡稱一樣、其實是不同材質的才補說明
  el.innerHTML = `<div class="head"><h1>訂貨排程</h1><span class="sp"></span>${tabs('od', [['active', `進行中 ${active.length + poRows.length}`], ['done', '已完成']], ui.tab)}<button class="btn pri" id="odNew">＋ 登記訂貨</button></div>
    ${ui.tab === 'active' ? `<div class="kpis"><div class="kpi ${late.length ? 'alert' : ''}"><span>逾期</span><b>${late.length}</b></div><div class="kpi"><span>${SOON} 天內到期</span><b>${soon.length}</b></div><div class="kpi"><span>進行中</span><b>${active.length + poRows.length}</b></div></div>` : ''}
    <div class="panel"><div class="tools"><input type="search" id="odQ" style="width:240px;flex:none" placeholder="搜尋產品、廠商、客戶" value="${esc(ui.q)}"><span class="muted small nowrap">${list.length} 筆</span><div class="od-vs"><button type="button" class="od-v${ui.vendor ? '' : ' on'}" data-v="">全部</button>${vendors.map(v => `<button type="button" class="od-v${v === ui.vendor ? ' on' : ''}" data-v="${esc(v)}">${esc(v)}<i>${vcnt[v] || 0}</i></button>`).join('')}</div><label class="check" style="display:inline-flex;gap:5px;align-items:center;white-space:nowrap"><input type="checkbox" id="odFull" style="width:auto" ${ui.full ? 'checked' : ''}> 完整品名</label><button class="btn sm" id="odAbbr">簡稱設定</button></div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>廠商</th><th>訂貨日</th><th>產品</th><th class="n">數量</th><th>客戶</th><th>交期</th><th>進度</th><th></th></tr></thead><tbody>${list.map((o, i) => { const dl = o.due ? daysLeft(o.due) : null; const tag = o.due && !(o.steps || {}).done ? (dl < 0 ? `<span class="pill bad">逾期 ${-dl} 天</span>` : dl <= SOON ? `<span class="pill warn">${dl === 0 ? '今天' : dl + ' 天後'}</span>` : '') : ''; return `<tr data-i="${i}"><td><b>${esc(vn(o))}</b>${o.fromPO ? ' <span class="pill blue">採購單</span>' : o.poId ? ' <span class="pill">PO</span>' : ''}</td><td class="nowrap">${esc(roc(o.date))}</td><td title="${esc(o.prod)}">${ui.full ? esc(o.prod) : (sp => `<b style="font-weight:600">${esc(sp.s)}</b>${dupS.has(sp.s) && sp.rest ? ` <span class="muted small">${esc(sp.rest)}</span>` : ''}`)(shortProd(o.prod))}${o.note ? `<span class="sub">${esc(o.note)}</span>` : ''}</td><td class="n">${esc(String(o.qty || ''))}</td><td>${esc(o.cust || '')}</td><td class="nowrap">${o.due ? esc(roc(o.due)) : ''} ${tag}</td><td><div class="steps">${STEPS.map(([k, l]) => `<label class="${(o.steps || {})[k] ? 'on' : ''}"><input type="checkbox" data-step="${k}" data-i="${i}" ${(o.steps || {})[k] ? 'checked' : ''}>${l}</label>`).join('')}</div></td><td class="nowrap"><button class="btn xs" data-edit="${i}">修改</button>${o.poId ? ` <button class="btn xs ghost" data-po="${o.poId}">採購單</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="8"><div class="empty"><b>${ui.tab === 'active' ? '沒有進行中的訂貨' : '沒有已完成的紀錄'}</b></div></td></tr>`}</tbody></table></div></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  el.querySelectorAll('.od-v').forEach(b => b.addEventListener('click', () => { ui.vendor = b.dataset.v === ui.vendor ? '' : b.dataset.v; draw(el); }));
  onSearch($('#odQ', el), v => { ui.q = v; draw(el); const i = $('#odQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#odNew', el).addEventListener('click', () => editOrder(null));
  $('#odFull', el).addEventListener('change', ev => { ui.full = ev.target.checked; draw(el); });
  $('#odAbbr', el).addEventListener('click', () => abbrDialog(() => draw(el)));
  el.querySelectorAll('[data-step]').forEach(cb => cb.addEventListener('change', async () => {
    const o = list[+cb.dataset.i]; const steps = { ...(o.steps || {}) }; steps[cb.dataset.step] = cb.checked;
    if (cb.dataset.step === 'done' && cb.checked) steps.doneAt = today();
    const data = { ...o, steps }; delete data.id; delete data.fromPO;
    await store.save('orders', o.fromPO ? uid('o') : o.id, data);
    if (cb.dataset.step === 'done' && cb.checked && o.poId && !store.get('bills', o.poId)?.received) {
      // 同一張採購單的每一項都完成了，才提醒轉進貨單
      const rest = poLeft(o.poId);
      toast(rest ? `已完成。這張採購單還有 ${rest} 項沒完成。` : '這張採購單都完成了，記得到「採購進貨」把採購單轉成進貨單。');
    }
  }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editOrder(list[+b.dataset.edit])));
  el.querySelectorAll('[data-po]').forEach(b => b.addEventListener('click', () => openBill(null, b.dataset.po)));
}
/** 某張採購單還有幾項沒完成（存過的列看 steps.done，還沒存過的列一律算沒完成） */
function poLeft(poId) {
  const b = store.get('bills', poId); if (!b) return 0; const docs = store.list('orders').filter(o => o.poId === poId);
  if (docs.some(o => !o.pk)) return docs.filter(o => !(o.steps || {}).done).length;
  const seen = {}; let n = 0;
  for (const l of b.lines || []) { if (l.txt !== undefined || !(l.gid || l.n)) continue; const k0 = l.gid || 'n:' + l.n; seen[k0] = (seen[k0] || 0) + 1; const pk = seen[k0] > 1 ? `${k0}#${seen[k0]}` : k0; if (!(docs.find(o => o.pk === pk)?.steps || {}).done) n++; }
  return n;
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

/** 簡稱設定：一行一組「原字=簡稱」，品名裡有「原字」就顯示成「簡稱＋尺寸」；沒列到的自動去掉「螺絲」「內六角」 */
function abbrDialog(done) {
  const cur = abbrList();
  modal({
    title: '產品簡稱設定', width: 520,
    body: `<p class="muted small" style="margin:0 0 8px">訂貨排程的產品欄只顯示「簡稱＋尺寸」，材質、表面處理、客料號都不顯示（滑鼠移上去看完整品名；同一頁有兩筆一樣時才補上材質）。<br>一行一組：<b>品名裡的字=要顯示的簡稱</b>。字比較長的優先。沒列到的品名會自動去掉「螺絲」「內六角」。</p>
      <div class="f"><textarea id="ab-t" rows="12" style="font:inherit;width:100%" spellcheck="false">${esc(cur.map(x => x[0] + '=' + x[1]).join('\n'))}</textarea></div>
      <div class="muted small">例：喇叭快速牙=快速牙　→　⊕喇叭快速牙螺絲6#*5分 鍍鋅鐵 顯示成「快速牙 6#*5分」</div><div class="err" id="ab-e"></div>`,
    footer: '<button class="btn" id="ab-def">恢復預設</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ab-ok">儲存</button>',
    onOpen(el, close) {
      const ta = el.querySelector('#ab-t');
      el.querySelector('#ab-def').onclick = () => { ta.value = ABBR_DEFAULT.map(x => x[0] + '=' + x[1]).join('\n'); };
      el.querySelector('#ab-ok').onclick = async () => {
        const list = []; for (const line of ta.value.split(/\n/)) { const t = line.trim(); if (!t) continue; const i = t.search(/[=＝]/); if (i < 1) { el.querySelector('#ab-e').textContent = `這一行看不懂：「${t}」（要寫成 原字=簡稱）`; return; } list.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]); }
        await store.saveSetting('prod_abbr', { list }); close(); toast('已儲存簡稱設定'); done && done();
      };
    },
  });
}
