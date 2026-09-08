import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestStarPaymentTool } from '../../src/tools/telegram/request-star-payment.js';
test('Stars invoice schema rejects invalid amount and currency override', async () => {
  const tool = createRequestStarPaymentTool({ request: async (args) => ({ amount: args.amount }) });
  assert.deepEqual(
    await tool.prepare('{"amount":10,"description":"Service"}')({ operationId: 'invoice' }),
    { amount: 10 },
  );
  assert.throws(() => tool.prepare('{"amount":0,"description":"Service"}'));
  assert.throws(() => tool.prepare('{"amount":10,"description":"Service","currency":"TON"}'));
});
