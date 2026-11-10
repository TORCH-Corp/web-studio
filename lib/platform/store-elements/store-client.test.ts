import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { EMPTY_FORM } from './checkout-form';
import { fetchOrder, postCheckout, StoreRequestError } from './store-client';

const realFetch = globalThis.fetch;
const realError = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

const BODY = { checkout_id: '0b3f6f0e-2a53-4b8a-8f3a-6a0d5d1f5a11', buyer: { ...EMPTY_FORM }, lines: [{ item_id: 'x', quantity: '1' }], locale: 'en' as const };

function answer(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

function silenced(): string[] {
  const logged: string[] = [];
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  return logged;
}

test('the checkout is posted as JSON to the site\'s own route', async () => {
  const calls = answer(201, { data: { checkout_id: BODY.checkout_id, code: 'SO-2026-0142' } });
  const result = await postCheckout(BODY);
  assert.deepEqual(result, { kind: 'placed', checkout_id: BODY.checkout_id, code: 'SO-2026-0142' });
  assert.equal(calls[0].url, '/studio/api/store/checkout');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), BODY);
});

test('a checkout that already had its order (200) is placed too', async () => {
  answer(200, { data: { checkout_id: BODY.checkout_id, code: 'SO-2026-0142' } });
  assert.equal((await postCheckout(BODY)).kind, 'placed');
});

test('the field errors come back by their paths, in the page\'s language', async () => {
  answer(400, { error: 'Some fields need correcting', code: 'invalid_checkout', fields: { 'buyer.phone': 'Enter an Iraqi mobile number, such as 0770 123 4567 or +964 770 123 4567.' } });
  assert.deepEqual(await postCheckout(BODY), { kind: 'invalid', fields: { 'buyer.phone': 'Enter an Iraqi mobile number, such as 0770 123 4567 or +964 770 123 4567.' } });
});

test('the items the store no longer sells come back with their names', async () => {
  const items = [{ item_id: 'x', name: 'Linen shirt — Size: Small, Colour: White', reason: 'inactive' }];
  answer(422, { error: 'An item is no longer available', code: 'item_unavailable', items });
  assert.deepEqual(await postCheckout(BODY), { kind: 'item_unavailable', items });
});

test('a service that cannot be reached is the form\'s "try again" and is not logged as a surprise', async () => {
  const logged = silenced();
  answer(503, { error: 'The order cannot be placed right now', code: 'service_unavailable' });
  assert.deepEqual(await postCheckout(BODY), { kind: 'service_unavailable' });
  assert.deepEqual(logged, []);
});

test('a refusal the buyer cannot fix, an answer that is not ours and a lost connection are the same "try again", and are logged', async () => {
  for (const [status, body] of [[400, { code: 'invalid_body', error: 'Unknown field x' }], [403, { code: 'cross_origin' }], [500, { error: 'Failed' }], [502, '<html>bad gateway</html>']] as const) {
    const logged = silenced();
    answer(status, body);
    assert.deepEqual(await postCheckout(BODY), { kind: 'service_unavailable' }, String(status));
    assert.equal(logged.length, 1, `${status} is logged`);
  }
  const logged = silenced();
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  assert.deepEqual(await postCheckout(BODY), { kind: 'service_unavailable' });
  assert.equal(logged.length, 1);
});

test('the rate limit and a store that stopped selling are told apart', async () => {
  answer(429, { code: 'rate_limited' });
  assert.deepEqual(await postCheckout(BODY), { kind: 'rate_limited' });
  answer(404, { code: 'store_not_found' });
  assert.deepEqual(await postCheckout(BODY), { kind: 'not_selling' });
});

test('an aborted request is the caller\'s to hear, not a failed checkout', async () => {
  const controller = new AbortController();
  globalThis.fetch = (async () => {
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  }) as typeof fetch;
  await assert.rejects(postCheckout(BODY, controller.signal), /Abort/);
});

test('the order is read by its checkout id; an unknown one is not found; a store that does not sell says so', async () => {
  const order = { checkout_id: BODY.checkout_id, code: 'SO-2026-0142', currency: 'IQD', lines: [], subtotal: '0', delivery_fee: '0', total: '0', payment_method: 'cash_on_delivery', phone: null };
  const calls = answer(200, { data: order });
  assert.deepEqual(await fetchOrder(BODY.checkout_id), { kind: 'ok', order });
  assert.equal(calls[0].url, `/studio/api/store/orders/${BODY.checkout_id}`);
  answer(404, { code: 'order_not_found' });
  assert.deepEqual(await fetchOrder(BODY.checkout_id), { kind: 'not_found' });
  answer(404, { code: 'store_not_found' });
  assert.deepEqual(await fetchOrder(BODY.checkout_id), { kind: 'not_selling' });
});

test('an order that cannot be read is an error the element shows with a way to try again', async () => {
  answer(503, { code: 'service_unavailable' });
  await assert.rejects(fetchOrder(BODY.checkout_id), (error: unknown) => error instanceof StoreRequestError && error.status === 503);
});

test('a checkout id is escaped into the path', async () => {
  const calls = answer(404, { code: 'order_not_found' });
  await fetchOrder('a/b c');
  assert.equal(calls[0].url, '/studio/api/store/orders/a%2Fb%20c');
});
