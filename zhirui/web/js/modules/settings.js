// 設定：公司資料、帳號、備份、外觀、操作日誌
import { $, esc, roc, slash, money } from '../core/util.js';
import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { toast, modal, confirm, tabs, prompt } from '../core/ui.js';
import { healthPanel } from './health.js';
import { setTheme, getTheme, setSkin, getSkin } from '../app.js';
import { PROC_DEFAULT, PROC_NAMES, procMap, isLot, qqMult } from '../core/proccost.js';
import { calc } from '../core/calc.js';
import { INV_FONTS } from './invoices.js';

const ui = { tab: 'company' };
const TABS = [['company', '公司資料'], ['users', '帳號'], ['backup', '備份'], ['health', '每週檢查'], ['print', '套印與顯示'], ['ai', 'AI 辨識'], ['vision', '自有辨識'], ['aicost', 'AI 費用'], ['proc', '加工成本'], ['logs', '操作日誌']];
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
    const boss = store.user.role === 'admin';
    box.innerHTML = `<p class="muted" style="margin:0">角色分「管理者」和「同事」：只有管理者能用手機版（/m/）、新增或修改帳號；同事帳號由管理者在這裡建立、重設密碼。</p><div class="tw"><table><thead><tr><th>姓名</th><th>帳號</th><th>角色</th><th>狀態</th><th></th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.name)}</td><td class="mono">${esc(u.login)}</td><td>${u.role === 'admin' ? '<span class="pill blue">管理者</span>' : '<span class="pill">同事</span>'}${boss ? ` <button class="btn xs" data-role="${u.id}" data-to="${u.role === 'admin' ? 'staff' : 'admin'}">改成${u.role === 'admin' ? '同事' : '管理者'}</button>` : ''}</td><td>${u.disabled ? '<span class="pill bad">停用</span>' : '<span class="pill ok">可用</span>'}${u.id === store.user.id ? ' <span class="pill blue">我</span>' : ''}</td><td class="nowrap"><button class="btn xs" data-pw="${u.id}">重設密碼</button> <button class="btn xs" data-rn="${u.id}">改名</button> ${u.id !== store.user.id ? `<button class="btn xs ${u.disabled ? '' : 'danger'}" data-dis="${u.id}" data-to="${u.disabled ? 0 : 1}">${u.disabled ? '啟用' : '停用'}</button>${boss ? ` <button class="btn xs danger" data-del="${u.id}">刪除</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table></div><div class="tools"><span class="sp"></span><button class="btn pri" id="uAdd">＋ 新增帳號</button></div>`;
    $('#uAdd', box).onclick = () => modal({ title: '新增帳號', width: 420, body: `<div class="f"><label for="nu-name">姓名</label><input id="nu-name" autofocus></div><div class="f"><label for="nu-login">帳號（英數字）</label><input id="nu-login" autocomplete="off"></div><div class="f"><label for="nu-pw">密碼（至少 8 碼）</label><input id="nu-pw" type="password" autocomplete="new-password"></div><div class="f"><label for="nu-role">角色</label><select id="nu-role"><option value="staff">同事</option><option value="admin">管理者</option></select></div><div class="err" id="nu-err"></div>`, footer: '<span class="sp"></span><button class="btn" data-close>取消</button><button class="btn pri" id="nu-ok">建立</button>', onOpen(m, close) { m.querySelector('#nu-ok').onclick = async () => { try { await api.post('/api/users', { name: m.querySelector('#nu-name').value, login: m.querySelector('#nu-login').value, pw: m.querySelector('#nu-pw').value, role: m.querySelector('#nu-role').value }); close(); toast('已建立'); draw(el); } catch (e) { m.querySelector('#nu-err').textContent = e.message; } }; } });
    box.querySelectorAll('[data-pw]').forEach(b => b.onclick = async () => { const pw = await prompt('新密碼（至少 8 碼）', '', { type: 'password', title: '重設密碼' }); if (pw == null) return; try { await api.updateUser(b.dataset.pw, { pw }); toast('密碼已重設'); } catch (e) { toast(e.message); } });
    box.querySelectorAll('[data-rn]').forEach(b => b.onclick = async () => { const u = users.find(x => x.id === b.dataset.rn); const name = await prompt('姓名', u.name, { title: '改名' }); if (!name) return; await api.updateUser(u.id, { name }); draw(el); });
    box.querySelectorAll('[data-dis]').forEach(b => b.onclick = async () => { try { await api.updateUser(b.dataset.dis, { disabled: b.dataset.to === '1' }); draw(el); } catch (e) { toast(e.message); } });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const u = users.find(x => x.id === b.dataset.del);
      if (!await confirm(`確定要刪除帳號「${u.name}」（${u.login}）嗎？\n\n刪除後這個帳號不能再登入，也救不回來；他開過的單據、操作日誌都會留著。\n只是暫時不讓他用的話，按「停用」就好。`, { title: '刪除帳號', ok: '刪除', danger: true })) return;
      try { const r = await api.updateUser(u.id, { delete: true }); if (!r.deleted) { toast('伺服器還是舊版，請先到「備份」按「重新啟動伺服器」再刪'); return; } store.log('刪除', `帳號 ${u.name}（${u.login}）`); toast('帳號已刪除'); draw(el); } catch (e) { toast(e.message); } });
    box.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => { try { await api.updateUser(b.dataset.role, { role: b.dataset.to }); toast('角色已更改'); draw(el); } catch (e) { toast(e.message); } });
  } else if (ui.tab === 'health') {
    await healthPanel(box, () => draw(el));
  } else if (ui.tab === 'backup') {
    const bk = store.setting('backup'); const st = store.setting('backup_state');
    box.innerHTML = `<p class="muted" style="margin:0">伺服器每天在指定時間自動把資料庫壓縮備份到下面的資料夾（伺服器電腦上的路徑，可以是 BeeStation 的網路磁碟機，例如 <span class="mono">Z:\\志瑞備份</span>），只保留最近 N 份。不需要有人開著網頁。</p>
      <div class="grid"><div class="f" style="grid-column:1/-1"><label for="bk-dir">備份資料夾（空白＝伺服器 data\\backup）</label><input id="bk-dir" value="${esc(bk.dir || '')}" placeholder="C:\\zhirui\\data\\backup"></div><div class="f"><label for="bk-time">每天時間</label><input type="time" id="bk-time" value="${esc(bk.time || '12:00')}"></div><div class="f"><label for="bk-keep">保留份數</label><input id="bk-keep" class="num" value="${bk.keep || 30}"></div><label class="check" style="align-self:end"><input type="checkbox" id="bk-on" ${bk.on === false ? '' : 'checked'}> 啟用自動備份</label></div>
      <div class="banner ${st.err ? '' : 'info'}">${st.err ? '上次備份失敗：' + esc(st.err) : st.last ? `上次備份：${new Date(st.last).toLocaleString('zh-TW')}　${esc(st.file || '')}` : '還沒有備份過'}</div>
      <div class="tools"><button class="btn" id="bkNow">立即備份</button><button class="btn" id="svRestart" title="伺服器程式（server 資料夾）更新後按這個，約 5 秒，大家的畫面會自動重新連線">重新啟動伺服器</button><button class="btn" id="dbOpt" title="先備份，再檢查並整理資料庫；建議每幾個月或覺得變慢時按一次">一鍵優化</button><span class="sp"></span><button class="btn pri" id="bkSave">儲存設定</button></div>
      <p class="muted small">還原方式：關掉伺服器，把備份 zip 裡的 zhirui.db 覆蓋 data\\zhirui.db，再啟動伺服器。</p>`;
    $('#svRestart', box).onclick = async () => {
      if (!await confirm('重新啟動伺服器？約 5 秒內所有人會暫時斷線，正在編輯的單據請先儲存。', { ok: '重新啟動' })) return;
      const b = $('#svRestart', box); b.disabled = true; b.textContent = '重新啟動中…';
      try {
        const old = (await api.status()).started;
        await api.post('/api/restart', {});
        const t0 = Date.now(); let ok = false;
        while (Date.now() - t0 < 40000) { await new Promise(r => setTimeout(r, 1500)); try { const st = await api.status(); if (st.started && st.started !== old) { ok = true; break; } } catch (e) {} }
        toast(ok ? '伺服器已重新啟動' : '伺服器還沒回應，請稍後重新整理');
      } catch (e) { toast(e.message); }
      b.disabled = false; b.textContent = '重新啟動伺服器';
    };
    $('#dbOpt', box).onclick = async () => {
      if (!await confirm('一鍵優化資料庫？\n會先自動備份一份，再檢查資料是否完整、整理資料庫檔案、更新查詢統計。\n大約 10 秒內，其他人的畫面可能會短暫停頓。', { ok: '開始優化' })) return;
      const b = $('#dbOpt', box); b.disabled = true; b.textContent = '優化中…';
      const mb = n => (n / 1048576).toFixed(1) + ' MB';
      try {
        const r = await api.post('/api/optimize', {});
        if (r.ok) {
          modal({ title: '資料庫已優化', width: 560, body: `<ul style="margin:0;padding-left:20px;line-height:1.9">
              <li>資料檢查：<b style="color:var(--ok)">正常</b></li>
              <li>檔案大小：${mb(r.before)} → <b>${mb(r.after)}</b>${r.before > r.after ? `（少了 ${mb(r.before - r.after)}）` : ''}</li>
              <li>花費時間：${(r.ms / 1000).toFixed(1)} 秒</li>
              <li class="muted small">${esc(r.backup || '')}</li></ul>
            <p class="muted small" style="margin:12px 0 0">這台電腦若還是覺得慢，可以清除瀏覽器暫存：會重新下載一次全部資料（約十幾秒），之後就是最新、最乾淨的。</p>`,
            footer: '<button class="btn" id="opClr">清除這台電腦的暫存並重新載入</button><span class="sp"></span><button class="btn pri" data-close>完成</button>',
            onOpen(m) { m.querySelector('#opClr').onclick = async () => { await store.cacheClear(); location.reload(); }; } });
        } else modal({ title: '沒有優化', width: 520, body: `<div class="banner">${esc(r.msg || '優化失敗')}</div><p class="muted small">資料沒有被改動。${r.backup ? esc(r.backup) : ''}</p>`, footer: '<span class="sp"></span><button class="btn" data-close>關閉</button>' });
      } catch (e) { toast('優化失敗：' + e.message); }
      b.disabled = false; b.textContent = '一鍵優化'; draw(el);
    };
    $('#bkSave', box).onclick = async () => { await store.saveSetting('backup', { dir: $('#bk-dir', box).value.trim(), time: $('#bk-time', box).value, keep: +$('#bk-keep', box).value || 30, on: $('#bk-on', box).checked }); toast('已儲存'); };
    $('#bkNow', box).onclick = async () => { $('#bkNow', box).disabled = true; try { const r = await api.backup(); toast(r.msg); } catch (e) { toast('備份失敗：' + e.message); } draw(el); };
  } else if (ui.tab === 'print') {
    const ip = store.setting('invoice_print'); const pr = store.setting('pricing');
    box.innerHTML = `<h2>發票套印（三聯式手開發票，3×5.5 吋）</h2><div class="grid"><div class="f"><label for="ip-dx">水平位移 mm（正＝右移）</label><input id="ip-dx" class="num" value="${ip.dx || 0}"></div><div class="f"><label for="ip-dy">垂直位移 mm（正＝下移）</label><input id="ip-dy" class="num" value="${ip.dy || 0}"></div><div class="f"><label for="ip-tdy">下方金額（銷售額／稅／總計）再位移 mm（正＝下移）</label><input id="ip-tdy" class="num" value="${ip.tdy || 0}"></div><div class="f"><label for="ip-font">字體</label><select id="ip-font">${Object.entries(INV_FONTS).map(([k, v]) => `<option value="${k}" ${(ip.font || 'hei') === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div></div>
      <h2>查價</h2><div class="grid"><div class="f"><label for="pr-dec">淨價小數位</label><select id="pr-dec">${[0, 1, 2, 3, 4].map(n => `<option ${n === (+pr.decimals || 2) ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <h2>外觀（只影響這台裝置）</h2><div class="tabs" id="thm">${[['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => `<button type="button" data-v="${v}" class="${getTheme() === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="tools" style="margin-top:8px"><span class="muted small">風格</span><div class="tabs" id="skn">${[['ios', '經典'], ['desk', '工作台']].map(([v, l]) => `<button type="button" data-v="${v}" class="${getSkin() === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="tools"><span class="sp"></span><button class="btn pri" id="prSave">儲存</button></div>`;
    $('#prSave', box).onclick = async () => { await store.batch([{ col: 'settings', id: 'invoice_print', data: { ...ip, dx: +$('#ip-dx', box).value || 0, dy: +$('#ip-dy', box).value || 0, tdy: +$('#ip-tdy', box).value || 0, font: $('#ip-font', box).value } }, { col: 'settings', id: 'pricing', data: { ...pr, decimals: +$('#pr-dec', box).value } }]); toast('已儲存'); };
    box.querySelectorAll('#thm button').forEach(b => b.onclick = () => { setTheme(b.dataset.v); box.querySelectorAll('#thm button').forEach(x => x.classList.toggle('on', x === b)); });
    box.querySelectorAll('#skn button').forEach(b => b.onclick = () => { setSkin(b.dataset.v); box.querySelectorAll('#skn button').forEach(x => x.classList.toggle('on', x === b)); });
  } else if (ui.tab === 'vision') {
    await visionTab(box);
  } else if (ui.tab === 'proc') {
    procCfg(box);
  } else if (ui.tab === 'aicost') {
    await aiCost(box);
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

// ---------- 自有影像辨識：主機本地跑 OCR（PP-OCRv6）＋條碼／QR，不連網、不花 API 費用 ----------
// 圖片在瀏覽器縮到長邊 2000px 再送，伺服器回傳每個字框（box 四點座標）與依行合併的文字
export function shrinkImage(file, max = 2000) {
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('讀不出圖片')); };
    img.src = url;
  });
}

async function visionTab(box) {
  let st = { available: false, reason: '查不到狀態' }; try { st = await api.get('/api/vision/status'); } catch (e) { st.reason = e.message; }
  box.innerHTML = `<p class="muted" style="margin:0">自有影像辨識在主機上直接跑，<b>照片不會送到外面、不花 API 費用、斷網也能用</b>。目前提供：文字辨識（印刷字，中英數）與條碼／QR Code。手寫字、印章的準度不如雲端 AI。</p>
    <div class="banner ${st.available ? 'info' : ''}">${st.available ? `可以使用（OpenCV ${esc(st.opencv)}，模型 PP-OCRv6）${st.loaded ? '・模型已載入' : '・第一次辨識會先載入模型'}` : '無法使用：' + esc(st.reason)}</div>
    <div class="tools" style="margin-bottom:8px"><b>印刷單據（App 拍照上傳的進貨單、報價、訂單；傳真／Email 訂單轉單）</b>
      <select id="vsEng"><option value="auto">本機優先：讀得完整就不用 AI，讀不完整才送 AI</option><option value="local">只用本機（完全不花錢，讀不完整也給草稿）</option><option value="cloud">只用雲端 AI（跟以前一樣）</option></select>
      <span class="muted small">支票一律用 AI</span></div>
    <div class="tools"><label class="btn pri" style="cursor:pointer">📷 選照片測試<input id="vsFile" type="file" accept="image/*" hidden></label>
      <div class="tabs" id="vsMode"><button type="button" data-v="all" class="on">文字＋條碼</button><button type="button" data-v="ocr">只辨識文字</button><button type="button" data-v="codes">只讀條碼</button></div>
      <span class="sp"></span><span class="muted small" id="vsMsg"></span></div>
    <div id="vsOut"></div>`;
  let mode = 'all';
  const eng = $('#vsEng', box);
  api.get('/api/ai').then(a => { eng.value = a.doc_engine || 'auto'; }).catch(() => { eng.disabled = true; });
  eng.onchange = async () => { try { await api.post('/api/ai', { doc_engine: eng.value }); toast('已儲存'); } catch (e) { toast(e.message); } };
  box.querySelectorAll('#vsMode button').forEach(b => b.onclick = () => { mode = b.dataset.v; box.querySelectorAll('#vsMode button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#vsFile', box).onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    const msg = $('#vsMsg', box), out = $('#vsOut', box);
    msg.textContent = '辨識中…'; out.innerHTML = '';
    try {
      const image = await shrinkImage(f);
      const t = Date.now();
      const r = await api.post('/api/vision', { image, mode });
      msg.textContent = `完成：${((Date.now() - t) / 1000).toFixed(1)} 秒（主機 ${((r.ms || r.codes_ms || 0) / 1000).toFixed(1)} 秒）・${(r.items || []).length} 個字框・${(r.codes || []).length} 個條碼`;
      const poly = (b, cls) => `<polygon class="${cls}" points="${b.map(p => p.join(',')).join(' ')}"/>`;
      out.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;align-items:start">
        <div style="position:relative"><img src="${image}" style="width:100%;display:block;border-radius:6px">
          <svg viewBox="0 0 ${r.w} ${r.h}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">
            <style>.vb{fill:rgba(37,99,235,.12);stroke:#2563eb;stroke-width:${Math.max(1, r.w / 600)}}.vc{fill:rgba(22,163,74,.15);stroke:#16a34a;stroke-width:${Math.max(2, r.w / 300)}}</style>
            ${(r.items || []).map(it => poly(it.box, 'vb')).join('')}${(r.codes || []).filter(c => c.box?.length).map(c => poly(c.box, 'vc')).join('')}</svg></div>
        <div>${(r.codes || []).length ? `<h4 style="margin:0 0 6px">條碼／QR Code</h4><div class="tw"><table><thead><tr><th>種類</th><th>內容</th></tr></thead><tbody>${r.codes.map(c => `<tr><td class="nowrap">${esc(c.type)}</td><td class="mono" style="word-break:break-all">${esc(c.text)}</td></tr>`).join('')}</tbody></table></div>` : (mode !== 'ocr' ? '<p class="muted">沒有讀到條碼／QR Code</p>' : '')}
          ${r.lines ? `<h4 style="margin:10px 0 6px">文字（依行）</h4><textarea readonly style="width:100%;min-height:360px;font-family:inherit">${esc(r.lines.map(l => l.text).join('\n'))}</textarea>` : ''}</div></div>`;
    } catch (e) { msg.textContent = ''; toast(e.message); }
  };
}

// ---------- AI 費用紀錄：伺服器每次呼叫 AI 記一筆（data/ai_usage.jsonl），這裡依月份彙總 ----------
const AI_FEAT = { faxidx: '傳真內容索引', order: '訂單轉單（傳真／Email）', po: '如陽採購單辨識', 'order-doc': '拍照：客戶訂單', pur: '拍照：廠商進貨單', quote: '拍照：廠商報價', check: '支票拍照辨識', agent: 'AI 助理' };
const aiUi = { ym: '' };
// 加工成本：表面處理 → 加工料號對照（成品沒有進貨單時，用原料＋熱處理＋加工費每 KG 乘單重推成本）
function procCfg(box) {
  const map = procMap(); const C = calc(); const byCode = new Map(Object.values(C.g).map(g => [g.code, g]));
  const last = code => { const g = byCode.get(code); const li = g ? (C.purIdx[g.id] || []).filter(x => x.per > 0 && !isLot(x)).sort((a, b) => b.d - a.d) : []; return li[0] ? `${li[0].per}／KG（${li[0].date}${li[0].cid ? ' ' + esc(C.ct[li[0].cid]?.short || C.ct[li[0].cid]?.name || '') : ''}）` : '<span class="muted">沒有進貨紀錄</span>'; };
  box.innerHTML = `<p class="muted small" style="margin:0">成品（例如平華司M6*13*1 鍍鎳鐵）自己沒有進貨單時，成本＝原料（料號第 3 碼改成 D：黑身／白皮）每 KG 進價＋熱處理每 KG（雙合鑫、金元達有同尺寸同品項的 H_ 熱處理料號才加）＋下面對照的加工費每 KG，再乘單重。加工費取該料號最近一次進貨單價（量少一批的低消，例如 500、1000 元一批，不算）。華司、墊片用「-PW」，有熱處理的用「-H」。</p>
    <div class="tw"><table><thead><tr><th>表面處理</th><th>加工料號</th><th>品名</th><th>最近單價</th></tr></thead><tbody>
    ${Object.keys(PROC_DEFAULT).map(k => `<tr><td>${esc(k)}　${esc(PROC_NAMES[k] || '')}</td><td><input data-pk="${esc(k)}" value="${esc(map[k] || '')}" style="width:140px" placeholder="${esc(PROC_DEFAULT[k])}"></td><td>${esc(byCode.get(map[k])?.name || '')}${map[k] && !byCode.get(map[k]) ? '<span class="warn-t">找不到這個料號</span>' : ''}</td><td>${map[k] ? last(map[k]) : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="f" style="max-width:520px"><label for="pcQQ">阡阡華司牌價倍數</label><input id="pcQQ" class="num" inputmode="decimal" value="${qqMult()}" style="width:100px"><div class="hint muted small">沒有進價的平華司用阡阡牌價補成本（內徑號數、外徑、厚度要一樣）。牌價比我們實際進價低，預設乘 1.24（比對 15 個有進價的鍍鋅華司的中位數）。鍍鋅華司直接用；其他處理用牌價扣鍍鋅費當黑身，再加上面的加工費。</div></div>
    <div class="tools"><button class="btn pri" id="pcSave">儲存</button><button class="btn" id="pcReset">恢復預設</button></div>`;
  $('#pcSave', box).onclick = async () => { const m = {}; box.querySelectorAll('[data-pk]').forEach(i => { const v = i.value.trim(); if (v && v !== PROC_DEFAULT[i.dataset.pk]) m[i.dataset.pk] = v; }); const q = +$('#pcQQ', box).value; await store.saveSetting('proccost', { ...store.setting('proccost'), map: m, ...(q > 0 ? { qqMult: q } : {}) }); toast('已儲存，成本已重算'); procCfg(box); };
  $('#pcReset', box).onclick = async () => { await store.saveSetting('proccost', { map: {} }); toast('已恢復預設'); procCfg(box); };
}
async function aiCost(box) {
  const now = new Date(); const ym = aiUi.ym || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; const y = ym.slice(0, 4);
  const rate = +(store.setting('aicost').rate) || 32;
  box.innerHTML = '<div class="muted">載入中…</div>';
  let R; try { R = await api.get(`/api/ai/usage?from=${y}-01-01&to=${y}-12-31`); } catch (e) { box.innerHTML = `<div class="banner">${esc(e.message)}</div>`; return; }
  const rows = R.rows || []; const mOf = r => { const d = new Date(r.t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const usd = a => a.reduce((s, r) => s + (+r.usd || 0), 0); const nt = v => 'NT$ ' + (v * rate).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const us = v => '$' + v.toFixed(v < 1 ? 4 : 2);
  const cur = rows.filter(r => mOf(r) === ym); const unk = cur.filter(r => r.usd == null).length;
  const byF = {}; for (const r of cur) { const o = byF[r.f] ||= { n: 0, usd: 0, in: 0, out: 0 }; o.n++; o.usd += +r.usd || 0; o.in += r.in + (r.cr || 0) + (r.cw || 0); o.out += r.out; }
  const byD = {}; for (const r of cur) { const d = new Date(r.t).getDate(); const o = byD[d] ||= { n: 0, usd: 0 }; o.n++; o.usd += +r.usd || 0; }
  const byM = Array.from({ length: 12 }, (_, i) => { const k = `${y}-${String(i + 1).padStart(2, '0')}`; const a = rows.filter(r => mOf(r) === k); return { k, n: a.length, usd: usd(a) }; });
  const when = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const cap = R.cap ?? 5, today = R.today || 0, pct = cap > 0 ? Math.min(100, today / cap * 100) : 0, isBoss = (store.user?.role || 'admin') === 'admin';
  const capBox = `<div class="panel" style="margin:0 0 12px;padding:12px 14px;display:grid;gap:8px">
      <div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center"><b>今天的 AI 用量</b><span>${us(today)}（${nt(today)}）${cap > 0 ? `／每日上限 ${us(cap)}（${nt(cap)}）` : '／不限'}</span>${cap > 0 && today >= cap ? '<span class="pill bad">已到上限，今天的 AI 辨識先停用，明天自動恢復</span>' : ''}<span class="sp"></span>
        ${isBoss ? `<label class="small muted nowrap">每日上限（美元，0＝不限）</label><input id="acCap" class="num" style="width:90px" value="${cap}"><button class="btn sm" id="acCapOk">儲存</button>` : ''}</div>
      ${cap > 0 ? `<div style="height:8px;border-radius:99px;background:var(--sunken);overflow:hidden"><div style="height:100%;width:${pct.toFixed(1)}%;background:${pct >= 100 ? 'var(--red, #c62828)' : pct >= 80 ? '#e0a400' : 'var(--blue)'}"></div></div>` : ''}
      <div class="muted small">拍照辨識、匯入對帳、AI 助理、傳真辨識、訂單轉單都算在內。到上限當天停用、隔天自動恢復，防止程式出錯或一直按把費用燒掉；平常一天不到 1 美元。</div></div>`;
  box.innerHTML = capBox + `<div class="tools"><button class="btn sm" id="acPrev">‹</button><input type="month" id="acYm" value="${ym}" style="font-weight:600"><button class="btn sm" id="acNext">›</button><span class="sp"></span><label class="small muted">匯率 1 美元 ＝ <input id="acRate" class="num" value="${rate}" style="width:56px"> 台幣</label></div>
    <div class="kpis"><div class="kpi"><span>${+ym.slice(5)} 月 AI 費用</span><b>${nt(usd(cur))}</b><small>${us(usd(cur))}・${cur.length} 次</small></div><div class="kpi"><span>${y} 年累計</span><b>${nt(usd(rows))}</b><small>${us(usd(rows))}・${rows.length} 次</small></div><div class="kpi"><span>${+ym.slice(5)} 月平均每次</span><b>${cur.length ? nt(usd(cur) / cur.length) : '—'}</b></div></div>
    ${unk ? `<div class="banner">有 ${unk} 次用的模型不在價格表裡，沒有算進費用。</div>` : ''}
    <div class="grid2"><div><h2>依功能（${+ym.slice(5)} 月）</h2><div class="tw"><table><thead><tr><th>功能</th><th class="n">次數</th><th class="n">token（入／出）</th><th class="n">費用</th></tr></thead><tbody>${Object.entries(byF).sort((a, b) => b[1].usd - a[1].usd).map(([f, o]) => `<tr><td>${esc(AI_FEAT[f] || f)}</td><td class="n">${o.n}</td><td class="n">${o.in.toLocaleString()}／${o.out.toLocaleString()}</td><td class="n">${nt(o.usd)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">這個月沒有使用 AI</td></tr>'}</tbody></table></div></div>
      <div><h2>${y} 年各月</h2><div class="tw"><table><thead><tr><th>月份</th><th class="n">次數</th><th class="n">費用</th></tr></thead><tbody>${byM.map(o => `<tr class="row ${o.k === ym ? 'sel' : ''}" data-ym="${o.k}"><td>${+o.k.slice(5)} 月</td><td class="n">${o.n || ''}</td><td class="n">${o.n ? nt(o.usd) : ''}</td></tr>`).join('')}</tbody><tfoot><tr><td>全年</td><td class="n">${rows.length}</td><td class="n">${nt(usd(rows))}</td></tr></tfoot></table></div></div></div>
    <h2>每日（${+ym.slice(5)} 月）</h2><div class="tw"><table><thead><tr><th>日期</th><th class="n">次數</th><th class="n">費用</th></tr></thead><tbody>${Object.keys(byD).sort((a, b) => b - a).map(d => `<tr><td>${+ym.slice(5)}/${d}</td><td class="n">${byD[d].n}</td><td class="n">${nt(byD[d].usd)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody></table></div>
    <h2>明細（${+ym.slice(5)} 月，新的在前${cur.length > 300 ? '，只列最近 300 筆' : ''}）</h2><div class="tw"><table><thead><tr><th>時間</th><th>功能</th><th>模型</th><th class="n">輸入</th><th class="n">輸出</th><th class="n">費用</th><th>使用者／備註</th></tr></thead><tbody>${cur.slice(0, 300).map(r => `<tr><td class="nowrap">${when(r.t)}</td><td>${esc(AI_FEAT[r.f] || r.f)}</td><td class="mono small">${esc(r.m)}</td><td class="n">${(r.in + (r.cr || 0) + (r.cw || 0)).toLocaleString()}</td><td class="n">${r.out.toLocaleString()}</td><td class="n">${r.usd == null ? '<span class="muted">未知</span>' : r.m.startsWith('gemini') ? '<span class="muted">免費額度</span>' : nt(r.usd)}</td><td class="small">${esc([r.u, r.n].filter(Boolean).join('・'))}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">—</td></tr>'}</tbody></table></div>
    <p class="muted small" style="margin:0">費用依 Anthropic 公告的每百萬 token 價格估算（Haiku 5.5 輸入 $0.10／輸出 $0.50；Opus 5.5 輸入 $4／輸出 $20）；實際以 Anthropic 帳單為準。Gemini 用免費額度，不計費。從這個版本開始記錄，之前的用量沒有紀錄。</p>`;
  const go = v => { aiUi.ym = v; aiCost(box); };
  const shift = (v, n) => { const [a, b] = v.split('-').map(Number); const d = new Date(a, b - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  $('#acPrev', box).onclick = () => go(shift(ym, -1)); $('#acNext', box).onclick = () => go(shift(ym, 1));
  $('#acYm', box).onchange = ev => ev.target.value && go(ev.target.value);
  box.querySelectorAll('[data-ym]').forEach(tr => tr.onclick = () => go(tr.dataset.ym));
  $('#acCapOk', box)?.addEventListener('click', async () => { const v = parseFloat($('#acCap', box).value); if (!(v >= 0)) return toast('每日上限要填數字'); try { await api.post('/api/ai', { daily_usd_cap: v }); toast('已儲存每日上限'); aiCost(box); } catch (e) { toast(e.message); } });
  $('#acRate', box).onchange = async ev => { const v = +ev.target.value; if (v > 0) { await store.saveSetting('aicost', { ...store.setting('aicost'), rate: v }); aiCost(box); } };
}

