import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, message, context, completion } from './helpers.mjs';
import { createRuntime } from '../src/composition/runtime.js';
import { digest } from '../src/shared/hash.js';
import { recoverTurns } from '../src/application/turn-recovery.js';

const longAnswer = ('Long answer content. '.repeat(220) + '\n\n').repeat(3);
const runtime = (f, complete = async () => completion(longAnswer)) =>
  createRuntime({
    db: f.db,
    api: f.api,
    now: f.now,
    fetcher: async () => {
      throw new Error('No real HTTP');
    },
    chainFactory: () => f.ton,
    modelFactory: () => complete,
  });
const receipt = (f, id) =>
  f.repositories.operations.operation(`delivery:${digest(`update:${id}`)}`);

test('an expired worker stops multipart delivery without releasing the new conversation lease', async () => {
  const f = await fixture();
  let sent = 0;
  f.api.sendRichMessage = async () => {
    sent++;
    if (sent === 1) {
      f.setTime(f.now() + 181000);
      assert.equal(await f.repositories.conversations.acquireChat('42', 'new-worker'), true);
    }
    return { message_id: sent };
  };
  const app = runtime(f);
  await app.onMessage(message('hello'), context(3001));
  assert.equal(sent, 1);
  assert.equal((await f.repositories.operations.operation('lock:chat:42')).data, 'new-worker');
  assert.equal((await receipt(f, 3001)).state, 'unknown');
  assert.deepEqual((await receipt(f, 3001)).data.message_ids, [1]);
  const recovered = await recoverTurns({
    ...f.repositories,
    sessionId: '42',
    token: 'new-worker',
    maxBytes: 8192,
  });
  assert.match(
    recovered.find((turn) => turn.id === 'update:3001').messages.at(-1).content,
    /partial.*interrupted/,
  );
});

test('/stop remains available during final delivery and preserves the partial receipt', async () => {
  const f = await fixture();
  let sent = 0,
    stop;
  const app = runtime(f);
  f.api.sendRichMessage = async () => {
    sent++;
    if (sent === 1) stop = await app.onMessage(message('/stop'), context(3003));
    return { message_id: sent };
  };
  const result = await app.onMessage(message('hello'), context(3002));
  assert.equal(stop.stopped, true);
  assert.equal(sent, 1);
  assert.equal(result.status, 'cancelled');
  assert.equal((await f.repositories.turns.get('update:3002')).status, 'cancelled');
  assert.match(
    JSON.stringify(await f.repositories.conversations.history('42')),
    /cancelled by the user/,
  );
  assert.equal((await receipt(f, 3002)).state, 'unknown');
});

test('inference timeout can deliver a terminal status while its conversation lease is valid', async () => {
  const f = await fixture();
  const app = runtime(f, async () => {
    f.setTime(f.now() + 121000);
    return completion('Late answer');
  });
  const result = await app.onMessage(message('hello'), context(3004));
  assert.equal(result.status, 'partial');
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, /time limit/);
  assert.equal((await receipt(f, 3004)).state, 'succeeded');
});

test('a timed-out final send stays uncertain and a duplicate update cannot resend it', async () => {
  const f = await fixture();
  let sent = 0;
  f.api.sendRichMessage = async () => {
    sent++;
    throw new Error('Network result unknown');
  };
  const app = runtime(f);
  await app.onMessage(message('hello'), context(3005));
  assert.equal(sent, 1);
  assert.equal((await receipt(f, 3005)).state, 'unknown');
  assert.deepEqual(await app.onMessage(message('hello'), context(3005)), { duplicate: true });
  assert.equal(sent, 1);
});
