// 客戶／廠商名稱：介面用簡稱、列印用全名
// shortName：從全名擷取簡稱（品牌核心字，例：協記精密工業股份有限公司 → 協記、台灣聖德彼有限公司 → 聖德彼）
// printName：列印用全名（拿掉「(鍍鋅)」這種備註括號，保留「(股)」）

// 產業／公司型態字：出現在第 2 個字以後就從那裡切掉（長的放前面）
const KW = ['股份有限公司', '有限公司', '股份公司', '工業社', '企業社', '實業社', '鐵工廠', '室內裝修', '自動控制', '有線電視', '自動化',
  '股份', '公司', '企業', '實業', '工業', '興業', '科技', '國際', '精密', '精機', '精研', '機械', '機電', '電機', '電子', '電器', '電氣', '五金', '螺絲', '螺栓', '螺帽',
  '塑膠', '金屬', '鋼鋁', '鋁門窗', '鋁業', '工程', '水電', '營造', '建設', '開發', '貿易', '商行', '行號', '工作室', '事業', '製品', '材料', '化工', '光電', '能源', '環保',
  '設計', '裝潢', '汽車', '車業', '機車', '傢俱', '家具', '園藝', '工具', '彈簧', '齒輪', '油壓', '空調', '冷氣', '紡織', '保溫', '耐火', '防盜', '門窗', '木箱', '工廠',
  '產業', '產機', '橡膠', '鋁製', '不銹鋼', '不鏽鋼', '電鍍', '熱處理', '鐵線', '鐵網', '物流', '通運', '醫療', '生化', '資訊', '通信', '照明', '衡器', '模具', '皮件', '漁具',
  '板金', '精工', '童車', '音樂', '氣體', '導管', '包裝', '手工具', '壓鑄', '沖壓', '鍛造', '車床', '-'];
const TAIL1 = /[行社廠店館堂號]$/;   // 單字結尾（只在最後一個字才切）
const PAREN = /[(（]([^()（）]*)[)）]/g;
const isStock = s => /^股(份有限公司)?$|^股份$/.test(s.trim());
const n0 = s => String(s || '').replace(/\s+/g, '').replace(/臺/g, '台');

/** 列印用全名：拿掉備註括號（保留「(股)」），去掉多餘空白 */
export function printName(name) {
  let s = String(name || '').trim();
  s = s.replace(PAREN, (m, inner) => isStock(inner) ? m : '');
  return s.replace(/\s{2,}/g, ' ').replace(/\s*-\s*$/, '').trim() || String(name || '').trim();
}

/** 從全名擷取核心字 */
function core(name) {
  let s = n0(name).replace(/[-－].*(分公司|營業所|營運處|門市|廠區|辦事處)$/, '');   // 分公司另外處理
  s = s.replace(PAREN, '');
  s = s.replace(/^(財團法人|社團法人|台灣省私立|台灣省|台中市|臺中市)/, '');
  const raw = s;
  if (/^台灣/.test(s) && s.length > 4) s = s.slice(2);
  let cut = s.length;
  for (let i = 2; i < s.length; i++) { if (KW.some(k => s.startsWith(k, i))) { cut = i; break; } }
  let c = s.slice(0, cut);
  if (c.length > 2 && TAIL1.test(c) && cut === s.length) c = c.slice(0, -1);
  c = c.replace(/[-－]+$/, '');
  if (c.length < 2) c = raw.replace(/[-－]/g, '').slice(0, Math.max(2, Math.min(4, raw.length)));
  return c;
}
/** 從全名（＋別名）擷取簡稱；別名裡有「全名開頭、2～4 個字」的就直接用（那是以前實際在用的叫法） */
export function shortName(name, aliases) {
  const nm = n0(name);
  const al = (aliases || []).map(n0).filter(a => a.length >= 2 && a.length <= 4 && !/[-\d]/.test(a) && nm.startsWith(a) && a !== nm).sort((a, b) => a.length - b.length);
  if (al.length) return al[0];
  return core(name);
}
/** 給一批聯絡人建議簡稱，同類（客戶／供應商）裡重複的自動加長；existing：已經有簡稱的（不動，但要避開） */
export function suggestShorts(list, existing) {
  const taken = new Map();   // 簡稱 → 已用的 id
  for (const c of existing || []) if (c.short) taken.set(n0(c.short), c.id);
  const out = [];
  for (const c of list) {
    let s = shortName(c.name, c.aliases); let note = '';
    if (taken.has(s) && taken.get(s) !== c.id) {
      // 加長：拿掉公司型態字的全名 → 再不行加分公司字樣
      const longer = n0(c.name).replace(PAREN, '').replace(/(股份有限公司|有限公司|股份公司|公司)$/, '');
      const br = (n0(c.name).match(/[-－](.+)$/) || [])[1] || '';
      const cand = [s + br.replace(/分公司|營業所|營運處/, ''), longer, n0(c.name)].find(x => x && x !== s && !taken.has(x));
      if (cand) { note = `「${s}」已被其他${c.kind === 'S' ? '供應商' : '客戶'}使用`; s = cand; }
      else note = `「${s}」重複`;
    }
    taken.set(s, c.id); out.push({ c, short: s, note });
  }
  return out;
}
