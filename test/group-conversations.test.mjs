import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, message, context, call, completion } from './helpers.mjs';
import { createRuntime } from '../src/composition/runtime.js';
import { extractTrigger } from '../src/adapters/telegram/triggers.js';

const group = (text, actor = 42, chat = -10077, topic = undefined) => ({
  message_id: 50,
  from: { id: actor },
  chat: { id: chat, type: 'supergroup' },
  text,
  ...(topic ? { message_thread_id: topic } : {}),
  entities: [...text.matchAll(/@TestBot/gi)].map((m) => ({
    type: 'mention',
    offset: m.index,
    length: m[0].length,
  })),
});
function runtime(f, complete) {
  return createRuntime({
    ...f,
    fetcher: async () => {
      throw new Error('Unexpected HTTP');
    },
    chainFactory: () => f.ton,
    modelFactory: () => complete,
  });
}

test('Telegram triggers use UTF-16 and recognize exact mentions, text mentions and replies', () => {
  const identity = { id: 99, username: 'TestBot' };
  const input = group('😀 @TestBot explain\n```js\na()\n```');
  assert.deepEqual(extractTrigger(input, identity), {
    text: '😀  explain\n```js\na()\n```',
    mentioned: true,
    repliedToBot: false,
    foreignCommand: false,
  });
  assert.equal(
    extractTrigger(
      { text: '/help@TestBot', entities: [{ type: 'bot_command', offset: 0, length: 13 }] },
      identity,
    ).text,
    '/help',
  );
  assert.equal(extractTrigger({ text: '/help@OtherBot' }, identity).foreignCommand, true);
  assert.equal(
    extractTrigger(
      { text: '@TestBotFake', entities: [{ type: 'mention', offset: 0, length: 12 }] },
      identity,
    ).mentioned,
    false,
  );
  assert.equal(
    extractTrigger(
      {
        text: 'Hi Bot',
        entities: [{ type: 'text_mention', offset: 3, length: 3, user: { id: 99 } }],
      },
      identity,
    ).mentioned,
    true,
  );
  assert.equal(
    extractTrigger(
      { caption: '@TestBot photo', caption_entities: [{ type: 'mention', offset: 0, length: 8 }] },
      identity,
    ).mentioned,
    true,
  );
  assert.equal(
    extractTrigger({ text: 'Continue', reply_to_message: { from: { id: 99 } } }, identity)
      .repliedToBot,
    true,
  );
  assert.equal(
    extractTrigger(
      { text: '@TestBot', entities: [{ type: 'mention', offset: -1, length: 8 }] },
      identity,
    ).mentioned,
    false,
  );
});

test('group owner mentions/replies go to the source chat and topic; unrelated chatter and bots stay silent', async () => {
  const f = await fixture();
  let turns = 0;
  const app = runtime(f, async (messages, tools) => {
    turns++;
    assert.ok(messages[0].content.includes('"chat_id":-10077'));
    assert.ok(tools.some((t) => t.function.name === 'telegram_admin'));
    assert.ok(
      !tools.some((t) =>
        ['ton_send', 'telegram_chat_automation', 'request_star_payment'].includes(t.function.name),
      ),
    );
    return completion('Group answer');
  });
  assert.equal((await app.onMessage(group('Unrelated'), context(1))).ignored, true);
  assert.equal(
    (await app.onMessage({ ...group('@TestBot hi'), from: { id: 42, is_bot: true } }, context(2)))
      .ignored,
    true,
  );
  assert.equal(
    (await app.onMessage({ ...group('@TestBot hi'), sender_chat: { id: -99 } }, context(3)))
      .ignored,
    true,
  );
  assert.equal(
    (await app.onMessage(group('@TestBot hi', 42, -10077, 12), context(4))).completed,
    true,
  );
  assert.equal(f.sent[0].chat_id, -10077);
  assert.equal(f.sent[0].message_thread_id, 12);
  assert.equal(f.sent[0].reply_parameters.message_id, 50);
  assert.equal(
    (
      await app.onMessage(
        {
          ...group('Continue'),
          reply_to_message: { from: { id: 99 }, text: 'Previous group answer' },
        },
        context(5),
      )
    ).completed,
    true,
  );
  assert.equal(turns, 2);
  assert.equal((await f.store.history('42')).length, 0);
  assert.equal((await f.store.history('group:-10077:12')).length, 1);
});

test('shared history and memory are isolated from owner DM, other groups and topics', async () => {
  const f = await fixture();
  await f.store.acquireChat('42', 'seed');
  await f.store.setNote('42', 'seed', 'secret_fact', 'private-only', []);
  await f.store.saveHistory('42', 'seed', [
    { id: 'seed', messages: [{ role: 'user', content: 'private conversation' }] },
  ]);
  await f.store.releaseChat('42', 'seed');
  let step = 0;
  const ownerApp = runtime(f, async () =>
    step++ === 0
      ? completion(null, [call('memory_set', { key: 'topic', value: 'group topic 12' })])
      : completion('Saved'),
  );
  await ownerApp.onMessage(group('@TestBot remember', 42, -10077, 12), context(6));
  assert.equal(await f.store.getNote('topic'), null);
  for (const [chat, topic, expected] of [
    [-10077, 12, 'group topic 12'],
    [-10077, 13, null],
    [-10088, 12, null],
  ]) {
    let round = 0;
    const app = runtime(f, async (messages, tools) => {
      assert.ok(!JSON.stringify(messages).includes('private conversation'));
      assert.deepEqual(
        tools.map((t) => t.function.name),
        ['memory_get', 'memory_search', 'telegram_send_message', 'tool_search', 'tool_call'],
      );
      if (round++ === 0)
        return completion(null, [
          call('memory_get', { key: 'secret_fact' }),
          call('memory_search', { query: '' }, 'search'),
        ]);
      const outputs = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
      assert.ok(!JSON.stringify(outputs).includes('private-only'));
      assert.equal(JSON.stringify(outputs).includes('group topic 12'), expected !== null);
      return completion('Done');
    });
    await app.onMessage(
      group('@TestBot notes?', 123, chat, topic),
      context(10 + Math.abs(chat) + topic),
    );
  }
  assert.equal((await f.store.getNote('secret_fact')).value, 'private-only');
});

test('public tools cannot execute privileged actions, redirect replies or create privileged callbacks', async () => {
  const f = await fixture();
  let round = 0;
  const app = runtime(f, async (messages) => {
    if (round++ === 0)
      return completion(null, [
        call('ton_send', { to: 'x', amount: '1' }, 'money'),
        call('memory_set', { key: 'private', value: 'overwrite' }, 'memory'),
        call('telegram_send_message', { text: 'Leak', chat_id: '42' }, 'redirect'),
        call(
          'telegram_send_message',
          {
            text: 'Escalate',
            rich_buttons: [
              {
                type: 'callback',
                label: 'Run',
                value: 'Run',
                execute: {
                  tool: 'telegram_admin',
                  args: { method: 'getChat', params: { chat_id: '42' } },
                },
              },
            ],
          },
          'button',
        ),
      ]);
    const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.error));
    return completion('Those actions are unavailable.');
  });
  assert.equal((await app.onMessage(group('@TestBot do it', 123), context(30))).completed, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].chat_id, -10077);
  assert.equal(f.broadcasts.length, 0);
});

test('public sender defaults to this group/topic; callbacks retain actor and group permissions', async () => {
  const f = await fixture();
  let rounds = 0;
  const app = runtime(f, async (_messages, tools) => {
    assert.deepEqual(
      tools.map((t) => t.function.name),
      ['memory_get', 'memory_search', 'telegram_send_message', 'tool_search', 'tool_call'],
    );
    if (rounds++ === 0)
      return completion(null, [
        call('telegram_send_message', {
          text: 'Choose',
          rich_buttons: [{ type: 'callback', label: 'Continue', value: 'Continue' }],
        }),
      ]);
    return completion(rounds === 2 ? 'Choose' : 'Still in the group');
  });
  await app.onMessage(group('@TestBot show options', 123, -10077, 12), context(40));
  assert.equal(f.sent.length, 1);
  assert.equal(String(f.sent[0].chat_id), '-10077');
  assert.equal(f.sent[0].message_thread_id, 12);
  const data = /data="(button:[a-f0-9]+)"/.exec(f.sent[0].rich_message.markdown)[1];
  const callback = {
    id: 'cb',
    data,
    from: { id: 123 },
    message: { message_id: 1, message_thread_id: 12, chat: { id: -10077, type: 'supergroup' } },
  };
  assert.equal(
    (await app.onCallback({ ...callback, from: { id: 42 } }, context(41))).ignored,
    true,
  );
  assert.equal((await app.onCallback(callback, context(42))).completed, true);
  assert.equal(f.sent.at(-1).chat_id, -10077);
  assert.equal(f.sent.at(-1).message_thread_id, 12);
  assert.equal((await f.store.history('42')).length, 0);
});

test('group commands stay scoped; other bots, public reset and wallet commands do not access private state', async () => {
  const f = await fixture();
  const app = runtime(f, async () => {
    throw new Error('Commands must not invoke the model');
  });
  assert.equal((await app.onMessage(group('/help@OtherBot'), context(50))).ignored, true);
  const help = {
    ...group('/help@TestBot', 123),
    entities: [{ type: 'bot_command', offset: 0, length: 13 }],
  };
  assert.equal((await app.onMessage(help, context(51))).command, 'help');
  assert.equal((await app.onMessage(group('/reset', 123), context(52))).command, 'denied');
  assert.equal((await app.onMessage(group('/wallet', 42), context(53))).command, 'private_only');
  assert.ok(f.sent.every((m) => m.chat_id === -10077));
  assert.equal((await app.onMessage(message('Hi', 1, 123), context(54))).ignored, true);
});

test('non-owner group limits are atomic and silent empty model replies are supported', async () => {
  const f = await fixture();
  const replies = await Promise.all(
    Array.from({ length: 14 }, (_, i) => f.store.allowReply(-10077, 123, `fill:${i}`, 10)),
  );
  assert.equal(replies.filter(Boolean).length, 10);
  const limited = runtime(f, async () => {
    throw new Error('Rate limit must prevent inference');
  });
  assert.equal(
    (await limited.onMessage(group('@TestBot again', 123), context(60))).rate_limited,
    true,
  );
  const app = runtime(f, async () => completion(''));
  assert.equal((await app.onMessage(group('@TestBot', 42), context(61))).completed, true);
  assert.equal(f.sent.length, 0);
});

test('a rate-limited group callback remains usable after the quota window resets', async () => {
  const f = await fixture();
  let round = 0;
  const app = runtime(f, async () =>
    round++ === 0
      ? completion(null, [
          call('telegram_send_message', {
            text: 'Choose',
            rich_buttons: [{ type: 'callback', label: 'Next', value: 'Next' }],
          }),
        ])
      : completion('Choose'),
  );
  await app.onMessage(group('@TestBot options', 123), context(70));
  const data = /data="(button:[a-f0-9]+)"/.exec(f.sent[0].rich_message.markdown)[1];
  for (let i = 0; i < 9; i++) await f.store.allowReply(-10077, 123, `fill:${i}`, 10);
  const cb = {
    id: 'cb',
    data,
    from: { id: 123 },
    message: { message_id: 1, chat: { id: -10077, type: 'supergroup' } },
  };
  assert.equal((await app.onCallback(cb, context(71))).rate_limited, true);
  assert.equal((await f.store.operation(data)).state, 'pending');
  f.setTime(f.now() + 3600000);
  assert.equal((await app.onCallback(cb, context(72))).completed, true);
});

test('group reception diagnostics distinguish ingress rejection without storing text', async () => {
  const f = await fixture();
  const app = runtime(f, async () => completion('Done'));
  await app.onMessage(
    { ...group('@TestBot private content'), sender_chat: { id: -991 } },
    context(91),
  );
  const row = await f.store.operation('reception-addressed:-10077');
  assert.equal(row.data.result.ignored, true);
  assert.equal(row.data.sender_chat, -991);
  assert.ok(!JSON.stringify(row).includes('private content'));
  await app.onMessage(group('Unaddressed private content'), context(92));
  assert.equal((await f.store.operation('reception:-10077')).data.update_id, 92);
  assert.equal((await f.store.operation('reception-addressed:-10077')).data.update_id, 91);
});
