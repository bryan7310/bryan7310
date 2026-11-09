// 報價／詢價：查價加入的報價單草稿 → 正式報價單（進銷存）→ 銷貨單
import { $, esc, fmt, fmtQ, uid, today } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, tabs, combo, confirm } from '../core/ui.js';
import { billList, openBill } from './_bills.js';
import { customers, calc, goodsLabel } from '../core/calc.js';
import { netPrice, itemFactor, fmtDisc } from '../core/pricing.js';
import { cart } from './pricing.js';
import { printName } from '../core/names.js';

const ui = { view: 'list' };
export default {
  id: 'quotes', name: '報價詢價', group: '業務', icon: 'quotes',
  render(el, { sub, params }) { this.el = el; ui.view = sub === 'draft' ? 'draft' : 'list'; draw(el); if (params.open) openBill(null, params.open); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('contacts'))) draw(this.el); },
};
function draw(el) {
  if (ui.view === 'draft') return drawDraft(el);
  billList(el, { key: 'quotes', title: '報價／詢價', types: ['QUO', 'RFQ'], tabList: [['all', '全部'], ['QUO', '報價單'], ['RFQ', '詢價單']], histTypes: ['QUO', 'RFQ'], newTypes: ['QUO', 'RFQ'], extraHead: `<a class="btn" href="#quotes/draft">報價單草稿（查價加入）<span class="pill blue">${cart.get().lines.length || 0}</span></a>` }, ui);
}
function drawDraft(el) {
  const c = cart.get(); const C = calc();
  const lines = c.lines.map(l => ({ l, it: store.get('pricing', l.pid) })).filter(x => x.it);
  const disc = +c.disc || 0; const sub = lines.reduce((s, { l, it }) => s + netPrice(it) * l.qty, 0);
  const net = Math.round(sub * (disc ? (1 - disc / 100) : 1)); const tax = c.tax ? Math.round(net * 0.05) : 0;
  el.innerHTML = `<div class="head"><h1>報價單草稿</h1><span class="sub">從「螺絲查價」加入的品項</span><span class="sp"></span><a class="btn" href="#quotes">報價單清單</a><a class="btn" href="#pricing">← 繼續查價</a></div>
    <div class="panel" style="display:grid;gap:12px">
      <div class="grid"><div class="f"><label for="qc">客戶</label><div class="combo"><input id="qc" placeholder="搜尋客戶（選填）" value="${esc(C.ct[c.cid]?.short || C.ct[c.cid]?.name || '')}"></div></div><div class="f"><label for="qd">整單再折（%）</label><input id="qd" class="num" value="${c.disc || ''}" placeholder="例如 5"></div><label class="check" style="align-self:end"><input type="checkbox" id="qt" ${c.tax ? 'checked' : ''}> 加 5% 營業稅</label></div>
      ${lines.length ? `<div class="tw"><table><thead><tr><th>品項</th><th>廠商</th><th class="n">淨價</th><th class="n" style="width:110px">數量</th><th class="n">小計</th><th></th></tr></thead><tbody>${lines.map(({ l, it }, i) => `<tr><td>${esc(it.name)} <span class="mono">${esc(it.spec || '')}</span><span class="sub">${esc([it.material, it.finish].filter(Boolean).join(' '))}　${esc(fmtDisc(itemFactor(it).f))}</span></td><td>${esc(it.sup || '')}</td><td class="n">${fmtQ(netPrice(it))}</td><td class="n"><input type="number" min="1" data-q="${i}" value="${l.qty}" style="width:90px;text-align:right;border:1px solid var(--line);border-radius:6px;padding:4px 6px" class="num"></td><td class="n">${fmt(netPrice(it) * l.qty)}</td><td><button class="icon-btn" data-rm="${i}" aria-label="移除"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td></tr>`).join('')}</tbody></table></div>
      <div class="totals"><div><span>小計</span> <b>${fmt(sub)}</b></div>${disc ? `<div><span>再折 ${disc}%</span> <b>${fmt(net)}</b></div>` : ''}${c.tax ? `<div><span>稅額</span> <b>${fmt(tax)}</b></div>` : ''}<div class="big"><span>總額</span> <b>${fmt(net + tax)}</b></div></div>
      <div class="tools"><button class="btn danger" id="qClear">清空草稿</button><span class="sp"></span><button class="btn" id="qCopy">複製報價文字</button><button class="btn pri" id="qMake">建立正式報價單</button></div>` : '<div class="empty"><b>草稿是空的</b>到「螺絲查價」找到品項後按「加入」</div>'}
    </div>`;
  combo($('#qc', el), { items: () => customers().map(x => ({ id: x.id, label: x.short || x.name, sub: [x.code, x.short ? x.name : ''].filter(Boolean).join(' '), text: [x.code, x.name, x.short, ...(x.aliases || [])].join(' ') })), onPick: it => { c.cid = it.id; cart.set(c); }, onClear: () => { c.cid = ''; cart.set(c); } });
  $('#qd', el).addEventListener('change', ev => { c.disc = +ev.target.value || 0; cart.set(c); drawDraft(el); });
  $('#qt', el).addEventListener('change', ev => { c.tax = ev.target.checked; cart.set(c); drawDraft(el); });
  el.querySelectorAll('[data-q]').forEach(i => i.addEventListener('change', () => { c.lines[+i.dataset.q].qty = Math.max(1, +i.value || 1); cart.set(c); drawDraft(el); }));
  el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { c.lines.splice(+b.dataset.rm, 1); cart.set(c); drawDraft(el); }));
  $('#qClear', el)?.addEventListener('click', async () => { if (await confirm('清空報價單草稿？', { danger: true, ok: '清空' })) { cart.set({ lines: [], cid: '' }); drawDraft(el); } });
  $('#qCopy', el)?.addEventListener('click', () => {
    const co = store.setting('company');
    const txt = [`${co.name || '志瑞螺絲'} 報價 ${today()}`, C.ct[c.cid] ? `客戶：${printName(C.ct[c.cid].name)}` : '', ...lines.map(({ l, it }, i) => `${i + 1}. ${it.name} ${it.spec || ''}${it.material ? ' ' + it.material : ''}${it.finish ? ' ' + it.finish : ''}　${fmtQ(netPrice(it))} 元/${it.unit || '支'} × ${l.qty} = ${fmt(netPrice(it) * l.qty)}`), `小計 ${fmt(sub)}${disc ? `，再折 ${disc}% → ${fmt(net)}` : ''}${c.tax ? `，稅 ${fmt(tax)}` : ''}，總額 ${fmt(net + tax)}`].filter(Boolean).join('\n');
    navigator.clipboard.writeText(txt).then(() => toast('已複製報價文字'), () => toast('無法複製，請手動選取'));
  });
  $('#qMake', el)?.addEventListener('click', async () => {
    if (!c.cid) { toast('請先選客戶'); $('#qc', el).focus(); return; }
    // 牌價品項 → 商品（已有同名同規格就用它，否則建立）
    const goods = store.list('goods'); const ops = []; const bl = [];
    for (const { l, it } of lines) {
      const name = `${it.name}${it.spec ? ' ' + it.spec : ''}${it.material ? ' ' + it.material : ''}${it.finish ? ' ' + it.finish : ''}`.trim();
      let g = goods.find(x => x.pid === it.id) || goods.find(x => x.name === name);
      if (!g) { const gid = uid('g'); g = { id: gid, code: '', name, spec: '', unit: it.unit || 'PCS', cat: '', purPrice: 0, salePrice: netPrice(it), safety: 0, pid: it.id, sup: it.sup, note: `由查價建立（${it.sup || ''}）` }; ops.push({ col: 'goods', id: gid, data: { ...g, id: undefined } }); }
      bl.push({ gid: g.id, qty: l.qty, price: netPrice(it) });
    }
    if (ops.length) await store.batch(ops);
    const discAmt = disc ? Math.round(sub * disc / 100) : 0;
    openBill('QUO', null, saved => { if (saved) { cart.set({ lines: [], cid: '' }); location.hash = '#quotes'; } }, { cid: c.cid, lines: bl, disc: discAmt, tax: !!c.tax, note: disc ? `整單再折 ${disc}%` : '' });
  });
}
