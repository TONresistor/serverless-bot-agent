import test from 'node:test';
import assert from 'node:assert/strict';
import { createJettonSendTool } from '../../src/tools/jetton/send.js';
import { createNftSendTool } from '../../src/tools/nft/send.js';

test('asset send tools only prepare a durable confirmation through the financial port', async () => {
  const calls = [];
  const financial = {
    validate: (kind) => calls.push(['validate', kind]),
    prepare: async (kind, args, id) => {
      calls.push([kind, args, id]);
      return { state: 'pending_confirmation' };
    },
  };
  for (const [factory, name, args] of [
    [
      createJettonSendTool,
      'jetton_send',
      { address: 'token', to: 'recipient', amount: '1', decimals: 6 },
    ],
    [createNftSendTool, 'nft_send', { nft_address: 'nft', to: 'recipient' }],
  ]) {
    const tool = factory(financial),
      prepared = tool.prepare(JSON.stringify(args));
    assert.equal(tool.metadata.exposure, 'search');
    assert.equal(prepared.effect, 'external_write');
    assert.equal(prepared.parallelSafe, false);
    assert.deepEqual(await prepared({ operationId: 'journal-id' }), {
      state: 'pending_confirmation',
    });
    assert.deepEqual(calls.at(-1), [name, args, 'journal-id']);
    assert.throws(() => tool.prepare(JSON.stringify({ ...args, confirmed: true })));
    assert.throws(() => tool.prepare(JSON.stringify({ ...args, payload_boc: 'injected' })));
  }
});
