import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, message, context, call, completion } from './helpers.mjs';
import { createRuntime } from '../src/composition/runtime.js';
import { createBuiltinRegistry } from '../src/composition/tools.js';
import { permittedRegistry } from '../src/tools/permissions.js';
import { createDiscovery } from '../src/tools/discovery/index.js';
import { createCatalog } from '../src/tools/catalog.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/define.js';
import { defineSchema, string } from '../src/tools/schema.js';
import { createToolExecutor } from '../src/tools/executor.js';
import { DEFAULT_SETTINGS, resolveSettings } from '../src/agent/settings.js';
import { runAgent } from '../src/agent/loop.js';
import { createContextManager } from '../src/agent/context.js';
import { recoverTurns } from '../src/application/turn-recovery.js';
import { SYSTEM_PROMPT } from '../src/agent/prompt.js';

const runtime = (f, model) =>
  createRuntime({
    ...f,
    fetcher: async () => {
      throw new Error('unexpected HTTP');
    },
    chainFactory: () => f.ton,
    modelFactory: () => model,
  });
const ports = () => ({
  memory: {},
  messenger: {},
  wallet: { identity: () => ({ address: 'public' }), balance: async () => ({ balance: '1' }) },
  transfers: { prepare: async () => ({ prepared: true }) },
});

test('settings are granular, scoped, revision-checked and applied on the next turn', async () => {
  const f = await fixture(),
    app = runtime(f, async () => completion('OK'));
  const initial = await app.getAgentSettings();
  assert.equal(initial.defaults.maxModelCalls, 12);
  const next = await app.updateAgentSettings({
    expectedRevision: 0,
    defaults: { maxModelCalls: 4 },
    overrides: { group: { maxParallelReads: 2 } },
  });
  assert.equal(next.effective.dm.maxModelCalls, 4);
  assert.equal(next.effective.group.maxParallelReads, 2);
  await assert.rejects(
    app.updateAgentSettings({ expectedRevision: 0, defaults: { maxModelCalls: 5 } }),
    /current/,
  );
  await assert.rejects(
    app.updateAgentSettings({ expectedRevision: 1, defaults: { unknown: true } }),
    /Invalid/,
  );
  await assert.rejects(
    app.updateAgentSettings({ expectedRevision: 1, defaults: { maxDurationMs: 5000 } }),
    /Invalid/,
  );
  await app.onMessage(message('Hi'), context(1001));
  assert.equal((await f.repositories.turns.get('update:1001')).settings.values.maxModelCalls, 4);
  assert.equal(
    resolveSettings({}, 'dm', { contextWindowTokens: 16000, maxOutputTokens: 1024 })
      .activeContextTokens,
    16000,
  );
  assert.ok(SYSTEM_PROMPT.split(/\s+/).length < 160);
});

test('Telegram/memory remain direct; TON search dispatches through the same journal and permissions', async () => {
  const f = await fixture(),
    registry = createBuiltinRegistry(ports()),
    discovery = createDiscovery(registry, DEFAULT_SETTINGS);
  assert.ok(discovery.schemas.some((s) => s.function.name === 'memory_get'));
  assert.ok(discovery.schemas.some((s) => s.function.name === 'telegram_admin'));
  assert.ok(!discovery.schemas.some((s) => s.function.name === 'ton_get_address'));
  const execute = createToolExecutor({
    registry,
    resolve: discovery.resolve,
    journal: f.repositories.operations,
    token: 'test',
    assertActive: async () => {},
  });
  const found = await execute('tool_search', '{"query":"wallet address"}', 'search');
  assert.ok(found.matches.some((m) => m.name === 'ton_get_address'));
  const result = await execute('tool_call', '{"name":"ton_get_address","arguments":{}}', 'call');
  assert.equal(result.address, 'public');
  const prepared = execute.prepare(
    'tool_call',
    '{"name":"ton_get_address","arguments":{}}',
    'call',
  );
  assert.equal((await f.store.operation(prepared.operationId)).data.name, 'ton_get_address');
  assert.deepEqual(await execute('ton_get_address', '{}', 'call'), result);
  const publicRegistry = permittedRegistry(registry, { group: true, owner: false });
  const publicDiscovery = createDiscovery(publicRegistry, DEFAULT_SETTINGS);
  assert.deepEqual(
    publicDiscovery.schemas.map((s) => s.function.name),
    ['memory_get', 'memory_search', 'telegram_send_message', 'tool_search', 'tool_call'],
  );
  const denied = createToolExecutor({
    registry: publicRegistry,
    resolve: publicDiscovery.resolve,
    journal: f.repositories.operations,
    token: 'public',
    assertActive: async () => {},
  });
  assert.equal(
    (await denied('tool_call', '{"name":"ton_send","arguments":{}}', 'bad')).error,
    'unknown_tool',
  );
  const description = await execute(
    'tool_search',
    '{"query":"telegram_chat_automation.getBusinessConnection"}',
    'method-contract',
  );
  assert.deepEqual(description.matches[0].parameters, {});
  assert.ok(!discovery.schemas.some((s) => s.function.name === 'tool_describe'));
  assert.equal(
    (await execute('tool_describe', '{"name":"ton_get_address"}', 'removed')).error,
    'unknown_tool',
  );
  assert.equal(
    (await execute('tool_call', '{"name":"tool_call","arguments":{}}', 'recursive')).error,
    'unknown_tool',
  );
});

test('catalog search is bounded and deterministic for 50, 200 and 500 tools', () => {
  for (const count of [50, 200, 500]) {
    const tools = Array.from({ length: count }, (_, i) =>
      defineTool({
        schema: defineSchema({
          name: `inventory_${i}`,
          description: `Read inventory for widget${i}.`,
          properties: { query: string('Query', 40) },
          required: [],
        }),
        effect: 'read',
        metadata: { family: 'inventory', exposure: 'search', keywords: [`widget${i}`] },
        execute: () => ({ ok: true }),
      }),
    );
    const a = createCatalog(createToolRegistry(tools), DEFAULT_SETTINGS),
      b = createCatalog(createToolRegistry([...tools].reverse()), DEFAULT_SETTINGS);
    assert.equal(a.listing(), b.listing());
    assert.equal(a.search(`widget${count - 1}`).matches[0].name, `inventory_${count - 1}`);
    assert.ok(a.search('inventory', 50).matches.length <= 10);
    assert.ok(a.listing().length <= DEFAULT_SETTINGS.catalogListingMaxTokens * 3);
    assert.deepEqual(a.search('nonexistentcapability').available_families, ['inventory']);
  }
});

test('read-write-read works; completed duplicate writes are not executed twice', async () => {
  const f = await fixture();
  let round = 0;
  const app = runtime(f, async (messages) => {
    round++;
    if (round === 1) return completion(null, [call('memory_get', { key: 'value' }, 'read')]);
    if (round === 2)
      return completion(null, [call('memory_set', { key: 'value', value: 'updated' }, 'write')]);
    if (round === 3) return completion(null, [call('memory_get', { key: 'value' }, 'read-again')]);
    assert.equal(JSON.parse(messages.at(-1).content).note.value, 'updated');
    return completion('Verified');
  });
  assert.equal(
    (await app.onMessage(message('Read, change, verify'), context(1002))).completed,
    true,
  );
  let sent = 0;
  const tool = defineTool({
    schema: defineSchema({ name: 'send', description: 'Send', properties: {}, required: [] }),
    effect: 'external_write',
    execute: () => {
      sent++;
      return { sent: true };
    },
  });
  const registry = createToolRegistry([tool]),
    execute = createToolExecutor({
      registry,
      journal: f.repositories.operations,
      token: 'writes',
      assertActive: async () => {},
    });
  const outcome = await runAgent({
    input: 'test',
    history: [],
    tools: registry.schemas,
    execute,
    assertActive: async () => {},
    complete: async (_m, t) =>
      t.length ? completion(null, [call('send', {})]) : completion('Already sent'),
  });
  assert.equal(sent, 1);
  assert.equal(outcome.reason, 'no_progress');
});

test('tool checkpoints precede effects and survive subsequent model failures', async () => {
  const f = await fixture();
  let round = 0;
  const app = runtime(f, async () => {
    if (!round++) return completion(null, [call('memory_set', { key: 'survives', value: 'yes' })]);
    throw new Error('provider offline');
  });
  const outcome = await app.onMessage(message('Remember this'), context(1003));
  assert.equal(outcome.status, 'failed');
  assert.equal((await f.store.getNote('survives')).value, 'yes');
  const row = await f.repositories.turns.get('update:1003');
  assert.equal(row.status, 'failed');
  assert.ok(
    row.checkpoint.transcript.some((m) => m.role === 'tool' && JSON.parse(m.content).saved),
  );
  assert.ok(
    (await f.store.history('42'))[0].messages
      .at(-1)
      .content.includes('Runtime turn outcome: failed'),
  );
});

test('orphan recovery uses journal results, never effects; history failure leaves recovery pending', async () => {
  const f = await fixture(),
    turns = f.repositories.turns;
  await f.store.acquireChat('42', 'old');
  await turns.start('old', '42', 42, {}, 'old');
  const toolCall = call('memory_set', { key: 'x', value: 'v' }, 'wire');
  await turns.checkpoint('old', '42', 'old', {
    transcript: [
      { role: 'user', content: 'Save x' },
      { role: 'assistant', content: null, tool_calls: [toolCall] },
    ],
    pending: [{ callId: 'wire', operationId: 'operation' }],
  });
  await f.store.claim('operation', 'tool', 'succeeded', {
    name: 'memory_set',
    result: { saved: true, key: 'x' },
  });
  f.setTime(f.now() + 181000);
  await f.store.acquireChat('42', 'new');
  await assert.rejects(
    recoverTurns({
      turns,
      operations: f.repositories.operations,
      conversations: {
        ...f.repositories.conversations,
        saveHistory: async () => {
          throw new Error('disk');
        },
      },
      sessionId: '42',
      token: 'new',
      maxBytes: 8192,
    }),
  );
  assert.equal((await turns.get('old')).status, 'running');
  const history = await recoverTurns({
    turns,
    operations: f.repositories.operations,
    conversations: f.repositories.conversations,
    sessionId: '42',
    token: 'new',
    maxBytes: 8192,
  });
  assert.equal(JSON.parse(history[0].messages.find((m) => m.role === 'tool').content).saved, true);
  assert.equal((await turns.get('old')).status, 'partial');
  assert.equal(f.broadcasts.length, 0);
});

test('compaction handles two large recent turns; failure preserves the previous summary and source', async () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    activeContextTokens: 4096,
    maxOutputTokens: 512,
    summaryMaxTokens: 128,
  };
  const history = [1, 2].map((id) => ({
    id: `t${id}`,
    messages: [
      { role: 'user', content: 'x'.repeat(18000) },
      { role: 'assistant', content: 'Done' },
    ],
  }));
  let calls = 0,
    saved;
  const manager = createContextManager({
    history,
    summary: null,
    input: 'Continue',
    tools: [],
    systemPrompt: 'Agent',
    settings,
    summarize: async () => {
      calls++;
      return 'Verified older state';
    },
    saveSummary: async (s) => {
      saved = s;
    },
  });
  const list = await manager.prepare([{ role: 'user', content: 'Continue' }]);
  assert.ok(calls > 0);
  assert.ok(saved.coveredIds.length > 0);
  assert.equal(history[0].messages[0].content.length, 18000);
  assert.ok(list.some((m) => m.content.includes('Verified older state')));
  const previous = { text: 'Old summary', coveredIds: [] };
  let writes = 0;
  const failed = createContextManager({
    history,
    summary: previous,
    input: 'Continue',
    tools: [],
    systemPrompt: 'Agent',
    settings,
    summarize: async () => {
      throw new Error('offline');
    },
    saveSummary: async () => {
      writes++;
    },
  });
  await assert.rejects(failed.prepare([{ role: 'user', content: 'Continue' }]));
  assert.equal(writes, 0);
  assert.equal(failed.summary().text, 'Old summary');
});

test('bounded text continuation never executes truncated actions', async () => {
  let calls = 0,
    effects = 0;
  const common = {
    input: 'Hi',
    history: [],
    tools: [],
    assertActive: async () => {},
    execute: async () => {
      effects++;
      return {};
    },
  };
  const result = await runAgent({
    ...common,
    complete: async (_m, tools) =>
      calls++ === 0
        ? { ...completion('First '), finishReason: 'length' }
        : (assert.deepEqual(tools, []), completion('second.')),
  });
  assert.equal(result.text, 'First second.');
  assert.equal(calls, 2);
  assert.equal(effects, 0);
  calls = 0;
  const partial = await runAgent({
    ...common,
    settings: { ...DEFAULT_SETTINGS, modelRecoveryAttempts: 0 },
    complete: async () => ({ ...completion(null, [call('write', {})]), finishReason: 'length' }),
  });
  assert.equal(partial.reason, 'truncated_tool_call');
  assert.equal(effects, 0);
});

test('/stop is actor-scoped, persists cancellation and prevents late model actions', async () => {
  const f = await fixture();
  let release, started;
  const ready = new Promise((r) => {
      started = r;
    }),
    paused = new Promise((r) => {
      release = r;
    });
  const app = runtime(f, async () => {
    started();
    await paused;
    return completion(null, [call('memory_set', { key: 'late', value: 'no' })]);
  });
  const running = app.onMessage(message('Work'), context(1004));
  await ready;
  assert.equal((await app.onMessage(message('/stop', 2), context(1005))).stopped, true);
  release();
  assert.equal((await running).status, 'cancelled');
  assert.equal(await f.store.getNote('late'), null);
  assert.ok(
    (await f.store.history('42'))[0].messages.at(-1).content.includes('cancelled by the user'),
  );
  assert.equal(f.sent.length, 1);
});

test('parallel read batches preserve barriers and operation result ordering', async () => {
  const f = await fixture(),
    events = [];
  let release,
    started = 0;
  const barrier = new Promise((r) => {
    release = r;
  });
  const make = (name, effect) =>
    defineTool({
      schema: defineSchema({ name, description: name, properties: {}, required: [] }),
      effect,
      parallelSafe: effect === 'read',
      async execute() {
        events.push(name);
        if (effect === 'read' && ++started === 2) release();
        if (effect === 'read') await barrier;
        return { name };
      },
    });
  const registry = createToolRegistry([
    make('read_a', 'read'),
    make('read_b', 'read'),
    make('write', 'state_write'),
  ]);
  const execute = createToolExecutor({
    registry,
    journal: f.repositories.operations,
    token: 'parallel',
    assertActive: async () => {},
  });
  let round = 0;
  const result = await runAgent({
    input: 'batch',
    history: [],
    tools: registry.schemas,
    execute,
    assertActive: async () => {},
    settings: { ...DEFAULT_SETTINGS, maxParallelReads: 2 },
    complete: async () =>
      round++ === 0
        ? completion(null, [
            call('read_a', {}, 'a'),
            call('read_b', {}, 'b'),
            call('write', {}, 'w'),
          ])
        : completion('Done'),
  });
  assert.deepEqual(events, ['read_a', 'read_b', 'write']);
  assert.deepEqual(
    result.transcript.filter((m) => m.role === 'tool').map((m) => m.tool_call_id),
    ['a', 'b', 'w'],
  );
});

test('mid-turn settings edits apply only to the next turn and overrides can return to inheritance', async () => {
  const f = await fixture();
  let release, start;
  const ready = new Promise((r) => {
      start = r;
    }),
    block = new Promise((r) => {
      release = r;
    });
  const app = runtime(f, async () => {
    start();
    await block;
    return completion('Done');
  });
  const pending = app.onMessage(message('Start'), context(2001));
  await ready;
  await app.updateAgentSettings({
    expectedRevision: 0,
    defaults: { maxModelCalls: 5 },
    overrides: { group: { maxModelCalls: 3 } },
  });
  release();
  await pending;
  assert.equal((await f.repositories.turns.get('update:2001')).settings.values.maxModelCalls, 12);
  await app.onMessage(message('Next'), context(2002));
  assert.equal((await f.repositories.turns.get('update:2002')).settings.values.maxModelCalls, 5);
  const reset = await app.updateAgentSettings({
    expectedRevision: 1,
    overrides: { group: { maxModelCalls: null } },
  });
  assert.equal(reset.effective.group.maxModelCalls, 5);
});

test('invalid Telegram inputs fail before transport and can be repaired by the model', async () => {
  const f = await fixture();
  let calls = 0,
    round = 0;
  f.api.banChatMember = async () => {
    calls++;
    return true;
  };
  const app = runtime(f, async (messages) => {
    if (round++ === 0)
      return completion(null, [
        call('telegram_admin', { method: 'banChatMember', params: { chat_id: '-100123' } }),
      ]);
    const result = JSON.parse(messages.at(-1).content);
    assert.equal(result.error, 'invalid_arguments');
    assert.equal(result.operation_state, undefined);
    return completion('A member identifier is required.');
  });
  assert.equal((await app.onMessage(message('Admin request'), context(2003))).completed, true);
  assert.equal(calls, 0);
});

test('tool and model budgets finalize without executing excess or uncertain writes', async () => {
  const f = await fixture();
  let count = 0,
    round = 0;
  const tool = defineTool({
    schema: defineSchema({
      name: 'write',
      description: 'Write',
      properties: { key: string('Key', 8) },
      required: ['key'],
    }),
    effect: 'external_write',
    execute: () => {
      count++;
      throw new Error('timeout');
    },
  });
  const registry = createToolRegistry([tool]),
    execute = createToolExecutor({
      registry,
      journal: f.repositories.operations,
      token: 'uncertain',
      assertActive: async () => {},
    });
  const result = await runAgent({
    input: 'Write twice',
    history: [],
    tools: registry.schemas,
    execute,
    assertActive: async () => {},
    complete: async (_m, schemas) =>
      round++ === 0
        ? completion(null, [call('write', { key: 'a' }, 'a'), call('write', { key: 'b' }, 'b')])
        : (assert.equal(schemas.length, 0), completion('The first operation is uncertain.')),
  });
  assert.equal(count, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.reason, 'operation_unknown');
  let modelCalls = 0;
  const bounded = await runAgent({
    input: 'Loop',
    history: [],
    tools: registry.schemas,
    execute: async () => ({}),
    assertActive: async () => {},
    settings: { ...DEFAULT_SETTINGS, maxModelCalls: 2, maxToolCalls: 1 },
    complete: async (_m, schemas) =>
      modelCalls++ === 0
        ? completion(null, [call('read', {}, 'a'), call('read', {}, 'b')])
        : (assert.equal(schemas.length, 0), completion('Partial work recorded.')),
  });
  assert.equal(bounded.budget.model_calls, 2);
  assert.equal(bounded.budget.tool_calls, 1);
  assert.equal(bounded.status, 'partial');
});
