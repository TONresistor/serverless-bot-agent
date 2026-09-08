import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, config, message, context, completion, call } from './helpers.mjs';
import { createRuntime } from '../src/composition/runtime.js';
import { createTelegramAdapter } from '../src/adapters/telegram.js';
import { createDelivery } from '../src/application/delivery.js';
import { createTelegramMessages } from '../src/application/telegram/messages.js';
import { createStarPayments } from '../src/application/telegram/payments.js';
import { createTelegramOperations } from '../src/application/telegram/operations.js';
import { validateTelegramParameters } from '../src/domain/telegram/parameters.js';
import { TELEGRAM_METHODS } from '../src/shared/telegram-methods.js';

function messaging(f) {
  const telegram = createTelegramAdapter(f.api);
  const deliver = createDelivery({ operations: f.repositories.operations, telegram, log() {} });
  return createTelegramMessages({
    operations: f.repositories.operations,
    deliver,
    ownerId: 42,
    now: f.now,
  });
}

test('all curated families reject arbitrary methods, extra fields and injected business identity', () => {
  assert.deepEqual(
    Object.values(TELEGRAM_METHODS).map((family) => Object.keys(family).length),
    [12, 40, 8],
  );
  for (const family of ['admin', 'business', 'gifts']) {
    assert.throws(() => validateTelegramParameters(family, 'getUpdates', {}));
    assert.throws(() => validateTelegramParameters(family, 'constructor', {}));
  }
  assert.throws(() => validateTelegramParameters('admin', 'banChatMember', { chat_id: 42 }));
  assert.throws(() =>
    validateTelegramParameters('admin', 'getChat', {
      chat_id: 42,
      business_connection_id: 'other',
    }),
  );
  assert.throws(() => validateTelegramParameters('gifts', 'getMyStarBalance', { token: 'secret' }));
  assert.throws(() =>
    validateTelegramParameters('admin', 'banChatMember', { chat_id: 42, user_id: 'wrong' }),
  );
  assert.deepEqual(validateTelegramParameters('admin', 'getChat', { chat_id: '-10042' }), {
    chat_id: '-10042',
  });
});

test('business capability binds owner identity and rechecks revocation on each operation', async () => {
  const calls = [];
  let current = { id: 'owned', is_enabled: true, user: { id: 42 } };
  const caps = createTelegramOperations({
    ownerId: 42,
    connections: { get: async () => ({ id: 'owned' }) },
    telegram: {
      async call(method, params) {
        calls.push({ method, params });
        return method === 'getBusinessConnection' ? current : true;
      },
    },
  });
  await caps.business.call('setBusinessAccountBio', { bio: 'Hello' });
  assert.deepEqual(calls.at(-1).params, { bio: 'Hello', business_connection_id: 'owned' });
  current = { ...current, is_enabled: false };
  await assert.rejects(caps.business.call('setBusinessAccountBio', { bio: 'No' }));
  current = { ...current, is_enabled: true, user: { id: 99 } };
  await assert.rejects(caps.business.call('setBusinessAccountBio', { bio: 'No' }));
  assert.equal(calls.filter((c) => c.method === 'setBusinessAccountBio').length, 1);
});

test('buttons share a rich message, escape labels and consume only the bound owner/message once', async () => {
  const f = await fixture(),
    messages = messaging(f);
  await messages.send(
    'Choose',
    { operationId: 'buttons' },
    {
      rich_buttons: [
        { type: 'url', label: '<Open>', value: 'https://example.com?a=1&b=2' },
        { type: 'copy', label: 'Copy', value: 'a"b' },
        { type: 'callback', label: 'Continue', value: 'Continue research' },
        { type: 'disabled', label: 'Soon' },
      ],
    },
  );
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].rich_message.markdown, /&lt;Open&gt;/);
  assert.match(f.sent[0].rich_message.markdown, /type="copy_text" text="a&quot;b"/);
  const id = /data="(button:[a-f0-9]+)"/.exec(f.sent[0].rich_message.markdown)[1];
  const cb = { data: id, actor: { id: 42 }, chat: { id: 42 }, messageId: 1 };
  assert.equal(await messages.consume({ ...cb, actor: { id: 99 } }), null);
  assert.equal(await messages.consume({ ...cb, messageId: 2 }), null);
  assert.equal((await messages.consume(cb)).value, 'Continue research');
  assert.equal(await messages.consume(cb), null);
  await messages.send(
    'Expire',
    { operationId: 'expired' },
    { rich_buttons: [{ type: 'callback', label: 'Go', value: 'Go' }] },
  );
  const expired = /data="(button:[a-f0-9]+)"/.exec(f.sent[1].rich_message.markdown)[1];
  f.setTime(f.now() + 86400001);
  assert.equal(await messages.consume({ ...cb, data: expired, messageId: 2 }), null);
});

test('invoice ledger checks payer, amount, expiry and duplicate checkout/payment without spending Stars', async () => {
  const f = await fixture(),
    calls = [];
  const payments = createStarPayments({
    ownerId: 42,
    now: f.now,
    operations: f.repositories.operations,
    telegram: {
      async call(method, params) {
        calls.push({ method, params });
        return { message_id: 7 };
      },
    },
  });
  const result = await payments.request(
    { amount: 10, description: 'Test invoice' },
    { operationId: 'invoice' },
  );
  assert.equal(calls[0].params.currency, 'XTR');
  assert.equal(calls[0].params.provider_token, '');
  const q = {
    id: 'checkout',
    invoice_payload: result.invoice_id,
    from: { id: 42 },
    currency: 'XTR',
    total_amount: 10,
  };
  assert.equal((await payments.preCheckout({ ...q, total_amount: 11 })).accepted, false);
  assert.equal((await payments.preCheckout({ ...q, from: { id: 99 } })).accepted, false);
  assert.deepEqual(
    await Promise.all([payments.preCheckout(q), payments.preCheckout(q)]).then((results) =>
      results.map((r) => r.accepted),
    ),
    [true, true],
  );
  assert.equal((await payments.preCheckout(q)).accepted, true);
  assert.equal((await payments.preCheckout({ ...q, id: 'second-payment' })).accepted, false);
  const event = {
    chat: { id: 42 },
    successful_payment: { ...q, telegram_payment_charge_id: 'charge' },
  };
  assert.equal((await payments.successful(event)).paid, true);
  assert.equal((await payments.successful(event)).duplicate, true);
  assert.equal((await payments.preCheckout(q)).accepted, false);
  await assert.rejects(
    payments.request({ amount: 10, description: 'Test' }, { operationId: 'invoice' }),
  );
});

test('owner loop exposes Telegram families; foreign users cannot invoke them; direct callbacks use the executor', async () => {
  const f = await fixture();
  let inference = 0;
  f.api.getMyStarBalance = async () => ({ amount: 0 });
  const runtime = createRuntime({
    db: f.db,
    api: f.api,
    now: f.now,
    fetcher: async () => {},
    chainFactory: () => f.ton,
    modelFactory: () => async (_messages, schemas) => {
      inference++;
      assert.equal(schemas.length, 10);
      return inference === 1
        ? completion(null, [call('telegram_gifts', { method: 'getMyStarBalance', params: {} })])
        : completion('Zero Stars.');
    },
  });
  assert.equal((await runtime.onMessage(message('Stars?', 1, 99), context(1))).ignored, true);
  assert.equal(inference, 0);
  assert.equal((await runtime.onMessage(message('Stars?'), context(2))).completed, true);
  const messages = messaging(f);
  await messages.send(
    'é'.repeat(8500),
    { operationId: 'direct' },
    {
      rich_buttons: [
        {
          type: 'callback',
          label: 'Refresh',
          value: 'Refresh',
          execute: { tool: 'telegram_gifts', args: { method: 'getMyStarBalance', params: {} } },
        },
      ],
    },
  );
  const id = /data="(button:[a-f0-9]+)"/.exec(f.sent.at(-1).rich_message.markdown)[1];
  const cb = {
    id: 'cb',
    data: id,
    from: { id: config.ownerId },
    message: { message_id: f.sent.length, chat: { id: 42, type: 'private' } },
  };
  assert.equal((await runtime.onCallback(cb, context(3))).direct_tool, 'telegram_gifts');
  assert.equal(inference, 2);
  assert.equal((await runtime.onCallback(cb, context(4))).ignored, true);
});

test('Telegram 5xx stays uncertain and busy owner turns leave buttons reusable', async () => {
  const caps = createTelegramOperations({
    ownerId: 42,
    connections: {},
    telegram: {
      async call() {
        throw { code: 500 };
      },
    },
  });
  await assert.rejects(
    caps.gifts.call('getMyStarBalance', {}),
    (e) => e.code === 'telegram_unknown',
  );
  const f = await fixture(),
    messages = messaging(f);
  await messages.send(
    'Choose',
    { operationId: 'busy-button' },
    { rich_buttons: [{ type: 'callback', label: 'Go', value: 'Continue' }] },
  );
  const id = /data="(button:[a-f0-9]+)"/.exec(f.sent[0].rich_message.markdown)[1];
  const runtime = createRuntime({
    db: f.db,
    api: f.api,
    now: f.now,
    fetcher: async () => {},
    chainFactory: () => f.ton,
  });
  await f.store.acquireChat('42', 'other');
  const cb = {
    id: 'cb',
    data: id,
    from: { id: 42 },
    message: { message_id: 1, chat: { id: 42, type: 'private' } },
  };
  assert.equal((await runtime.onCallback(cb, context(80))).busy, true);
  assert.equal((await f.store.operation(id)).state, 'pending');
  assert.equal((await runtime.onCallback(cb, context(80))).duplicate, true);
  assert.equal((await f.store.operation(id)).state, 'pending');
});
