import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, beginCell, Cell, TupleReader } from '@ton/core';
import { createSwapPlanner } from '../../src/adapters/swaps/planner.js';
import { normalizeSwap } from '../../src/domain/swaps/input.js';
import { inspectSwapSettlement } from '../../src/domain/swaps/settlement.js';
import { createSwapQuoteTool } from '../../src/tools/swaps/quote.js';
import { createSwapTool } from '../../src/tools/swaps/swap.js';
import { TON_ASSET } from '../../src/domain/market/stonfi.js';

const addr = (n) => new Address(0, Buffer.alloc(32, n)).toRawString();
const OWNER = addr(1),
  ROUTER = addr(2),
  POOL = addr(3),
  PTON = addr(4),
  A = addr(5),
  B = addr(6);
const PW = addr(7),
  AR = addr(8),
  BR = addr(9),
  AW = addr(10),
  BW = addr(11);
const addressItem = (value) => ({
  type: 'slice',
  cell: beginCell().storeAddress(Address.parse(value)).endCell(),
});
const int = (value) => ({ type: 'int', value: BigInt(value) });
const cell = (value = Cell.EMPTY) => ({ type: 'cell', cell: value });
const text = (value) => cell(beginCell().storeStringTail(value).endCell());

function fixture() {
  const state = {
    min: '1980000',
    expected: '2000000',
    forward: '300000000',
    locked: false,
    version: 2,
    balance: 1000000000000n,
    decimals: null,
    mutate: (_value) => {},
    requests: [],
    calls: [],
  };
  const chain = {
    async runGetMethod(address, method, args = []) {
      state.calls.push({ address, method });
      if (method === 'get_router_version')
        return { stack: new TupleReader([int(2), int(state.version), text('fixture')]) };
      if (method === 'get_router_data')
        return {
          stack: new TupleReader([
            int(0),
            text('constant_product'),
            int(state.locked ? -1 : 0),
            addressItem(OWNER),
            cell(),
            cell(),
            cell(),
            cell(),
            cell(),
          ]),
        };
      if (method === 'get_pool_address') return { stack: new TupleReader([addressItem(POOL)]) };
      if (method === 'get_wallet_address') {
        const owner = args[0].cell.beginParse().loadAddress().toRawString();
        const wallets = {
          [PTON]: { [ROUTER]: PW },
          [A]: { [ROUTER]: AR, [OWNER]: AW },
          [B]: { [ROUTER]: BR, [OWNER]: BW },
        };
        assert.ok(wallets[address]?.[owner], `Unexpected wallet getter: ${address} ${owner}`);
        return { stack: new TupleReader([addressItem(wallets[address][owner])]) };
      }
      if (method === 'get_wallet_data')
        return {
          stack: new TupleReader([
            int(state.balance),
            addressItem(OWNER),
            addressItem(address === AW ? A : B),
            cell(),
          ]),
        };
      assert.fail(`Unexpected getter ${method}`);
    },
  };
  const fetcher = async (url, options) => {
    state.requests.push({ url, options });
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.ston.fi');
    if (parsed.pathname.startsWith('/v1/assets/')) {
      const address = decodeURIComponent(parsed.pathname.slice('/v1/assets/'.length));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            asset: {
              contract_address: address,
              decimals: state.decimals ?? (address === A ? 6 : 9),
            },
          }),
      };
    }
    assert.equal(parsed.pathname, '/v1/swap/simulate');
    assert.equal(options.method, 'POST');
    assert.equal(parsed.searchParams.get('dex_version'), '2');
    const source = parsed.searchParams.get('offer_address'),
      output = parsed.searchParams.get('ask_address');
    const wallet = (asset) => (asset === TON_ASSET ? PW : asset === A ? AR : BR);
    const response = {
      offer_address: source,
      ask_address: output,
      offer_units: parsed.searchParams.get('units'),
      ask_units: state.expected,
      min_ask_units: state.min,
      offer_jetton_wallet: wallet(source),
      ask_jetton_wallet: wallet(output),
      router_address: ROUTER,
      pool_address: POOL,
      router: {
        address: ROUTER,
        major_version: 2,
        minor_version: state.version,
        router_type: 'ConstantProduct',
        pton_version: '2.1',
        pton_master_address: PTON,
        pton_wallet_address: PW,
      },
      gas_params: { forward_gas: state.forward },
    };
    state.mutate(response);
    return { ok: true, text: async () => JSON.stringify(response) };
  };
  return {
    state,
    planner: createSwapPlanner({
      chain,
      fetcher,
      walletAddress: OWNER,
      network: 'mainnet',
      now: () => 1000000,
    }),
  };
}

test('swap inputs require exact decimals, positive units, real addresses and supported slippage', () => {
  assert.equal(
    normalizeSwap({ to: A, to_decimals: 6, amount: '0.01' }, 'mainnet').inputUnits,
    '10000000',
  );
  assert.equal(
    normalizeSwap(
      { from: A, from_decimals: 6, to: 'TON', amount: '5', max_slippage_bps: 0 },
      'mainnet',
    ).inputUnits,
    '5000000',
  );
  for (const args of [
    { to: A, amount: '1' },
    { from: A, to: 'TON', amount: '1' },
    { to: 'USDT', to_decimals: 6, amount: '1' },
    { to: 'TON', amount: '1' },
    { to: A, to_decimals: 6, amount: '0' },
    { to: A, to_decimals: 6, amount: '1e2' },
    { from: A, from_decimals: 6, to: 'TON', amount: '1.1234567' },
    { to: A, to_decimals: 6, amount: '1', max_slippage_bps: 10000 },
  ])
    assert.throws(() => normalizeSwap(args, 'mainnet'));
  assert.throws(() => normalizeSwap({ to: A, to_decimals: 6, amount: '1' }, 'testnet'), /mainnet/);
});

test('STON plans all three directions with exact SDK payloads and immutable approvals', async () => {
  const { planner } = fixture();
  const native = await planner.plan({ to: A, to_decimals: 6, amount: '1' }, 'native');
  assert.equal(native.message.destination, PW);
  assert.equal(native.message.amountNano, '1310000000');
  const body = Cell.fromBase64(native.message.bodyBoc).beginParse();
  assert.equal(body.loadUint(32), 0x01f3835d);
  assert.equal(body.loadUintBig(64).toString(), native.receipt.queryId);
  assert.equal(body.loadCoins(), 1000000000n);
  assert.equal(body.loadAddress().toRawString(), OWNER);
  assert.equal(body.loadBit(), true);
  const swap = body.loadRef().beginParse();
  assert.equal(swap.loadUint(32), 0x6664de2a);
  assert.equal(swap.loadAddress().toRawString(), AR);
  assert.equal(swap.loadAddress().toRawString(), OWNER);
  assert.equal(swap.loadAddress().toRawString(), OWNER);
  assert.equal(swap.loadUintBig(64), BigInt(native.receipt.deadline));
  const terms = swap.loadRef().beginParse();
  assert.equal(terms.loadCoins().toString(), native.receipt.minOut);
  assert.equal(terms.loadAddress().toRawString(), OWNER);
  const saved = JSON.stringify(native);
  await planner.revalidate(native);
  assert.equal(JSON.stringify(native), saved);
  for (const to of ['TON', B]) {
    const plan = await planner.plan(
      { from: A, from_decimals: 6, to, ...(to === B ? { to_decimals: 9 } : {}), amount: '1' },
      `jetton:${to}`,
    );
    assert.equal(plan.message.destination, AW);
    const transfer = Cell.fromBase64(plan.message.bodyBoc).beginParse();
    assert.equal(transfer.loadUint(32), 0x0f8a7ea5);
    assert.equal(transfer.loadUintBig(64).toString(), plan.receipt.queryId);
    assert.equal(transfer.loadCoins(), 1000000n);
    assert.equal(transfer.loadAddress().toRawString(), ROUTER);
    await planner.revalidate(plan);
  }
});

test('fresh swap validation rejects price, gas, route, decimal and balance changes before signing', async () => {
  const { planner, state } = fixture(),
    args = { from: A, from_decimals: 6, to: B, to_decimals: 9, amount: '1' };
  const plan = await planner.plan(args, 'approval');
  state.expected = '2100000';
  state.min = '2079000';
  state.forward = '290000000';
  const original = JSON.stringify(plan);
  await planner.revalidate(plan);
  assert.equal(JSON.stringify(plan), original);
  state.forward = '300000000';
  state.expected = '1900000';
  state.min = '1881000';
  await assert.rejects(planner.revalidate(plan), /approved minimum/);
  state.expected = '2000000';
  state.min = '1980000';
  state.forward = '400000000';
  await assert.rejects(planner.revalidate(plan), /transaction changed/);
  state.forward = '300000000';
  state.balance = 0n;
  await assert.rejects(planner.revalidate(plan), /enough input tokens/);
  state.balance = 1000000000000n;
  state.decimals = 9;
  await assert.rejects(planner.quote(args), /decimals/);
  state.decimals = null;
  state.locked = true;
  await assert.rejects(planner.quote(args), /locked/);
  state.locked = false;
  state.mutate = (response) => {
    response.pool_address = addr(33);
  };
  await assert.rejects(planner.quote(args), /pool/);
  state.mutate = (response) => {
    response.offer_jetton_wallet = addr(34);
  };
  await assert.rejects(planner.quote(args), /wallets/);
  state.mutate = (response) => {
    response.router.major_version = 1;
  };
  await assert.rejects(planner.quote(args), /v2/);
});

function evidence(
  receipt,
  {
    amount = 1980000n,
    success = true,
    queryId = receipt.queryId,
    source = receipt.poolAddress,
    bounced = false,
  } = {},
) {
  const extra = beginCell()
    .storeCoins(0)
    .storeCoins(0)
    .storeAddress(Address.parse(receipt.routerOfferWallet))
    .storeCoins(amount)
    .storeAddress(Address.parse(receipt.routerAskWallet))
    .endCell();
  const pay = beginCell()
    .storeUint(0x657b54f5, 32)
    .storeUint(BigInt(queryId), 64)
    .storeAddress(Address.parse(OWNER))
    .storeAddress(Address.parse(OWNER))
    .storeAddress(Address.parse(OWNER))
    .storeUint(0xc64370e5, 32)
    .storeMaybeRef(null)
    .storeRef(extra)
    .endCell();
  const transfer = beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(BigInt(queryId), 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(OWNER))
    .endCell();
  const creditBuilder = beginCell()
    .storeUint(receipt.output === 'TON' ? 0x01f3835d : 0x178d4519, 32)
    .storeUint(BigInt(queryId), 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(receipt.output === 'TON' ? OWNER : ROUTER));
  if (receipt.output === 'TON') creditBuilder.storeBit(false);
  const credit = creditBuilder.endCell();
  return {
    complete: true,
    nodes: [
      {
        address: ROUTER,
        hash: 'pay',
        success: true,
        in: { source, bodyBoc: pay.toBoc().toString('base64') },
      },
      {
        address: receipt.routerAskWallet,
        hash: 'transfer',
        success: true,
        in: { source: ROUTER, bodyBoc: transfer.toBoc().toString('base64') },
      },
      {
        address: receipt.outputWallet,
        hash: 'credit',
        success,
        in: {
          source: receipt.routerAskWallet,
          bodyBoc: credit.toBoc().toString('base64'),
          valueNano: amount.toString(),
          bounced,
        },
      },
    ],
  };
}

test('swap settlement requires causal pool payment and the actual owner credit, never a router acknowledgement', async () => {
  const { planner } = fixture();
  for (const to of [B, 'TON']) {
    const plan = await planner.plan(
      { from: A, from_decimals: 6, to, ...(to === B ? { to_decimals: 9 } : {}), amount: '1' },
      `settle:${to}`,
    );
    assert.equal(inspectSwapSettlement(plan.receipt, evidence(plan.receipt)).state, 'confirmed');
    const partial = evidence(plan.receipt);
    partial.nodes.pop();
    partial.complete = false;
    assert.equal(inspectSwapSettlement(plan.receipt, partial).state, 'submitted');
    for (const change of [
      { source: addr(99) },
      { queryId: '999' },
      { success: false },
      { bounced: true },
    ])
      assert.equal(
        inspectSwapSettlement(plan.receipt, evidence(plan.receipt, change)).state,
        'submitted',
      );
    if (to === 'TON') {
      const invalidBodies = [
        Cell.EMPTY,
        beginCell().storeUint(0xd53276db, 32).storeUint(BigInt(plan.receipt.queryId), 64).endCell(),
        beginCell()
          .storeUint(0x178d4519, 32)
          .storeUint(BigInt(plan.receipt.queryId), 64)
          .storeCoins(1980000n)
          .storeAddress(Address.parse(ROUTER))
          .endCell(),
        beginCell()
          .storeUint(0x01f3835d, 32)
          .storeUint(999, 64)
          .storeCoins(1980000n)
          .storeAddress(Address.parse(OWNER))
          .storeBit(false)
          .endCell(),
        beginCell()
          .storeUint(0x01f3835d, 32)
          .storeUint(BigInt(plan.receipt.queryId), 64)
          .storeCoins(1n)
          .storeAddress(Address.parse(OWNER))
          .storeBit(false)
          .endCell(),
        beginCell()
          .storeUint(0x01f3835d, 32)
          .storeUint(BigInt(plan.receipt.queryId), 64)
          .storeCoins(1980000n)
          .endCell(),
      ];
      for (const invalid of invalidBodies) {
        const trace = evidence(plan.receipt);
        trace.nodes.at(-1).in.bodyBoc = invalid.toBoc().toString('base64');
        assert.equal(inspectSwapSettlement(plan.receipt, trace).state, 'submitted');
      }
    }
    assert.equal(
      inspectSwapSettlement(plan.receipt, evidence(plan.receipt, { amount: 1n })).state,
      'failed',
    );
  }
});

test('swap tools keep quotes read-only and invoke only financial preparation for execution', async () => {
  const calls = [],
    validate = (args) => {
      normalizeSwap(args, 'mainnet');
    };
  const quote = createSwapQuoteTool({
    validate,
    quote: async (args) => ({ expected_out: args.amount }),
  });
  const swap = createSwapTool({
    validate,
    prepare: async (...args) => {
      calls.push(args);
      return { confirmation_required: true };
    },
  });
  const args = { to: A, to_decimals: 6, amount: '1' };
  assert.equal(quote.effect, 'read');
  assert.equal(quote.prepare(JSON.stringify(args)).parallelSafe, true);
  assert.equal(swap.effect, 'external_write');
  assert.equal(swap.metadata.exposure, 'search');
  assert.deepEqual(await swap.prepare(JSON.stringify(args))({ operationId: 'exact:operation' }), {
    confirmation_required: true,
  });
  assert.deepEqual(calls, [['ton_swap', args, 'exact:operation']]);
});
