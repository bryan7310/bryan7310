import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { tuyaSign, canonicalPath, tuyaActions, parseTuyaAction, tuyaStatusText, Tuya } from '../src/tuya.js';
import { memKV } from './memkv.js';

test('簽名與 Tuya 官方 Node.js SDK 的算法一致', async () => {
  // 官方 SDK（@tuya/tuya-connector-nodejs 2.1.2 client.js）：
  // stringToSign = [method, sha256(body), '', url].join('\n')
  // signStr = accessKey + accessToken + t + stringToSign，HMAC-SHA256 後轉大寫
  const sts = ['GET', createHash('sha256').update('').digest('hex'), '', '/v1.0/token?grant_type=1'].join('\n');
  const expect = createHmac('sha256', 'SECRET').update('CID' + '' + '1588925778000' + sts).digest('hex').toUpperCase();
  const sign = await tuyaSign({ clientId: 'CID', secret: 'SECRET', method: 'GET', path: '/v1.0/token?grant_type=1', t: '1588925778000' });
  assert.equal(sign, expect);
});

test('有 token 與 body 的簽名與 node:crypto 計算一致', async () => {
  const body = '{"commands":[{"code":"control","value":"open"}]}';
  const p = '/v1.0/iot-03/devices/abc/commands';
  const sts = ['POST', createHash('sha256').update(body).digest('hex'), '', p].join('\n');
  const expect = createHmac('sha256', 'sec').update('cid' + 'tok' + '1' + 'n' + sts).digest('hex').toUpperCase();
  assert.equal(await tuyaSign({ clientId: 'cid', secret: 'sec', accessToken: 'tok', method: 'POST', path: p, body, t: '1', nonce: 'n' }), expect);
});

test('query 依 key 排序', () => {
  assert.equal(canonicalPath('/a?size=1&b=2'), '/a?b=2&size=1');
  assert.equal(canonicalPath('/a'), '/a');
});

test('窗簾/捲門功能轉成 開停關 按鈕', () => {
  const acts = tuyaActions([
    { code: 'control', type: 'Enum', values: '{"range":["close","stop","open"]}' },
    { code: 'percent_control', type: 'Integer', values: '{}' },
  ]);
  assert.deepEqual(acts.map((a) => a.label), ['開', '停', '關']);
  assert.deepEqual(acts.map((a) => a.id), ['control:open', 'control:stop', 'control:close']);
});

test('開關功能轉成 開/關', () => {
  const acts = tuyaActions([{ code: 'switch_1', type: 'Boolean', values: '{}' }]);
  assert.deepEqual(acts.map((a) => a.id), ['switch_1:true', 'switch_1:false']);
});

test('動作解析會擋掉不支援的指令', () => {
  assert.deepEqual(parseTuyaAction('control:open'), { code: 'control', value: 'open' });
  assert.deepEqual(parseTuyaAction('switch_1:false'), { code: 'switch_1', value: false });
  assert.throws(() => parseTuyaAction('child_lock:true'));
  assert.throws(() => parseTuyaAction('control:true'));
  assert.throws(() => parseTuyaAction('switch:open'));
  assert.throws(() => parseTuyaAction(undefined));
});

test('狀態文字', () => {
  assert.equal(tuyaStatusText([{ code: 'percent_state', value: 50 }]), '開啟 50%');
  assert.equal(tuyaStatusText([{ code: 'switch_1', value: true }]), '開');
});

test('列出裝置並送出開門指令（模擬 Tuya 伺服器）', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname + u.search, opts });
    const ok = (result) => ({ json: async () => ({ success: true, result }) });
    if (u.pathname === '/v1.0/token') return ok({ access_token: 'AT', expire_time: 7200 });
    assert.equal(opts.headers.access_token, 'AT');
    if (u.pathname === '/v1.0/iot-01/associated-users/devices')
      return ok({ devices: [{ id: 'd1', name: 'home89', online: true, category: 'cl' }] });
    if (u.pathname.endsWith('/functions'))
      return ok({ functions: [{ code: 'control', type: 'Enum', values: '{"range":["open","stop","close"]}' }] });
    if (u.pathname.endsWith('/status')) return ok([{ code: 'percent_state', value: 0 }]);
    if (u.pathname.endsWith('/commands')) return ok(true);
    throw new Error('unexpected ' + url);
  };
  const env = { TUYA_CLIENT_ID: 'c', TUYA_SECRET: 's', DOOR_KV: memKV(), TUYA_ENDPOINT: 'https://openapi.tuyaus.com' };
  const t = new Tuya(env, fakeFetch);
  const devs = await t.listDevices();
  assert.equal(devs[0].name, 'home89');
  assert.equal(devs[0].actions.length, 3);
  await t.runAction('d1', 'control:open');
  const last = calls.at(-1);
  assert.equal(last.path, '/v1.0/iot-03/devices/d1/commands');
  assert.deepEqual(JSON.parse(last.opts.body), { commands: [{ code: 'control', value: 'open' }] });
  // token 只拿一次（有快取）
  assert.equal(calls.filter((c) => c.path.startsWith('/v1.0/token')).length, 1);
});
