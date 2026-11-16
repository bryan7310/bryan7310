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

// ---------- AI 辨識防重複：同一張照片辨識過，伺服器回 dup＋上次結果，先問再決定要不要花錢 ----------
export const ocrDupMsg = d => `這張照片在 ${new Date(d.t).toLocaleString('zh-TW', { hour12: false })} ${d.by ? '由 ' + d.by + ' ' : ''}辨識過了。`;
/** ask(dup) 回 'reuse'（用上次結果，免費）、'again'（重新辨識，再花一次錢）或 null（取消） */
export async function aiOcr(path, body, ask = askOcrDupNative) {
  const r = await api.post(path, body);
  if (!r || !r.dup) return r;
  const how = await ask(r.dup);
  if (how === 'reuse') { const { dup, ...rest } = r; return rest; }
  if (how === 'again') return api.post(path, { ...body, again: 1 });
  throw new ApiError('已取消：這張照片辨識過，沒有重新辨識', 0);
}
/** 手機用：系統對話框 */
export function askOcrDupNative(d) {
  if (window.confirm(ocrDupMsg(d) + '\n\n按「確定」直接用上次的結果（不花錢）\n按「取消」可以選擇重新辨識')) return 'reuse';
  return window.confirm('重新辨識會再花一次 AI 費用，確定要重新辨識嗎？') ? 'again' : null;
}
