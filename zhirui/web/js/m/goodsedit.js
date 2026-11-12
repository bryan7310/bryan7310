// 手機版：新增／修改／複製商品（欄位跟電腦版「基本資料 › 商品」一樣；配方、圖面、特殊計價等進階設定請用電腦版，這裡改資料不會動到它們）
import { esc, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { suggestCode } from '../core/codegen.js';

const NUM = new Set(['salePrice', 'purPrice', 'cost', 'safety', 'wt', 'arate']);
const FIELDS = ['code', 'name', 'spec', 'spec2', 'custName', 'vcode', 'cat', 'unit', 'salePrice', 'purPrice', 'cost', 'safety', 'wt', 'aunit', 'arate', 'note'];
const CATS = ['鐵', '不鏽鋼', '合金鋼', '代工', '彈簧鋼', '中碳鋼', '銅', '鋁'];
const UNITS = ['PCS', 'KG', '包', '組', 'H', '批', '箱'];
const toast = msg => { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.hidden = false; setTimeout(() => t.hidden = true, 2500); };
const numVal = v => { const s = String(v ?? '').replace(/,/g, '').trim(); return s === '' ? 0 : +s || 0; };
const showNum = v => +v ? String(v) : '';

/**
 * 打開商品編輯畫面（全螢幕）。
 * mode：'new' 新增（tpl 可帶預設，例如搜尋字當品名）、'edit' 修改 g、'copy' 用 g 的資料新增一筆。
 * onSaved(id) 存好後呼叫。
 */
export function editGoods(mode, g, onSaved, tpl = {}) {
  const d = mode === 'edit' ? g : null;
  const v = mode === 'edit' ? g : mode === 'copy' ? g : tpl;
  const fld = (n, label, extra = '') => `<div class="f"><label for="ge-${n}">${label}</label><input id="ge-${n}" data-n="${n}" value="${esc(NUM.has(n) ? showNum(v[n]) : v[n] ?? '')}" ${NUM.has(n) ? 'inputmode="decimal"' : ''} ${extra}></div>`;
  const chipRow = (n, list) => `<div class="chips" style="margin:-6px 0 12px" data-for="${n}">${list.map(x => `<button type="button" class="chip ${String(v[n] || '') === x ? 'on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="link" data-x>取消</button><b>${mode === 'edit' ? '修改商品' : mode === 'copy' ? '複製商品' : '新增商品'}</b><button class="link" data-ok><b>儲存</b></button></div>
    ${mode === 'copy' ? `<div class="note" style="text-align:left">從「${esc(g.code || g.name)}」複製，請把料號改成新的（料號相同無法建立）。</div>` : ''}
    ${fld('code', '料號', 'autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false" class="mono"')}${mode === 'edit' ? '' : '<div class="note" id="gecg" style="text-align:left;margin:-6px 0 12px"></div>'}
    ${fld('name', '品名（必填）', 'autocomplete="off"')}
    ${fld('cat', '類別（材質）', 'autocomplete="off"')}${chipRow('cat', CATS)}
    ${fld('unit', '單位', 'autocapitalize="characters" autocomplete="off"')}${chipRow('unit', UNITS)}
    <div class="f2">${fld('salePrice', '售價')}${fld('purPrice', '進價')}</div>
    <div class="f2">${fld('cost', '手動成本')}${fld('safety', '安全庫存')}</div>
    ${fld('wt', '單重 g／支（空白＝自動估算）')}
    <div class="f2">${fld('spec', '客料號', 'autocapitalize="characters" autocomplete="off"')}${fld('vcode', '廠商料號', 'autocapitalize="characters" autocomplete="off"')}</div>
    <details style="margin-bottom:12px"><summary class="muted" style="padding:6px 0 12px">更多欄位（第二客料號、客戶品名、大單位）</summary>
      <div class="f2">${fld('spec2', '第二客料號', 'autocapitalize="characters" autocomplete="off"')}${fld('custName', '客戶品名', 'autocomplete="off"')}</div>
      <div class="f2">${fld('aunit', '大單位（例如 箱）', 'autocomplete="off"')}${fld('arate', '大單位＝幾個基本單位')}</div></details>
    ${fld('note', '備註', 'autocomplete="off"')}
    <div class="note" style="text-align:left">手動成本：進貨單、查價表都找不到成本時才用。配方（螺絲包）、圖面、特殊計價請在電腦版設定。</div>
    <div class="err" id="gee"></div>
    <p><button class="btn" data-ok>儲存</button></p>`;
  document.body.append(el); document.body.classList.add('noscroll');
  const close = () => { el.remove(); document.body.classList.remove('noscroll'); };
  const $ = q => el.querySelector(q);
  const err = m => { $('#gee').textContent = m; $('#gee').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  el.querySelector('[data-x]').onclick = close;
  // 類別／單位快選：點了填進欄位；欄位手打時同步亮起對應的鈕
  el.querySelectorAll('[data-for]').forEach(row => {
    const inp = $('#ge-' + row.dataset.for);
    const sync = () => row.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.v === inp.value.trim()));
    row.addEventListener('click', ev => { const b = ev.target.closest('[data-v]'); if (!b) return; inp.value = b.dataset.v; inp.dispatchEvent(new Event('input')); });
    inp.addEventListener('input', sync);
  });
  // 新增／複製：依品名、類別建議料號（料號空白或是自動帶的才自動填；自己打過的就只提示，可按「套用」）
  const cg = $('#gecg');
  if (cg) {
    const ci = $('#ge-code'), ni = $('#ge-name'), ki = $('#ge-cat');
    let auto = ci.value.trim() === '' ? '' : null;
    const draw = () => {
      const nm = ni.value.trim(); if (!nm) { cg.textContent = '打品名後會自動建議料號（例如「六角全牙螺絲M8*30 鍍鋅鐵」）'; return; }
      const s = suggestCode(nm, ki.value);
      if (!s.code) { cg.innerHTML = `料號建議：還認不出 <b>${esc(s.missing.join('、'))}</b>，品名寫完整一點（品名＋尺寸＋表面處理＋材質）`; return; }
      if (auto !== null && ci.value.trim() === auto) { ci.value = s.code; auto = s.code; }
      cg.innerHTML = `建議料號 <b class="mono">${esc(s.code)}</b>${ci.value.trim() !== s.code ? ' <button type="button" class="chip" data-cg>套用</button>' : ''}<br><small>${s.parts.map(p => `${esc(p.k)} ${esc(p.v)}${p.why ? '（' + esc(p.why) + '）' : ''}`).join('・')}</small>${s.same ? `<br><span class="bad">已經有 ${esc(s.same.code)}「${esc(s.same.name)}」，確定不是同一個商品？</span>` : ''}${s.typeNote ? `<br><span class="bad">${esc(s.typeNote)}</span>` : ''}`;
      cg.querySelector('[data-cg]')?.addEventListener('click', () => { ci.value = s.code; auto = s.code; draw(); });
    };
    ci.addEventListener('input', () => { const x = ci.value.trim(); auto = x === '' ? '' : x === auto ? auto : null; draw(); });
    let tm = 0; const later = () => { clearTimeout(tm); tm = setTimeout(draw, 200); };
    ni.addEventListener('input', later); ki.addEventListener('input', later); draw();
  }
  const save = async btn => {
    const out = mode === 'edit' ? { ...d } : mode === 'copy' && g.sp ? { sp: g.sp } : {};
    delete out.id;
    for (const n of FIELDS) { const raw = $('#ge-' + n).value; out[n] = NUM.has(n) ? numVal(raw) : String(raw).trim(); }
    for (const n of NUM) if (String($('#ge-' + n).value).trim() !== '' && isNaN(+String($('#ge-' + n).value).replace(/,/g, ''))) return err('「' + $(`label[for="ge-${n}"]`).textContent + '」要填數字');
    if (!out.name) { $('#ge-name').focus(); return err('請填品名'); }
    if (out.code && store.list('goods').some(x => x.code === out.code && x.id !== d?.id)) { const c = $('#ge-code'); c.focus(); c.select(); return err(`料號 ${out.code} 已經有了，請改成不一樣的料號`); }
    if (mode === 'copy') out.note = out.note || `由 ${g.code || g.name} 複製`;
    const id = d?.id || uid('g');
    el.querySelectorAll('[data-ok]').forEach(b => b.disabled = true);
    try { await store.save('goods', id, out); }
    catch (e) { el.querySelectorAll('[data-ok]').forEach(b => b.disabled = false); return err('儲存失敗：' + e.message); }
    store.log(d ? '修改' : '新增', `商品 ${out.code ? out.code + ' ' : ''}${out.name}（手機）`);
    close(); toast(d ? '已儲存商品' : `已新增商品 ${out.code || out.name}`); onSaved && onSaved(id);
  };
  el.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => save(b));
  if (mode === 'copy') setTimeout(() => { const c = $('#ge-code'); c.focus(); c.select(); }, 60);   // 複製：游標停在料號，直接改
}
