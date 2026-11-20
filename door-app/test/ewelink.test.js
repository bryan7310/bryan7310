import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EWeLink, ewelinkDevice, parseEwelinkAction } from '../src/ewelink.js';
import { memKV } from './memkv.js';

test('多通道開關用通道名稱', () => {
  const d = ewelinkDevice({
    deviceid: '1000abc',
    name: '88號鐵門開關',
    online: true,
    params: { switches: [{ switch: 'off', outlet: 0 }, { switch: 'on', outlet: 1 }, { switch: 'off', outlet: 2 }, { switch: 'off', outlet: 3 }] },
    extra: { chl: 2 },
    tags: { ck_channel_name: { 0: '捲閘門開關', 1: '背光開關' } },
  });
  assert.deepEqual(d.actions.map((a) => `${a.group} ${a.label}`), ['捲閘門開關 開', '捲閘門開關 關', '背光開關 開', '背光開關 關']);
  assert.equal(d.status, '捲閘門開關：關、背光開關：開');
});

test('單通道開關', () => {
  const d = ewelinkDevice({ deviceid: 'x', name: 'gate', online: false, params: { switch: 'on' } });
  assert.deepEqual(d.actions.map((a) => a.id), ['sw:on', 'sw:off']);
  assert.equal(d.online, false);
});

test('動作解析', () => {
  assert.deepEqual(parseEwelinkAction('sw:on'), { switch: 'on' });
  assert.deepEqual(parseEwelinkAction('ch:1:off'), { switches: [{ switch: 'off', outlet: 1 }] });
  assert.throws(() => parseEwelinkAction('ch:x:on'));
  assert.throws(() => parseEwelinkAction('startup:on'));
});

test('授權網址簽名正確', async () => {
  const e = new EWeLink({ EWELINK_APPID: 'APP', EWELINK_APPSECRET: 'SEC' });
  const u = new URL(await e.authorizeUrl('https://x.dev/cb', 'st'));
  const seq = u.searchParams.get('seq');
  assert.equal(u.searchParams.get('authorization'), createHmac('sha256', 'SEC').update(`APP_${seq}`).digest('base64'));
  assert.equal(u.searchParams.get('clientId'), 'APP');
});

test('換 token、列裝置、開門（模擬易微聯伺服器）', async () => {
  const calls = [];
  const env = { EWELINK_APPID: 'APP', EWELINK_APPSECRET: 'SEC', EWELINK_REGION: 'as', DOOR_KV: memKV() };
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    const r = (data) => ({ json: async () => ({ error: 0, msg: '', data }) });
    if (url.endsWith('/v2/user/oauth/token')) {
      assert.equal(opts.headers.Authorization, 'Sign ' + createHmac('sha256', 'SEC').update(opts.body).digest('base64'));
      return r({ accessToken: 'AT', refreshToken: 'RT', atExpiredTime: Date.now() + 30 * 86400_000 });
    }
    assert.equal(opts.headers.Authorization, 'Bearer AT');
    if (url.includes('/v2/device/thing?'))
      return r({ thingList: [{ itemType: 1, itemData: { deviceid: 'g', name: '88', online: true, params: { switch: 'off' } } }] });
    if (url.endsWith('/v2/device/thing/status')) return r({});
    throw new Error('unexpected ' + url);
  };
  const e = new EWeLink(env, fakeFetch);
  await e.exchangeCode('CODE', 'as', 'https://x.dev/cb');
  assert.equal(await e.linked(), true);
  const devs = await e.listDevices();
  assert.equal(devs[0].id, 'g');
  await e.runAction('g', 'sw:on');
  assert.equal(calls.at(-1).url, 'https://as-apia.coolkit.cc/v2/device/thing/status');
  assert.deepEqual(JSON.parse(calls.at(-1).opts.body), { type: 1, id: 'g', params: { switch: 'on' } });
});
