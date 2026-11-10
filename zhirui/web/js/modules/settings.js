// 設定：公司資料、帳號、備份、外觀、操作日誌
import { $, esc, roc, slash, money } from '../core/util.js';
import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { toast, modal, confirm, tabs, prompt } from '../core/ui.js';
import { setTheme, getTheme } from '../app.js';

const ui = { tab: 'company' };
const TABS = [['company', '公司資料'], ['users', '帳號'], ['backup', '備份'], ['print', '套印與顯示'], ['ai', 'AI 辨識'], ['logs', '操作日誌']];
export default {
  id: 'settings', name: '設定備份', group: '管理', icon: 'settings',
  render(el, { sub }) { this.el = el; if (sub && TABS.some(t => t[0] === sub)) ui.tab = sub; draw(el); },
  onChange(ch) { if (this.el?.isConnected && (ch.has('settings') || ch.has('logs'))) draw(this.el); },
};
async function draw(el) {
  el.innerHTML = `<div class="head"><h1>設定</h1><span class="sp"></span>${tabs('st', TABS, ui.tab)}</div><div id="stBody" class="panel" style="display:grid;gap:12px"></div>`;
  el.addEventListener('tab', ev => { ui.tab = ev.detail.val; draw(el); }, { once: true });
  const box = $('#stBody', el);
  if (ui.tab === 'company') {
    const co = store.setting('company');
    box.innerHTML = `<div class="grid">${[['name', '公司名稱'], ['short', '簡稱'], ['taxId', '統一編號'], ['phone', '電話'], ['fax', '傳真'], ['addr', '地址'], ['bank', '匯款帳戶（印在報價單）']].map(([k, l]) => `<div class="f" ${k === 'addr' || k === 'bank' ? 'style="grid-column:1/-1"' : ''}><label for="co-${k}">${l}</label><input id="co-${k}" value="${esc(co[k] || '')}"></div>`).join('')}</div><div class="tools"><span class="sp"></span><button class="btn pri" id="coSave">儲存</button></div>`;
    $('#coSave', box).onclick = async () => { const o = { ...co }; box.querySelectorAll('input[id^=co-]').forEach(i => o[i.id.slice(3)] = i.value.trim()); await store.saveSetting('company', o); toast('已儲存'); };
  } else if (ui.tab === 'users') {
    let users = store.users; try { users = (await api.users()).users; store.users = users; } catch (e) {}
    box.innerHTML = `<p class="muted" style="margin:0">所有帳號權限相同。密碼忘記時由其他人在這裡重設。</p><div class="tw"><table><thead><tr><th>姓名</th><th>帳號</th><th>狀態</th><th></th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.name)}</td><td class="mono">${esc(u.login)}</td><td>${u.disabled ? '<span class="pill bad">停用</span>' : '<span class="pill ok">可用</span>'}${u.id === store.user.id ? ' <span class="pill blue">我</span>' : ''}</td><td class="nowrap"><button class="btn xs" data-pw="${u.id}">重設密碼</button> <button class="btn xs" data-rn="${u.id}">改名</button> ${u.id !== store.user.id ? `<button class="btn xs ${u.disabled ? '' : 'danger'}" data-dis="${u.id}" data-to="${u.disabled ? 0 : 1}">${u.disabled ? '啟用' : '停用'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div><div class="tools"><span class="sp"></span><button class="btn pri" id="uAdd">＋ 新增帳號</button></div>`;
    $('#uAdd', box).onclick = () => modal({ title: '新增帳號', width: 420, body: `<div class="f"><label for="nu-name">姓名</label><input id="nu-name" autofocus></div><div class="f"><label for="nu-login">帳號（英數字）</label><input id="nu-login" autocomplete="off"></div><div class="f"><label for="nu-pw">密碼（至少 4 碼）</label><input id="nu-pw" type="password" autocomplete="new-password"></div><div class="err" id="nu-err"></div>`, footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="nu-ok">建立</button>', onOpen(m, close) { m.querySelector('#nu-ok').onclick = async () => { try { await api.addUser(m.querySelector('#nu-name').value, m.querySelector('#nu-login').value, m.querySelector('#nu-pw').value); close(); toast('已建立'); draw(el); } catch (e) { m.querySelector('#nu-err').textContent = e.message; } }; } });
    box.querySelectorAll('[data-pw]').forEach(b => b.onclick = async () => { const pw = await prompt('新密碼（至少 4 碼）', '', { type: 'password', title: '重設密碼' }); if (pw == null) return; try { await api.updateUser(b.dataset.pw, { pw }); toast('密碼已重設'); } catch (e) { toast(e.message); } });
    box.querySelectorAll('[data-rn]').forEach(b => b.onclick = async () => { const u = users.find(x => x.id === b.dataset.rn); const name = await prompt('姓名', u.name, { title: '改名' }); if (!name) return; await api.updateUser(u.id, { name }); draw(el); });
    box.querySelectorAll('[data-dis]').forEach(b => b.onclick = async () => { try { await api.updateUser(b.dataset.dis, { disabled: b.dataset.to === '1' }); draw(el); } catch (e) { toast(e.message); } });
  } else if (ui.tab === 'backup') {
    const bk = store.setting('backup'); const st = store.setting('backup_state');
    box.innerHTML = `<p class="muted" style="margin:0">伺服器每天在指定時間自動把資料庫壓縮備份到下面的資料夾（伺服器電腦上的路徑，可以是 BeeStation 的網路磁碟機，例如 <span class="mono">Z:\\志瑞備份</span>），只保留最近 N 份。不需要有人開著網頁。</p>
      <div class="grid"><div class="f" style="grid-column:1/-1"><label for="bk-dir">備份資料夾（空白＝伺服器 data\\backup）</label><input id="bk-dir" value="${esc(bk.dir || '')}" placeholder="C:\\zhirui\\data\\backup"></div><div class="f"><label for="bk-time">每天時間</label><input type="time" id="bk-time" value="${esc(bk.time || '12:00')}"></div><div class="f"><label for="bk-keep">保留份數</label><input id="bk-keep" class="num" value="${bk.keep || 30}"></div><label class="check" style="align-self:end"><input type="checkbox" id="bk-on" ${bk.on === false ? '' : 'checked'}> 啟用自動備份</label></div>
      <div class="banner ${st.err ? '' : 'info'}">${st.err ? '上次備份失敗：' + esc(st.err) : st.last ? `上次備份：${new Date(st.last).toLocaleString('zh-TW')}　${esc(st.file || '')}` : '還沒有備份過'}</div>
      <div class="tools"><button class="btn" id="bkNow">立即備份</button><span class="sp"></span><button class="btn pri" id="bkSave">儲存設定</button></div>
      <p class="muted small">還原方式：關掉伺服器，把備份 zip 裡的 zhirui.db 覆蓋 data\\zhirui.db，再啟動伺服器。</p>`;
    $('#bkSave', box).onclick = async () => { await store.saveSetting('backup', { dir: $('#bk-dir', box).value.trim(), time: $('#bk-time', box).value, keep: +$('#bk-keep', box).value || 30, on: $('#bk-on', box).checked }); toast('已儲存'); };
    $('#bkNow', box).onclick = async () => { $('#bkNow', box).disabled = true; try { const r = await api.backup(); toast(r.msg); } catch (e) { toast('備份失敗：' + e.message); } draw(el); };
  } else if (ui.tab === 'print') {
    const ip = store.setting('invoice_print'); const pr = store.setting('pricing');
    box.innerHTML = `<h2>發票套印（三聯式手開發票，3×5.5 吋）</h2><div class="grid"><div class="f"><label for="ip-dx">水平位移 mm（正＝右移）</label><input id="ip-dx" class="num" value="${ip.dx || 0}"></div><div class="f"><label for="ip-dy">垂直位移 mm（正＝下移）</label><input id="ip-dy" class="num" value="${ip.dy || 0}"></div></div>
      <h2>查價</h2><div class="grid"><div class="f"><label for="pr-dec">淨價小數位</label><select id="pr-dec">${[0, 1, 2, 3, 4].map(n => `<option ${n === (+pr.decimals || 2) ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <h2>外觀（只影響這台裝置）</h2><div class="tabs" id="thm">${[['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => `<button type="button" data-v="${v}" class="${getTheme() === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="tools"><span class="sp"></span><button class="btn pri" id="prSave">儲存</button></div>`;
    $('#prSave', box).onclick = async () => { await store.batch([{ col: 'settings', id: 'invoice_print', data: { ...ip, dx: +$('#ip-dx', box).value || 0, dy: +$('#ip-dy', box).value || 0 } }, { col: 'settings', id: 'pricing', data: { ...pr, decimals: +$('#pr-dec', box).value } }]); toast('已儲存'); };
    box.querySelectorAll('#thm button').forEach(b => b.onclick = () => { setTheme(b.dataset.v); box.querySelectorAll('#thm button').forEach(x => x.classList.toggle('on', x === b)); });
  } else if (ui.tab === 'ai') {
    let st = { provider: 'gemini', configured: false, hint: '', model: '', keys: {} }; try { st = await api.get('/api/ai'); } catch (e) {}
    const gem = st.provider === 'gemini';
    box.innerHTML = `<p class="muted" style="margin:0">支票登記的「拍照辨識」會把支票照片送到 AI 模型擷取發票人、銀行、票號、金額、到期日，再帶入登記客票讓人核對。</p>
      <div class="banner ${st.configured ? 'info' : ''}">${st.mock ? '目前是測試模式（回傳固定資料，不會呼叫 AI）。' : st.configured ? `目前使用 <b>${gem ? 'Google Gemini' : 'Anthropic Claude'}</b>（${esc(st.model)}），金鑰 <span class="mono">${esc(st.hint)}</span>` : `目前選 ${gem ? 'Google Gemini' : 'Anthropic Claude'}，但還沒設定金鑰，拍照辨識無法使用。`}</div>
      <div class="tabs" id="aiProv">${[['gemini', 'Google Gemini（免費額度）'], ['claude', 'Anthropic Claude（付費）']].map(([v, l]) => `<button type="button" data-v="${v}" class="${st.provider === v ? 'on' : ''}">${l}${st.keys?.[v] ? ' ✓' : ''}</button>`).join('')}</div>
      <div id="aiGem" style="display:${gem ? 'grid' : 'none'};gap:10px">
        <p class="muted small" style="margin:0">免費：到 <span class="mono">aistudio.google.com</span> 用 Google 帳號建立 API key，不用信用卡，每天有免費額度（Flash-Lite 等級）。<b>注意</b>：Google 條款寫明免費方案的內容「會用來改進 Google 產品」，也可能被人工檢視；支票上有客戶名稱、帳號，介意的話請改用付費方案（Gemini 付費或 Claude 都不會拿資料訓練）。</p>
        <div class="grid"><div class="f"><label for="ai-key-g">Gemini API 金鑰（AIza… 開頭；存在伺服器 data\\ai.json，不會同步到瀏覽器）</label><input id="ai-key-g" type="password" autocomplete="off" placeholder="${st.keys?.gemini ? '已設定 ' + esc(st.keys.gemini) + '，留空＝不變' : '貼上金鑰'}"></div><div class="f"><label for="ai-model-g">模型名稱（免費額度可用：gemini-3.5-flash-lite、gemini-3.6-flash、gemini-3.8-flash）</label><input id="ai-model-g" value="${esc(gem ? st.model : '')}" placeholder="gemini-3.5-flash-lite"></div></div>
      </div>
      <div id="aiCla" style="display:${gem ? 'none' : 'grid'};gap:10px">
        <p class="muted small" style="margin:0">付費：到 <span class="mono">console.anthropic.com</span> → API Keys 建立並在 Billing 儲值；模型 claude-opus-5-5，每張約新臺幣 1～2 元，資料不會被拿去訓練。</p>
        <div class="grid"><div class="f" style="grid-column:1/-1"><label for="ai-key-c">Anthropic API 金鑰（sk-ant-… 開頭；存在伺服器 data\\ai.json，不會同步到瀏覽器）</label><input id="ai-key-c" type="password" autocomplete="off" placeholder="${st.keys?.claude ? '已設定 ' + esc(st.keys.claude) + '，留空＝不變' : '貼上金鑰'}"></div></div>
      </div>
      <div class="tools"><button class="btn" id="aiClear">清除這個供應商的金鑰</button><span class="sp"></span><button class="btn pri" id="aiSave">儲存</button></div>
      <p class="muted small">金鑰只放伺服器，不要貼到群組或截圖。</p>`;
    let prov = st.provider;
    box.querySelectorAll('#aiProv button').forEach(b => b.onclick = () => { prov = b.dataset.v; box.querySelectorAll('#aiProv button').forEach(x => x.classList.toggle('on', x === b)); $('#aiGem', box).style.display = prov === 'gemini' ? 'grid' : 'none'; $('#aiCla', box).style.display = prov === 'claude' ? 'grid' : 'none'; });
    $('#aiSave', box).onclick = async () => {
      const key = $(prov === 'gemini' ? '#ai-key-g' : '#ai-key-c', box).value.trim();
      if (key && prov === 'claude' && !/^sk-ant-/.test(key)) return toast('Claude 金鑰格式不對（應該是 sk-ant- 開頭）');
      if (key && prov === 'gemini' && !/^AIza/.test(key)) return toast('Gemini 金鑰格式不對（應該是 AIza 開頭）');
      const body = { provider: prov, key }; if (prov === 'gemini') body.model = $('#ai-model-g', box).value.trim();
      try { await api.post('/api/ai', body); toast('已儲存'); draw(el); } catch (e) { toast(e.message); }
    };
    $('#aiClear', box).onclick = async () => { if (!await confirm(`清除 ${prov === 'gemini' ? 'Gemini' : 'Claude'} 的金鑰？`, { danger: true, ok: '清除' })) return; try { await api.post('/api/ai', { provider: prov, key: '', clear: true }); toast('已清除'); draw(el); } catch (e) { toast(e.message); } };
  } else if (ui.tab === 'logs') {
    const logs = store.list('logs').sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 300);
    const who = id => store.users.find(u => u.id === id)?.name || '';
    box.innerHTML = `<div class="tw"><table><thead><tr><th>時間</th><th>誰</th><th>動作</th><th>內容</th></tr></thead><tbody>${logs.map(l => `<tr><td class="nowrap muted">${l.at ? new Date(l.at).toLocaleString('zh-TW', { hour12: false }) : ''}</td><td>${esc(l.who || who(l.uid))}</td><td><span class="pill">${esc(l.action)}</span></td><td>${esc(l.what)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">還沒有紀錄</td></tr>'}</tbody></table></div>`;
  }
}
