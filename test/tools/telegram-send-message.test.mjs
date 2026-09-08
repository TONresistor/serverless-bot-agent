import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendMessageTool } from '../../src/tools/telegram/send-message.js';

test('message tool rejects privileged identity arguments and reports exactly what was sent', async () => {
  const tool = createSendMessageTool({
    send: async (text) => {
      assert.equal(text, 'Hello');
      return { message_id: 7 };
    },
  });
  assert.deepEqual(await tool.prepare('{"text":"Hello"}')({ operationId: 'test' }), {
    message_id: 7,
    reply_delivered: true,
    sent_text: 'Hello',
  });
  assert.throws(
    () => tool.prepare('{"text":"Hello","business_connection_id":"injected"}'),
    /not allowed/,
  );
});
