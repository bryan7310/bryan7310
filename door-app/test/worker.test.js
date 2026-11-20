import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { memKV } from './memkv.js';

const env = () => ({ APP_PASSWORD: 'pw123', DEMO_MODE: '1', DOOR_KV: memKV(), ASSETS: { fetch: () => new Response('asset') } });
const req = (path, opts = {}) => new Request('https://door.example' + path, opts);

async function loginCookie(e) {
  const r = await worker.fetch(req('/api/login', { method: 'POST', body: JSON.stringify({ password: 'pw123' }) }), e);
  assert.equal(r.status, 200);
  return r.headers.get('Set-Cookie').split(';')[0];
}

test('沒登入不能看裝置也不能開門', async () => {
  const e = env();
  assert.equal((await worker.fetch(req('/api/devices'), e)).status, 401);
  const r = await worker.fetch(req('/api/devices/tuya/home89/action', { method: 'POST', body: '{"action":"control:open"}' }), e);
  assert.equal(r.status, 401);
});

test('偽造 cookie 無效', async () => {
  const e = env();
  const fake = `door_session=${Date.now() + 1e9}.${'0'.repeat(64)}`;
  assert.equal((await worker.fetch(req('/api/devices', { headers: { Cookie: fake } }), e)).status, 401);
});

test('登入後可列裝置與開門', async () => {
  const e = env();
  const Cookie = await loginCookie(e);
  const list = await (await worker.fetch(req('/api/devices', { headers: { Cookie } }), e)).json();
  assert.ok(list.devices.length >= 5);
  const r = await worker.fetch(req('/api/devices/tuya/home89/action', { method: 'POST', headers: { Cookie }, body: '{"action":"control:open"}' }), e);
  assert.equal(r.status, 200);
});

test('密碼錯太多次會鎖住', async () => {
  const e = env();
  for (let i = 0; i < 10; i++) {
    const r = await worker.fetch(req('/api/login', { method: 'POST', body: '{"password":"x"}' }), e);
    assert.equal(r.status, 401);
  }
  const r = await worker.fetch(req('/api/login', { method: 'POST', body: '{"password":"pw123"}' }), e);
  assert.equal(r.status, 429);
});

test('擋掉其他網站來的請求', async () => {
  const e = env();
  const Cookie = await loginCookie(e);
  const r = await worker.fetch(
    req('/api/devices/tuya/home89/action', { method: 'POST', headers: { Cookie, Origin: 'https://evil.example' }, body: '{"action":"control:open"}' }),
    e,
  );
  assert.equal(r.status, 403);
});
