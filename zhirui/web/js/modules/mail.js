// 郵寄掛號：寄對帳單／發票給客戶的地址標籤（5×4 cm）與大宗掛號函件執據
import { $, esc, today, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, confirm, combo, printHTML } from '../core/ui.js';
import { calc, customers } from '../core/calc.js';
import { printName } from '../core/names.js';

export default {
  id: 'mail', name: '郵寄掛號', group: '財務', icon: 'mail',
  render(el) { this.el = el; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('mail') || ch.has('settings') || ch.has('contacts'))) draw(this.el); },
  badge() { return { cnt: store.list('mail').length }; },
};
// ---------- 郵遞區號 ----------
const ZIP_TBL = { '台北市': { 中正: 100, 大同: 103, 中山: 104, 松山: 105, 大安: 106, 萬華: 108, 信義: 110, 士林: 111, 北投: 112, 內湖: 114, 南港: 115, 文山: 116 },
  '新北市': { 萬里: 207, 金山: 208, 板橋: 220, 汐止: 221, 深坑: 222, 石碇: 223, 瑞芳: 224, 平溪: 226, 雙溪: 227, 貢寮: 228, 新店: 231, 坪林: 232, 烏來: 233, 永和: 234, 中和: 235, 土城: 236, 三峽: 237, 樹林: 238, 鶯歌: 239, 三重: 241, 新莊: 242, 泰山: 243, 林口: 244, 蘆洲: 247, 五股: 248, 八里: 249, 淡水: 251, 三芝: 252, 石門: 253 },
  '桃園市': { 中壢: 320, 平鎮: 324, 龍潭: 325, 楊梅: 326, 新屋: 327, 觀音: 328, 桃園: 330, 龜山: 333, 八德: 334, 大溪: 335, 復興: 336, 大園: 337, 蘆竹: 338 },
  '新竹市': { 東: 300, 北: 300, 香山: 300 }, '新竹縣': { 竹北: 302, 湖口: 303, 新豐: 304, 新埔: 305, 關西: 306, 芎林: 307, 寶山: 308, 竹東: 310, 五峰: 311, 橫山: 312, 尖石: 313, 北埔: 314, 峨眉: 315 },
  '苗栗縣': { 竹南: 350, 頭份: 351, 三灣: 352, 南庄: 353, 獅潭: 354, 後龍: 356, 通霄: 357, 苑裡: 358, 苗栗: 360, 造橋: 361, 頭屋: 362, 公館: 363, 大湖: 364, 泰安: 365, 銅鑼: 366, 三義: 367, 西湖: 368, 卓蘭: 369 },
  '台中市': { 中: 400, 東: 401, 南: 402, 西: 403, 北: 404, 北屯: 406, 西屯: 407, 南屯: 408, 太平: 411, 大里: 412, 霧峰: 413, 烏日: 414, 豐原: 420, 后里: 421, 石岡: 422, 東勢: 423, 和平: 424, 新社: 426, 潭子: 427, 大雅: 428, 神岡: 429, 大肚: 432, 沙鹿: 433, 龍井: 434, 梧棲: 435, 清水: 436, 大甲: 437, 外埔: 438, 大安: 439 },
  '彰化縣': { 彰化: 500, 芬園: 502, 花壇: 503, 秀水: 504, 鹿港: 505, 福興: 506, 線西: 507, 和美: 508, 伸港: 509, 員林: 510, 社頭: 511, 永靖: 512, 埔心: 513, 溪湖: 514, 大村: 515, 埔鹽: 516, 田中: 520, 北斗: 521, 田尾: 522, 埤頭: 523, 溪州: 524, 溪洲: 524, 竹塘: 525, 二林: 526, 大城: 527, 芳苑: 528, 二水: 530 },
  '南投縣': { 南投: 540, 中寮: 541, 草屯: 542, 國姓: 544, 埔里: 545, 仁愛: 546, 名間: 551, 集集: 552, 水里: 553, 魚池: 555, 信義: 556, 竹山: 557, 鹿谷: 558 },
  '雲林縣': { 斗南: 630, 大埤: 631, 虎尾: 632, 土庫: 633, 褒忠: 634, 東勢: 635, 台西: 636, 崙背: 637, 麥寮: 638, 斗六: 640, 林內: 643, 古坑: 646, 莿桐: 647, 西螺: 648, 二崙: 649, 北港: 651, 水林: 652, 口湖: 653, 四湖: 654, 元長: 655 },
  '嘉義市': { 東: 600, 西: 600 }, '嘉義縣': { 番路: 602, 梅山: 603, 竹崎: 604, 阿里山: 605, 中埔: 606, 大埔: 607, 水上: 608, 鹿草: 611, 太保: 612, 朴子: 613, 東石: 614, 六腳: 615, 新港: 616, 民雄: 621, 大林: 622, 溪口: 623, 義竹: 624, 布袋: 625 },
  '台南市': { 中西: 700, 東: 701, 南: 702, 北: 704, 安平: 708, 安南: 709, 永康: 710, 歸仁: 711, 新化: 712, 左鎮: 713, 玉井: 714, 楠西: 715, 南化: 716, 仁德: 717, 關廟: 718, 龍崎: 719, 官田: 720, 麻豆: 721, 佳里: 722, 西港: 723, 七股: 724, 將軍: 725, 學甲: 726, 北門: 727, 新營: 730, 後壁: 731, 白河: 732, 東山: 733, 六甲: 734, 下營: 735, 柳營: 736, 鹽水: 737, 善化: 741, 大內: 742, 山上: 743, 新市: 744, 安定: 745 },
  '高雄市': { 新興: 800, 前金: 801, 苓雅: 802, 鹽埕: 803, 鼓山: 804, 旗津: 805, 前鎮: 806, 三民: 807, 楠梓: 811, 小港: 812, 左營: 813, 仁武: 814, 大社: 815, 岡山: 820, 路竹: 821, 阿蓮: 822, 田寮: 823, 燕巢: 824, 橋頭: 825, 梓官: 826, 彌陀: 827, 永安: 828, 湖內: 829, 鳳山: 830, 大寮: 831, 林園: 832, 鳥松: 833, 大樹: 840, 旗山: 842, 美濃: 843, 六龜: 844, 內門: 845, 杉林: 846, 甲仙: 847, 茄萣: 852 },
  '屏東縣': { 屏東: 900 } };
const CITY_ALIAS = { '台北縣': '新北市', '桃園縣': '桃園市', '台中縣': '台中市', '台南縣': '台南市', '高雄縣': '高雄市' };
export function addrParts(a) { a = String(a || '').trim().replace(/臺/g, '台').replace(/^[\s　]+/, ''); const m = a.match(/^(\d{3,6})[\s　]*(.*)$/); return m ? { zip: m[1], addr: m[2].trim() } : { zip: '', addr: a }; }
export function zipLookup(addr) {
  const a = addrParts(addr).addr.replace(/\s/g, ''); const re = /(台北|新北|桃園|新竹|苗栗|台中|彰化|南投|雲林|嘉義|台南|高雄|屏東)([縣市])/g; let mm, m = null;
  while ((mm = re.exec(a))) { const city0 = mm[0]; const c1 = CITY_ALIAS[city0] || city0; if (ZIP_TBL[c1]) { m = [null, city0, a.slice(mm.index + city0.length)]; break; } }
  if (!m) return ''; const city = CITY_ALIAS[m[1]] || m[1]; const t = ZIP_TBL[city]; if (!t) return '';
  const keys = Object.keys(t).sort((x, y) => y.length - x.length);
  for (const k of keys) { if (m[2].startsWith(k)) { const nx = m[2].charAt(k.length); if (/[區鄉鎮市]/.test(nx)) return String(t[k]); } }
  return '';
}
export const contactZip = c => { const p = addrParts(c?.addr); const lk = zipLookup(c?.addr); const st = String(c?.zip || '').replace(/\D/g, '') || p.zip; if (lk && !(st && st.startsWith(lk))) return lk; return st || lk; };
export const shortName = c => String(c?.short || c?.name || '').replace(/[-－]\s*\d+$/, '').replace(/(股份有限公司|有限公司|企業社|工業社)$/, '').trim();
function addrSplit(a) { a = String(a || '').trim(); const m = a.match(/^(.{2,6}?[縣市].{1,4}?[區鄉鎮市])(.+)$/); if (m && m[2].length <= 20) return [m[1], m[2]]; if (a.length <= 13) return [a, '']; const r = a.match(/^(.*?[路街道段巷])(.+)$/); if (r && r[1].length >= 6 && r[1].length <= 16) return [r[1], r[2]]; const h = Math.ceil(a.length / 2); return [a.slice(0, h), a.slice(h)]; }

/** 從客戶 id 清單加入郵寄明細（已在清單裡的不重複加）。回傳 {add, miss:[名稱]} */
export async function mailImport(cids) {
  const C = calc(); const cur = store.list('mail'); const ops = []; const miss = []; let add = 0;
  for (const id of cids) { const c = C.ct[id]; if (!c || cur.some(x => x.cid === id)) continue; const p = addrParts(c.addr); if (!p.addr) miss.push(shortName(c)); ops.push({ col: 'mail', id: uid('M'), data: { cid: id, name: printName(c.name), zip: contactZip(c), addr: p.addr, no: '', to: '公司 會計部收', at: Date.now() } }); add++; }
  if (ops.length) await store.batch(ops);
  return { add, miss };
}
const sorted = () => store.list('mail').sort((a, b) => String(a.zip || '999999').localeCompare(String(b.zip || '999999')) || String(a.name).localeCompare(String(b.name), 'zh-Hant'));
const sel = new Set();
function draw(el) {
  const list = sorted(); const co = store.setting('company'); const s = store.setting('mail'); const type = s.type || '限時掛號'; const miss = list.filter(x => !x.addr).length;
  el.innerHTML = `<div class="head"><h1>郵寄掛號</h1><span class="sub">寄件人：${esc(co.name || '')}　${esc(co.addr || '')}</span><span class="sp"></span><button class="btn" id="mlAdd">＋ 加客戶</button><button class="btn" id="mlExe" ${sel.size ? '' : 'disabled'}>列印大宗掛號執據${sel.size ? `（${sel.size}）` : ''}</button><button class="btn pri" id="mlLabel" ${list.length ? '' : 'disabled'}>列印地址標籤（${list.length}）</button></div>
    <div class="panel" style="display:grid;gap:10px">
      <div class="tools"><span class="muted">郵件種類</span>${['限時掛號', '掛號', '快捷郵件'].map(t => `<label class="check"><input type="radio" name="mltype" value="${t}" ${type === t ? 'checked' : ''}> ${t}</label>`).join('')}<span class="sp"></span>${list.length ? '<button class="btn sm" id="mlClear">清空</button>' : ''}</div>
      ${miss ? `<div class="banner">有 ${miss} 筆沒有地址，請在下表補上，或到「基本資料 → 客戶」填地址後重新加入。</div>` : ''}
      <p class="muted small" style="margin:0">從「應收帳款」勾選客戶按「導入郵寄掛號」，或按「加客戶」。勾選列右邊的方塊選要印在執據上的件數；地址標籤印全部。</p>
      <div class="tw"><table><thead><tr><th><input type="checkbox" id="mlAll" ${list.length && list.every(x => sel.has(x.id)) ? 'checked' : ''}></th><th class="n">順序</th><th>掛號號碼</th><th>姓名（公司全名）</th><th>郵遞區號</th><th>寄達地址</th><th>標籤第四行</th><th></th></tr></thead><tbody>
      ${list.map((x, i) => `<tr class="${x.addr ? '' : 'muted'}"><td><input type="checkbox" data-sel="${x.id}" ${sel.has(x.id) ? 'checked' : ''}></td><td class="n">${i + 1}</td>${[['no', 110], ['name', 120], ['zip', 70], ['addr', 300], ['to', 130]].map(([k, w]) => `<td><input data-f="${k}" data-id="${x.id}" value="${esc(x[k] ?? '')}" style="width:${w}px;border:1px solid var(--line);border-radius:6px;padding:4px 6px" ${k === 'addr' && !x.addr ? 'placeholder="找不到地址，請填"' : ''}></td>`).join('')}<td><button class="btn xs" data-del="${x.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty"><b>還沒有郵寄明細</b>到「應收帳款」勾選客戶後按「導入郵寄掛號」。</div></td></tr>'}</tbody></table></div></div>`;
  el.querySelectorAll('[name=mltype]').forEach(r => r.onchange = () => store.saveSetting('mail', { ...s, type: r.value }));
  el.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('change', async () => { const x = store.get('mail', inp.dataset.id); if (!x) return; const d = { ...x, [inp.dataset.f]: inp.value }; delete d.id; await store.save('mail', x.id, d); }));
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => store.remove('mail', b.dataset.del));
  el.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = () => { cb.checked ? sel.add(cb.dataset.sel) : sel.delete(cb.dataset.sel); draw(el); });
  $('#mlAll', el).onchange = ev => { list.forEach(x => ev.target.checked ? sel.add(x.id) : sel.delete(x.id)); draw(el); };
  $('#mlClear', el)?.addEventListener('click', async () => { if (await confirm('清空郵寄明細？', { danger: true, ok: '清空' })) { await store.batch(list.map(x => ({ col: 'mail', id: x.id, delete: true }))); sel.clear(); } });
  $('#mlAdd', el).onclick = () => modal({ title: '加客戶到郵寄明細', width: 480, body: '<div class="f"><label for="ml-c">客戶</label><div class="combo"><input id="ml-c" placeholder="搜尋客戶" autofocus></div></div>', footer: '<span class="sp"></span><button class="btn" data-close>關閉</button>', onOpen(m) { combo(m.querySelector('#ml-c'), { items: () => customers().map(c => ({ id: c.id, label: c.short || c.name, sub: c.short ? c.name : '', text: [c.code, c.name, c.short, ...(c.aliases || [])].join(' ') })), onPick: async it => { const r = await mailImport([it.id]); toast(r.add ? `已加入${r.miss.length ? '（沒有地址）' : ''}` : '已經在清單裡'); m.querySelector('#ml-c').value = ''; } }); } });
  $('#mlLabel', el).onclick = () => printLabels(list);
  $('#mlExe', el).onclick = () => printReceipt(list.filter(x => sel.has(x.id)), type);
}
// 列印用名稱：清單裡還是以前存的簡稱（或就是簡稱）時換成全名；自己改過的名字照印
const outName = x => { const c = x.cid && store.get('contacts', x.cid); if (c && (!x.name || x.name === shortName(c) || x.name === c.short)) return printName(c.name); return x.name || ''; };
function printLabels(list) {
  const html = list.filter(x => x.addr || x.name).map(x => { const [l2, l3] = addrSplit(x.addr); return `<div class="lb"><div class="z">${esc(x.zip)}</div><div class="a">${esc(l2)}</div><div class="a">${esc(l3)}</div><div class="n">${esc(outName(x))}${esc(x.to || '公司 會計部收')}</div></div>`; }).join('');
  printHTML('地址標籤', `@page{size:50mm 40mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif;color:#000}
.lb{width:50mm;height:40mm;padding:3mm 3mm 2.5mm;display:grid;grid-template-rows:auto 1fr 1fr auto;align-content:space-between;page-break-after:always;overflow:hidden}.lb:last-child,.lb:not(:has(~ .lb)){page-break-after:auto}@media screen{.lb{border:1px dashed #999;margin:4mm;display:inline-grid;vertical-align:top}}
.lb>div{white-space:nowrap;overflow:hidden;transform-origin:left center}.z{font-size:13pt;font-weight:bold;letter-spacing:.15em}.a{font-size:11.5pt;font-weight:bold;line-height:1.35;align-self:center}.n{font-size:11pt;font-weight:bold;border-top:.4pt solid #000;padding-top:1mm}`,
    html + `<script>window.addEventListener('load',()=>{document.querySelectorAll('.lb>div').forEach(r=>{const w=r.clientWidth,s=r.scrollWidth;if(s>w+1){r.style.overflow='visible';r.style.transform='scaleX('+(w/s).toFixed(3)+')';}});});<\/script>`,
    { tip: `按 Ctrl+P，紙張選 5 × 4 cm 標籤（寬 50 mm、高 40 mm），邊界「無」，縮放 100%。共 ${list.length} 張。` });
  store.log('列印', `地址標籤 ${list.length} 張`);
}
function printReceipt(list, type) {
  const co = store.setting('company'); const d = new Date(); const rocD = `中華民國 ${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const per = 30, pages = Math.max(1, Math.ceil(list.length / per)); let html = '';
  const ty = t => type === t ? `<b class="sel">${t}</b>` : `<span class="off">${t}</span>`;
  for (let p = 0; p < pages; p++) {
    const rows = list.slice(p * per, (p + 1) * per);
    html += `<div class="page"><div class="top"><div class="lft"><div class="boxes">□□□□□□　□□</div><div>收寄局碼　郵件種類碼</div><div>（由收寄局填寫）</div></div><div class="mid"><div class="tt">中　華　民　國　郵　政</div><div>${ty('限時掛號')}</div><div>交寄大宗${ty('掛號')}函件執據</div><div>${ty('快捷郵件')}</div></div><div class="stamp">郵<br>局<br>郵<br>戳</div></div>
      <div class="dt">${rocD}　　　　　　第 ${p + 1} / ${pages} 頁</div><div class="snd"><div>寄　件　人　名稱：${esc(co.name || '志瑞螺絲企業有限公司')}</div><div>寄件人代表　　詳細地址：${esc(co.addr || '')}　電話號碼：${esc(co.phone || '')}</div></div>
      <table><thead><tr><th rowspan="2" class="c0">順序<br>號碼</th><th rowspan="2" class="c1">掛號號碼</th><th colspan="2">收　　件　　人</th><th rowspan="2" class="c4">是否<br>回執<br>(√)</th><th rowspan="2" class="c4">是否<br>印刷<br>物(√)</th><th rowspan="2" class="c5">重量</th><th rowspan="2" class="c5">郵資</th><th rowspan="2" class="c6">限時小包掛號或快捷郵件內裝物品名稱</th></tr><tr><th class="c2">姓　　名</th><th>寄達地名(或地址)</th></tr></thead><tbody>
      ${Array.from({ length: per }, (_, i) => { const x = rows[i]; return `<tr><td class="c">${p * per + i + 1}</td><td>${x ? esc(x.no) : ''}</td><td>${x ? esc(outName(x)) : ''}</td><td class="ad">${x ? esc((x.zip ? x.zip + ' ' : '') + x.addr) : ''}</td><td></td><td></td><td></td><td></td><td></td></tr>`; }).join('')}</tbody></table>
      ${p === pages - 1 ? `<div class="ft"><div>(1) 此單填寫 1 式 2 份。</div><div>上開 ${esc(type)} 共 <b>${list.length}</b> 件照收無誤</div><div>經辦員簽署＿＿＿＿＿＿</div></div><div class="keep">保存期限 2 年</div>` : ''}</div>`;
  }
  printHTML('大宗掛號執據', `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"PMingLiU","新細明體","Microsoft JhengHei",serif;color:#000;font-size:10pt}
.page{width:210mm;height:297mm;padding:12mm 12mm 10mm;page-break-after:always;display:flex;flex-direction:column}.page:last-child,.page:not(:has(~ .page)){page-break-after:auto}
.top{display:flex;justify-content:space-between;align-items:flex-start}.lft{font-size:9pt;text-align:center}.boxes{font-size:13pt;letter-spacing:.1em}.mid{text-align:center;line-height:1.5}.tt{font-size:12pt;letter-spacing:.2em}.sel{text-decoration:underline;font-size:11pt}.off{color:#555}.stamp{border:.6pt solid #000;padding:2mm 3mm;font-size:9pt;line-height:1.2;text-align:center}
.dt{margin-top:2mm}.snd{margin:1mm 0 2mm;line-height:1.6}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.6pt solid #000;height:7mm;padding:0 1.5mm;font-size:9.5pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}th{font-weight:normal;font-size:8.5pt;line-height:1.2;height:auto;padding:1mm;white-space:normal;text-align:center}
.c0{width:9mm}.c1{width:20mm}.c2{width:24mm}.c4{width:9mm}.c5{width:10mm}.c6{width:18mm}.c{text-align:center}td.ad{font-size:8.5pt;white-space:normal;line-height:1.15;text-overflow:clip}.ft{display:flex;justify-content:space-between;margin-top:3mm;font-size:10.5pt}.keep{text-align:right;margin-top:2mm;font-size:9pt}`, html, { tip: '大宗掛號函件執據：按 Ctrl+P，A4 直式，縮放 100%。郵局規定填寫 1 式 2 份，請印兩份。' });
  store.log('列印', `大宗掛號執據 ${list.length} 件（${type}）`);
}
