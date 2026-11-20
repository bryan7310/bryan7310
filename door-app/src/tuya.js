// Tuya（Smart Life）雲端 OpenAPI
// 文件：https://developer.tuya.com/en/docs/iot/new-singnature
import { sha256Hex, hmacHex } from './crypto.js';

const TOKEN_KEY = 'tuya:token';

// 依官方簽名規則產生 headers
export async function tuyaSign({ clientId, secret, accessToken = '', method, path, body = '', t, nonce = '' }) {
  const stringToSign = [method.toUpperCase(), await sha256Hex(body), '', path].join('\n');
  const str = clientId + accessToken + t + nonce + stringToSign;
  return (await hmacHex(secret, str)).toUpperCase();
}

// 把 query 依 key 排序，簽名要求
export function canonicalPath(path) {
  const [base, query] = path.split('?');
  if (!query) return base;
  const sorted = query
    .split('&')
    .filter(Boolean)
    .sort((a, b) => a.split('=')[0].localeCompare(b.split('=')[0]))
    .join('&');
  return `${base}?${sorted}`;
}

export class Tuya {
  constructor(env, fetchImpl = fetch) {
    this.env = env;
    this.fetch = fetchImpl;
    this.endpoint = (env.TUYA_ENDPOINT || 'https://openapi.tuyaus.com').replace(/\/$/, '');
  }

  get configured() {
    return Boolean(this.env.TUYA_CLIENT_ID && this.env.TUYA_SECRET);
  }

  async raw(method, path, bodyObj, accessToken = '') {
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const t = String(Date.now());
    const cpath = canonicalPath(path);
    const sign = await tuyaSign({
      clientId: this.env.TUYA_CLIENT_ID,
      secret: this.env.TUYA_SECRET,
      accessToken,
      method,
      path: cpath,
      body,
      t,
    });
    const headers = {
      client_id: this.env.TUYA_CLIENT_ID,
      sign,
      t,
      sign_method: 'HMAC-SHA256',
      'Content-Type': 'application/json',
    };
    if (accessToken) headers.access_token = accessToken;
    const res = await this.fetch(this.endpoint + cpath, { method, headers, body: body || undefined });
    const data = await res.json();
    return data;
  }

  async token(force = false) {
    const kv = this.env.DOOR_KV;
    if (!force) {
      const cached = await kv.get(TOKEN_KEY, 'json');
      if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
    }
    const data = await this.raw('GET', '/v1.0/token?grant_type=1');
    if (!data.success) throw new Error(`Tuya 取得 token 失敗：${data.msg || data.code}`);
    const accessToken = data.result.access_token;
    const expiresAt = Date.now() + data.result.expire_time * 1000;
    await kv.put(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt }), {
      expirationTtl: Math.max(60, data.result.expire_time),
    });
    return accessToken;
  }

  async call(method, path, body) {
    let data = await this.raw(method, path, body, await this.token());
    // token 失效（1010/1011）就重拿一次
    if (!data.success && (data.code === 1010 || data.code === 1011)) {
      data = await this.raw(method, path, body, await this.token(true));
    }
    if (!data.success) throw new Error(`Tuya 錯誤 ${data.code}：${data.msg}`);
    return data.result;
  }

  async listDevices() {
    let list;
    try {
      const r = await this.call('GET', '/v1.0/iot-01/associated-users/devices?size=100');
      list = (r.devices || []).map((d) => ({ id: d.id, name: d.name, online: d.online, category: d.category }));
    } catch (e) {
      // 部分專案沒開這支 API，改用雲端專案裝置清單
      const r = await this.call('GET', '/v2.0/cloud/thing/device?page_size=20');
      list = (Array.isArray(r) ? r : r.list || []).map((d) => ({
        id: d.id,
        name: d.customName || d.name,
        online: d.isOnline ?? d.online,
        category: d.category,
      }));
    }
    return Promise.all(list.map((d) => this.describe(d).catch((err) => ({ ...base(d), error: err.message }))));
  }

  async describe(d) {
    const [fn, status] = await Promise.all([
      this.call('GET', `/v1.0/iot-03/devices/${d.id}/functions`),
      this.call('GET', `/v1.0/iot-03/devices/${d.id}/status`),
    ]);
    return { ...base(d), actions: tuyaActions(fn.functions || []), status: tuyaStatusText(status || []) };
  }

  async runAction(deviceId, actionId) {
    const cmd = parseTuyaAction(actionId);
    await this.call('POST', `/v1.0/iot-03/devices/${deviceId}/commands`, { commands: [cmd] });
  }
}

function base(d) {
  return { platform: 'tuya', id: d.id, name: d.name, online: Boolean(d.online), actions: [], status: '' };
}

const CONTROL_LABELS = { open: '開', stop: '停', close: '關', continue: '繼續', FZ: '開', STOP: '停', ZZ: '關' };
const CONTROL_STYLE = { open: 'open', FZ: 'open', close: 'close', ZZ: 'close' };
const CONTROL_CODES = /^(control|control_\d|mach_operate)$/;
const SWITCH_CODES = /^(switch|switch_\d|switch_on)$/;

export function tuyaActions(functions) {
  const actions = [];
  for (const f of functions) {
    if (CONTROL_CODES.test(f.code) && f.type === 'Enum') {
      let range = [];
      try {
        range = JSON.parse(f.values || '{}').range || [];
      } catch {}
      // 依「開、停、關」順序排
      const order = ['open', 'FZ', 'stop', 'STOP', 'close', 'ZZ'];
      for (const v of order.filter((v) => range.includes(v))) {
        actions.push({ id: `${f.code}:${v}`, label: CONTROL_LABELS[v], style: CONTROL_STYLE[v] || 'stop' });
      }
    } else if (SWITCH_CODES.test(f.code) && f.type === 'Boolean') {
      const suffix = f.code.match(/_(\d)$/)?.[1];
      const n = suffix ? ` ${suffix}` : '';
      actions.push({ id: `${f.code}:true`, label: `開${n}`, style: 'open' });
      actions.push({ id: `${f.code}:false`, label: `關${n}`, style: 'close' });
    }
  }
  return actions;
}

export function parseTuyaAction(actionId) {
  const m = /^([a-z_0-9]+):([A-Za-z]+)$/.exec(actionId || '');
  if (!m || !(CONTROL_CODES.test(m[1]) || SWITCH_CODES.test(m[1]))) throw new Error('不支援的動作');
  const [, code, v] = m;
  const value = v === 'true' ? true : v === 'false' ? false : v;
  if (CONTROL_CODES.test(code) && typeof value !== 'string') throw new Error('不支援的動作');
  if (SWITCH_CODES.test(code) && typeof value !== 'boolean') throw new Error('不支援的動作');
  return { code, value };
}

export function tuyaStatusText(status) {
  const get = (c) => status.find((s) => s.code === c)?.value;
  const pct = get('percent_state') ?? get('percent_control');
  if (pct !== undefined) return `開啟 ${pct}%`;
  const ctl = get('control');
  if (ctl === 'open') return '開啟中';
  if (ctl === 'close') return '關閉中';
  const sw = status.filter((s) => SWITCH_CODES.test(s.code) && typeof s.value === 'boolean');
  if (sw.length === 1) return sw[0].value ? '開' : '關';
  return '';
}
