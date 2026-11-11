import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { retryTickSeconds, startFormLinkRetry } from './form-link-retry';

test('the tick is the environment\'s whole number of seconds from 1 to 3600, and 30 otherwise', () => {
  assert.equal(retryTickSeconds({}), 30);
  assert.equal(retryTickSeconds({ WS_FORM_RETRY_TICK_SECONDS: '5' }), 5);
  assert.equal(retryTickSeconds({ WS_FORM_RETRY_TICK_SECONDS: '3600' }), 3600);
  for (const bad of ['0', '3601', '1.5', 'soon', '']) assert.equal(retryTickSeconds({ WS_FORM_RETRY_TICK_SECONDS: bad }), 30, bad);
});

/** Let the awaits of a timer's callback finish (the clock is mocked, the microtask queue is not). */
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

test('the retry says once that it started and how often it looks, then asks every tick and reports what it set', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const info = mock.method(console, 'info', () => {});
  const error = mock.method(console, 'error', () => {});
  const runs: Array<{ taken: number; set: number }> = [{ taken: 0, set: 0 }, { taken: 3, set: 2 }];
  let asked = 0;
  const stop = startFormLinkRetry(async () => runs[asked++] ?? { taken: 0, set: 0 });
  try {
    assert.deepEqual(info.mock.calls.map((call) => call.arguments[0]), ['[form link] retry started: waiting submissions are looked at every 30 seconds']);

    // A second start while one is going does nothing: one timer, one start line.
    startFormLinkRetry(async () => ({ taken: 9, set: 9 }))();
    assert.equal(info.mock.callCount(), 1);

    mock.timers.tick(30_000);
    await settle();
    assert.equal(asked, 1);
    assert.equal(info.mock.callCount(), 1, 'a tick that finds nothing waiting says nothing');

    mock.timers.tick(30_000);
    await settle();
    assert.equal(asked, 2);
    assert.equal(info.mock.calls[1].arguments[0], '[form link] retry: 2 of 3 waiting submissions reached Contact Center');
    assert.equal(error.mock.callCount(), 0);

    stop();
    mock.timers.tick(120_000);
    await settle();
    assert.equal(asked, 2, 'a stopped retry asks no more');
  } finally {
    stop();
    mock.restoreAll();
    mock.timers.reset();
  }
});

test('a run that fails is logged and the next tick asks again', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  mock.method(console, 'info', () => {});
  const error = mock.method(console, 'error', () => {});
  let asked = 0;
  const stop = startFormLinkRetry(async () => {
    asked += 1;
    if (asked === 1) throw new Error('the database is down');
    return { taken: 1, set: 1 };
  });
  try {
    mock.timers.tick(30_000);
    await settle();
    assert.equal(error.mock.callCount(), 1);
    mock.timers.tick(30_000);
    await settle();
    assert.equal(asked, 2);
    assert.equal(error.mock.callCount(), 1);
  } finally {
    stop();
    mock.restoreAll();
    mock.timers.reset();
  }
});
