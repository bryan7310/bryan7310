// eWeLink（易微聯）開放平台 API v2
// 文件：https://coolkit-technologies.github.io/eWeLink-API/
import { hmacBase64, randomString } from './crypto.js';

const AUTH_KEY = 'ewelink:auth';

export class EWeLink {
  constructor(env, fetchImpl = fetch) {
    this.env = env;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.env.EWELINK_APPID && this.env.EWELINK_APPSECRET);
  }

  host(region) {
    const r = region || this.env.EWELINK_REGION || 'as';
    if (!/^(cn|as|us|eu)$/.test(r)) throw new Error('eWeLink 區域錯誤');
    return r === 'cn' ? 'https://cn-apia.coolkit.cn' : `https://${r}-apia.coolkit.cc`;
  }

  // 產生 eWeLink 授權頁網址，使用者在那邊登入易微聯帳號
  async authorizeUrl(redirectUrl, state) {
    const seq = String(Date.now());
    const sign = await hmacBase64(this.env.EWELINK_APPSECRET, `${this.env.EWELINK_APPID}_${seq}`);
    const q = new URLSearchParams({
      state,
      clientId: this.env.EWELINK_APPID,
      authorization: sign,
      seq,
      redirectUrl,
      nonce: randomString(8),
      grantType: 'authorization_code',
      showQRCode: 'false',
    });
    return `https://c2ccdn.coolkit.cc/oauth/index.html?${q}`;
  }

  async exchangeCode(code, region, redirectUrl) {
    const body = JSON.stringify({ code, redirectUrl, grantType: 'authorization_code' });
    const res = await this.fetch(`${this.host(region)}/v2/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CK-Appid': this.env.EWELINK_APPID,
        'X-CK-Nonce': randomString(8),
        Authorization: `Sign ${await hmacBase64(this.env.EWELINK_APPSECRET, body)}`,
      },
      body,
    });
    const data = await res.json();
    if (data.error !== 0) throw new Error(`易微聯授權失敗：${data.msg || data.error}`);
    const auth = {
      region: region || this.env.EWELINK_REGION || 'as',
      at: data.data.accessToken,
      rt: data.data.refreshToken,
      atExpires: data.data.atExpiredTime,
    };
    await this.env.DOOR_KV.put(AUTH_KEY, JSON.stringify(auth));
    return auth;
  }

  async auth() {
    return this.env.DOOR_KV.get(AUTH_KEY, 'json');
  }

  async linked() {
    return Boolean(await this.auth());
  }

  async refresh(auth) {
    const res = await this.fetch(`${this.host(auth.region)}/v2/user/refresh`, {
      method: 'POST',
      headers: this.headers(auth.at),
      body: JSON.stringify({ rt: auth.rt }),
    });
    const data = await res.json();
    if (data.error !== 0) {
      await this.env.DOOR_KV.delete(AUTH_KEY);
      throw new Error('易微聯登入已過期，請重新連結');
    }
    const next = { ...auth, at: data.data.at, rt: data.data.rt, atExpires: Date.now() + 29 * 86400_000 };
    await this.env.DOOR_KV.put(AUTH_KEY, JSON.stringify(next));
    return next;
  }

  headers(at) {
    return {
      'Content-Type': 'application/json',
      'X-CK-Appid': this.env.EWELINK_APPID,
      'X-CK-Nonce': randomString(8),
      Authorization: `Bearer ${at}`,
    };
  }

  async call(method, path, bodyObj) {
    let auth = await this.auth();
    if (!auth) throw new Error('尚未連結易微聯帳號');
    // access token 快到期（剩 1 天內）就先換新
    if (auth.atExpires && auth.atExpires < Date.now() + 86400_000) auth = await this.refresh(auth);
    const send = (a) =>
      this.fetch(this.host(a.region) + path, {
        method,
        headers: this.headers(a.at),
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
      }).then((r) => r.json());
    let data = await send(auth);
    if (data.error === 401 || data.error === 402) data = await send(await this.refresh(auth));
    if (data.error !== 0) throw new Error(`易微聯錯誤 ${data.error}：${data.msg}`);
    return data.data;
  }

  async listDevices() {
    const data = await this.call('GET', '/v2/device/thing?num=0');
    return (data.thingList || [])
      .filter((t) => t.itemType === 1 || t.itemType === 2)
      .map((t) => ewelinkDevice(t.itemData));
  }

  async runAction(deviceId, actionId) {
    await this.call('POST', '/v2/device/thing/status', { type: 1, id: deviceId, params: parseEwelinkAction(actionId) });
  }
}

export function ewelinkDevice(d) {
  const p = d.params || {};
  const names = d.tags?.ck_channel_name || {};
  const actions = [];
  let status = '';
  if (Array.isArray(p.switches) && p.switches.length) {
    const count = Number(d.extra?.chl) || p.switches.length;
    const chs = p.switches.slice(0, Math.min(count, 4));
    for (const s of chs) {
      const label = names[s.outlet] || `通道 ${s.outlet + 1}`;
      actions.push({ id: `ch:${s.outlet}:on`, label: '開', group: label, style: 'open' });
      actions.push({ id: `ch:${s.outlet}:off`, label: '關', group: label, style: 'close' });
    }
    status = chs.map((s) => `${names[s.outlet] || `通道 ${s.outlet + 1}`}：${s.switch === 'on' ? '開' : '關'}`).join('、');
  } else if (p.switch !== undefined) {
    actions.push({ id: 'sw:on', label: '開', style: 'open' });
    actions.push({ id: 'sw:off', label: '關', style: 'close' });
    status = p.switch === 'on' ? '開' : '關';
  }
  return { platform: 'ewelink', id: d.deviceid, name: d.name, online: Boolean(d.online), actions, status };
}

export function parseEwelinkAction(actionId) {
  let m = /^sw:(on|off)$/.exec(actionId || '');
  if (m) return { switch: m[1] };
  m = /^ch:(\d{1,2}):(on|off)$/.exec(actionId || '');
  if (m) return { switches: [{ switch: m[2], outlet: Number(m[1]) }] };
  throw new Error('不支援的動作');
}
