import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramBusinessTool } from '../../src/tools/telegram/business.js';
test('Telegram business validates method and nested parameter boundaries', async () => {
  let seen;
  const tool = createTelegramBusinessTool({
    call: async (method, params) => {
      seen = { method, params };
      return { ok: true };
    },
  });
  await tool.prepare(JSON.stringify({ method: 'getBusinessConnection', params: {} }))({
    operationId: 'test',
  });
  assert.equal(seen.method, 'getBusinessConnection');
  assert.throws(() => tool.prepare('{"method":"getUpdates","params":{}}'));
  assert.throws(() =>
    tool.prepare('{"method":"getBusinessConnection","params":{"nested":{"__proto__":{}}}}'),
  );
});
