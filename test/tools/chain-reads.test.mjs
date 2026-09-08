import test from 'node:test';
import assert from 'node:assert/strict';
import { createTxHistoryTool } from '../../src/tools/ton/tx-history.js';
import { createAddressInfoTool } from '../../src/tools/ton/address-info.js';
import { createDnsResolveTool } from '../../src/tools/ton/dns-resolve.js';
import { createDnsInfoTool } from '../../src/tools/ton/dns-info.js';
import { createJettonInfoTool } from '../../src/tools/jetton/info.js';
import { createJettonBalanceTool } from '../../src/tools/jetton/balance.js';
import { createNftInfoTool } from '../../src/tools/nft/info.js';
import { createNftCollectionInfoTool } from '../../src/tools/nft/collection-info.js';

test('eight chain tools expose complete searchable read contracts and invoke only their narrow ports', async () => {
  const cases = [
    [createTxHistoryTool, 'txHistory', {}, { limit: 10 }],
    [createAddressInfoTool, 'addressInfo', { address: ' EQaddress ' }, { address: 'EQaddress' }],
    [createDnsResolveTool, 'dnsResolve', { domain: ' alice ' }, { domain: 'alice' }],
    [createDnsInfoTool, 'dnsInfo', { domain: ' alice.ton ' }, { domain: 'alice.ton' }],
    [
      createJettonInfoTool,
      'jettonInfo',
      { address: ' EQmaster ' },
      { address: 'EQmaster', decimals: 9 },
    ],
    [
      createJettonBalanceTool,
      'jettonBalance',
      { address: ' EQmaster ', decimals: 6 },
      { address: 'EQmaster', decimals: 6 },
    ],
    [createNftInfoTool, 'nftInfo', { address: ' EQitem ' }, { address: 'EQitem' }],
    [
      createNftCollectionInfoTool,
      'nftCollectionInfo',
      { address: ' EQcollection ' },
      { address: 'EQcollection' },
    ],
  ];
  for (const [factory, method, input, expected] of cases) {
    let calls = 0;
    const tool = factory({
      [method]: async (args) => {
        calls++;
        assert.deepEqual(args, expected);
        return { found: true };
      },
    });
    const prepared = tool.prepare(JSON.stringify(input));
    assert.equal(prepared.effect, 'read');
    assert.equal(prepared.parallelSafe, true);
    assert.equal(tool.metadata.exposure, 'search');
    assert.deepEqual(await prepared({ operationId: 'read' }), { found: true });
    assert.throws(() =>
      tool.prepare(JSON.stringify({ ...input, provider_url: 'https://evil.example' })),
    );
    assert.equal(calls, 1);
  }
});

test('chain tool validators reject empty addresses/domains, excess limits and invalid decimals before any provider call', () => {
  for (const factory of [
    createAddressInfoTool,
    createJettonInfoTool,
    createJettonBalanceTool,
    createNftInfoTool,
    createNftCollectionInfoTool,
  ])
    assert.throws(() => factory({}).prepare('{"address":" "}'));
  for (const factory of [createDnsInfoTool, createDnsResolveTool])
    assert.throws(() => factory({}).prepare('{"domain":" "}'));
  for (const limit of [0, 51, 1.5])
    assert.throws(() => createTxHistoryTool({}).prepare(JSON.stringify({ limit })));
  for (const decimals of [-1, 31, 1.5])
    assert.throws(() =>
      createJettonBalanceTool({}).prepare(JSON.stringify({ address: 'EQmaster', decimals })),
    );
});
