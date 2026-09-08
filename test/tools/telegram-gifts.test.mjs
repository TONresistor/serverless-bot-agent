import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramGiftsTool } from '../../src/tools/telegram/gifts.js';
test('Telegram gifts validates method and nested parameter boundaries', async () => {
  let seen;
  const tool = createTelegramGiftsTool({
    call: async (method, params) => {
      seen = { method, params };
      return { ok: true };
    },
  });
  await tool.prepare(JSON.stringify({ method: 'getMyStarBalance', params: {} }))({
    operationId: 'test',
  });
  assert.equal(seen.method, 'getMyStarBalance');
  assert.throws(() => tool.prepare('{"method":"getUpdates","params":{}}'));
  assert.throws(() =>
    tool.prepare('{"method":"getMyStarBalance","params":{"nested":{"__proto__":{}}}}'),
  );
});
