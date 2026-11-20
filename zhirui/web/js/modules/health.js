// 每週檢查（程式測試＋資料健康＋電腦狀態＋硬碟健康）：總覽上的摘要、設定頁的「每週檢查」分頁。
// 檢查本身是伺服器跑 tools/weekly_check.py，這裡只顯示結果、改排程、按「現在檢查」。
import { esc } from '../core/util.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { toast, modal } from '../core/ui.js';

let cache = null, at = 0;
store.subscribe(ch => { if (ch.has('settings')) at = 0; });   // 檢查跑完伺服器會寫一筆設定 → 下次重新讀
export async function loadHealth(force) {
  if (!force && cache && Date.now() - at < 60000) return cache;
  cache = await api.get('/api/health'); at = Date.now(); return cache;
}
const W = { ok: ['ok', '正常'], warn: ['warn', '要注意'], bad: ['bad', '有問題'], info: ['', '—'] };
const DOW = ['一', '二', '三', '四', '五', '六', '日'];
const p2 = n => String(n).padStart(2, '0');
const when = ms => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}（${DOW[(d.getDay() + 6) % 7]}）${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const pills = h => `<span class="pill ok">正常 ${h.ok}</span>${h.warn ? ` <span class="pill warn">要注意 ${h.warn}</span>` : ''}${h.bad ? ` <span class="pill bad">有問題 ${h.bad}</span>` : ''}`;

/** 檢查結果明細（每一類一張表；有問題、要注意的排前面） */
export function healthDetail(h) {
  const rank = { bad: 0, warn: 1, ok: 2, info: 3 };
  return h.sections.map(s => `<div class="ptitle" style="margin-top:10px">${esc(s.title)}</div>
    <div class="tw"><table><tbody>${[...s.items].sort((a, b) => rank[a.st] - rank[b.st]).map(i => `<tr><td style="width:34%">${esc(i.n)}</td><td class="nowrap" style="width:70px">${W[i.st][0] ? `<span class="pill ${W[i.st][0]}">${W[i.st][1]}</span>` : '<span class="muted">—</span>'}</td><td class="${i.st === 'ok' || i.st === 'info' ? 'muted' : ''}" style="white-space:normal">${esc(i.i)}</td></tr>`).join('')}</tbody></table></div>`).join('');
}
function showDetail(h) {
  modal({ title: `每週檢查　${when(h.at)}`, width: 860, body: `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${pills(h)}<span class="muted small">${h.quick ? '快速檢查（沒跑全站測試、還原演練）' : '完整檢查'}・花了 ${Math.floor(h.took / 60)} 分 ${h.took % 60} 秒</span></div>${healthDetail(h)}`, footer: '<button class="btn" data-close>關閉</button>' });
}

/** 總覽上的一列摘要：上次檢查時間、幾項正常／要注意／有問題；按下去看明細 */
export async function fillHealth(box) {
  if (!box) return;
  let R; try { R = await loadHealth(); } catch (e) { return; }
  if (!box.isConnected) return;
  const h = R.health;
  if (!h) { box.innerHTML = store.user.role === 'admin' ? `<a class="panel" href="#settings/health" style="display:flex;gap:10px;align-items:center;margin:0 0 12px;padding:10px 14px;text-decoration:none;color:inherit"><b>每週檢查</b><span class="muted">還沒有檢查過，到「設定 › 每週檢查」按「現在檢查」</span></a>` : ''; return; }
  const prob = h.sections.flatMap(s => s.items.filter(i => i.st === 'bad' || i.st === 'warn').map(i => ({ ...i, sec: s.title }))).sort((a, b) => (a.st === 'bad' ? 0 : 1) - (b.st === 'bad' ? 0 : 1));
  box.innerHTML = `<button type="button" class="panel" id="hhBtn" style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;width:100%;margin:0 0 12px;padding:10px 14px;text-align:left;font:inherit;color:inherit;cursor:pointer;${h.bad ? 'box-shadow:inset 3px 0 0 var(--bad)' : ''}">
    <b>每週檢查</b><span class="muted small">${when(h.at)}</span>${R.running ? '<span class="pill blue">檢查中…</span>' : ''}${pills(h)}
    <span class="muted small" style="flex:1;min-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${prob.length ? esc(prob.slice(0, 3).map(i => i.n).join('、')) + (prob.length > 3 ? ` 等 ${prob.length} 項` : '') : '電腦、硬碟、資料、程式都正常'}</span><span class="muted small">明細 ›</span></button>`;
  box.querySelector('#hhBtn').onclick = () => showDetail(h);
}

/** 設定 › 每週檢查 */
export async function healthPanel(box, redraw) {
  let R; try { R = await loadHealth(true); } catch (e) { box.innerHTML = `<p class="muted">讀不到檢查結果：${esc(e.message)}（伺服器更新後要重新啟動才有這個功能）</p>`; return; }
  const h = R.health, c = R.cfg, boss = store.user.role === 'admin';
  box.innerHTML = `<p class="muted" style="margin:0">伺服器每週固定時間自動檢查一次：全站自動測試、備份還原演練、資料健康檢查、電腦運行狀態、硬碟健康度。全部在資料複本和測試主機上跑，不會動到正式資料；結果顯示在總覽。完整檢查大約 15 分鐘，那段時間主機會比較忙。</p>
    ${boss ? `<div class="grid"><label class="check" style="align-self:end"><input type="checkbox" id="hc-on" ${c.on ? 'checked' : ''}> 啟用每週自動檢查</label><div class="f"><label for="hc-dow">星期</label><select id="hc-dow">${DOW.map((d, i) => `<option value="${i + 1}" ${c.dow === i + 1 ? 'selected' : ''}>星期${d}</option>`).join('')}</select></div><div class="f"><label for="hc-time">時間</label><input type="time" id="hc-time" value="${esc(c.time)}"></div></div>
    <div class="tools"><button class="btn" id="hcRun" ${R.running ? 'disabled' : ''}>現在完整檢查（約 15 分鐘）</button><button class="btn" id="hcQuick" ${R.running ? 'disabled' : ''}>快速檢查（約 1 分鐘）</button><span class="sp"></span><button class="btn pri" id="hcSave">儲存設定</button></div>` : ''}
    ${R.auto ? '' : '<div class="muted small">這台伺服器不是由啟動器執行（或是測試主機），不會自動排程；可以按上面的按鈕手動檢查。</div>'}
    ${R.running ? `<div class="pill blue" style="justify-self:start">${R.quick ? '快速' : '完整'}檢查進行中（${when(R.started)} 開始），跑完這裡會自動更新</div>` : ''}
    ${R.err ? `<div class="pill bad" style="justify-self:start;white-space:normal">${esc(R.err)}</div>` : ''}
    ${h ? `<div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>上次檢查　${when(h.at)}</b>${pills(h)}<span class="muted small">${h.quick ? '快速檢查' : '完整檢查'}・花了 ${Math.floor(h.took / 60)} 分 ${h.took % 60} 秒・報告檔 test_reports/${esc(h.report || '')}</span></div>${healthDetail(h)}</div>` : '<p class="muted">還沒有檢查過。</p>'}`;
  const q = s => box.querySelector(s);
  const start = quick => async () => { try { const r = await api.post('/api/health/run', { quick }); toast(r.msg); at = 0; redraw(); } catch (e) { toast(e.message); } };
  if (boss) {
    q('#hcRun').onclick = start(false); q('#hcQuick').onclick = start(true);
    q('#hcSave').onclick = async () => { await store.saveSetting('weekly', { on: q('#hc-on').checked, dow: +q('#hc-dow').value, time: q('#hc-time').value || '15:00' }); at = 0; toast('已儲存'); };
  }
  if (R.running) { clearTimeout(healthPanel.t); healthPanel.t = setTimeout(() => { if (box.isConnected) redraw(); }, 6000); }
}
