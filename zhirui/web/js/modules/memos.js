// 留言板／交辦事項：總覽和手機首頁最上面。存在設定 memos（大家共用、即時同步）。
// 等級顏色：緊急＝偏白粉紅、普急＝馬卡龍綠、一般＝鵝黃（像便利貼，深色模式也用淺底深字）。
import { esc, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, confirm, modal } from '../core/ui.js';

export const LV = {
  u: { name: '緊急', bg: '#FDE4EA', bd: '#F2B3C2', tag: '#C2185B' },
  m: { name: '普急', bg: '#D3F2DF', bd: '#9CD8B3', tag: '#1E7A46' },
  n: { name: '一般', bg: '#FFF3C2', bd: '#EDD27A', tag: '#8A6400' },
};
const ORDER = { u: 0, m: 1, n: 2 };
// 完成的：當天畫線留在板上，隔天自動消失（存檔時順便清掉）
const today0 = () => new Date(new Date().toDateString()).getTime();
const gone = x => x.done && (x.doneAt || 0) < today0();
const all = () => (store.setting('memos').list || []).filter(x => !gone(x));
async function put(fn) {   // 讀最新的再改，減少兩個人同時改互蓋
  const s = store.setting('memos'); const list = fn((s.list || []).filter(x => !gone(x)).map(x => ({ ...x })));
  await store.saveSetting('memos', { ...s, list });
}
const when = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const dueTxt = d => { if (!d) return ''; const dd = Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000); return dd < 0 ? `逾期 ${-dd} 天` : dd === 0 ? '今天到期' : dd === 1 ? '明天到期' : `${d.slice(5).replace('-', '/')} 到期`; };

/** 留言板 HTML。mobile＝手機版排版 */
export function memoBoard(ui, mobile) {
  const L = all(); const open = L.filter(x => !x.done).sort((a, b) => ORDER[a.lv] - ORDER[b.lv] || (b.at || 0) - (a.at || 0));
  const done = L.filter(x => x.done).sort((a, b) => ORDER[a.lv] - ORDER[b.lv] || (b.doneAt || 0) - (a.doneAt || 0));   // 今天完成的：畫線、排在後面
  const me = store.user?.name || '';
  const card = x => { const c = LV[x.lv] || LV.n; const due = dueTxt(x.due); const late = x.due && !x.done && due.startsWith('逾期');
    return `<div class="memo" data-mid="${x.id}" style="background:${c.bg};border:1px solid ${c.bd};border-left:5px solid ${c.tag};border-radius:10px;padding:${mobile ? '10px 12px' : '10px 12px 8px'};color:#2B2B2B;${x.done ? 'opacity:.6;' : ''}display:flex;flex-direction:column;gap:4px;min-width:0">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span style="background:${c.tag};color:#fff;border-radius:5px;padding:0 7px;font-size:12px;font-weight:700;line-height:19px">${c.name}</span>${x.to ? `<span style="font-size:12.5px;font-weight:600">→ ${esc(x.to)}</span>` : ''}${due ? `<span style="font-size:12px;font-weight:600;color:${late ? '#C62828' : '#555'}">${esc(due)}</span>` : ''}<span style="flex:1"></span>
        <label style="display:inline-flex;gap:5px;align-items:center;font-size:13px;font-weight:600;cursor:pointer;color:#333"><input type="checkbox" data-mdone="${x.id}" ${x.done ? 'checked' : ''} style="width:18px;height:18px;accent-color:${c.tag}">${x.done ? '已完成' : '完成'}</label></div>
      <div style="white-space:pre-wrap;word-break:break-word;font-size:${mobile ? 15 : 14.5}px;line-height:1.45;${x.done ? 'text-decoration:line-through;text-decoration-thickness:2px;color:#666;' : ''}">${esc(x.text)}</div>
      <div style="display:flex;gap:8px;align-items:center;font-size:11.5px;color:#666">${esc(x.by || '')} ${esc(when(x.at))}${x.done ? `・${esc(x.doneBy || '')} ${esc(when(x.doneAt))} 完成` : ''}<span style="flex:1"></span>
        <a href="#" data-medit="${x.id}" style="color:#555">修改</a><a href="#" data-mdel="${x.id}" style="color:#B71C1C">刪除</a></div></div>`; };
  const mine = open.filter(x => x.to && x.to === me).length;
  return `<div class="${mobile ? '' : 'panel'}" id="memoBoard" style="${mobile ? 'margin-bottom:14px' : ''}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap"><b style="font-size:${mobile ? 17 : 15}px">留言板・交辦事項</b><span style="font-size:12.5px;color:var(--muted)">${open.length} 件待辦${mine ? `・交辦給我 ${mine} 件` : ''}</span><span style="flex:1"></span>
      ${done.length ? `<span style="font-size:12.5px;color:var(--muted)">今天完成 ${done.length} 件（明天自動消失）</span>` : ''}<button class="${mobile ? 'chip' : 'btn sm pri'}" data-madd>＋ 新增</button></div>
    ${open.length || done.length ? `<div style="display:grid;gap:8px;grid-template-columns:${mobile ? '1fr' : 'repeat(auto-fill,minmax(260px,1fr))'}">${open.map(card).join('')}${done.map(card).join('')}</div>` : `<div style="color:var(--muted);font-size:13px;padding:4px 0">目前沒有留言。按「＋ 新增」寫交辦事項，緊急的會用粉紅色排在最前面。</div>`}
  </div>`;
}
/** 綁定留言板按鈕；redraw＝重畫外層 */
export function bindMemoBoard(root, ui, redraw, mobile) {
  const box = root.querySelector('#memoBoard'); if (!box) return;
  box.querySelector('[data-madd]')?.addEventListener('click', ev => { ev.preventDefault(); memoDialog(null, redraw, mobile); });
  box.querySelector('[data-mshow]')?.addEventListener('click', ev => { ev.preventDefault(); ui.showDone = !ui.showDone; redraw(); });
  box.querySelectorAll('[data-mdone]').forEach(cb => cb.onchange = async () => { const on = cb.checked; await put(L => L.map(x => x.id === cb.dataset.mdone ? (on ? { ...x, done: true, doneBy: store.user?.name || '', doneAt: Date.now() } : (({ done, doneBy, doneAt, ...r }) => r)(x)) : x)); toast(on ? '已標成完成' : '已改回待辦'); });
  box.querySelectorAll('[data-medit]').forEach(a => a.onclick = ev => { ev.preventDefault(); const x = all().find(y => y.id === a.dataset.medit); if (x) memoDialog(x, redraw, mobile); });
  box.querySelectorAll('[data-mdel]').forEach(a => a.onclick = async ev => { ev.preventDefault(); const x = all().find(y => y.id === a.dataset.mdel); if (!x) return; if (!window.confirm(`刪除這則留言？\n${x.text.slice(0, 40)}`)) return; await put(L => L.filter(y => y.id !== x.id)); toast('已刪除'); });
}
/** 新增／修改留言 */
// 手機版沒有對話框樣式，改用全螢幕 sheet
function box(title, body, footer, onOpen, mobile) {
  if (!mobile) return modal({ title, width: 520, closeOnBg: false, body, footer, onOpen });
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-close>取消</button><b>${esc(title)}</b><span style="width:40px"></span></div>${body}<div style="display:flex;gap:8px;margin-top:12px">${footer}</div>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); };
  el.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  onOpen(el, close);
}
export function memoDialog(x, done, mobile) {
  const v = x ? { ...x } : { lv: 'n', text: '', to: '', due: '' };
  const users = (store.users || []).filter(u => !u.disabled).map(u => u.name).filter(Boolean);
  box(x ? '修改留言' : '新增留言・交辦事項', `<div class="f"><label>急迫程度</label><div style="display:flex;gap:8px;flex-wrap:wrap">${Object.entries(LV).map(([k, c]) => `<button type="button" class="btn" data-lv="${k}" style="background:${c.bg};border:2px solid ${v.lv === k ? c.tag : c.bd};color:#2B2B2B;font-weight:${v.lv === k ? 700 : 500}">${c.name}</button>`).join('')}</div></div>
      <div class="f"><label for="mm-text">內容</label><textarea id="mm-text" rows="4" style="font:inherit" placeholder="例如：鑫太的 5/32 鐵板螺絲明天要出 1000 支，記得先電鍍">${esc(v.text)}</textarea></div>
      <div class="grid" style="display:grid;gap:10px;grid-template-columns:1fr 1fr"><div class="f"><label for="mm-to">交辦給（選填）</label><input id="mm-to" list="mm-users" value="${esc(v.to || '')}" placeholder="誰負責"><datalist id="mm-users">${users.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div class="f"><label for="mm-due">期限（選填）</label><input id="mm-due" type="date" value="${esc(v.due || '')}"></div></div>
      <div class="err" id="mm-err"></div>`,
    mobile ? '<button class="btn" id="mm-save">儲存</button>' : '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="mm-save">儲存</button>',
    (m, close) => {
      m.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { v.lv = b.dataset.lv; m.querySelectorAll('[data-lv]').forEach(y => { const c = LV[y.dataset.lv]; const on = y === b; y.style.borderColor = on ? c.tag : c.bd; y.style.fontWeight = on ? 700 : 500; }); });
      m.querySelector('#mm-save').onclick = async () => {
        const text = m.querySelector('#mm-text').value.trim(); if (!text) { m.querySelector('#mm-err').textContent = '請寫內容'; return; }
        const o = { ...v, text, to: m.querySelector('#mm-to').value.trim(), due: m.querySelector('#mm-due').value };
        if (x) await put(L => L.map(y => y.id === x.id ? { ...y, ...o } : y));
        else await put(L => [{ ...o, id: uid('mm'), by: store.user?.name || '', at: Date.now() }, ...L]);
        store.log(x ? '修改' : '新增', `留言板｜${LV[o.lv].name}｜${text.slice(0, 30)}`);
        close(); toast('已儲存'); done && done();
      };
    }, mobile);
}
