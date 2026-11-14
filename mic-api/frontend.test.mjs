import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../mic/survey.js', import.meta.url), 'utf8');
const fields = { name: 'Example Visitor', phone: '+961 71 123 456', email: 'visitor@example.com', interest: 'Travel', website: '' };
function setup(fetch) {
  const button = { disabled: false, textContent: '' };
  const status = { dataset: {}, textContent: '' };
  const form = {
    querySelector: () => button,
    addEventListener: (_, handler) => { form.submit = handler; },
    reportValidity: () => true,
    setAttribute() {}, removeAttribute() {},
    reset: () => { form.resets++; }, resets: 0
  };
  vm.runInNewContext(source, {
    document: { getElementById: id => id === 'interest-form' ? form : status },
    FormData: class { *[Symbol.iterator]() { yield* Object.entries(fields); } },
    fetch, AbortSignal, TypeError
  });
  return { form, status, button };
}

test('success submits all four fields in the body and resets only after acceptance', async () => {
  const ui = setup(async (url, options) => {
    assert.equal(url, 'https://mic-survey.slack-90.workers.dev/submit');
    assert.deepEqual(JSON.parse(options.body), fields);
    assert.equal(options.method, 'POST');
    assert.equal(ui.form.resets, 0);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  await ui.form.submit({ preventDefault() {} });
  assert.equal(ui.form.resets, 1);
  assert.equal(ui.status.dataset.state, 'success');
  assert.equal(ui.button.disabled, false);
});

test('failed email delivery keeps fields and shows a retry error', async () => {
  const ui = setup(async () => ({ ok: false, json: async () => ({ error: 'Please try again.' }) }));
  await ui.form.submit({ preventDefault() {} });
  assert.equal(ui.form.resets, 0);
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.status.textContent, 'Please try again.');
  assert.equal(ui.button.disabled, false);
});

test('double submit cannot send a second request while delivery is pending', async () => {
  let resolve;
  let sent = 0;
  const ui = setup(() => { sent++; return new Promise(done => { resolve = done; }); });
  const first = ui.form.submit({ preventDefault() {} });
  await ui.form.submit({ preventDefault() {} });
  assert.equal(sent, 1);
  assert.equal(ui.button.disabled, true);
  resolve({ ok: true, json: async () => ({ ok: true }) });
  await first;
  assert.equal(ui.button.disabled, false);
});
