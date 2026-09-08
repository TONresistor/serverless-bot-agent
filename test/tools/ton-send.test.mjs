import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendTonTool } from '../../src/tools/ton/send.js';

test('TON send has preparation capability only and keeps the invocation identity', async () => {
  const tool = createSendTonTool({
    prepare: async (args, id) => {
      assert.equal(args.amount, '0.01');
      assert.equal(id, 'operation-1');
      return { state: 'pending_confirmation' };
    },
  });
  assert.deepEqual(
    await tool.prepare('{"to":"destination","amount":"0.01"}')({ operationId: 'operation-1' }),
    { state: 'pending_confirmation' },
  );
  assert.throws(
    () => tool.prepare('{"to":"destination","amount":"0.01","confirmed":true}'),
    /not allowed/,
  );
  assert.throws(
    () =>
      tool.prepare(JSON.stringify({ to: 'destination', amount: '0.01', comment: 'é'.repeat(61) })),
    /120 bytes/,
  );
});
