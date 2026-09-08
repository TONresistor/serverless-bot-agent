import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../src/agent/loop.js';
import { contextMessages } from '../src/agent/context.js';
import { createRuntime } from '../src/composition/runtime.js';
import {
  BUILTIN_SCHEMAS as TOOL_SCHEMAS,
  createBuiltinRegistry,
} from '../src/composition/tools.js';
const validationRegistry = createBuiltinRegistry({
  memory: {},
  messenger: {},
  wallet: {},
  transfers: {},
});
const validateTool = (name, raw) => validationRegistry.get(name).prepare(raw);
import { fixture, message, context, call, completion } from './helpers.mjs';

test('runs multiple tools then returns the final answer with full transcript', async () => {
  const seen = [];
  let iteration = 0;
  const result = await runAgent({
    input: 'Remember and read',
    history: [],
    tools: TOOL_SCHEMAS,
    complete: async (messages) => {
      seen.push(structuredClone(messages));
      return iteration++ === 0
        ? completion(null, [
            call('memory_set', { key: 'name', value: 'Duck' }),
            call('memory_get', { key: 'name' }, 'call-2'),
          ])
        : completion('Duck');
    },
    execute: async () => ({ value: 'Duck' }),
    assertActive: async () => {},
  });
  assert.equal(result.text, 'Duck');
  assert.deepEqual(
    result.transcript.map((m) => m.role),
    ['user', 'assistant', 'tool', 'tool', 'assistant'],
  );
  assert.equal(seen[1].at(-1).tool_call_id, 'call-2');
});

test('intermediate Telegram messages do not suppress a distinct final answer', async () => {
  let iteration = 0;
  const result = await runAgent({
    input: 'Balance?',
    history: [],
    tools: TOOL_SCHEMAS,
    complete: async () =>
      iteration++ === 0
        ? completion(null, [call('telegram_send_message', { text: 'Je vérifie.' })])
        : completion('Ton solde est de 12 TON.'),
    execute: async () => ({ reply_delivered: true, sent_text: 'Je vérifie.' }),
    assertActive: async () => {},
  });
  assert.equal(result.delivered, false);
});

test('identical text already sent by a tool is not sent again', async () => {
  let iteration = 0;
  const result = await runAgent({
    input: 'Hello',
    history: [],
    tools: TOOL_SCHEMAS,
    complete: async () =>
      iteration++ === 0
        ? completion(null, [call('telegram_send_message', { text: 'Bonjour' })])
        : completion('Bonjour'),
    execute: async () => ({ reply_delivered: true, sent_text: 'Bonjour' }),
    assertActive: async () => {},
  });
  assert.equal(result.delivered, true);
});

test('bounds tool iterations and rejects duplicate call ids', async () => {
  let invocations = 0;
  const result = await runAgent({
    input: 'Loop',
    history: [],
    tools: TOOL_SCHEMAS,
    complete: async () => completion(null, [call('memory_get', { key: 'x' })]),
    execute: async () => {
      invocations++;
      return {};
    },
    assertActive: async () => {},
  });
  assert.equal(invocations, 3);
  assert.ok(result.usages.length <= 12);
  assert.equal(result.reason, 'no_progress');
  await assert.rejects(
    runAgent({
      input: 'bad',
      history: [],
      tools: [],
      complete: async () => completion(null, [call('x', {}), call('x', {})]),
      execute: async () => {},
      assertActive: async () => {},
    }),
    /invalid action/,
  );
});

test('trims history by complete turns, preserving tool pairs', () => {
  const history = Array.from({ length: 20 }, (_, id) => ({
    id,
    messages: [
      { role: 'user', content: 'x'.repeat(8000) },
      {
        role: 'assistant',
        content: null,
        tool_calls: [call('memory_get', { key: 'x' }, `call-${id}`)],
      },
      { role: 'tool', tool_call_id: `call-${id}`, content: '{}' },
      { role: 'assistant', content: 'done' },
    ],
  }));
  const messages = contextMessages(history, 'now', TOOL_SCHEMAS);
  assert.ok(messages.length < 82);
  for (const m of messages.filter((m) => m.role === 'tool'))
    assert.ok(messages.some((a) => a.tool_calls?.some((c) => c.id === m.tool_call_id)));
});

test('strict tool inputs reject unknown tools, privileged args and secret values', () => {
  assert.throws(() => validateTool('read_secrets', '{}'), /Unknown/);
  assert.throws(
    () => validateTool('telegram_send_message', '{"text":"x","business_connection_id":"injected"}'),
    /not allowed/,
  );
  assert.throws(
    () => validateTool('memory_set', '{"key":"api","value":"sk-or-test-secret"}'),
    /secret/,
  );
  assert.throws(() => validateTool('memory_search', '{"query":"x","limit":1000}'), /bounds/);
});

test('real SQLite: owner checks, duplicate update, memory persistence and reset', async () => {
  const f = await fixture();
  let calls = 0;
  const app = createRuntime({
    ...f,
    fetcher: async () => {
      throw new Error('unexpected network');
    },
    chainFactory: () => f.ton,
    modelFactory: () => async () =>
      calls++ === 0
        ? completion(null, [
            call('memory_set', { key: 'name', value: 'Duck' }),
            call('memory_get', { key: 'name' }, 'call-2'),
          ])
        : completion('Saved Duck'),
  });
  assert.deepEqual(await app.onMessage(message('hello', 1, 123), context(1)), { ignored: true });
  await app.onMessage(message('Remember Duck'), context(2));
  await app.onMessage(message('Remember Duck'), context(2));
  assert.equal(calls, 2);
  assert.equal(f.sent.length, 1);
  assert.equal((await f.store.getNote('name')).value, 'Duck');
  assert.equal((await f.store.history('42')).length, 1);
  await app.onMessage(message('/reset'), context(3));
  assert.deepEqual(await f.store.history('42'), []);
  assert.equal((await f.store.getNote('name')).value, 'Duck');
  f.database.close();
});

test('concurrent conversation gets an explicit busy notice, not a second LLM call', async () => {
  const f = await fixture();
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const block = new Promise((resolve) => {
    release = resolve;
  });
  const app = createRuntime({
    ...f,
    fetcher: async () => {},
    chainFactory: () => f.ton,
    modelFactory: () => async () => {
      started();
      await block;
      return completion('Done');
    },
  });
  const first = app.onMessage(message('one'), context(1));
  await ready;
  assert.deepEqual(await app.onMessage(message('two'), context(2)), { busy: true });
  release();
  await first;
  assert.equal((await f.store.history('42')).length, 1);
  assert.ok(f.sent.some((m) => m.text.includes('already in progress')));
  f.database.close();
});

test('an expired session cannot write history or facts after a new owner acquired it', async () => {
  const f = await fixture();
  assert.equal(await f.store.acquireChat('42', 'old'), true);
  f.setTime(f.now() + 181_000);
  assert.equal(await f.store.acquireChat('42', 'new'), true);
  await assert.rejects(f.store.saveHistory('42', 'old', []), /expired/);
  await assert.rejects(f.store.setNote('42', 'old', 'a', 'b', []), /expired/);
  await f.store.releaseChat('42', 'old');
  await f.store.assertChat('42', 'new');
  f.database.close();
});
