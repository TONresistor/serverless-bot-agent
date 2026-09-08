import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegramAdminTool } from '../../src/tools/telegram/admin.js';
test('Telegram admin validates method and nested parameter boundaries', async () => {
  let seen;
  const tool = createTelegramAdminTool({
    call: async (method, params) => {
      seen = { method, params };
      return { ok: true };
    },
  });
  await tool.prepare(JSON.stringify({ method: 'getChat', params: {} }))({ operationId: 'test' });
  assert.equal(seen.method, 'getChat');
  assert.throws(() => tool.prepare('{"method":"getUpdates","params":{}}'));
  assert.throws(() => tool.prepare('{"method":"getChat","params":{"nested":{"__proto__":{}}}}'));
});
