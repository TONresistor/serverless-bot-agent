import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Address, beginCell, Cell, TupleReader } from '@ton/core';
import { createSwapPlanner } from '../../src/adapters/swaps/planner.js';
import { createTonClient } from '../../src/adapters/ton-client.js';
import { readCpmmState } from '../../src/domain/swaps/dedust/cpmm.js';
import { buildDedustMessage } from '../../src/domain/swaps/dedust/messages.js';
import { normalizeSwap } from '../../src/domain/swaps/input.js';
import { createSwapQuoteTool } from '../../src/tools/swaps/quote.js';
import { createSwapTool } from '../../src/tools/swaps/swap.js';

const fixture = JSON.parse(
  await readFile(new URL('../fixtures/swaps/dedust-http.json', import.meta.url), 'utf8'),
);
const addr = (n) => new Address(0, Buffer.alloc(32, n)).toRawString();
function harness() {
  const state = {
    mutate: (_response, _request) => {},
    balance: 1000000000000000000n,
    now: 1800000000000,
    calls: [],
  };
  const fetcher = async (url, options = {}) => {
    const key = JSON.stringify([url, options.method || 'GET', options.body || '']);
    const request = options.body ? JSON.parse(options.body) : { url };
    state.calls.push(request);
    assert.notEqual(request.method, 'sendBoc', 'Tests must never broadcast');
    assert.ok(fixture.records[key], 'Unrecorded read: ' + key);
    const response = structuredClone(fixture.records[key]);
    state.mutate(response, request);
    return { ok: true, text: async () => JSON.stringify(response) };
  };
  const rpc = createTonClient(fetcher, 'mainnet'),
    chain = {
      ...rpc,
      async runGetMethod(address, method, args = []) {
        const item = fixture.cases.find((c) => c.plan.receipt.outputWallet === address);
        if (item && method === 'get_wallet_data')
          return {
            stack: new TupleReader([
              { type: 'int', value: state.balance },
              ...[fixture.owner, item.plan.receipt.output].map((a) => ({
                type: 'slice',
                cell: beginCell().storeAddress(Address.parse(a)).endCell(),
              })),
              { type: 'cell', cell: Cell.EMPTY },
            ]),
          };
        return rpc.runGetMethod(address, method, args);
      },
    };
  return {
    state,
    planner: createSwapPlanner({
      chain,
      fetcher,
      walletAddress: fixture.owner,
      network: 'mainnet',
      now: () => state.now,
    }),
  };
}
const argsFor = (item) => ({
  dex: 'dedust',
  to: item.token,
  to_decimals: item.decimals,
  amount: '0.01',
  ...(item.pool ? { pool_address: item.pool } : {}),
});

test('DeDust discovery verifies mainnet factory and both CPMM revisions and pins approvals', async () => {
  const { planner, state } = harness();
  for (const item of fixture.cases) {
    const args = argsFor(item),
      plan = await planner.plan(args, 'fixture-' + item.name);
    assert.deepEqual(plan, item.plan);
    const original = JSON.stringify(plan);
    await planner.revalidate(plan);
    assert.equal(JSON.stringify(plan), original);
    assert.equal((await planner.quote(args)).pool_address, plan.receipt.poolAddress);
    assert.equal(plan.receipt.args.pool_address, plan.receipt.poolAddress);
    const reverse = await planner.plan(
      {
        dex: 'dedust',
        from: item.token,
        from_decimals: item.decimals,
        to: 'TON',
        amount: '1',
        pool_address: plan.receipt.poolAddress,
      },
      'reverse-' + item.name,
    );
    assert.equal(reverse.message.destination, plan.receipt.outputWallet);
    const transfer = Cell.fromBase64(reverse.message.bodyBoc).beginParse();
    assert.equal(transfer.loadUint(32), 0x0f8a7ea5);
    assert.equal(transfer.loadUintBig(64).toString(), reverse.receipt.queryId);
    assert.equal(transfer.loadCoins(), 10n ** BigInt(item.decimals));
    assert.equal(transfer.loadAddress().toRawString(), reverse.receipt.inputVault);
    await planner.revalidate(reverse);
  }
  assert.ok(state.calls.some((call) => call.url?.includes('dedust.io')));
  assert.ok(state.calls.some((call) => call.url?.includes('/api/v3/messages?')));
});

test('DeDust rejects unknown DEX, wrong decimals, taxes, forged pools, frozen state and provider failure', async () => {
  const item = fixture.cases[1],
    args = argsFor(item);
  assert.throws(() => normalizeSwap({ ...args, dex: 'other' }, 'mainnet'), /Choose/);
  assert.throws(
    () =>
      normalizeSwap(
        { ...args, dex: 'stonfi', pool_address: item.plan.receipt.poolAddress },
        'mainnet',
      ),
    /DeDust only/,
  );
  const checks = [
    (d, r) => {
      if (r.url?.includes('dedust.io'))
        d.items.forEach((c) => {
          c.metadata.decimals = 6;
        });
    },
    (d, r) => {
      if (r.url?.includes('dedust.io'))
        d.items.forEach((c) => {
          c.buy_tax = 1;
        });
    },
    (d, r) => {
      if (
        r.method === 'getAddressInformation' &&
        r.params.address === item.plan.receipt.poolAddress
      )
        d.result.code = Cell.EMPTY.toBoc().toString('base64');
    },
    (d, r) => {
      if (
        r.method === 'getAddressInformation' &&
        r.params.address === item.plan.receipt.poolAddress
      )
        d.result.state = 'frozen';
    },
    (d, r) => {
      if (r.method === 'getAddressInformation') {
        d.ok = false;
        d.error = 'upstream unavailable';
      }
    },
    (d, r) => {
      if (r.method === 'runGetMethod' && r.params.method === 'get_wallet_address')
        d.result.stack = [
          [
            'slice',
            {
              bytes: beginCell()
                .storeAddress(Address.parse(addr(99)))
                .endCell()
                .toBoc()
                .toString('base64'),
            },
          ],
        ];
    },
  ];
  for (const mutate of checks) {
    const { planner, state } = harness();
    state.mutate = mutate;
    await assert.rejects(planner.quote({ ...args, pool_address: item.plan.receipt.poolAddress }));
  }
});

test('DeDust approvals reject stale terms, lower output, insufficient tokens and mutated bodies', async () => {
  const item = fixture.cases[1],
    { planner, state } = harness(),
    plan = await planner.plan(argsFor(item), 'approval');
  const original = JSON.stringify(plan);
  state.mutate = (d, r) => {
    if (r.method !== 'getAddressInformation' || r.params.address !== plan.receipt.poolAddress)
      return;
    const old = Cell.fromBase64(d.result.data),
      s = old.beginParse();
    s.loadRef();
    s.loadRef();
    s.loadRef();
    const rewards = s.loadMaybeRef();
    const status = s.loadUint(2),
      deposit = s.loadBit(),
      swap = s.loadBit(),
      liquidity = s.loadCoins(),
      x = s.loadCoins(),
      y = s.loadCoins();
    d.result.data = beginCell()
      .storeRef(old.refs[0])
      .storeRef(old.refs[1])
      .storeRef(old.refs[2])
      .storeMaybeRef(rewards)
      .storeUint(status, 2)
      .storeBit(deposit)
      .storeBit(swap)
      .storeCoins(liquidity)
      .storeCoins(x)
      .storeCoins(y / 2n)
      .endCell()
      .toBoc()
      .toString('base64');
  };
  await assert.rejects(planner.revalidate(plan), /approved minimum/);
  state.mutate = () => {};
  await assert.rejects(
    planner.revalidate({ ...plan, message: { ...plan.message, amountNano: '1' } }),
    /transaction changed/,
  );
  state.now += 901000;
  await assert.rejects(planner.revalidate(plan), /expired/);
  state.now -= 901000;
  state.balance = 0n;
  await assert.rejects(
    planner.plan(
      {
        dex: 'dedust',
        from: item.token,
        from_decimals: 9,
        to: 'TON',
        amount: '1',
        pool_address: plan.receipt.poolAddress,
      },
      'empty',
    ),
    /enough input/,
  );
  assert.equal(JSON.stringify(plan), original);
});

test('CPMM root parser keeps unequal reserves and rejects an attacker upgrade controller', () => {
  const item = fixture.cases[1];
  const response = Object.entries(fixture.records).find(
    ([key]) => key.includes('getAddressInformation') && key.includes(item.plan.receipt.poolAddress),
  )[1];
  const state = response.result,
    parsed = readCpmmState(state);
  assert.notEqual(parsed.reserveX, parsed.reserveY);
  const data = Cell.fromBase64(state.data),
    extra = data.refs[2].beginParse();
  extra.loadAddress();
  const maliciousExtra = beginCell()
    .storeAddress(Address.parse(addr(99)))
    .storeSlice(extra)
    .endCell();
  const forged = new Cell({
    bits: data.bits,
    refs: [data.refs[0], data.refs[1], maliciousExtra, ...data.refs.slice(3)],
  });
  assert.throws(
    () => readCpmmState({ ...state, data: forged.toBoc().toString('base64') }),
    /untrusted upgrade/,
  );
});

test('DeDust tools are discoverable and expose only reads or owner-confirmation preparation', async () => {
  const calls = [],
    validate = (args) => {
      normalizeSwap(args, 'mainnet');
    };
  const quote = createSwapQuoteTool({ validate, quote: async (args) => ({ dex: args.dex }) });
  const swap = createSwapTool({
    validate,
    prepare: async (...args) => {
      calls.push(args);
      return { confirmation_required: true };
    },
  });
  const args = argsFor(fixture.cases[1]);
  assert.ok(quote.metadata.keywords.includes('dedust'));
  assert.ok(swap.metadata.keywords.includes('uranus'));
  assert.equal(quote.effect, 'read');
  assert.equal(swap.effect, 'external_write');
  assert.deepEqual(await quote.prepare(JSON.stringify(args))({}), { dex: 'dedust' });
  assert.deepEqual(await swap.prepare(JSON.stringify(args))({ operationId: 'approval-only' }), {
    confirmation_required: true,
  });
  assert.deepEqual(calls, [['ton_swap', args, 'approval-only']]);
});

test('DeDust jetton-to-jetton body fixes exact units, output minimum, deadline and recipients', () => {
  for (const version of ['cpmm-v2', 'vault-v2']) {
    const parsed = normalizeSwap(
      {
        dex: 'dedust',
        from: addr(2),
        from_decimals: 6,
        to: addr(3),
        to_decimals: 9,
        amount: '1.23',
      },
      'mainnet',
    );
    const { message } = buildDedustMessage(
      parsed,
      {
        version,
        poolAddress: addr(4),
        inputVault: addr(5),
        inputWallet: addr(6),
        minOut: '987654321',
      },
      fixture.owner,
      '77',
      1800000900,
    );
    assert.equal(message.destination, addr(6));
    assert.equal(message.amountNano, '350000000');
    const s = Cell.fromBase64(message.bodyBoc).beginParse();
    assert.equal(s.loadUint(32), 0x0f8a7ea5);
    assert.equal(s.loadUintBig(64), 77n);
    assert.equal(s.loadCoins(), 1230000n);
    assert.equal(s.loadAddress().toRawString(), version === 'cpmm-v2' ? addr(4) : addr(5));
    assert.equal(s.loadAddress().toRawString(), fixture.owner);
    assert.equal(s.loadMaybeRef(), null);
    assert.equal(s.loadCoins(), 300000000n);
    assert.equal(s.loadBit(), true);
    const payload = s.loadRef().beginParse();
    if (version === 'cpmm-v2') {
      assert.equal(payload.loadUint(32), 0xcbc33949);
      const inner = payload.loadRef().beginParse();
      assert.equal(inner.loadUint(32), 0xc442500f);
      assert.equal(inner.loadCoins(), 987654321n);
      assert.equal(inner.loadUint(40), 1800000900);
    } else {
      assert.equal(payload.loadUint(32), 0xe3a0d482);
      assert.equal(payload.loadAddress().toRawString(), addr(4));
      assert.equal(payload.loadBit(), false);
      assert.equal(payload.loadCoins(), 987654321n);
    }
  }
});
