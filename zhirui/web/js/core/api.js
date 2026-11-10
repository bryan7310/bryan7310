// 與伺服器溝通
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function call(method, path, body, signal) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal, credentials: 'same-origin' });
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) throw new ApiError((j && j.error) || `伺服器回應 ${r.status}`, r.status);
  return j;
}
export const api = {
  get: (path, signal) => call('GET', path, null, signal),
  post: (path, body) => call('POST', path, body || {}),
  status: () => call('GET', '/api/status'),
  login: (login, pw) => call('POST', '/api/login', { login, pw }),
  setup: (name, login, pw) => call('POST', '/api/setup', { name, login, pw }),
  logout: () => call('POST', '/api/logout', {}),
  bootstrap: () => call('GET', '/api/bootstrap'),
  sync: (since, signal) => call('GET', '/api/sync?since=' + since, null, signal),
  batch: ops => call('POST', '/api/batch', ops),
  hist: params => call('GET', '/api/hist?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')))),
  histPrices: (gid, limit = 50, cid = '') => call('GET', `/api/hist/prices?gid=${encodeURIComponent(gid)}&limit=${limit}${cid ? '&cid=' + encodeURIComponent(cid) : ''}`),
  users: () => call('GET', '/api/users'),
  addUser: (name, login, pw) => call('POST', '/api/users', { name, login, pw }),
  updateUser: (id, patch) => call('POST', '/api/users/' + id, patch),
  backup: () => call('POST', '/api/backup', {}),
};
