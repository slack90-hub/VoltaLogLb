import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './handler.mjs';

const valid = { name: 'Test Visitor', phone: '+961 71 123 456', email: 'visitor@example.com', interest: 'Health & family', website: '' };
const environment = () => ({
  DELIVERY_ADDRESS: 'fixed@example.com',
  SUBMISSIONS_PER_IP: { limit: async () => ({ success: true }) },
  SUBMISSIONS_TOTAL: { limit: async () => ({ success: true }) }
});
const request = (data = valid, origin = 'https://mdslb.com') => new Request('https://example.com/submit', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify(data)
});

test('sends all fields, supports Unicode, and sets visitor Reply-To', async () => {
  let message;
  const response = await handleRequest(request({ ...valid, name: 'نادَر', interest: 'تأمين سفر' }), environment(), async raw => { message = raw; });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(message, /To: Murex Insurance Consultancy <mic@mdslb.com>/);
  assert.match(message, /Reply-To: visitor@example.com\r\n/);
  const body = Buffer.from(message.split('\r\n\r\n')[1].replace(/\s/g, ''), 'base64').toString('utf8');
  for (const part of ['نادَر', valid.phone, valid.email, 'تأمين سفر']) assert.ok(body.includes(part));
});

test('rejects missing fields, header injection, invalid phone, honeypot and oversized bodies without sending', async () => {
  for (const bad of [
    { ...valid, name: ' ' }, { ...valid, email: 'a@example.com\r\nBcc: victim@example.com' },
    { ...valid, phone: 'invalid' }, { ...valid, interest: '' }, { ...valid, website: 'spam' },
    { ...valid, interest: 'x'.repeat(9000) }, { ...valid, name: 'a\nInjected' }, null
  ]) {
    const response = await handleRequest(request(bad), environment(), () => assert.fail('Must not send'));
    assert.equal(response.status, 400);
  }
});

test('only allows production origins and preflight', async () => {
  const denied = await handleRequest(request(valid, 'https://example.org'), environment(), () => assert.fail('Must not send'));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  const response = await handleRequest(new Request('https://example.com/submit', { method: 'OPTIONS', headers: { Origin: 'https://www.mdslb.com' } }), environment());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://www.mdslb.com');
});

test('email provider failure returns an error without leaking provider contents', async () => {
  const response = await handleRequest(request(), environment(), async () => { throw new Error('private provider details'); });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('private provider details'));
});

test('rate limits stop emails and missing setup fails closed', async () => {
  for (const key of ['SUBMISSIONS_PER_IP', 'SUBMISSIONS_TOTAL']) {
    const env = environment();
    env[key].limit = async () => ({ success: false });
    const response = await handleRequest(request(), env, () => assert.fail('Must not send'));
    assert.equal(response.status, 429);
  }
  const response = await handleRequest(request(), {}, () => assert.fail('Must not send'));
  assert.equal(response.status, 503);
});
