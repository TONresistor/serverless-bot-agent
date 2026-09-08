import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools, schemas } from '../../src/composition/tools/market.js';

test('all seven market tools expose complete bounded discovery contracts and invoke narrow ports with reference defaults', async () => {
  const calls = [];
  const market = Object.fromEntries(
    [
      'searchTokens',
      'tonPrice',
      'jettonPrice',
      'portfolio',
      'uranusSearch',
      'uranusHoldings',
      'tokenMarket',
    ].map((name) => [
      name,
      async (input) => {
        calls.push({ name, input });
        return { ok: name };
      },
    ]),
  );
  const tools = createTools({ market });
  assert.equal(tools.length, 7);
  assert.equal(schemas.length, 7);
  const inputs = [
    { query: ' USDT ' },
    {},
    { address: ' EQaddress ' },
    {},
    {},
    {},
    { query: ' NOT ', chain: ' TON ' },
  ];
  for (const [i, tool] of tools.entries()) {
    assert.equal(tool.effect, 'read');
    assert.equal(tool.metadata.exposure, 'search');
    const invocation = tool.prepare(JSON.stringify(inputs[i]));
    assert.equal(invocation.parallelSafe, true);
    await invocation({ operationId: `call-${i}` });
    assert.throws(
      () => tool.prepare('{"unexpected":true}'),
      (e) => e.code === 'invalid_arguments',
    );
  }
  assert.deepEqual(calls[0], { name: 'searchTokens', input: { query: 'USDT', limit: 8 } });
  assert.deepEqual(calls[4], { name: 'uranusSearch', input: { query: '', limit: 10 } });
  assert.deepEqual(calls[6], { name: 'tokenMarket', input: { query: 'NOT', chain: 'ton' } });
  assert.throws(
    () => tools[0].prepare('{"query":" "}'),
    (e) => e.code === 'invalid_arguments',
  );
  assert.throws(
    () => tools[0].prepare('{"query":"USDT","limit":26}'),
    (e) => e.code === 'invalid_arguments',
  );
  assert.throws(
    () => tools[4].prepare('{"limit":51}'),
    (e) => e.code === 'invalid_arguments',
  );
  assert.deepEqual(createTools({}), []);
});
