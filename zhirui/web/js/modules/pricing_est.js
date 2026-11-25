// 螺絲查價 › 特殊品估價：輸入牙徑、長度、材質、數量 → 估久允／澤發大概報價、線材成本、相似舊報價、久允牌價
import { $, esc, ls, debounce } from '../core/util.js';
import { store } from '../core/store.js';
import { netPrice, itemFactor, fmtDisc } from '../core/pricing.js';
import { estimate, similarQuotes, parseDia, parseLen, EST_MATS, WIRE } from '../core/estimate.js';

const DEF = { d: 'M4', L: '12', mat: '鐵', qty: '20000', plating: '1', head: '', wt: '' };
const f2 = v => v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
const pz = v => v >= 1 ? v.toFixed(2) : v.toFixed(3);

export function drawEstimate(box) {
  const s = { ...DEF, ...ls.get('zr.est', {}) };
  box.innerHTML = `<div class="panel" style="display:grid;gap:10px">
      <p class="small muted" style="margin:0">依 111～115 年久允、澤發的報價單反推（每家廠商報價自有一套，分開算）。估出來約 ±20%，只當參考，正式請詢價。</p>
      <div class="grid">
        <div class="f"><label for="es-d">牙徑（M4、4.8、1/4、#8、2分）</label><input id="es-d" value="${esc(s.d)}" autocomplete="off"></div>
        <div class="f"><label for="es-L">長度（mm，或 1-1/2"）</label><input id="es-L" value="${esc(s.L)}" autocomplete="off"></div>
        <div class="f"><label for="es-mat">材質</label><select id="es-mat">${EST_MATS.map(m => `<option ${m === s.mat ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="f"><label for="es-qty">數量（支）</label><input id="es-qty" class="num" value="${esc(s.qty)}" inputmode="numeric"></div>
        <div class="f"><label for="es-pl">表面處理</label><select id="es-pl"><option value="1" ${s.plating !== '0' ? 'selected' : ''}>要電鍍（鍍鋅、三價、染黑…）</option><option value="0" ${s.plating === '0' ? 'selected' : ''}>白皮（不電鍍）</option></select></div>
        <div class="f"><label for="es-head">頭型（找久允牌價用）</label><select id="es-head">${[['', '不指定'], ['丸頭', '丸頭／圓頭'], ['皿頭', '皿頭'], ['大扁頭', '大扁頭']].map(([v, l]) => `<option value="${v}" ${v === s.head ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="f"><label for="es-wt">單重 g（知道的話填，空白＝自動估）</label><input id="es-wt" class="num" value="${esc(s.wt)}" autocomplete="off"></div>
      </div>
    </div>
    <div class="panel" id="es-out"></div>`;
  const run = () => {
    const v = { d: $('#es-d', box).value, L: $('#es-L', box).value, mat: $('#es-mat', box).value, qty: $('#es-qty', box).value, plating: $('#es-pl', box).value, head: $('#es-head', box).value, wt: $('#es-wt', box).value };
    ls.set('zr.est', v); render($('#es-out', box), v);
  };
  box.querySelectorAll('input,select').forEach(x => x.addEventListener(x.tagName === 'SELECT' ? 'change' : 'input', debounce(run, 150)));
  run();
}

function render(out, v) {
  const d = parseDia(v.d), L = parseLen(v.L), qty = parseFloat(String(v.qty).replace(/,/g, '')) || 0;
  if (!d || !L) { out.innerHTML = `<p class="muted">${!d ? '牙徑看不懂，請輸入例如 M4、4.8、1/4、#8' : '長度看不懂，請輸入 mm 數字，或 1-1/2"'}</p>`; return; }
  const o = { d, L, mat: v.mat, qty, plating: v.plating !== '0', wt: parseFloat(v.wt) || 0 };
  const r = estimate(o);
  const ref = store.setting('quoteRef').rows;
  const sim = similarQuotes(ref, o, r.w, 12);
  const list = jyList(d, L, v.head);
  out.innerHTML = `<h2 style="margin-top:0">估價結果</h2>
    <p>我理解成：<b>牙徑 ${f2(d)} mm × 長 ${f2(L)} mm、${esc(v.mat)}、${qty ? qty.toLocaleString('zh-TW') + ' 支' : '數量未填'}、${o.plating ? '要電鍍' : '白皮'}</b>。
      單重約 <b>${f2(r.w)} g</b>${o.wt ? '（照填的）' : '（估算）'}，線材成本約 <b>${pz(r.wire)}</b> 元/支（${WIRE[v.mat]} 元/kg，含一成料損）。${r.qf !== 1 ? `數量係數 ×${r.qf}。` : ''}</p>
    <div class="tw"><table><thead><tr><th>廠商</th><th class="n">估計單價（元/支）</th><th class="n">範圍 ±20%</th><th class="n">每千支</th><th class="n">約 元/kg</th><th>依據</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td><b>${x.vendor}</b></td><td class="n"><b>${pz(x.price)}</b></td><td class="n">${pz(x.lo)}～${pz(x.hi)}</td><td class="n">${Math.round(x.price * 1000).toLocaleString('zh-TW')}</td><td class="n">${x.ppk}</td><td class="small muted">${esc(x.src)}</td></tr>`).join('')}
    </tbody></table></div>
    <details style="margin-top:8px"><summary>模具費、樣品費、其他規則</summary><ul class="small">
      <li>久允：模具費另計，小改（段差、梅花、內六角、改頭徑）2,000～6,000；新開整套（新頭型、法蘭花齒、等高、左牙）15,000～30,000；牙模約 12,000。頭徑頭厚照標準規範可免模具。樣品費一批 1,200～2,500。</li>
      <li>澤發：模具費／牙板費 2,000～8,000（多半 2,000～3,000）。白鐵六角木牙代工＝工資 0.40 元/支＋線材（打頭重量 × 108～115 元/kg）＋洗油（成品重量 × 14～15 元/kg）。</li>
      <li>數量：5,000 支比 1 萬支貴 10～30%，2 萬支便宜約 5%，10 萬支再便宜約 15%。白皮比電鍍每公斤少約 20 元；久允 115/10/1 起三價鋅、五彩 +1 元/kg、三價黑鋅 +3 元/kg。</li>
      <li>不含耐落；回頭單通常「照原價」，先查前批。久允手寫價常可議低 0.05～0.1 元。</li>
    </ul></details>
    ${list.length ? `<h3>久允牌價（標準品，鐵）</h3><div class="tw"><table><thead><tr><th>品名</th><th>規格</th><th class="n">牌價</th><th class="n">折數</th><th class="n">淨價</th></tr></thead><tbody>${list.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.spec)}</td><td class="n">${pz(+p.price)}</td><td class="n">${esc(fmtDisc(itemFactor(p).f))}</td><td class="n"><b>${pz(netPrice(p))}</b></td></tr>`).join('')}</tbody></table></div><p class="small muted">標準品照牌價×折數；特殊品同尺寸的久允報價，鐵大約是淨價的 1.7 倍、白鐵 2.7 倍。</p>` : ''}
    <h3>相似的舊報價（同材質、重量相近）</h3>
    ${!Array.isArray(ref) ? '<p class="muted">歷史報價資料還沒匯入（settings › quoteRef）。</p>' : sim.length ? `<div class="tw"><table><thead><tr><th>廠商</th><th>日期</th><th>品名</th><th>規格</th><th>處理</th><th class="n">數量</th><th class="n">單價</th><th class="n">單重 g</th><th>備註</th></tr></thead><tbody>${sim.map(q => `<tr><td class="nowrap">${esc(q.v)}</td><td class="nowrap">${esc(q.dt || '')}</td><td>${esc(q.n || '')}</td><td>${esc(q.s || '')}</td><td>${esc(q.f || '')}</td><td class="n">${q.q ? (+q.q).toLocaleString('zh-TW') : ''}</td><td class="n"><b>${pz(+q.p)}</b></td><td class="n">${f2(+q.w)}</td><td class="small muted">${esc(q.mold ? '模具 ' + q.mold : '')}${q.file ? ` <span title="${esc(q.file)}">📄</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">沒有重量相近的舊報價。</p>'}`;
}

function jyList(d, L, head) {
  return store.list('pricing').filter(p => p.sup === '久允' && /^jy-(mm|mi|tb)$/.test(p.cat) && (!head || String(p.head || '').startsWith(head.slice(0, 2)))
    && Math.abs(parseDia(p.dia) - d) < 0.2 && Math.abs(parseLen(p.length) - L) < 0.8).slice(0, 8);
}
