import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, beginCell, Dictionary, TupleReader } from '@ton/core';
import { createChainCapabilities } from '../src/adapters/chain/index.js';
import { decodeMetadata, snakeBytes } from '../src/domain/chain/metadata.js';
import { normalizeDomain } from '../src/domain/chain/dns.js';
import { formatUnits } from '../src/domain/chain/values.js';
import { digest } from '../src/shared/hash.js';
import { address, recipient, transaction, internalMessage } from './helpers.mjs';

const owner = Address.parse(address),
  master = recipient,
  jettonWallet = new Address(0, Buffer.alloc(32, 3));
const root = new Address(-1, Buffer.alloc(32, 4)),
  item = new Address(0, Buffer.alloc(32, 5));
const num = (value) => ({ type: 'int', value: BigInt(value) });
const cell = (value) => (value ? { type: 'cell', cell: value } : { type: 'null' });
const addr = (value) => ({ type: 'slice', cell: beginCell().storeAddress(value).endCell() });
const tuple = (...items) => ({ stack: new TupleReader(items) });
const empty = beginCell().endCell();
const api = (chain) =>
  createChainCapabilities({ chain, walletAddress: address, network: 'mainnet' });
const eq = (value) => value.toString({ bounceable: true });
const content = (fields) => {
  const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
  for (const [key, value] of Object.entries(fields))
    dict.set(
      BigInt('0x' + digest(key)),
      beginCell().storeUint(0, 8).storeStringTail(value).endCell(),
    );
  return beginCell().storeUint(0, 8).storeDict(dict).endCell();
};

test('jetton read shapes preserve precision and validate owner/master instead of silently returning zero', async () => {
  let badOwner = false;
  const chain = {
    account: async () => ({ state: 'active' }),
    runGetMethod: async (_address, method, args) => {
      if (method === 'get_jetton_data')
        return tuple(num('9007199254740993001'), num(-1), addr(null), cell(empty), cell(empty));
      if (method === 'get_wallet_address') {
        assert.ok(args[0].cell.beginParse().loadAddress().equals(owner));
        return tuple(addr(jettonWallet));
      }
      if (method === 'get_wallet_data')
        return tuple(num('1500001'), addr(badOwner ? master : owner), addr(master), cell(empty));
      throw new Error('unexpected method');
    },
  };
  const ports = api(chain);
  assert.deepEqual(await ports.jettonInfo({ address: eq(master), decimals: 6 }), {
    address: eq(master),
    total_supply_raw: '9007199254740993001',
    total_supply: '9007199254740.993001',
    mintable: true,
    admin_address: '',
    immutable: true,
  });
  assert.deepEqual(await ports.jettonBalance({ address: eq(master), decimals: 6 }), {
    address: eq(master),
    jetton_wallet: eq(jettonWallet),
    balance_raw: '1500001',
    balance: '1.500001',
  });
  badOwner = true;
  await assert.rejects(ports.jettonBalance({ address: eq(master) }), /does not match/);
  chain.account = async () => {
    throw new Error('RPC unavailable');
  };
  await assert.rejects(ports.jettonBalance({ address: eq(master) }), /RPC unavailable/);
  chain.account = async () => ({ state: 'frozen' });
  await assert.rejects(ports.jettonBalance({ address: eq(master) }), /frozen/);
  chain.account = async () => ({ state: 'uninitialized' });
  assert.equal((await ports.jettonBalance({ address: eq(master) })).balance_raw, '0');
});

test('amount display rejects negative values and unsupported precision', () => {
  assert.equal(formatUnits('12345678901234567890', 18), '12.34567890123456789');
  assert.equal(formatUnits(12n, 0), '12');
  for (const [value, decimals] of [
    [-1n, 9],
    ['no', 9],
    [1n, 31],
    [1n, -1],
  ])
    assert.throws(() => formatUnits(value, decimals));
});

test('account info retains code/state and never fabricates an empty account after a provider failure', async () => {
  const ports = api({
    account: async () => ({
      balance: '1500000001',
      state: 'active',
      code: beginCell().storeUint(1, 8).endCell().toBoc().toString('base64'),
    }),
  });
  const result = await ports.addressInfo({ address: eq(master) });
  assert.equal(result.balance_ton, '1.500000001');
  assert.equal(result.is_contract, true);
  assert.equal(result.status, 'active');
  await assert.rejects(
    ports.addressInfo({ address: master.toString({ testOnly: true }) }),
    /Invalid TON address/,
  );
  await assert.rejects(
    api({
      account: async () => {
        throw new Error('rate limited');
      },
    }).addressInfo({ address: eq(master) }),
    /rate limited/,
  );
});

test('history verifies account transaction cells, formats dominant direction and preserves LT as text', async () => {
  const outbound = internalMessage({
    body: beginCell().storeUint(0, 32).storeStringTail('invoice').endCell(),
  });
  const ports = api({
    transactions: async () => [
      transaction({ inbound: internalMessage({ from: master, to: owner }), outbound: [outbound] }),
    ],
  });
  const result = await ports.txHistory({ limit: 10 });
  assert.equal(result.count, 1);
  assert.equal(result.transactions[0].direction, 'out');
  assert.equal(result.transactions[0].comment, 'invoice');
  assert.equal(typeof result.transactions[0].lt, 'string');
  assert.equal(result.transactions[0].value_ton, '0.01');
  await assert.rejects(
    api({ transactions: async () => [{ data: 'invalid' }] }).txHistory(),
    /invalid transaction/,
  );
  await assert.rejects(
    api({ transactions: async () => [transaction({ account: master })] }).txHistory(),
    /invalid transaction/,
  );
});

test('NFT item expands collection content and keeps chain ownership independent from indexed metadata', async () => {
  let indexCalls = 0;
  const ports = api({
    runGetMethod: async (target, method, args) => {
      if (method === 'get_nft_data')
        return tuple(
          num(-1),
          num(42),
          addr(master),
          addr(owner),
          cell(beginCell().storeStringTail('42.json').endCell()),
        );
      assert.equal(target, master.toRawString());
      assert.equal(method, 'get_nft_content');
      assert.equal(args[0].value, 42n);
      return tuple(cell(content({ name: 'On-chain title', uri: 'http://127.0.0.1/private' })));
    },
    indexed: async (path, params) => {
      indexCalls++;
      assert.equal(path, '/nft/items');
      assert.equal(params.address, item.toRawString());
      return {
        nft_items: [
          {
            address: eq(item),
            owner_address: eq(master),
            content: {
              name: 'Stale index title',
              image: 'https://example.com/logo.png',
              description: 'Indexed display text',
            },
          },
        ],
      };
    },
  });
  const result = await ports.nftInfo({ address: eq(item) });
  assert.equal(result.owner, eq(owner));
  assert.equal(result.name, 'On-chain title');
  assert.equal(result.index, '42');
  assert.equal(result.description, 'Indexed display text');
  assert.equal(result.metadata_status, 'indexed');
  assert.equal(indexCalls, 1);
});

test('NFT collection metadata uses the v3 collection schema, and index failure does not erase on-chain fields', async () => {
  const chain = {
    runGetMethod: async () => tuple(num(7), cell(content({ name: 'Collection' })), addr(owner)),
    indexed: async () => ({
      nft_collections: [{ address: eq(master), collection_content: {} }],
      metadata: {
        [master.toRawString()]: {
          token_info: [
            {
              name: 'Ignored replacement',
              image: 'https://example.com/collection.png',
              valid: true,
            },
          ],
        },
      },
    }),
  };
  let result = await api(chain).nftCollectionInfo({ address: eq(master) });
  assert.equal(result.name, 'Collection');
  assert.equal(result.item_count, '7');
  assert.equal(result.image, 'https://example.com/collection.png');
  chain.indexed = async () => {
    throw new Error('index unavailable');
  };
  result = await api(chain).nftCollectionInfo({ address: eq(master) });
  assert.equal(result.name, 'Collection');
  assert.equal(result.owner, eq(owner));
  assert.equal(result.metadata_status, 'unavailable');
});

test('metadata is bounded and malformed or private image URLs are not exposed as public images', async () => {
  assert.equal(decodeMetadata(content({ name: 'a'.repeat(300) })).name, 'a'.repeat(300));
  assert.throws(
    () => snakeBytes(beginCell().storeStringTail('abc').endCell(), false, 2),
    /size limit/,
  );
  const ports = api({
    runGetMethod: async () =>
      tuple(
        num(1),
        cell(content({ name: 'Private image', image: 'http://169.254.169.254/latest/meta-data' })),
        addr(owner),
      ),
  });
  const result = await ports.nftCollectionInfo({ address: eq(master) });
  assert.equal(result.image, undefined);
  assert.equal(result.metadata_status, 'unavailable');
});

test('DNS follows config 4 and delegated records, returning wallet/site and NFT ownership', async () => {
  const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
  dict.set(
    BigInt('0x' + digest('wallet')),
    beginCell().storeUint(0x9fd3, 16).storeAddress(owner).endCell(),
  );
  dict.set(
    BigInt('0x' + digest('site')),
    beginCell().storeUint(0x7473, 16).storeBuffer(Buffer.alloc(32, 7)).endCell(),
  );
  const records = beginCell().storeDictDirect(dict).endCell();
  const chain = {
    configParam: async (id) => {
      assert.equal(id, 4);
      return beginCell().storeBuffer(root.hash).endCell();
    },
    runGetMethod: async (target, method, args) => {
      if (method === 'get_nft_data')
        return tuple(num(-1), num(1), addr(master), addr(owner), cell(null));
      const name = args[0].cell
        .beginParse()
        .loadBuffer(args[0].cell.bits.length / 8)
        .toString();
      if (target === root.toRawString()) {
        assert.equal(name, 'ton\0alice\0');
        return tuple(num(32), cell(beginCell().storeUint(0xba93, 16).storeAddress(item).endCell()));
      }
      assert.equal(target, item.toRawString());
      assert.equal(name, 'alice\0');
      return tuple(num(48), cell(records));
    },
  };
  const result = await api(chain).dnsInfo({ domain: ' ALICE.ton. ' });
  assert.equal(result.domain, 'alice.ton');
  assert.equal(result.owner, eq(owner));
  assert.equal(result.collection, eq(master));
  assert.equal(result.resolves_to.bounceable_address, eq(owner));
  assert.equal(result.site, 'ton-storage:' + '07'.repeat(32));
  assert.equal((await api(chain).dnsResolve({ domain: 'alice' })).resolved, true);
});

test('DNS distinguishes absent records from transport failures and rejects non-progressing delegation', async () => {
  const chain = {
    configParam: async () => beginCell().storeBuffer(root.hash).endCell(),
    runGetMethod: async () => tuple(num(0), cell(null)),
  };
  assert.equal((await api(chain).dnsResolve({ domain: 'missing.ton' })).resolved, false);
  chain.runGetMethod = async () => tuple(num(0), cell(empty));
  await assert.rejects(api(chain).dnsResolve({ domain: 'missing.ton' }), /did not consume/);
  chain.runGetMethod = async () => {
    throw new Error('RPC offline');
  };
  await assert.rejects(api(chain).dnsResolve({ domain: 'missing.ton' }), /RPC offline/);
  for (const domain of ['a..ton', '', 'https://a.ton', 'a.com', 'a'.repeat(64) + '.ton', 'a\0.ton'])
    assert.throws(() => normalizeDomain(domain));
});
