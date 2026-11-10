// 支票開立：付款支票、國字金額、套印；從應付帳款帶入
import { $, esc, money, today, roc, rocLong, parseNum, uid, cnMoney, slash, qTerms, matchQ } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, tabs, combo, printHTML, pager, onSearch } from '../core/ui.js';
import { suppliers, cshort } from '../core/calc.js';
import { printName } from '../core/names.js';

const ui = { tab: 'pending', q: '', page: 0 };
export default {
  id: 'checks-out', name: '支票開立', group: '財務', icon: 'checks',
  render(el, { sub }) { this.el = el; if (sub === 'done') ui.tab = 'done'; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('checks_out') || ch.has('settings') || ch.has('contacts'))) draw(this.el); },
  badge() { return { cnt: store.list('checks_out').filter(c => !c.printedAt).length }; },
};
const DEFAULT_LAYOUT = { pageW: 190.5, pageH: 98.4, offX: 0, offY: 0, mT: 13, mB: 0, mL: 26, mR: 0 };
const FIELDS = { year: { x: 135.3, y: 18.0, w: 13.5, h: 8.2, v: 'vb', pt: 12 }, month: { x: 148.8, y: 18.0, w: 11.1, h: 8.2, v: 'vb', pt: 12 }, day: { x: 159.9, y: 18.0, w: 20.4, h: 8.2, v: 'vb', pt: 12 }, payee: { x: 67.3, y: 26.2, w: 113.0, h: 9.8, v: 'vc', pt: 14 }, words: { x: 62.8, y: 36.0, w: 117.5, h: 7.9, v: 'vc', pt: 14 }, num: { x: 67.3, y: 46.3, w: 68.0, h: 6.9, v: 'vt', pt: 14 } };
function layout() { const s = store.setting('check_print'); return { ...DEFAULT_LAYOUT, ...(s.layout || {}) }; }
function fmtList() {
  const s = store.setting('check_print'); if (s.fmt && Array.isArray(s.fmt.list)) return s.fmt.list;
  const L = layout(); const r1 = v => Math.round(v * 10) / 10;
  return [...Object.keys(FIELDS).map(k => ({ k, on: true, ...FIELDS[k], x: r1(FIELDS[k].x - L.mL), y: r1(FIELDS[k].y - L.mT), font: '', bold: true, al: 'l', ls: 0, pre: '', suf: '' })), { k: 'no', on: false, x: 109.3, y: 0, w: 45, h: 7, v: 'vc', pt: 11, font: '', bold: true, al: 'l', ls: 0, pre: '', suf: '' }, { k: 'note', on: false, x: 41.3, y: 42, w: 68, h: 7, v: 'vc', pt: 11, font: '', bold: false, al: 'l', ls: 0, pre: '', suf: '' }];
}
const incNo = no => { const m = String(no || '').match(/^(.*?)(\d+)$/); return m ? m[1] + String(+m[2] + 1).padStart(m[2].length, '0') : ''; };
export function lastNo() { const s = store.setting('check_print'); if (s.lastNo) return s.lastNo; const w = store.list('checks_out').filter(c => c.no).sort((a, b) => (b.seq || 0) - (a.seq || 0)); return w.length ? w[0].no : ''; }
const rocDate = iso => { const [y, m, d] = iso.split('-').map(Number); return { y: y - 1911, m, d }; };

function draw(el) {
  const all = store.list('checks_out'); const q = qTerms(ui.q);
  const list = all.filter(c => (ui.tab === 'pending' ? !c.printedAt : !!c.printedAt) && (!q.length || matchQ([c.payee, c.no, c.note, money(c.amount)].join(' '), q))).sort((a, b) => ui.tab === 'pending' ? (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || ''));
  const [s, e, pg] = pager('co', list.length, ui.page);
  el.innerHTML = `<div class="head"><h1>支票開立</h1><span class="sp"></span>${tabs('co', [['pending', `待列印 ${all.filter(c => !c.printedAt).length || ''}`], ['done', '已列印']], ui.tab)}<button class="btn" id="coLayout">套印位置</button><button class="btn pri" id="coNew">＋ 開立支票</button></div>
    <div class="panel"><div class="tools"><input type="search" id="coQ" placeholder="搜尋抬頭、票號、金額" value="${esc(ui.q)}"><span class="muted small">${list.length} 張・合計 ${money(list.reduce((a, c) => a + (+c.amount || 0), 0))}</span><span class="sp"></span>${ui.tab === 'pending' && list.length ? `<button class="btn sm pri" id="coPrintAll">列印全部待列印（${list.length} 張）</button>` : ''}</div>
    <div class="tw" style="margin-top:10px"><table><thead><tr><th>票載日期</th><th>抬頭</th><th class="n">金額</th><th>國字</th><th>支票號碼</th><th>備註</th><th></th></tr></thead><tbody>${list.slice(s, e).map(c => `<tr class="row" data-id="${c.id}"><td class="nowrap">${esc(roc(c.date))}</td><td><b>${esc(c.cid ? cshort(c.cid) : c.payee)}</b></td><td class="n">${money(c.amount)}</td><td class="muted small">${esc(cnMoney(c.amount))}</td><td class="mono">${esc(c.no || '')}</td><td class="muted">${esc(c.note || '')}</td><td class="nowrap"><button class="btn xs" data-print="${c.id}">${c.printedAt ? '重印' : '列印'}</button></td></tr>`).join('') || `<tr><td colspan="7"><div class="empty"><b>${ui.tab === 'pending' ? '沒有待列印的支票' : '還沒有列印過的支票'}</b></div></td></tr>`}</tbody></table></div>${pg}</div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; ui.page = 0; draw(el); }, { once: true });
  onSearch($('#coQ', el), v => { ui.q = v; ui.page = 0; draw(el); const i = $('#coQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { ui.page = +b.dataset.to; draw(el); }));
  $('#coNew', el).addEventListener('click', () => newCheckOut());
  $('#coLayout', el).addEventListener('click', layoutDialog);
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button')) return; newCheckOut(store.get('checks_out', tr.dataset.id)); }));
  el.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => printChecks([store.get('checks_out', b.dataset.print)])));
  $('#coPrintAll', el)?.addEventListener('click', () => printChecks(list));
}
export function newCheckOut(preset, cb) {
  const d = preset?.id ? { ...preset } : { date: today(), payee: '', amount: '', note: '', no: '', ...(preset || {}) };
  const isNew = !preset?.id;
  modal({
    title: isNew ? '開立支票' : '修改支票', width: 560,
    body: `<div class="grid"><div class="f" style="grid-column:1/-1"><label for="co-payee">抬頭（受款人）</label><div class="combo"><input id="co-payee" value="${esc(d.payee)}" placeholder="搜尋供應商或直接輸入"></div></div>
      <div class="f"><label for="co-date">票載日期</label><input type="date" id="co-date" value="${esc(d.date)}"></div><div class="f"><label for="co-amount">金額</label><input id="co-amount" class="num" value="${d.amount !== '' ? money(d.amount) : ''}"></div>
      <div class="f"><label for="co-no">支票號碼（可列印時再填）</label><input id="co-no" class="mono" value="${esc(d.no || '')}" placeholder="${esc(incNo(lastNo()))}"></div><div class="f"><label for="co-note">備註</label><input id="co-note" value="${esc(d.note || '')}"></div></div>
      <div class="muted" id="co-cn" style="font-size:15px">${cnMoney(d.amount)}</div>`,
    footer: `${!isNew ? '<button class="btn danger" id="co-del">刪除</button>' : ''}<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="co-ok">儲存</button>`,
    onOpen(el, close) {
      let cid = d.cid;
      combo($('#co-payee', el), { items: () => suppliers().map(c => ({ id: c.id, label: printName(c.name), sub: c.short || '', text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), allowFree: true, onPick: it => { cid = it.id; } });
      $('#co-amount', el).addEventListener('input', () => { $('#co-cn', el).textContent = cnMoney(parseNum($('#co-amount', el).value) || 0); });
      $('#co-ok', el).onclick = async () => {
        const amount = parseNum($('#co-amount', el).value); const payee = $('#co-payee', el).value.trim();
        if (!payee) return toast('請填抬頭'); if (!(amount > 0)) return toast('金額要大於 0');
        const out = { ...d, cid, payee, amount, date: $('#co-date', el).value, no: $('#co-no', el).value.trim().toUpperCase(), note: $('#co-note', el).value.trim(), createdAt: d.createdAt || Date.now() }; delete out.id;
        const id = d.id || uid('co'); await store.save('checks_out', id, out); store.log(isNew ? '開立' : '修改', `支票 ${payee} ${money(amount)}`); close(); toast('已儲存'); cb && cb({ ...out, id });
      };
      $('#co-del', el)?.addEventListener('click', async () => { if (await confirm('刪除這張支票？', { danger: true, ok: '刪除' })) { await store.remove('checks_out', d.id); close(); } });
    },
    onClose: v => { if (!v) cb && cb(null); },
  });
}
// 支票抬頭印全名：抬頭寫的是該供應商的簡稱／別名時，換成全名（拿掉備註括號）；自己打的其他抬頭照印
function payeeOut(c) { const s = c.cid && store.get('contacts', c.cid); const p = String(c.payee || '').trim(); if (s && (p === s.short || p === s.name || (s.aliases || []).includes(p))) return printName(s.name); return p; }
async function printChecks(list) {
  // 沒票號的先補：從上一張 +1
  const need = list.filter(c => !c.no);
  if (need.length) {
    const first = await new Promise(res => modal({ title: '填支票號碼', width: 420, body: `<p>有 ${need.length} 張沒有支票號碼。輸入第一張的號碼，其餘自動 +1。</p><div class="f"><input id="cn1" class="mono" value="${esc(incNo(lastNo()))}" autofocus></div>`, footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="cnOk">繼續</button>', onOpen(el, close) { el.querySelector('#cnOk').onclick = () => { res(el.querySelector('#cn1').value.trim().toUpperCase()); close(); }; }, onClose: () => res(null) }));
    if (!first) return;
    let no = first; for (const c of need) { c.no = no; no = incNo(no); }
  }
  const L = layout(); const fl = fmtList(); const W = L.pageW - L.mL - L.mR, H = L.pageH - L.mT - L.mB;
  const html = list.map(c => {
    const dt = rocDate(c.date); const vals = { year: dt.y, month: dt.m, day: dt.d, payee: payeeOut(c), words: cnMoney(c.amount), num: money(c.amount), no: c.no || '', note: c.note || '' };
    let h = `<div class="check" style="width:${L.pageW}mm;height:${L.pageH}mm">`;
    for (const f of fl) { if (!f.on) continue; let v = f.custom ? (f.txt || '') : (vals[f.k] ?? ''); if (v !== '' && v != null) v = (f.pre || '') + v + (f.suf || ''); h += `<div class="f ${f.v || 'vc'}${f.al === 'c' ? ' ha-c' : f.al === 'r' ? ' ha-r' : ''}" style="left:${+L.mL + f.x + +L.offX}mm;top:${+L.mT + f.y + +L.offY}mm;width:${f.w}mm;height:${f.h}mm;font-size:${f.pt}pt;${f.font ? `font-family:${esc(f.font)};` : ''}font-weight:${f.bold ? 700 : 400};${+f.ls ? `letter-spacing:${+f.ls}mm;` : ''}"><span>${esc(v)}</span></div>`; }
    return h + '</div>';
  }).join('');
  const css = `@page{size:${L.pageW}mm ${L.pageH}mm;margin:0}body{margin:0}.check{position:relative;color:#000;font-family:"PMingLiU","新細明體","MingLiU","Noto Serif TC",serif;font-weight:700;overflow:hidden;break-after:page;page-break-after:always}.f{position:absolute;display:flex;white-space:nowrap;padding-left:.6mm;line-height:1}.f.vb{align-items:flex-end;padding-bottom:.4mm}.f.vc{align-items:center}.f.vt{align-items:flex-start;padding-top:.4mm}.f.ha-c{justify-content:center}.f.ha-r{justify-content:flex-end}`;
  printHTML('支票套印', css, html, { tip: `把支票放進印表機，紙張 ${L.pageW}×${L.pageH} mm、邊界「無」、縮放 100%。共 ${list.length} 張。` });
  const ops = list.map(c => ({ col: 'checks_out', id: c.id, data: { ...store.get('checks_out', c.id), no: c.no, printedAt: Date.now(), seq: Date.now() } }));
  const last = list[list.length - 1].no; const s = store.setting('check_print');
  ops.push({ col: 'settings', id: 'check_print', data: { ...s, lastNo: last } });
  for (const o of ops) delete o.data.id;
  await store.batch(ops);
}
function layoutDialog() {
  const L = layout(); const s = store.setting('check_print');
  modal({
    title: '支票套印位置', width: 520,
    body: `<p class="muted" style="margin:0">支票紙張大小與列印位移（mm）。印出來整體偏右就把「水平位移」改負數；偏下就把「垂直位移」改負數。各欄位的細部位置沿用舊作業平台的設定。</p>
      <div class="grid">${[['pageW', '紙寬'], ['pageH', '紙高'], ['mL', '左邊界'], ['mT', '上邊界'], ['offX', '水平位移'], ['offY', '垂直位移']].map(([k, l]) => `<div class="f"><label for="ly-${k}">${l}</label><input id="ly-${k}" class="num" value="${L[k]}"></div>`).join('')}</div>`,
    footer: '<button class="btn" id="lyReset">恢復預設</button><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="lyOk">儲存</button>',
    onOpen(el, close) {
      $('#lyOk', el).onclick = async () => { const o = { ...L }; for (const k of Object.keys(DEFAULT_LAYOUT)) { const v = parseFloat($('#ly-' + k, el)?.value); if (isFinite(v)) o[k] = v; } await store.saveSetting('check_print', { ...s, layout: o }); close(); toast('已儲存'); };
      $('#lyReset', el).onclick = async () => { await store.saveSetting('check_print', { ...s, layout: DEFAULT_LAYOUT }); close(); };
    },
  });
}
