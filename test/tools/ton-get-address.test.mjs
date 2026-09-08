import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetAddressTool } from '../../src/tools/ton/get-address.js';

test('wallet address tool exposes only the injected public identity', async () => {
  const identity = { address: 'public-address', network: 'mainnet' };
  const tool = createGetAddressTool({ identity: () => identity });
  assert.deepEqual(await tool.prepare('{}')({ operationId: 'test' }), identity);
  assert.throws(() => tool.prepare('{"secret":true}'), /not allowed/);
});
