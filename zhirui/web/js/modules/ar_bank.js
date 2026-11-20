// 應收帳款「匯入對帳」：存摺／網銀交易明細（PDF 或照片）→ AI 讀出存入金額、匯款人 →
// 對近 1 年未收的應收帳款（名稱＋金額、多個月加總、只對到金額…）→ 使用者核對勾選 → 寫入已收款、實收金額、收款日。
import { esc, money, thisMonth, shiftMonth, ymLabel, slash, parseNum } from '../core/util.js';
import { store } from '../core/store.js';
import { toast, modal, askOcrDup } from '../core/ui.js';
import { aiOcr } from '../core/api.js';
import { customers, cshort } from '../core/calc.js';
import { allOpen, saveRow } from './receivables.js';
import { apYm } from './payables.js';

const FEE = 30;   // 對方扣的匯費（存入比總額少 0～30 元也算對得上）
const norm = x => String(x || '').replace(/[\s　()（）\-－.,，、*＊]/g, '').replace(/(股份)?有限公司|企業社|實業|企業|工業|商行|公司/g, '').toLowerCase();
const fileB64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => bad(r.error); r.readAsDataURL(f); });
const shrinkJpeg = (f, max = 2400, q = 0.88) => new Promise((ok, bad) => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src); ok(cv.toDataURL('image/jpeg', q).split(',')[1]); }; img.onerror = () => bad(new Error('圖片讀不到')); img.src = URL.createObjectURL(f); });

/** 匯款人 → 客戶：先看之前核對過記住的對照（設定 bank_payers），再用名稱／簡稱／別名互相包含（取最長） */
function payerCust(payer) {
  const d = norm(payer); if (d.length < 2) return null;
  const learned = (store.setting('bank_payers').map || {})[d]; if (learned && store.get('contacts', learned)) return { cid: learned, how: '之前核對過' };
  let best = null, bl = 0;
  for (const c of customers(true)) for (const a of [c.name, c.short, ...(c.aliases || [])]) { const k = norm(a); if (k.length < 2) continue; const l = k === d ? 1000 : d.includes(k) ? k.length : k.includes(d) ? d.length : 0; if (l > bl) { bl = l; best = c; } }
  return bl >= 2 ? { cid: best.id, how: '名稱相符' } : null;
}
const near = (total, amt) => { const df = Math.round(total) - Math.round(amt); return df >= 0 && df <= FEE; };
const key = r => r.ym + '|' + (r.cid || r.name);
const mdiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));   // a 月到 b 月差幾個月
/** 這筆存入離應收月份幾個月（25 結；6 月應收通常 7 月底以後才入帳）；沒有日期回 null */
const lagOf = (r, dep) => dep.date ? mdiff(r.ym, apYm(dep.date)) : null;
const optLabel = rows => rows.map(r => `${r.name} ${ymLabel(r.ym)} ${money(r.total)}`).join(' ＋ ');

/** 每一筆存入找要沖的應收：回傳 [{ dep, opts:[{rows, why, lvl}], pick, on }] */
export function bankMatch(deps, open) {
  const used = new Set(); const byCid = new Map();
  for (const r of open) if (r.cid) (byCid.get(r.cid) || byCid.set(r.cid, []).get(r.cid)).push(r);
  for (const a of byCid.values()) a.sort((x, y) => x.ym.localeCompare(y.ym));
  const items = deps.map(dep => ({ dep, pc: payerCust(dep.payer), opts: [], pick: -1, on: false }));
  const take = (it, rows, why, lvl) => { it.opts.push({ rows, why, lvl }); };
  // 第 1 輪：名稱＋金額（單月、或最早的連續幾個月加總）
  for (const it of items) {
    const A = it.dep.amt; const list = it.pc ? (byCid.get(it.pc.cid) || []) : [];
    if (!list.length) continue;
    const pre = list.filter(r => (lagOf(r, it.dep) ?? 1) >= 1), any = [...pre, ...list.filter(r => !pre.includes(r))];   // 存入之前月份的應收優先
    const one = any.find(r => !used.has(key(r)) && Math.round(r.total) === Math.round(A)) || any.find(r => !used.has(key(r)) && near(r.total, A));
    if (one) { take(it, [one], `${it.pc.how}、金額${Math.round(one.total) === Math.round(A) ? '相同' : `差 ${money(one.total - A)}（匯費？）`}`, 'ok'); continue; }
    const free = list.filter(r => !used.has(key(r))); let s = 0;
    for (let i = 0; i < free.length; i++) { s += free[i].total; if (i && (Math.round(s) === Math.round(A) || near(s, A))) { take(it, free.slice(0, i + 1), `${it.pc.how}、${i + 1} 個月加總${Math.round(s) === Math.round(A) ? '相同' : `差 ${money(s - A)}（匯費？）`}`, 'ok'); break; } if (s > A + FEE) break; }
  }
  for (const it of items) if (it.opts.length) { it.pick = 0; it.on = true; it.opts[0].rows.forEach(r => used.add(key(r))); }
  // 第 2 輪：只對到金額（全部客戶）；只有一筆就預設勾，好幾筆讓使用者選
  for (const it of items) {
    if (it.opts.length) continue;
    const A = it.dep.amt;
    const okLag = r => { const g = lagOf(r, it.dep); return g == null || g >= 1; };   // 應收月份要在存入月份之前
    const rank = r => { const g = lagOf(r, it.dep); return g == null ? 9 : g === 1 || g === 2 ? 0 : g === 3 ? 1 : 2 + g; };   // 晚 1～2 個月入帳最常見
    let same = open.filter(r => !used.has(key(r)) && okLag(r) && Math.round(r.total) === Math.round(A));
    if (!same.length) same = open.filter(r => !used.has(key(r)) && okLag(r) && near(r.total, A));
    same.sort((x, y) => rank(x) - rank(y));
    same.slice(0, 8).forEach(r => { const g = lagOf(r, it.dep); take(it, [r], `只對到金額${Math.round(r.total) === Math.round(A) ? '' : `（差 ${money(r.total - A)}）`}${g != null ? `，應收月份比入帳早 ${g} 個月` : ''}，匯款人${it.pc ? '是 ' + cshort(it.pc.cid) : '對不到客戶'}，請確認`, 'warn'); });
    if (same.length && (same.length === 1 || rank(same[0]) < rank(same[1]))) { it.pick = 0; used.add(key(same[0])); }   // 只對到金額：先選好最可能的，但不預設勾，讓使用者確認
  }
  // 第 3 輪：名稱對到、金額對不上 → 列出這家的未收月份讓使用者選（不預設勾）
  for (const it of items) {
    if (!it.pc) continue;
    for (const r of byCid.get(it.pc.cid) || []) if (!it.opts.some(o => o.rows.length === 1 && o.rows[0] === r)) take(it, [r], `${it.pc.how}，金額不同（未收 ${money(r.total)}，存入 ${money(it.dep.amt)}），請確認`, 'bad');
  }
  return items;
}

/** 打開「匯入對帳」 */
export function bankImport(onDone) {
  let items = [], meta = null;
  modal({
    title: '匯入對帳（存摺／網銀明細）', width: 1180,
    body: `<div class="tools"><input type="file" id="bkF" accept="application/pdf,image/*" multiple><button class="btn pri" id="bkGo">辨識</button><span class="muted small">可以一次選好幾張照片或 PDF；AI 讀出存入金額和匯款人，再跟近 1 年未收的應收帳款比對（約 10～60 秒）。</span></div>
      <div id="bkOut" style="margin-top:12px"></div>`,
    footer: '<span class="muted small" id="bkSum"></span><span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="bkOk" disabled>沖帳勾選的項目</button>',
    onOpen(el, close) {
      const out = el.querySelector('#bkOut'), ok = el.querySelector('#bkOk');
      const sum = () => { const n = items.filter(it => it.on && it.pick >= 0).length; el.querySelector('#bkSum').textContent = items.length ? `存入 ${items.length} 筆，勾選 ${n} 筆` : ''; ok.disabled = !n; ok.textContent = n ? `沖帳勾選的 ${n} 筆` : '沖帳勾選的項目'; };
      const draw = () => {
        if (!items.length) { out.innerHTML = `<div class="empty"><b>沒有讀到存入的明細</b>${meta?.doubts ? esc(meta.doubts) : ''}</div>`; sum(); return; }
        out.innerHTML = `${meta?.doubts ? `<div class="banner" style="margin-bottom:8px">AI 提醒：${esc(meta.doubts)}</div>` : ''}${meta?.dupe ? `<div class="banner info" style="margin-bottom:8px">${meta.dupe.split('<br>').map(esc).join('<br>')}</div>` : ''}
          <div class="tw"><table><thead><tr><th>沖帳</th><th>存摺日期</th><th>匯款人／摘要</th><th class="n">存入</th><th>對到的應收</th><th class="n">實收金額</th><th>判斷</th></tr></thead><tbody>
          ${items.map((it, i) => { const o = it.opts[it.pick]; const tot = o ? o.rows.reduce((s, r) => s + r.total, 0) : 0; const sep = !it.opts.length && (i === 0 || items[i - 1].opts.length) ? `<tr><td colspan="7" class="muted small" style="background:var(--sunken);padding:6px 10px">以下 ${items.length - i} 筆在近 1 年未收的應收裡找不到對應（例如利息、其他收入），不會沖帳</td></tr>` : ''; return `${sep}<tr data-i="${i}" class="${it.on ? '' : 'muted'}">
            <td><input type="checkbox" data-on ${it.on ? 'checked' : ''} ${it.opts.length ? '' : 'disabled'}></td>
            <td class="nowrap">${esc(slash(it.dep.date))}</td>
            <td>${esc(it.dep.payer || '')}<div class="muted small">${esc(it.dep.memo || '')}</div></td>
            <td class="n"><b>${money(it.dep.amt)}</b></td>
            <td>${it.opts.length ? `<select data-pick style="max-width:330px"><option value="-1">（不沖帳）</option>${it.opts.map((x, k) => `<option value="${k}" ${k === it.pick ? 'selected' : ''}>${esc(optLabel(x.rows))}</option>`).join('')}</select>${o && Math.round(tot) !== Math.round(it.dep.amt) ? `<div class="small bad">應收 ${money(tot)}，差 ${money(tot - it.dep.amt)}</div>` : ''}` : '<span class="muted">近 1 年未收的應收裡找不到</span>'}</td>
            <td class="n"><input class="num" data-amt style="width:100px" value="${money(it.amt ?? it.dep.amt)}" ${o ? '' : 'disabled'}></td>
            <td class="small ${o ? (o.lvl === 'ok' ? 'good' : o.lvl === 'warn' ? 'warn' : 'bad') : 'muted'}">${o ? esc(o.why) : it.opts.length ? (it.pc ? `${esc(cshort(it.pc.cid))}：金額對不上，請在左邊選要沖的月份` : `有 ${it.opts.length} 筆同金額的未收，請選`) : ''}</td></tr>`; }).join('')}</tbody></table></div>
          <p class="muted small">勾選的會寫入「已收款」、實收金額＝存入金額、收款日＝存摺日期、付款方式＝匯款，備註記下存摺日期與匯款人。一筆存入沖好幾個月時，前面的月份照各月總額，差額算在最後一個月。匯款人名稱對不上、你手動選了客戶的，下次會記住這個匯款人。</p>`;
        sum();
      };
      out.addEventListener('change', ev => {
        const tr = ev.target.closest('[data-i]'); if (!tr) return; const it = items[+tr.dataset.i];
        if (ev.target.matches('[data-on]')) { it.on = ev.target.checked; if (it.on && it.pick < 0) it.pick = 0; draw(); }
        else if (ev.target.matches('[data-pick]')) { it.pick = +ev.target.value; it.on = it.pick >= 0; draw(); }
        else if (ev.target.matches('[data-amt]')) { const v = parseNum(ev.target.value); if (v == null || isNaN(v) || v <= 0) { toast('實收金額不正確'); ev.target.value = money(it.amt ?? it.dep.amt); return; } it.amt = v; }
      });
      el.querySelector('#bkGo').onclick = async ev => {
        const files = [...el.querySelector('#bkF').files]; if (!files.length) return toast('請先選存摺照片或 PDF');
        const btn = ev.currentTarget; btn.disabled = true; out.innerHTML = '<div class="muted">辨識中…（約 10～60 秒）</div>';
        try {
          const rows = []; const doubts = [];
          for (const f of files) {
            const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
            if (!pdf && !f.type.startsWith('image/')) throw new Error(`${f.name} 不是 PDF 或照片`);
            const data = pdf ? await fileB64(f) : await shrinkJpeg(f);
            const r = await aiOcr('/api/ocr/bank', { data, media: pdf ? 'application/pdf' : 'image/jpeg' }, askOcrDup);
            rows.push(...(r.rows || [])); if (r.doubts) doubts.push((files.length > 1 ? f.name + '：' : '') + r.doubts);
          }
          // 只要存入；同一天同金額同匯款人只算一次（同一頁拍兩次）；已經沖過的（收款日＋實收金額一樣）略過
          const seen = new Set(); const rec = store.list('receivables').filter(r => r.rec);
          let deps = rows.filter(r => +r.deposit > 0).map(r => ({ date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : '', payer: String(r.payer || '').trim(), memo: String(r.memo || '').trim(), amt: +r.deposit }))
            .filter(d => { const k = d.date + '|' + d.amt + '|' + norm(d.payer); if (seen.has(k)) return false; seen.add(k); return true; });
          const dn = s => s ? Date.parse(s + 'T00:00:00') / 864e5 : NaN;
          // 已經沖過：有同金額的已收款，收款日在存入日前 7 天～後 60 天（常常隔幾天才登記；匯款人跟客戶可能是關係企業，所以不限同客戶）
          const done = deps.filter(d => { const r = rec.find(r => Math.round(+r.recAmt) === Math.round(d.amt) && (!d.date || (dn(r.recDate) - dn(d.date) >= -7 && dn(r.recDate) - dn(d.date) <= 60))); if (r) d.doneAs = `${r.cid ? cshort(r.cid) : r.cust} ${ymLabel(r.ym)}（${slash(r.recDate)} 收）`; return !!r; });
          deps = deps.filter(d => !done.includes(d));
          // 票據交換（次日交換）＝存進去的客票，通常好幾張加總，已經在「收到的支票」登記沖帳；利息也不是貨款 → 不比對，只列出來
          const skip = deps.filter(d => /交換|票據|託收|利息/.test(d.memo + d.payer)); deps = deps.filter(d => !skip.includes(d));
          const since = shiftMonth(thisMonth(), -12);
          const open = allOpen().filter(r => r.ym >= since);
          items = bankMatch(deps, open);
          // 排序：已勾選（名稱＋金額對上）→ 選好等確認（只對到金額）→ 要自己選月份 → 找不到；同一類照存摺順序
          const rank = it => it.on ? 0 : it.pick >= 0 ? 1 : it.opts.length ? 2 : 3;
          items = items.map((it, k) => ({ it, k })).sort((a, b) => rank(a.it) - rank(b.it) || a.k - b.k).map(x => x.it);
          meta = { doubts: doubts.join('；'), dupe: [done.length ? `另有 ${done.length} 筆存入已經沖過帳（有同金額的已收款，收款日在存入日前後），沒有列出：${done.map(d => `${slash(d.date)} ${d.payer} ${money(d.amt)} → ${d.doneAs}`).join('、')}` : '', skip.length ? `支票存入（票據交換）、利息 ${skip.length} 筆不比對（支票請在「收到的支票」沖帳）：${skip.map(d => `${slash(d.date)} ${d.memo || d.payer} ${money(d.amt)}`).join('、')}` : ''].filter(Boolean).join('<br>') };
          draw();
        } catch (e) { out.innerHTML = `<div class="banner">${esc(e.message || String(e))}</div>`; }
        btn.disabled = false;
      };
      ok.onclick = async () => {
        const todo = items.filter(it => it.on && it.pick >= 0); if (!todo.length) return;
        ok.disabled = true; let n = 0; const learn = { ...(store.setting('bank_payers').map || {}) }; let learned = 0;
        try {
          for (const it of todo) {
            const rows = it.opts[it.pick].rows; const A = it.amt ?? it.dep.amt; const tag = `存摺 ${slash(it.dep.date)} ${it.dep.payer || ''} ${money(it.dep.amt)}`.replace(/\s+/g, ' ').trim();
            let rest = A;
            for (let k = 0; k < rows.length; k++) {
              const r = rows[k]; const amt = k === rows.length - 1 ? rest : Math.round(r.total); rest -= amt;
              const cur = r.id ? store.get('receivables', r.id) : null; const note = [cur?.note || r.note, tag].filter(Boolean).join('；');
              await saveRow(r, { rec: true, recAmt: Math.round(amt), recDate: it.dep.date || r.recDate, method: '匯款', note, amt: r.amt, tax: r.tax, manual: !!r.manual }); n++;
            }
            const cid = rows[0].cid; const pk = norm(it.dep.payer);
            if (cid && pk.length >= 2 && rows.every(r => r.cid === cid) && it.pc?.cid !== cid) { learn[pk] = cid; learned++; }
          }
          if (learned) await store.saveSetting('bank_payers', { map: learn });
          store.log('收款', `匯入對帳：沖帳 ${todo.length} 筆存入、${n} 個月份（${todo.map(it => `${it.opts[it.pick].rows[0].name} ${money(it.amt ?? it.dep.amt)}`).join('、').slice(0, 300)}）`);
        } catch (e) { toast('沖帳失敗：' + e.message); ok.disabled = false; return; }
        close(); toast(`已沖帳 ${todo.length} 筆存入（${n} 個月份）`); onDone && onDone();
      };
    },
  });
}
