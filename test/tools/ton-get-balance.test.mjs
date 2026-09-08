import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetBalanceTool } from '../../src/tools/ton/get-balance.js';

test('wallet balance tool preserves exact decimal strings and propagates read failure', async () => {
  const value = {
    address: 'public',
    network: 'mainnet',
    balance_nano: '10000000000000001',
    balance_ton: '10000000.000000001',
  };
  assert.deepEqual(
    await createGetBalanceTool({ balance: async () => value }).prepare('{}')({
      operationId: 'test',
    }),
    value,
  );
  await assert.rejects(
    createGetBalanceTool({
      balance: async () => {
        throw new Error('offline');
      },
    }).prepare('{}')({ operationId: 'test' }),
    /offline/,
  );
});
