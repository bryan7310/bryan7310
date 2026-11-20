const $ = (id) => document.getElementById(id);
const PLATFORM = { tuya: 'Smart Life', ewelink: '易微聯' };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('請先登入'); }
  if (!res.ok) throw new Error(data.error || `錯誤 ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function showLogin() {
  $('login').hidden = false;
  $('home').hidden = true;
  $('refresh').hidden = true;
}

function confirmAsk(text) {
  return new Promise((resolve) => {
    const d = $('confirm');
    $('confirm-text').textContent = text;
    const done = (v) => { d.close(); resolve(v); };
    $('confirm-yes').onclick = () => done(true);
    $('confirm-no').onclick = () => done(false);
    d.oncancel = () => resolve(false);
    d.showModal();
  });
}

function card(dev) {
  const el = document.createElement('div');
  el.className = 'card' + (dev.online ? '' : ' offline');
  const h = document.createElement('h2');
  h.textContent = dev.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const st = document.createElement('span');
  st.innerHTML = '<span class="dot"></span>';
  st.append(dev.online ? (dev.status || '在線') : '離線');
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = PLATFORM[dev.platform];
  meta.append(st, tag);
  // 同一個 group（例如多通道開關的某一路）排成一列
  const groups = new Map();
  for (const a of dev.actions || []) {
    if (!groups.has(a.group || '')) groups.set(a.group || '', []);
    groups.get(a.group || '').push(a);
  }
  const rows = [];
  for (const [name, list] of groups) {
    const row = document.createElement('div');
    row.className = 'actions' + (name ? ' grouped' : '');
    if (name) {
      const lab = document.createElement('span');
      lab.className = 'group-label';
      lab.textContent = name;
      row.append(lab);
    }
    for (const a of list) {
      const b = document.createElement('button');
      b.className = `act ${a.style}`;
      b.textContent = a.label;
      b.disabled = !dev.online;
      b.onclick = () => act(dev, a, b);
      row.append(b);
    }
    rows.push(row);
  }
  el.append(h, meta);
  if (dev.error) {
    const e = document.createElement('p');
    e.className = 'error';
    e.textContent = dev.error;
    el.append(e);
  }
  el.append(...rows);
  return el;
}

async function act(dev, a, btn) {
  // 「開」需要確認，避免誤觸
  if (a.style === 'open' && !(await confirmAsk(`確定要「${a.group ? a.group + ' ' : ''}${a.label}」${dev.name}？`))) return;
  btn.disabled = true;
  try {
    await api(`/api/devices/${dev.platform}/${encodeURIComponent(dev.id)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: a.id }),
    });
    if (navigator.vibrate) navigator.vibrate(30);
    toast(`已送出：${dev.name} ${a.group ? a.group + ' ' : ''}${a.label}`);
    setTimeout(load, 2000);
  } catch (e) {
    toast(`失敗：${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function load() {
  const box = $('devices');
  try {
    const { devices, errors } = await api('/api/devices');
    box.replaceChildren(...devices.map(card));
    if (!devices.length && !errors.length) box.innerHTML = '<p class="hint">還沒有裝置。請確認後台設定。</p>';
    $('errors').replaceChildren(...errors.map((m) => {
      const p = document.createElement('p');
      p.className = 'banner error';
      p.textContent = m;
      return p;
    }));
  } catch (e) {
    box.innerHTML = '';
    toast(e.message);
  }
}

async function start() {
  const me = await api('/api/me');
  if (!me.loggedIn) return showLogin();
  $('login').hidden = true;
  $('home').hidden = false;
  $('refresh').hidden = false;
  $('demo-banner').hidden = !me.demo;
  $('link-ewelink').hidden = !(me.ewelink && !me.ewelinkLinked);
  if (location.search.includes('linked=ewelink')) {
    toast('易微聯已連結');
    history.replaceState(null, '', '/');
  }
  load();
}

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('password').value = '';
    start();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
};
$('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); showLogin(); };
$('refresh').onclick = load;
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('home').hidden) load(); });

start().catch((e) => toast(e.message));
