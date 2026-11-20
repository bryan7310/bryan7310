// 開門 App 後端：合併 Smart Life（Tuya）與易微聯（eWeLink）
import { Tuya } from './tuya.js';
import { EWeLink } from './ewelink.js';
import { hmacHex, randomString, safeEqual } from './crypto.js';
import { demoDevices, demoAction } from './demo.js';

const COOKIE = 'door_session';
const SESSION_DAYS = 180;
const MAX_FAILS = 10; // 15 分鐘內密碼錯 10 次就暫時鎖住

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const sessionKey = (env) => `${env.APP_PASSWORD}|door-session`;

async function makeSession(env) {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  return `${exp}.${await hmacHex(sessionKey(env), String(exp))}`;
}

async function validSession(req, env) {
  const cookie = req.headers.get('Cookie') || '';
  const m = new RegExp(`${COOKIE}=([0-9]+)\\.([0-9a-f]{64})`).exec(cookie);
  if (!m || Number(m[1]) < Date.now()) return false;
  return safeEqual(m[2], await hmacHex(sessionKey(env), m[1]));
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function login(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const failKey = `fail:${ip}`;
  const fails = Number((await env.DOOR_KV.get(failKey)) || 0);
  if (fails >= MAX_FAILS) return json({ error: '錯誤次數太多，請 15 分鐘後再試' }, 429);
  const { password } = await req.json().catch(() => ({}));
  if (!password || !safeEqual(password, env.APP_PASSWORD)) {
    await env.DOOR_KV.put(failKey, String(fails + 1), { expirationTtl: 900 });
    return json({ error: '密碼錯誤' }, 401);
  }
  await env.DOOR_KV.delete(failKey);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(await makeSession(env), SESSION_DAYS * 86400) });
}

async function listAll(env) {
  if (env.DEMO_MODE === '1') return { devices: demoDevices(), errors: [] };
  const tuya = new Tuya(env);
  const ewe = new EWeLink(env);
  const errors = [];
  const tasks = [];
  if (tuya.configured) tasks.push(tuya.listDevices().catch((e) => (errors.push(`Smart Life：${e.message}`), [])));
  if (ewe.configured && (await ewe.linked()))
    tasks.push(ewe.listDevices().catch((e) => (errors.push(`易微聯：${e.message}`), [])));
  const devices = (await Promise.all(tasks)).flat();
  return { devices, errors };
}

async function runAction(env, platform, id, action) {
  if (env.DEMO_MODE === '1') return demoAction(id, action);
  if (platform === 'tuya') return new Tuya(env).runAction(id, action);
  if (platform === 'ewelink') return new EWeLink(env).runAction(id, action);
  throw new Error('不明平台');
}

async function api(req, env, url) {
  const path = url.pathname;
  if (path === '/api/login' && req.method === 'POST') return login(req, env);
  if (path === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', 0) });

  const authed = await validSession(req, env);
  if (path === '/api/me') {
    const ewe = new EWeLink(env);
    return json({
      loggedIn: authed,
      demo: env.DEMO_MODE === '1',
      tuya: env.DEMO_MODE === '1' || new Tuya(env).configured,
      ewelink: env.DEMO_MODE === '1' || ewe.configured,
      ewelinkLinked: authed && (env.DEMO_MODE === '1' || (ewe.configured && (await ewe.linked()))),
    });
  }
  if (!authed) return json({ error: '請先登入' }, 401);

  if (path === '/api/devices' && req.method === 'GET') return json(await listAll(env));

  const m = /^\/api\/devices\/(tuya|ewelink)\/([A-Za-z0-9_-]{1,64})\/action$/.exec(path);
  if (m && req.method === 'POST') {
    const { action } = await req.json().catch(() => ({}));
    try {
      await runAction(env, m[1], m[2], action);
      return json({ ok: true });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  return json({ error: 'Not found' }, 404);
}

async function oauth(req, env, url) {
  if (!(await validSession(req, env))) return Response.redirect(`${url.origin}/`, 302);
  const ewe = new EWeLink(env);
  const redirectUrl = `${url.origin}/oauth/ewelink/callback`;
  if (url.pathname === '/oauth/ewelink/start') {
    if (!ewe.configured) return new Response('尚未設定易微聯 APPID / APPSECRET', { status: 500 });
    const state = randomString(24);
    await env.DOOR_KV.put(`oauth:${state}`, '1', { expirationTtl: 600 });
    return Response.redirect(await ewe.authorizeUrl(redirectUrl, state), 302);
  }
  if (url.pathname === '/oauth/ewelink/callback') {
    const state = url.searchParams.get('state') || '';
    if (!/^[a-z0-9]{24}$/.test(state) || !(await env.DOOR_KV.get(`oauth:${state}`)))
      return new Response('連結逾時，請回 App 重新按「連結易微聯」', { status: 400 });
    await env.DOOR_KV.delete(`oauth:${state}`);
    try {
      await ewe.exchangeCode(url.searchParams.get('code'), url.searchParams.get('region'), redirectUrl);
    } catch (e) {
      return new Response(e.message, { status: 502 });
    }
    return Response.redirect(`${url.origin}/?linked=ewelink`, 302);
  }
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.APP_PASSWORD) return new Response('尚未設定 APP_PASSWORD', { status: 500 });
    if (url.pathname.startsWith('/api/')) {
      // 防止其他網站偷偷送出開門請求
      if (req.method !== 'GET') {
        const origin = req.headers.get('Origin');
        if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, 403);
      }
      return api(req, env, url);
    }
    if (url.pathname.startsWith('/oauth/')) return oauth(req, env, url);
    return env.ASSETS.fetch(req);
  },
};
