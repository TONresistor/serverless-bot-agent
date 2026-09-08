import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, message, context, completion, call, config } from './helpers.mjs';
import { createRuntime } from '../src/composition/runtime.js';
import { DEFAULT_ACCESS, allowsTool, validateAccess } from '../src/shared/access-policy.js';
import { conversationScope } from '../src/application/conversation.js';
import { validateTask, nextOccurrence } from '../src/domain/tasks.js';
import { prepareMessage } from '../src/adapters/telegram/rich-message.js';
import { createLiveProgress } from '../src/application/live-progress.js';

const runtime = (f, complete = async () => completion('Done.')) =>
  createRuntime({
    db: f.db,
    api: f.api,
    fetcher: async () => {},
    now: f.now,
    chainFactory: () => f.ton,
    modelFactory: () => complete,
  });
const task = (f, patch = {}) => ({
  title: 'Check',
  prompt: 'Return a short status.',
  kind: 'once',
  runAt: f.now(),
  ...patch,
});

test('reference access modes, owner group bypass, trusted additive tools and sliding hourly quota', async () => {
  const input = {
    actor: { id: 123 },
    chat: { id: -55, type: 'supergroup' },
    mentioned: true,
    text: 'Hello',
  };
  assert.equal(conversationScope(input, config, DEFAULT_ACCESS), null);
  const policy = validateAccess({
    ...DEFAULT_ACCESS,
    group: { mode: 'allowlist', groups: [-55] },
    trusted: [123],
  });
  assert.ok(conversationScope(input, config, policy));
  assert.equal(
    conversationScope({ ...input, chat: { id: -56, type: 'group' } }, config, policy),
    null,
  );
  assert.ok(
    conversationScope(
      { ...input, actor: { id: 42 }, chat: { id: -56, type: 'group' } },
      config,
      policy,
    ),
  );
  assert.equal(allowsTool(policy, 'workspace_read', { actorId: 123, group: true }), true);
  assert.equal(allowsTool(policy, 'workspace_write', { actorId: 123, group: true }), false);
  const f = await fixture();
  assert.equal(await f.store.allowReply(-55, 123, 'one', 1), true);
  f.setTime(3600001); // New clock hour, still inside the sliding window.
  assert.equal(await f.store.allowReply(-55, 123, 'two', 1), false);
  f.setTime(4600001);
  assert.equal(await f.store.allowReply(-55, 123, 'three', 1), true);
});

test('workspace seeds once, survives runtime recreation, fences writes and changes next-turn persona', async () => {
  const f = await fixture();
  let prompt = '';
  const app = runtime(f, async (messages) => {
    prompt = messages[0].content;
    return completion('Ready.');
  });
  await app.initializeFeatures();
  const soul = await app.readWorkspace({ path: 'SOUL.md' });
  await app.writeWorkspace({
    path: 'SOUL.md',
    content: 'Speak as a patient navigator.',
    expectedRevision: soul.revision,
  });
  await app.initializeFeatures();
  await app.onMessage(message('Hello'), context(1));
  assert.match(prompt, /patient navigator/);
  assert.equal(
    (await runtime(f).readWorkspace({ path: 'SOUL.md' })).content,
    'Speak as a patient navigator.',
  );
  await assert.rejects(
    app.writeWorkspace({ path: 'SOUL.md', content: 'stale', expectedRevision: soul.revision }),
    /revision/,
  );
  const port = f.repositories.workspace.port('agent', async () => {}, {
    chatId: '42',
    token: 'expired',
  });
  await assert.rejects(port.write('notes.md', 'late'), /changed/);
  await assert.rejects(
    app.writeWorkspace({ path: '../secret', content: 'x', expectedRevision: 0 }),
    /path/,
  );
  await assert.rejects(
    app.writeWorkspace({ path: 'large.md', content: 'é'.repeat(140000), expectedRevision: 0 }),
    /256 KiB/,
  );
});

test('mid-turn tool revocation blocks a write and stored callback execution', async () => {
  const f = await fixture();
  let n = 0;
  const app = runtime(f, async () => {
    if (n++ === 0) {
      const p = await f.repositories.features.access();
      await f.repositories.features.setAccess(p.revision, {
        ...p.value,
        tools: { ...p.value.tools, memory_set: { enabled: false } },
      });
      return completion(null, [call('memory_set', { key: 'revoked', value: 'no' })]);
    }
    return completion('Denied.');
  });
  await app.onMessage(message('Remember this'), context(2));
  assert.equal(await f.store.getNote('revoked'), null);
  const calls = await f.db.all("SELECT data_json FROM agent_operations WHERE kind='tool'");
  assert.match(calls[0].data_json, /tool_forbidden/);
});

test('guest replies once through answerGuestQuery and callbacks edit the returned inline message', async () => {
  const f = await fixture();
  let n = 0;
  const guests = [],
    edits = [];
  f.api.getMe = async () => ({ id: 99, username: 'TestBot', supports_guest_queries: true });
  f.api.answerGuestQuery = async (params) => {
    guests.push(params);
    return { inline_message_id: 'inline:one' };
  };
  f.api.editMessageText = async (params) => {
    edits.push(params);
    return true;
  };
  const app = runtime(f, async () =>
    n++ === 0
      ? completion(null, [
          call('telegram_send_message', {
            text: 'Choose',
            rich_buttons: [{ type: 'callback', label: 'More', value: 'More' }],
          }),
        ])
      : completion(n === 2 ? 'A distinct final answer' : 'Updated'),
  );
  const incoming = {
    ...message('Hello', 1, 123),
    chat: { id: -55, type: 'supergroup' },
    guest_query_id: 'guest:one',
  };
  assert.equal((await app.onGuestMessage(incoming, context(3))).completed, true);
  const journal = await f.db.get("SELECT state,data_json FROM agent_operations WHERE kind='tool'");
  assert.equal(journal.state, 'succeeded');
  assert.match(journal.data_json, /inline:one/);
  assert.equal(guests.length, 1);
  assert.equal(f.sent.length, 0);
  const button = /data="(button:[a-f0-9]+)"/.exec(
    guests[0].result.input_message_content.rich_message.markdown,
  )[1];
  assert.equal(
    (
      await app.onCallback(
        { id: 'cb', from: { id: 123 }, inline_message_id: 'wrong', data: button },
        context(4),
      )
    ).ignored,
    true,
  );
  assert.equal(
    (
      await app.onCallback(
        { id: 'cb', from: { id: 123 }, inline_message_id: 'inline:one', data: button },
        context(5),
      )
    ).completed,
    true,
  );
  assert.equal(edits.length, 1);
  assert.equal(edits[0].inline_message_id, 'inline:one');
  assert.equal(guests.length, 1);
});

test('Business auto-replies with bound identity, external permissions and live disconnect fencing', async () => {
  const f = await fixture();
  let round = 0,
    live = true;
  f.api.getBusinessConnection = async () => ({
    id: 'business:one',
    is_enabled: live,
    user: { id: 42 },
    rights: { can_reply: true },
  });
  const app = runtime(f, async (_messages, schemas) => {
    assert.ok(
      !schemas.some((t) =>
        ['ton_send', 'telegram_admin', 'telegram_chat_automation'].includes(t.function.name),
      ),
    );
    return completion('Business reply');
  });
  await app.onBusinessConnection({ id: 'business:one', is_enabled: true, user: { id: 42 } });
  const incoming = { ...message('Help', 1, 123), business_connection_id: 'business:one' };
  assert.equal((await app.onBusinessMessage(incoming, context(6))).completed, true);
  assert.equal(f.sent[0].business_connection_id, 'business:one');
  assert.equal(f.sent[0].chat_id, 123);
  assert.equal((await f.store.history('42')).length, 0);
  assert.equal(
    (await app.onBusinessMessage({ ...incoming, from: { id: 42 } }, context(7))).ignored,
    true,
  );
  const paused = await app.getSecretarySettings();
  await app.updateSecretarySettings({ expectedRevision: paused.revision, enabled: false });
  assert.equal((await app.onBusinessMessage(incoming, context(8))).ignored, true);
  await app.updateSecretarySettings({ expectedRevision: paused.revision + 1, enabled: true });
  const revoked = runtime(f, async () => {
    round++;
    live = false;
    return completion('Must not publish');
  });
  await revoked.onBusinessMessage(incoming, context(9));
  assert.equal(round, 1);
  assert.equal(f.sent.length, 1);
});

test('a card version permits only one sibling action; edit failure cannot replay an executed action', async () => {
  const f = await fixture();
  let n = 0;
  const app = runtime(f, async () =>
    n++ === 0
      ? completion(null, [
          call('telegram_send_message', {
            text: 'Choose',
            rich_buttons: [
              {
                type: 'callback',
                label: 'A',
                value: 'A',
                execute: { tool: 'memory_set', args: { key: 'a', value: 'yes' } },
              },
              {
                type: 'callback',
                label: 'B',
                value: 'B',
                execute: { tool: 'memory_set', args: { key: 'b', value: 'no' } },
              },
            ],
          }),
        ])
      : completion('Choose'),
  );
  await app.onMessage(message('Options'), context(10));
  const ids = [...f.sent[0].rich_message.markdown.matchAll(/data="(button:[a-f0-9]+)"/g)].map(
    (m) => m[1],
  );
  f.api.editMessageText = async () => {
    throw new Error('timeout');
  };
  const cb = (data) => ({
    id: 'cb',
    from: { id: 42 },
    data,
    message: { message_id: 1, chat: { id: 42, type: 'private' } },
  });
  await app.onCallback(cb(ids[0]), context(11));
  assert.equal((await f.store.getNote('a')).value, 'yes');
  assert.equal((await app.onCallback(cb(ids[0]), context(12))).ignored, true);
  assert.equal((await app.onCallback(cb(ids[1]), context(13))).ignored, true);
  assert.equal(await f.store.getNote('b'), null);
});

test('rich extensions match reference compact alignment, code pipes and presentation allowlist', () => {
  const raw =
    '<tg-spoiler>Hidden</tg-spoiler>\n\n<blockquote expandable>More</blockquote>\n\n<table compact>\n| Token | Volume | Note |\n|:---|---:|:---:|\n| **$KITO** | $420 | `up|only` |\n</table>\n\n<button data="evil">Action</button>';
  const rendered = prepareMessage(raw, 'rich')
    .map((p) => p.rich_message?.markdown || p.text)
    .join('');
  assert.match(rendered, /<tg-spoiler>Hidden<\/tg-spoiler>/);
  assert.match(rendered, /<blockquote expandable>/);
  assert.match(rendered, /<td align="right">&#36;420<\/td>/);
  assert.match(rendered, /<code>up\|only<\/code>/);
  assert.ok(!rendered.includes('<button'));
  const fenced = '```html\n<table compact>\n| A | B |\n|---|---|\n| 1 | 2 |\n</table>\n```';
  assert.ok(prepareMessage(fenced, 'rich')[0].rich_message.markdown.includes(fenced));
});

test('draft previews use stable IDs, throttle and omit unavailable native Stop', async () => {
  const sent = [];
  let now = 100;
  const progress = createLiveProgress({
    telegram: { sendRichMessageDraft: async (p) => sent.push(p) },
    scope: { surface: 'dm', destination: 42 },
    event: 'update:1',
    now: () => now,
    assertActive: async () => {},
  });
  await progress('Thinking <now>');
  now += 1300;
  await progress('Using memory');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].draft_id, sent[1].draft_id);
  assert.ok(!('can_stop' in sent[0]));
  assert.match(sent[0].rich_message.html, /&lt;now&gt;/);
});

test('once task runs from a fresh session, coalesces duplicates and delivers automatically', async () => {
  const f = await fixture();
  let calls = 0;
  await f.store.acquireChat('42', 'seed');
  await f.store.saveHistory('42', 'seed', [
    { messages: [{ role: 'user', content: 'PRIVATE OLD CHAT' }] },
  ]);
  await f.store.releaseChat('42', 'seed');
  const app = runtime(f, async (messages) => {
    calls++;
    assert.ok(!JSON.stringify(messages).includes('PRIVATE OLD CHAT'));
    return completion('Scheduled result');
  });
  await app.saveTask({ id: 'once', expectedRevision: 0, definition: task(f) });
  const results = await Promise.all([app.schedulerTick(), app.schedulerTick()]);
  assert.equal(calls, 1);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].text, 'Scheduled result');
  assert.equal((await app.getTask({ id: 'once' })).enabled, 0);
  assert.equal(results.flatMap((r) => r.results).filter((r) => r.status === 'completed').length, 1);
});

test('recurring tasks collapse missed intervals; manual runs preserve paused schedules and request deduplication', async () => {
  const f = await fixture(),
    app = runtime(f);
  await app.saveTask({
    id: 'repeat',
    expectedRevision: 0,
    definition: task(f, { kind: 'recurring', everySeconds: 300, enabled: false }),
  });
  const before = await app.getTask({ id: 'repeat' });
  await app.runTaskNow({ id: 'repeat', requestId: 'manual:one' });
  await app.runTaskNow({ id: 'repeat', requestId: 'manual:one' });
  assert.equal(f.sent.length, 1);
  assert.equal((await app.getTask({ id: 'repeat' })).next_run_at, before.next_run_at);
  assert.equal((await app.getTask({ id: 'repeat' })).enabled, 0);
  await app.setTaskEnabled({ id: 'repeat', expectedRevision: 1, enabled: true });
  f.setTime(f.now() + 3600000);
  await app.schedulerTick();
  assert.equal(f.sent.length, 2);
  assert.equal((await app.getTask({ id: 'repeat' })).next_run_at, f.now() + 300000);
  assert.equal(nextOccurrence(1000, 300, 1000000), 1201000);
});

test('pause/revision change fences a running task before its tool and report', async () => {
  const f = await fixture();
  let app,
    round = 0;
  app = runtime(f, async () => {
    if (round++ === 0) {
      await app.setTaskEnabled({ id: 'paused', expectedRevision: 1, enabled: false });
      return completion(null, [call('telegram_send_message', { text: 'Do not send' })]);
    }
    return completion('Do not publish');
  });
  await app.saveTask({ id: 'paused', expectedRevision: 0, definition: task(f) });
  await app.schedulerTick();
  assert.equal(f.sent.length, 0);
  assert.equal((await app.getTask({ id: 'paused' })).enabled, 0);
});

test('expired task claims are recorded as interrupted and never repeat uncertain effects', async () => {
  const f = await fixture(),
    app = runtime(f);
  await app.saveTask({ id: 'expired', expectedRevision: 0, definition: task(f) });
  const t = await app.getTask({ id: 'expired' }),
    runId = await f.repositories.tasks.claim(t, 'scheduled');
  f.setTime(f.now() + 700000);
  await app.schedulerTick();
  assert.equal(f.sent.length, 0);
  assert.equal((await f.repositories.tasks.getRun(runId)).status, 'interrupted');
  assert.equal((await app.getTask({ id: 'expired' })).enabled, 0);
});

test('draft approval blocks tool publishing, records content and publishes at most once after approval', async () => {
  const f = await fixture();
  let round = 0;
  const app = runtime(f, async () =>
    round++ === 0
      ? completion(null, [call('telegram_send_message', { text: 'Premature' })])
      : completion('Reviewed post'),
  );
  await app.saveTask({
    id: 'draft',
    expectedRevision: 0,
    definition: task(f, { mode: 'draft_approve', targetChatId: -55 }),
  });
  await app.schedulerTick();
  assert.ok(f.sent.every((m) => m.chat_id === 42));
  const drafts = await app.listTaskDrafts();
  assert.equal(drafts.length, 1);
  await app.decideTaskDraft({ id: drafts[0].id, approve: true });
  await assert.rejects(app.decideTaskDraft({ id: drafts[0].id, approve: true }), /already handled/);
  assert.equal(f.sent.filter((m) => m.chat_id === -55).length, 1);
});

test('heartbeat starts disabled; evolving state is persistent and internal summaries stay silent', async () => {
  const f = await fixture(),
    app = runtime(f);
  await app.initializeFeatures();
  await app.updateHeartbeat({ expectedRevision: 1, enabled: false, everySeconds: 3600 });
  assert.equal((await app.schedulerTick()).due, 0);
  await app.runTaskNow({ id: 'heartbeat', requestId: 'hb1' });
  assert.equal(f.sent.length, 0);
  await app.saveTask({
    id: 'goal',
    expectedRevision: 0,
    definition: task(f, { kind: 'recurring', behavior: 'evolving', everySeconds: 3600 }),
  });
  await app.schedulerTick();
  assert.match((await app.readWorkspace({ path: 'automations/goal.md' })).content, /# Objective/);
  assert.equal(f.sent.length, 0);
  assert.throws(
    () => validateTask(task(f, { kind: 'recurring', everySeconds: 299 }), 42),
    /Invalid task/,
  );
});

test('owner can stop a manual task while its command is still awaiting the model', async () => {
  const f = await fixture();
  let unblock, ready;
  const gate = new Promise((resolve) => {
      unblock = resolve;
    }),
    started = new Promise((resolve) => {
      ready = resolve;
    });
  const app = runtime(f, async () => {
    ready();
    await gate;
    return completion('Late scheduled reply');
  });
  await app.saveTask({
    id: 'manual',
    expectedRevision: 0,
    definition: task(f, { enabled: false }),
  });
  const running = app.onMessage(message('/tasks run manual'), context(201));
  await started;
  assert.equal((await app.onMessage(message('/tasks stop manual'), context(202))).command, 'tasks');
  unblock();
  await running;
  assert.equal((await app.taskHistory({ id: 'manual' }))[0].status, 'cancelled');
  assert.ok(!f.sent.some((m) => m.text === 'Late scheduled reply'));
});

test('recovery preserves a manual once schedule when its worker never started, and consumes a recorded success', async () => {
  const f = await fixture(),
    app = runtime(f);
  await app.saveTask({
    id: 'orphan',
    expectedRevision: 0,
    definition: task(f, { runAt: f.now() + 3600000 }),
  });
  const t = await app.getTask({ id: 'orphan' }),
    runId = await f.repositories.tasks.claim(t, 'manual', 'orphan');
  await f.db.run('DELETE FROM agent_task_runs WHERE id=:id', { ':id': runId });
  f.setTime(f.now() + 700000);
  await f.repositories.tasks.recoverExpired();
  assert.equal((await app.getTask({ id: 'orphan' })).enabled, 1);
  assert.equal((await app.getTask({ id: 'orphan' })).next_run_at, t.next_run_at);
  const run2 = await f.repositories.tasks.claim(
    await app.getTask({ id: 'orphan' }),
    'manual',
    'terminal',
  );
  await f.db.run("UPDATE agent_task_runs SET status='completed' WHERE id=:id", { ':id': run2 });
  f.setTime(f.now() + 700000);
  await f.repositories.tasks.recoverExpired();
  assert.equal((await app.getTask({ id: 'orphan' })).enabled, 0);
});

test('revoking TON during the destination RPC prevents signing or broadcast of a pending confirmation', async () => {
  const f = await fixture();
  let round = 0;
  const app = runtime(f, async () =>
    round++ === 0
      ? completion(null, [
          call('ton_send', {
            to: 'UQAwoTYDYllGAzQ8Et_2Zf2KHQu5UofXhwNKl8a8gEuFb4u0',
            amount: '0.01',
          }),
        ])
      : completion('Confirm the request.'),
  );
  await app.onMessage(message('Prepare the transfer'), context(301));
  const pending = await f.db.get("SELECT id,data_json FROM agent_operations WHERE kind='transfer'");
  assert.ok(pending);
  const original = f.ton.state;
  f.ton.state = async (...args) => {
    const policy = await f.repositories.features.access();
    await f.repositories.features.setAccess(policy.revision, {
      ...policy.value,
      tools: { ...policy.value.tools, ton_send: { enabled: false } },
    });
    return original(...args);
  };
  await app.onCallback(
    {
      id: 'confirm',
      from: { id: 42 },
      data: `confirm:${pending.id.slice('transfer:'.length)}`,
      message: {
        message_id: JSON.parse(pending.data_json).messageId,
        chat: { id: 42, type: 'private' },
      },
    },
    context(302),
  );
  assert.equal(f.broadcasts.length, 0);
  const stored = await f.store.operation(pending.id);
  assert.equal(stored.state, 'failed');
  assert.equal(stored.data.signed, undefined);
});

test('explicit trusted wallet-read grants bind only public reads and scoped administration cannot redirect', async () => {
  const f = await fixture();
  let round = 0;
  const policy = await f.repositories.features.access();
  await f.repositories.features.setAccess(policy.revision, {
    ...policy.value,
    dm: { mode: 'allowlist' },
    trusted: [123],
    tools: {
      ...policy.value.tools,
      ton_get_address: { trusted: ['dm'] },
      ton_get_balance: { trusted: ['dm'] },
      telegram_admin: { enabled: true, trusted: ['dm'] },
    },
  });
  f.api.getChat = async () => {
    throw new Error('Off-target API must not run');
  };
  const app = runtime(f, async (messages) => {
    if (round++ === 0)
      return completion(null, [
        call('ton_get_address', {}, 'address'),
        call('ton_get_balance', {}, 'balance'),
        call('telegram_admin', { method: 'getChat', params: { chat_id: -55 } }, 'admin'),
      ]);
    const replies = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
    assert.equal(replies[0].network, 'mainnet');
    assert.equal(replies[1].balance_ton, '1');
    assert.equal(replies[2].error, 'forbidden_destination');
    return completion('Read-only wallet access works.');
  });
  assert.equal(
    (await app.onMessage(message('Wallet status', 1, 123), context(401))).completed,
    true,
  );
  assert.equal(f.broadcasts.length, 0);
});

test('fresh initialization uses reference defaults while explicit legacy migration preserves deployed behavior', async () => {
  const f = await fixture();
  await f.db.run("DELETE FROM agent_settings WHERE key='access_policy'");
  const app = runtime(f);
  await app.initializeFeatures();
  assert.equal((await app.getAccessPolicy()).value.group.mode, 'off');
  assert.equal((await app.getAccessPolicy()).value.tools.ton_send, undefined);
  await f.db.run("DELETE FROM agent_settings WHERE key='access_policy'");
  await app.initializeFeatures({ migrateLegacy: true });
  assert.equal((await app.getAccessPolicy()).value.group.mode, 'all');
  assert.equal((await app.getAccessPolicy()).value.tools.ton_send.enabled, true);
});
