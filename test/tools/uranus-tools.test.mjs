import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../../src/composition/tools/uranus.js';

test('Uranus tools expose hidden reference min_out/decimals and delegate all writes only to confirmation preparation', async () => {
  const calls = [];
  const tools = createTools({
    uranus: { info: async (args) => ({ token: args.token }) },
    financial: {
      prepare: async (tool, args, operationId) => {
        calls.push({ tool, args, operationId });
        return { state: 'awaiting_confirmation' };
      },
    },
  });
  assert.equal(tools.length, 5);
  assert.deepEqual(await tools[0].prepare('{"token":" DUCK "}')({ operationId: 'read' }), {
    token: 'DUCK',
  });
  for (const [index, args] of [
    [1, { token: 'DUCK', amount: '1', min_out: '0', decimals: 6 }],
    [2, { token: 'DUCK', amount: '1', min_out: '0.1', decimals: 6 }],
    [3, { preset_id: 0, metadata_uri: 'https://example.org/a' }],
    [4, { token: 'DUCK' }],
  ]) {
    const tool = tools[index];
    assert.equal(tool.effect, 'external_write');
    assert.equal(tool.metadata.exposure, 'search');
    assert.equal(
      (await tool.prepare(JSON.stringify(args))({ operationId: `op-${index}` })).state,
      'awaiting_confirmation',
    );
  }
  assert.deepEqual(
    calls.map((c) => c.tool),
    ['uranus_buy', 'uranus_sell', 'uranus_deploy', 'uranus_claim_fees'],
  );
  assert.equal(calls[0].args.min_out, '0');
  assert.equal(calls[0].args.decimals, 6);
  assert.doesNotThrow(() => tools[3].prepare('{"preset_id":15}'));
  assert.throws(
    () => tools[3].prepare('{"preset_id":16}'),
    (e) => e.code === 'invalid_arguments',
  );
  assert.throws(
    () => tools[1].prepare('{"token":"DUCK","amount":"1","decimals":31}'),
    (e) => e.code === 'invalid_arguments',
  );
  assert.deepEqual(createTools({}), []);
});
