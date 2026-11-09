// 傳真：採購單／詢價單／報價單產生黑白傳真稿（可加封面頁），用電腦的傳真驅動程式送出；傳真紀錄
import { $, esc, fmt, today, slash, ls, qTerms, matchQ, thisMonth, shiftMonth, ymLabel } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, printHTML } from '../core/ui.js';
import { calc, TYPES, cname } from '../core/calc.js';
import { billDoc, openBill } from './_bills.js';

const ui = { month: thisMonth(), q: '' };
export default {
  id: 'faxes', name: '傳真紀錄', group: '業務', icon: 'fax',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && ch.has('bills')) draw(this.el); },
};
// 傳真撥號：台中客戶（地址在台中，或沒有地址但號碼是 04 開頭）把區碼 04 拿掉
export function faxDial(c, num) {
  const raw = String(num || '').trim(); if (!raw) return ''; const d = raw.replace(/[^\d]/g, '');
  const tc = /台中|臺中/.test(c?.addr || '') || (!(c?.addr) && /^04(?!9)/.test(d));
  if (tc && /^04(?!9)/.test(d) && d.length >= 9) return d.slice(2); return d || raw;
}
export function faxDialog(b, after) {
  const T = TYPES[b.type]; if (!T?.doc) return; const C = calc(); const c = C.ct[b.cid] || {}; const co = store.setting('company');
  if (!b.cid) return toast('請先選擇' + (T.party === 'C' ? '客戶' : '廠商'));
  modal({
    title: `傳真${T.name} ${b.no}`, width: 640,
    body: `<div class="grid">
      <div class="f"><label for="fx-to">收件傳真號碼（撥號用）${c.fax ? `<span class="muted">　資料：${esc(c.fax)}${/台中|臺中/.test(c.addr || '') ? '・台中，已去掉 04' : ''}</span>` : ''}</label><input id="fx-to" value="${esc(faxDial(c, b.faxTo || c.fax || ''))}" placeholder="例如 24834426"></div>
      <div class="f"><label for="fx-attn">收件人</label><input id="fx-attn" value="${esc(b.attn || c.person || '')}"></div>
      <div class="f" style="grid-column:1/-1"><label for="fx-subj">主旨</label><input id="fx-subj" value="${esc(T.name + ' ' + b.no)}"></div>
      <div class="f" style="grid-column:1/-1"><label for="fx-msg">附言</label><textarea id="fx-msg">${b.type === 'PO' ? '敬請依採購單內容安排交貨，收到後請簽回確認，謝謝。' : b.type === 'RFQ' ? '敬請報價並回傳，謝謝。' : '報價如上，敬請參考，謝謝。'}</textarea></div></div>
      ${(b.faxLog || []).length ? `<div class="muted small">傳真紀錄：${b.faxLog.slice(-3).map(x => esc(x.at.slice(0, 16).replace('T', ' ')) + ' → ' + esc(x.to)).join('；')}</div>` : ''}
      <label class="check"><input type="checkbox" id="fx-cover"> 加一張傳真封面頁</label>
      <label class="check" ${c.fax ? 'hidden' : ''}><input type="checkbox" id="fx-save" ${c.fax ? '' : 'checked'}> 把傳真號碼存到這家${T.party === 'C' ? '客戶' : '廠商'}的資料</label>
      <div class="f"><label for="fx-prn">傳真印表機名稱（這台電腦，列印畫面要選這台）</label><input id="fx-prn" value="${esc(ls.get('zr.faxprn', 'Brother PC-FAX'))}" placeholder="例如：Brother MFC-L2770DW Printer PC-FAX"></div>
      <div class="muted small">按「產生傳真稿」後會<b>自動複製傳真號碼</b>並開列印畫面：印表機請選<b>傳真機／事務機的傳真驅動程式</b>（或 Windows 的「Fax」），在傳真號碼欄按 Ctrl+V 貼上送出；沒有傳真驅動的話，印出來用傳真機傳。傳真稿全部黑白、不用底色。</div>
      <div class="err" id="fx-err"></div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="fx-go">產生傳真稿</button>',
    onOpen(el, close) {
      el.querySelector('#fx-go').onclick = async () => {
        const v = id => el.querySelector('#' + id).value.trim();
        const to = v('fx-to'), attn = v('fx-attn'), subj = v('fx-subj'), msg = v('fx-msg'), cover = el.querySelector('#fx-cover').checked, prn = v('fx-prn');
        if (!to) return el.querySelector('#fx-err').textContent = '請填收件傳真號碼';
        ls.set('zr.faxprn', prn);
        try { await navigator.clipboard.writeText(to.replace(/[^\d#*+]/g, '')); } catch (e) {}
        const ops = [];
        if (el.querySelector('#fx-save')?.checked && c.id && !c.fax) { const d = { ...c, fax: to }; delete d.id; ops.push({ col: 'contacts', id: c.id, data: d }); }
        const d = billDoc({ ...b, attn: attn || b.attn }); const n = 1 + (cover ? 1 : 0);
        const cv = cover ? `<div class="cover"><div class="fxt">傳　真　FAX</div><table class="fxi"><tr><th>收件公司</th><td>${esc(c.name)}</td><th>寄件公司</th><td>${esc(co.name || '志瑞螺絲企業有限公司')}</td></tr><tr><th>收 件 人</th><td>${esc(attn)}</td><th>寄 件 人</th><td>${esc(store.user.name)}</td></tr><tr><th>傳真號碼</th><td><b>${esc(to)}</b></td><th>傳真號碼</th><td>${esc(co.fax || '')}</td></tr><tr><th>電　　話</th><td>${esc(c.phone || '')}</td><th>電　　話</th><td>${esc(co.phone || '')}</td></tr><tr><th>日　　期</th><td>${esc(slash(today()))}</td><th>頁　　數</th><td>共 ${n} 頁（含本頁）</td></tr><tr><th>主　　旨</th><td colspan="3"><b>${esc(subj)}</b></td></tr></table><div class="fxm">${esc(msg).replace(/\n/g, '<br>')}</div><div class="fxf">如傳真不清楚或頁數不符，請來電 ${esc(co.phone || '')} 告知，謝謝。</div></div>` : '';
        const bw = `*{color:#000!important}th{background:none!important}.cover{height:270mm;display:flex;flex-direction:column;page-break-after:always}.fxt{font-size:30pt;font-weight:bold;text-align:center;letter-spacing:.2em;border-bottom:2pt solid #000;padding-bottom:4mm;margin-bottom:8mm}.fxi{width:100%;border-collapse:collapse;table-layout:fixed}.fxi th,.fxi td{border:.8pt solid #000;height:11mm;font-size:12pt;padding:0 3mm;white-space:normal}.fxi th{width:28mm;text-align:center;font-weight:bold}.fxm{margin-top:8mm;border:.8pt solid #000;min-height:80mm;padding:5mm;font-size:13pt;line-height:1.7}.fxf{margin-top:auto;text-align:center;font-size:11pt}`;
        printHTML(`傳真_${b.no}`, d.css + bw, cv + d.html, { tip: `傳真到 <b style="font-size:18px">${esc(to)}</b>（${esc(c.name)}），共 ${n} 頁<br>① 列印畫面「目的地／印表機」選 <b>${esc(prn || '傳真印表機（PC-FAX）')}</b>，紙張 A4、縮放 100%，按「列印」<br>② 傳真軟體跳出來後，在傳真號碼欄按 <b>Ctrl+V</b> 貼上（號碼已自動複製），再按「傳送」<br><span style="color:#a33">③ 下次印出貨單時，記得把印表機換回原本的印表機。</span>` });
        const cur = store.get('bills', b.id);
        if (cur) { const nd = { ...cur, faxTo: to, attn: attn || cur.attn, faxLog: [...(cur.faxLog || []), { at: new Date().toISOString(), to, attn, by: store.user.name }] }; delete nd.id; ops.push({ col: 'bills', id: b.id, data: nd }); b.faxTo = to; b.faxLog = nd.faxLog; }
        if (ops.length) await store.batch(ops);
        store.log('傳真', `${T.name} ${b.no} → ${c.name} ${to}`); close(); after && after();
      };
    },
  });
}
function rows() { const out = []; for (const b of store.list('bills')) for (const f of b.faxLog || []) { const at = String(f.at || ''); const d = new Date(at); const loc = isNaN(d) ? at.slice(0, 16).replace('T', ' ') : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; out.push({ b, f, loc, m: loc.slice(0, 7) }); } return out.sort((x, y) => y.loc.localeCompare(x.loc)); }
function draw(el) {
  const C = calc(); const all = rows(); const q = qTerms(ui.q);
  const list = all.filter(r => (ui.month === 'all' || r.m === ui.month) && (!q.length || matchQ([r.b.no, cname(r.b.cid), C.ct[r.b.cid]?.short, r.f.to, r.f.attn, TYPES[r.b.type]?.name].join(' '), q)));
  const byM = {}; all.forEach(r => byM[r.m] = (byM[r.m] || 0) + 1); const months = Object.keys(byM).sort().reverse();
  el.innerHTML = `<div class="head"><h1>傳真紀錄</h1><span class="sub">在採購單、詢價單、報價單按「傳真」產生傳真稿後，會記錄在這裡</span></div>
    <div class="panel" style="display:grid;gap:10px"><div class="tools"><button class="btn sm" id="fxPrev">‹</button><input type="month" id="fxMonth" value="${ui.month === 'all' ? '' : ui.month}"><button class="btn sm" id="fxNext">›</button><button class="btn sm ${ui.month === 'all' ? 'pri' : ''}" id="fxAll">全部</button><input type="search" id="fxQ" placeholder="搜尋單號、廠商、傳真號碼、收件人" value="${esc(ui.q)}"><span class="muted small">${list.length} 筆</span></div>
    ${months.length ? `<div class="tools">${months.slice(0, 12).map(m => `<button class="btn sm ${m === ui.month ? 'pri' : ''}" data-m="${m}">${m.replace('-', '/')}（${byM[m]}）</button>`).join('')}</div>` : ''}
    <div class="tw"><table><thead><tr><th>傳真時間</th><th>單據</th><th>單號</th><th>對象</th><th>傳真號碼</th><th>收件人</th><th>誰</th><th class="n">金額</th><th></th></tr></thead><tbody>${list.map((r, i) => `<tr class="row" data-id="${r.b.id}"><td class="nowrap">${esc(r.loc)}</td><td>${esc(TYPES[r.b.type]?.name || '')}</td><td class="mono">${esc(r.b.no)}</td><td>${esc(cname(r.b.cid))}</td><td class="mono">${esc(r.f.to)}</td><td>${esc(r.f.attn || '')}</td><td class="muted">${esc(r.f.by || '')}</td><td class="n">${fmt(C.tot[r.b.id]?.total || 0)}</td><td><button class="btn xs" data-re="${i}">再傳一次</button></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty"><b>這個月沒有傳真紀錄</b></div></td></tr>'}</tbody></table></div></div>`;
  $('#fxMonth', el).addEventListener('change', ev => { if (ev.target.value) { ui.month = ev.target.value; draw(el); } });
  $('#fxPrev', el).onclick = () => { ui.month = shiftMonth(ui.month === 'all' ? thisMonth() : ui.month, -1); draw(el); };
  $('#fxNext', el).onclick = () => { ui.month = shiftMonth(ui.month === 'all' ? thisMonth() : ui.month, 1); draw(el); };
  $('#fxAll', el).onclick = () => { ui.month = 'all'; draw(el); };
  $('#fxQ', el).addEventListener('input', ev => { ui.q = ev.target.value; draw(el); const i = $('#fxQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { ui.month = b.dataset.m; draw(el); });
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button')) return; openBill(null, tr.dataset.id); }));
  el.querySelectorAll('[data-re]').forEach(b => b.onclick = () => { const r = list[+b.dataset.re]; faxDialog(store.get('bills', r.b.id)); });
}
