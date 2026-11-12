// 傳真：採購單／詢價單／報價單產生黑白傳真稿（可加封面頁），用電腦的傳真驅動程式送出；傳真紀錄
import { $, esc, fmt, today, slash, ls, qTerms, matchQ, thisMonth, shiftMonth, ymLabel, copyText, toHalf, uid } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { toast, modal, printHTML, onSearch } from '../core/ui.js';
import { calc, TYPES, cname, cshort } from '../core/calc.js';
import { printName } from '../core/names.js';
import { billDoc, openBill } from './_bills.js';

const ui = { month: thisMonth(), q: '' };
export default {
  id: 'faxes', name: '傳真紀錄', group: '業務', icon: 'fax',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('bills') || ch.has('faxjobs'))) draw(this.el); },
};
// 傳真撥號：符號、空白一律拿掉（全形數字先轉半形；寫了兩個號碼只取第一個）；
// 地址有「台中／臺中」的，再把開頭的區碼 04 拿掉（049 是南投區碼，不動）
export const isTaichung = c => /台中|臺中/.test(toHalf(c?.addr || ''));
export function faxDial(c, num) {
  const raw = toHalf(num).trim(); if (!raw) return '';
  const first = raw.split(/[、,，;；/／]|或|及/)[0].split(/[#＃]|分機|轉|ext\.?|x(?=\s*\d)/i)[0];
  let d = first.replace(/[^\d]/g, '') || raw.replace(/[^\d]/g, '');
  if (isTaichung(c) && /^04(?!9)/.test(d)) d = d.slice(2);
  return d;
}
/** 傳真稿：封面頁（可選）＋單據，全部黑白；回傳 css、body、完整 HTML（給傳真小幫手轉 PDF）與頁數 */
export function faxDoc(b, c, { to, attn, subj, msg, cover, big }) {
  const co = store.setting('company');
  const d = billDoc({ ...b, attn: attn || b.attn }); const n = 1 + (cover ? 1 : 0);
  const cv = cover ? `<div class="cover"><div class="fxt">傳　真　FAX</div><table class="fxi"><tr><th>收件公司</th><td>${esc(printName(c.name))}</td><th>寄件公司</th><td>${esc(co.name || '志瑞螺絲企業有限公司')}</td></tr><tr><th>收 件 人</th><td>${esc(attn)}</td><th>寄 件 人</th><td>${esc(store.user.name)}</td></tr><tr><th>傳真號碼</th><td><b>${esc(to)}</b></td><th>傳真號碼</th><td>${esc(co.fax || '')}</td></tr><tr><th>電　　話</th><td>${esc(c.phone || '')}</td><th>電　　話</th><td>${esc(co.phone || '')}</td></tr><tr><th>日　　期</th><td>${esc(slash(today()))}</td><th>頁　　數</th><td>共 ${n} 頁（含本頁）</td></tr><tr><th>主　　旨</th><td colspan="3"><b>${esc(subj)}</b></td></tr></table><div class="fxm">${esc(msg).replace(/\n/g, '<br>')}</div><div class="fxf">如傳真不清楚或頁數不符，請來電 ${esc(co.phone || '')} 告知，謝謝。</div></div>` : '';
  const bw = `*{color:#000!important}th{background:none!important}.cover{height:270mm;display:flex;flex-direction:column;page-break-after:always}.fxt{font-size:30pt;font-weight:bold;text-align:center;letter-spacing:.2em;border-bottom:2pt solid #000;padding-bottom:4mm;margin-bottom:8mm}.fxi{width:100%;border-collapse:collapse;table-layout:fixed}.fxi th,.fxi td{border:.8pt solid #000;height:11mm;font-size:12pt;padding:0 3mm;white-space:normal}.fxi th{width:28mm;text-align:center;font-weight:bold}.fxm{margin-top:8mm;border:.8pt solid #000;min-height:80mm;padding:5mm;font-size:13pt;line-height:1.7}.fxf{margin-top:auto;text-align:center;font-size:11pt}`;
  const bg = big ? 'body,.meta,th,td,p,.sig{font-size:12pt!important}.co{font-size:11.5pt!important}h1{font-size:20pt!important}' : '';   // 手機版傳真：內文至少 12pt
  return { css: d.css + bw + bg, body: cv + d.html, n, html: `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>傳真 ${esc(b.no)}</title><style>${d.css + bw + bg}</style></head><body>${cv + d.html}</body></html>` };
}
/** 排入自動傳真：由「傳真小幫手」在伺服器電腦上印到 PC-FAX、填號碼、按開始 */
export async function queueFax(b, c, opts) {
  const fd = faxDoc(b, c, opts); const dial = faxDial(c, opts.to) || toHalf(opts.to).replace(/[^\d#*+]/g, '');
  const id = uid('fx'); const T = TYPES[b.type];
  const ops = [{ col: 'faxjobs', id, data: { status: 'queued', billId: b.id, no: b.no, type: b.type, cid: b.cid, to: opts.to, dial, attn: opts.attn || '', pages: fd.n, html: fd.html, printer: ls.get('zr.faxprn', 'Brother PC-FAX v.3.2'), by: store.user.name, at: new Date().toISOString() } }];
  const cur = store.get('bills', b.id);
  if (cur) { const nd = { ...cur, faxTo: opts.to, attn: opts.attn || cur.attn, faxLog: [...(cur.faxLog || []), { at: new Date().toISOString(), to: opts.to, attn: opts.attn || '', by: store.user.name, auto: true, job: id }] }; delete nd.id; ops.push({ col: 'bills', id: b.id, data: nd }); }
  await store.batch(ops); store.log('傳真', `${T.name} ${b.no} → ${c.name} ${opts.to}（自動傳真排入）`);
  return id;
}
export const FAX_ST = { queued: ['等待中', ''], sending: ['傳送中', 'blue'], sent: ['已送出', 'ok'], failed: ['失敗', 'bad'] };
export const faxPill = j => { const [t, c] = FAX_ST[j?.status] || ['', '']; return t ? `<span class="pill ${c}" title="${esc(j.msg || '')}">${t}</span>` : ''; };
export function faxDialog(b, after) {
  const T = TYPES[b.type]; if (!T?.doc) return; const C = calc(); const c = C.ct[b.cid] || {}; const co = store.setting('company');
  if (!b.cid) return toast('請先選擇' + (T.party === 'C' ? '客戶' : '廠商'));
  modal({
    title: `傳真${T.name} ${b.no}`, width: 640,
    body: `<div class="grid">
      <div class="f"><label for="fx-to">收件傳真號碼（撥號用）${c.fax ? `<span class="muted">　資料：${esc(c.fax)}${isTaichung(c) ? '・地址在台中，去掉 04' : ''}</span>` : ''}</label><input id="fx-to" value="${esc(faxDial(c, b.faxTo || c.fax || ''))}" placeholder="例如 24834426"></div>
      <div class="f"><label for="fx-attn">收件人</label><input id="fx-attn" value="${esc(b.attn || c.person || '')}"></div>
      <div class="f" style="grid-column:1/-1"><label for="fx-subj">主旨</label><input id="fx-subj" value="${esc(T.name + ' ' + b.no)}"></div>
      <div class="f" style="grid-column:1/-1"><label for="fx-msg">附言</label><textarea id="fx-msg">${b.type === 'PRC' ? '送上加工品，敬請依加工單內容加工，完成後請連同本單送回並註明實際重量，謝謝。' : b.type === 'PO' ? '敬請依採購單內容安排交貨，收到後請簽回確認，謝謝。' : b.type === 'RFQ' ? '敬請報價並回傳，謝謝。' : '報價如上，敬請參考，謝謝。'}</textarea></div></div>
      ${(b.faxLog || []).length ? `<div class="muted small">傳真紀錄：${b.faxLog.slice(-3).map(x => esc(x.at.slice(0, 16).replace('T', ' ')) + ' → ' + esc(x.to)).join('；')}</div>` : ''}
      <label class="check"><input type="checkbox" id="fx-cover"> 加一張傳真封面頁</label>
      <label class="check" ${c.fax ? 'hidden' : ''}><input type="checkbox" id="fx-save" ${c.fax ? '' : 'checked'}> 把傳真號碼存到這家${T.party === 'C' ? '客戶' : '廠商'}的資料</label>
      <div class="f"><label for="fx-prn">傳真印表機名稱（這台電腦，列印畫面要選這台）</label><input id="fx-prn" value="${esc(ls.get('zr.faxprn', 'Brother PC-FAX'))}" placeholder="例如：Brother MFC-L2770DW Printer PC-FAX"></div>
      <div class="muted small">按「產生傳真稿」後會<b>自動複製傳真號碼</b>並開列印畫面：印表機請選<b>傳真機／事務機的傳真驅動程式</b>（或 Windows 的「Fax」），在傳真號碼欄按 Ctrl+V 貼上送出；沒有傳真驅動的話，印出來用傳真機傳。傳真稿全部黑白、不用底色。</div>
      <div class="err" id="fx-err"></div>`,
    footer: '<span class="muted small" id="fx-helper"></span><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn" id="fx-go">產生傳真稿（手動）</button><button class="btn pri" id="fx-auto">自動傳真</button>',
    onOpen(el, close) {
      api.get('/api/fax/helper').then(r => { el.querySelector('#fx-helper').innerHTML = r.online ? '<span class="pill ok">傳真小幫手在線上</span>' : '<span class="pill bad">傳真小幫手沒有在執行</span>'; }).catch(() => { el.querySelector('#fx-helper').textContent = ''; });
      el.querySelector('#fx-auto').onclick = async () => {
        const v = id => el.querySelector('#' + id).value.trim();
        const to = v('fx-to'); if (!to) return el.querySelector('#fx-err').textContent = '請填收件傳真號碼';
        ls.set('zr.faxprn', v('fx-prn'));
        if (el.querySelector('#fx-save')?.checked && c.id && !c.fax) { const d = { ...c, fax: to }; delete d.id; await store.save('contacts', c.id, d); }
        await queueFax(b, c, { to, attn: v('fx-attn'), subj: v('fx-subj'), msg: v('fx-msg'), cover: el.querySelector('#fx-cover').checked });
        toast(`已排入自動傳真：${to}，結果會顯示在「傳真紀錄」`); close(); after && after();
      };
      el.querySelector('#fx-go').onclick = async () => {
        const v = id => el.querySelector('#' + id).value.trim();
        const to = v('fx-to'), attn = v('fx-attn'), subj = v('fx-subj'), msg = v('fx-msg'), cover = el.querySelector('#fx-cover').checked, prn = v('fx-prn');
        if (!to) return el.querySelector('#fx-err').textContent = '請填收件傳真號碼';
        ls.set('zr.faxprn', prn);
        const dial = faxDial(c, to) || toHalf(to).replace(/[^\d#*+]/g, ''); const copied = await copyText(dial);
        const ops = [];
        if (el.querySelector('#fx-save')?.checked && c.id && !c.fax) { const d = { ...c, fax: to }; delete d.id; ops.push({ col: 'contacts', id: c.id, data: d }); }
        const fd = faxDoc(b, c, { to, attn, subj, msg, cover }); const n = fd.n;
        printHTML(`傳真_${b.no}`, fd.css, fd.body, { tip: `傳真到 <b style="font-size:18px">${esc(to)}</b>（${esc(printName(c.name))}），共 ${n} 頁　<button type="button" onclick="(function(){var t=document.createElement('textarea');t.value='${esc(dial)}';document.body.appendChild(t);t.select();var ok=document.execCommand('copy');t.remove();this.textContent=ok?'已複製 ${esc(dial)}':'複製失敗，請手動輸入';}).call(this)" style="font-size:13px;padding:3px 10px;border-radius:6px;border:1px solid #c9a44a;background:#fff;cursor:pointer">${copied ? '已複製號碼，再複製一次' : '複製傳真號碼'}</button><br>① 列印畫面「目的地／印表機」選 <b>${esc(prn || '傳真印表機（PC-FAX）')}</b>，紙張 A4、縮放 100%，按「列印」<br>② 傳真軟體跳出來後，在傳真號碼欄按 <b>Ctrl+V</b> 貼上（號碼已自動複製），再按「傳送」<br><span style="color:#a33">③ 下次印出貨單時，記得把印表機換回原本的印表機。</span>` });
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
  const jobs = store.list('faxjobs').sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
  el.innerHTML = `<div class="head"><h1>傳真紀錄</h1><span class="sp"></span><span class="muted small" id="fxHelper"></span><button class="btn" id="fxTest">傳真測試頁</button></div>
    ${jobs.length ? `<div class="panel"><div class="ptitle">最近的自動傳真</div><div class="tw"><table><thead><tr><th>排入時間</th><th>單據</th><th>對象</th><th>號碼</th><th>頁數</th><th>狀態</th><th>說明</th></tr></thead><tbody>${jobs.map(j => `<tr><td class="nowrap">${esc((d => isNaN(d) ? String(j.at || '').slice(0, 16) : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)(new Date(j.at)))}</td><td class="mono">${esc(j.no || '')}</td><td>${esc(j.cid ? cshort(j.cid) : j.toName || '')}</td><td class="mono">${esc(j.dial || j.to || '')}</td><td class="n">${j.pages || ''}</td><td>${faxPill(j)}</td><td class="small muted">${esc(j.msg || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div style="display:none"></div><div class="muted small" style="margin:-4px 0 8px">在採購單、詢價單、報價單按「傳真」後，會記錄在這裡</div>
    <div class="panel" style="display:grid;gap:10px"><div class="tools"><button class="btn sm" id="fxPrev">‹</button><input type="month" id="fxMonth" value="${ui.month === 'all' ? '' : ui.month}"><button class="btn sm" id="fxNext">›</button><button class="btn sm ${ui.month === 'all' ? 'pri' : ''}" id="fxAll">全部</button><input type="search" id="fxQ" placeholder="搜尋單號、廠商、傳真號碼、收件人" value="${esc(ui.q)}"><span class="muted small">${list.length} 筆</span></div>
    ${months.length ? `<div class="tools">${months.slice(0, 12).map(m => `<button class="btn sm ${m === ui.month ? 'pri' : ''}" data-m="${m}">${m.replace('-', '/')}（${byM[m]}）</button>`).join('')}</div>` : ''}
    <div class="tw"><table><thead><tr><th>傳真時間</th><th>單據</th><th>單號</th><th>對象</th><th>傳真號碼</th><th>收件人</th><th>誰</th><th class="n">金額</th><th></th></tr></thead><tbody>${list.map((r, i) => `<tr class="row" data-id="${r.b.id}"><td class="nowrap">${esc(r.loc)}</td><td>${esc(TYPES[r.b.type]?.name || '')}</td><td class="mono">${esc(r.b.no)}</td><td>${esc(cshort(r.b.cid))}</td><td class="mono">${esc(r.f.to)}${r.f.job ? ' ' + faxPill(store.get('faxjobs', r.f.job)) : ''}</td><td>${esc(r.f.attn || '')}</td><td class="muted">${esc(r.f.by || '')}</td><td class="n">${fmt(C.tot[r.b.id]?.total || 0)}</td><td><button class="btn xs" data-re="${i}">再傳一次</button></td></tr>`).join('') || '<tr><td colspan="9"><div class="empty"><b>這個月沒有傳真紀錄</b></div></td></tr>'}</tbody></table></div></div>`;
  $('#fxMonth', el).addEventListener('change', ev => { if (ev.target.value) { ui.month = ev.target.value; draw(el); } });
  $('#fxPrev', el).onclick = () => { ui.month = shiftMonth(ui.month === 'all' ? thisMonth() : ui.month, -1); draw(el); };
  $('#fxNext', el).onclick = () => { ui.month = shiftMonth(ui.month === 'all' ? thisMonth() : ui.month, 1); draw(el); };
  $('#fxAll', el).onclick = () => { ui.month = 'all'; draw(el); };
  onSearch($('#fxQ', el), v => { ui.q = v; draw(el); const i = $('#fxQ', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { ui.month = b.dataset.m; draw(el); });
  el.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('button')) return; openBill(null, tr.dataset.id); }));
  el.querySelectorAll('[data-re]').forEach(b => b.onclick = () => { const r = list[+b.dataset.re]; faxDialog(store.get('bills', r.b.id)); });
  api.get('/api/fax/helper').then(r => { const h = $('#fxHelper', el); if (h) h.innerHTML = r.online ? '<span class="pill ok">傳真小幫手在線上</span>' : '<span class="pill bad">傳真小幫手沒有在執行</span>'; }).catch(() => {});
  $('#fxTest', el).onclick = () => faxTestDialog();
}
/** 傳真測試頁：只傳一張「測試，請忽略」，用來確認自動傳真能不能用 */
function faxTestDialog() {
  const co = store.setting('company');
  modal({
    title: '傳真測試頁', width: 560,
    body: `<div class="grid"><div class="f"><label for="ft-to">傳真號碼</label><input id="ft-to" placeholder="例如 04-22712196"></div><div class="f"><label for="ft-name">收件公司</label><input id="ft-name" placeholder="例如 和輪工業"></div>
      <div class="f" style="grid-column:1/-1"><label for="ft-msg">內容</label><textarea id="ft-msg" rows="4">這是${esc(co.name || '志瑞螺絲企業有限公司')}的傳真測試，收到請不用處理，謝謝。\n如方便，請回電 ${esc(co.phone || '')} 告知是否清楚，感謝您。</textarea></div></div>
      <div class="muted small">按「傳送測試頁」後由傳真小幫手自動印到 PC-FAX 送出，送出後不能收回。</div><div class="err" id="ft-err"></div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="ft-go">傳送測試頁</button>',
    onOpen(el, close) {
      el.querySelector('#ft-go').onclick = async () => {
        const v = id => el.querySelector('#' + id).value.trim();
        const to = v('ft-to'), name = v('ft-name'), msg = v('ft-msg');
        let dial = toHalf(to).replace(/[^\d#*+]/g, ''); if (/^04(?!9)/.test(dial) && dial.length >= 9) dial = dial.slice(2);   // 台中市話：跟平常一樣去掉 04
        if (!dial) return el.querySelector('#ft-err').textContent = '請填傳真號碼';
        const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:"Microsoft JhengHei","微軟正黑體",sans-serif;color:#000}h1{font-size:28pt;text-align:center;letter-spacing:.2em;border-bottom:2pt solid #000;padding-bottom:4mm}table{width:100%;border-collapse:collapse;margin:8mm 0}th,td{border:.8pt solid #000;padding:3mm;font-size:13pt;text-align:left}th{width:30mm}.m{border:.8pt solid #000;padding:6mm;font-size:15pt;line-height:1.8;min-height:60mm}</style></head><body><h1>傳真測試</h1><table><tr><th>收件公司</th><td>${esc(name)}</td></tr><tr><th>傳真號碼</th><td>${esc(to)}</td></tr><tr><th>寄件公司</th><td>${esc(co.name || '志瑞螺絲企業有限公司')}　電話 ${esc(co.phone || '')}　傳真 ${esc(co.fax || '')}</td></tr><tr><th>日期</th><td>${esc(slash(today()))}</td></tr></table><div class="m">${esc(msg).replace(/\n/g, '<br>')}</div></body></html>`;
        const id = uid('fx');
        await store.save('faxjobs', id, { status: 'queued', no: '傳真測試', type: 'TEST', toName: name, to, dial, pages: 1, html, printer: ls.get('zr.faxprn', 'Brother PC-FAX v.3.2'), by: store.user.name, at: new Date().toISOString() });
        store.log('傳真', `傳真測試頁 → ${name} ${to}`);
        toast('已排入傳真測試頁，結果會顯示在「最近的自動傳真」'); close();
      };
    },
  });
}
