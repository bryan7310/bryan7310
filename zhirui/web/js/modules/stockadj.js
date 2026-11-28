// 電腦版：點庫存數字 → 調整這個商品的庫存（跟 App「盤點庫存」同一套做法）。
//   每個倉庫填「實際數量」，跟系統的差異自動開其他入庫（IN）／其他出庫（OUT）補平；有填就記盤點日 cntAt。
//   哪一頁要用：庫存數字包成 stockBtn(gid, 數量)，再在那一頁呼叫 bindStockBtns(容器, 重畫)。
import { esc, fmtQ, today, uid } from '../core/util.js';
import { store } from '../core/store.js';
import { modal, toast } from '../core/ui.js';
import { calc, nextNo, TYPES } from '../core/calc.js';

/** 庫存數字（可以點）；cls 例如 'bad'（不夠時紅字） */
export const stockBtn = (gid, qty, cls = '', title = '') => `<button type="button" class="link stk ${cls}" data-stk="${esc(gid)}" title="${esc(title || '點一下調整庫存')}" style="font:inherit;font-variant-numeric:tabular-nums">${fmtQ(qty)}</button>`;
export function bindStockBtns(root, done) {
  root.querySelectorAll('[data-stk]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); const g = store.get('goods', b.dataset.stk); if (g) adjustStockDlg(g, done); }));
}
export function adjustStockDlg(g, done, where = '電腦版') {
  const C = calc(); const whs = store.list('warehouses'); const st = C.stock[g.id] || {};
  const num = v => parseFloat(String(v).replace(/,/g, ''));
  modal({
    title: '調整庫存', width: 560,
    body: `<p style="margin:0 0 4px"><b>${esc(g.name)}</b></p><p class="muted small mono" style="margin:0 0 10px">${esc(g.code || '')}${g.cntAt ? `・上次盤點 ${esc(g.cntAt)}` : ''}</p>
      <div class="tw"><table><thead><tr><th>倉庫</th><th class="n">系統數量</th><th class="n" style="width:150px">實際數量</th><th class="n">差異</th></tr></thead><tbody>${whs.map(w => { const q = st[w.id] || 0; return `<tr><td>${esc(w.name)}</td><td class="n">${fmtQ(q)} ${esc(g.unit || '')}</td><td class="n"><input class="num sa-q" data-w="${esc(w.id)}" data-sys="${q}" inputmode="decimal" placeholder="${fmtQ(q)}" style="width:130px"></td><td class="n" data-d="${esc(w.id)}">—</td></tr>`; }).join('')}</tbody></table></div>
      <div class="f" style="margin-top:10px"><label for="sa-n">原因（選填）</label><input id="sa-n" placeholder="例如：盤點、破損、樣品"></div>
      <p class="muted small" style="margin:8px 0 0">只填要改的倉庫；沒填的不動。差異會自動開一張其他入庫或其他出庫補平，「庫存數量 › 出入庫」查得到。</p><div class="err" id="sa-e"></div>`,
    footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="sa-ok">確認修改</button>',
    onOpen(el, close) {
      const diff = t => { if (t.value.trim() === '') return null; const v = num(t.value); return isNaN(v) ? NaN : +(v - +t.dataset.sys).toPrecision(12); };
      el.querySelectorAll('.sa-q').forEach(t => t.addEventListener('input', () => { const d = diff(t); const c = el.querySelector(`[data-d="${CSS.escape(t.dataset.w)}"]`); c.textContent = d === null ? '—' : isNaN(d) ? '要填數字' : d === 0 ? '相符' : (d > 0 ? '+' : '') + fmtQ(d); c.className = 'n' + (d && !isNaN(d) ? ' bad' : ''); }));
      setTimeout(() => el.querySelector('.sa-q')?.focus(), 50);
      el.querySelector('#sa-ok').onclick = async ev => {
        const err = el.querySelector('#sa-e'); err.textContent = ''; const note = el.querySelector('#sa-n').value.trim(); const d0 = today(); const ops = []; const made = []; let filled = false;
        for (const t of el.querySelectorAll('.sa-q')) {
          const d = diff(t); if (d === null) continue; if (isNaN(d)) { err.textContent = '數量要填數字'; return; }
          filled = true; if (!d) continue;
          const type = d > 0 ? 'IN' : 'OUT'; const no = nextNo(type, d0, [...store.list('bills'), ...ops.map(o => o.data)]);
          ops.push({ col: 'bills', id: uid('b'), data: { type, no, date: d0, wid: t.dataset.w, lines: [{ gid: g.id, qty: Math.abs(d), price: 0 }], note: `盤點調整（${where}）${note ? '：' + note : ''}`, createdAt: Date.now(), updatedAt: Date.now(), createdBy: store.user.id } });
          made.push(`${TYPES[type].name} ${no}（${d > 0 ? '+' : ''}${fmtQ(d)}）`);
        }
        if (!filled) { err.textContent = '請填實際數量'; return; }
        const { id: _i, _by, ...g0 } = store.get('goods', g.id) || g;
        ops.push({ col: 'goods', id: g.id, data: { ...g0, cntAt: d0, updatedAt: Date.now() } });
        ev.target.disabled = true;
        try { await store.batch(ops); } catch (e) { err.textContent = '儲存失敗：' + e.message; ev.target.disabled = false; return; }
        if (made.length) store.log('新增', `${made.join('、')}｜${g.name} 盤點調整（${where}）`); else store.log('修改', `${g.code} ${g.name} 盤點：數量相符（${where}）`);
        close(); toast(made.length ? '已修改庫存：' + made.join('、') : '數量相符，已記錄盤點'); done && done();
      };
    },
  });
}
