import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Address, beginCell, Cell, TupleReader } from '@ton/core';
import { AgentError } from '../src/shared/errors.js';
import {
  buildBuy,
  buildSell,
  buildDeploy,
  buildClaim,
  decodeUranusMessage,
  parseUranusAmount,
  URANUS_FACTORY,
  URANUS_GAS,
  URANUS_OP,
} from '../src/domain/uranus/abi.js';
import { createUranusCapabilities } from '../src/adapters/uranus/provider.js';

const addr = (id) => Address.parse(`0:${id.toString(16).padStart(64, '0')}`);
const own = addr(1).toRawString(),
  meme = addr(2).toRawString(),
  wallet = addr(3).toRawString(),
  stranger = addr(4).toRawString();
const int = (value) => ({ type: 'int', value: BigInt(value) });
const slice = (value) => ({
  type: 'slice',
  cell: beginCell()
    .storeAddress(value ? Address.parse(value) : null)
    .endCell(),
});
const cell = (value = beginCell().endCell()) => ({ type: 'cell', cell: value });
const boc = (value) => value.toBoc({ idx: false }).toString('base64');

function fixture(options = {}) {
  const values = {
    initialized: -1,
    migrated: 0,
    graduated: 0,
    creator: own,
    creatorFee: 1000000000n,
    balance: 100000000000n,
    walletOwner: own,
    walletMaster: meme,
    walletState: 'active',
    target: 1000000000000n,
    metadataUri: 'https://metadata.example/duck.json',
    failGetter: '',
    ...options,
  };
  const calls = [],
    metadataCalls = [];
  const chain = {
    async state(address) {
      calls.push({ state: address });
      return { state: address === wallet ? values.walletState : 'active' };
    },
    async runGetMethod(address, method, args = []) {
      calls.push({ address, method, args });
      if (values.failGetter === method)
        throw new AgentError('ton_getter_failed', 'Getter unavailable.');
      let stack;
      if (method === 'get_meme_data')
        stack = [
          int(values.initialized),
          int(values.migrated),
          slice(stranger),
          slice(values.creator),
          int(values.creatorFee),
          int(123),
          int(values.graduated),
          int(1),
          int(2),
          int(3),
          int(100),
          int(500000000000n),
          int(10000000000n),
        ];
      else if (method === 'get_bonding_curve_data')
        stack = [
          int(values.graduated),
          int(1000000000000000000n),
          int(10000000000n),
          int(1),
          int(2),
          int(values.target),
          int(50000000000n),
          int(500000000000n),
          int(1),
          int(2),
        ];
      else if (method === 'get_wallet_address') {
        assert.equal(args[0].cell.beginParse().loadAddress().toRawString(), own);
        stack = [slice(wallet)];
      } else if (method === 'get_wallet_data')
        stack = [
          int(values.balance),
          slice(values.walletOwner),
          slice(values.walletMaster),
          cell(),
        ];
      else if (method === 'get_jetton_data')
        stack = [
          int(10),
          int(-1),
          slice(own),
          cell(beginCell().storeUint(1, 8).storeStringTail(values.metadataUri).endCell()),
          cell(),
        ];
      else throw new Error(`Unexpected getter ${method}`);
      return { stack: new TupleReader(stack) };
    },
  };
  let searchAddress = meme;
  const market = {
    async uranusSearch() {
      calls.push({ search: true });
      return {
        results: [
          { address: searchAddress, ticker: 'DUCK', liquidity_ton: '100' },
          { address: stranger, liquidity_ton: '1' },
        ],
      };
    },
    async uranusCoin() {
      return { ticker: 'DUCK', price_usd: '0.123', price_ton: '0.05' };
    },
  };
  const metadata = {
    async prepare(args, operationId) {
      metadataCalls.push({ args, operationId });
      return { metadataUri: args.metadataUri || values.metadataUri };
    },
  };
  const uranus = createUranusCapabilities({
    chain,
    market,
    walletAddress: own,
    network: 'mainnet',
    metadata,
  });
  return {
    uranus,
    values,
    calls,
    metadataCalls,
    chain,
    changeSearch: (value) => {
      searchAddress = value;
    },
  };
}

test('Uranus four action payloads and long metadata snake match independent MyDuckAI Go vectors', async () => {
  const golden = JSON.parse(
    await readFile(new URL('./fixtures/uranus/golden.json', import.meta.url), 'utf8'),
  );
  const values = {
    buy: buildBuy(URANUS_FACTORY, 5000000000n, 42n),
    sell: buildSell(URANUS_FACTORY, 1000000000n, 7n),
    deploy: buildDeploy(7, 'https://meta.example/duck.json', 2000000000n),
    deploy_long: buildDeploy(7, `https://meta.example/${'duck'.repeat(80)}.json`, 2000000000n),
    claim: buildClaim(URANUS_FACTORY),
  };
  for (const [name, value] of Object.entries(values)) {
    assert.equal(value.hash().toString('hex'), golden[name].hash, name);
    assert.ok(value.equals(Cell.fromBase64(golden[name].boc)), name);
  }
  assert.deepEqual(URANUS_GAS, {
    buy: 150000000n,
    sell: 200000000n,
    deploy: 400000000n,
    claim: 100000000n,
  });
});

test('Uranus amounts reject rounding, negative, nondecimal and VarUInteger16 overflow', () => {
  assert.equal(parseUranusAmount('9007199254.740993001'), 9007199254740993001n);
  assert.equal(parseUranusAmount('0', 9, true), 0n);
  for (const amount of [
    '0',
    '-1',
    '+1',
    '1e3',
    '.5',
    'NaN',
    '1.0000000001',
    (1n << 120n).toString(),
  ])
    assert.throws(
      () => parseUranusAmount(amount),
      (e) => e.code === 'invalid_amount',
    );
  assert.throws(
    () => parseUranusAmount('1', 31),
    (e) => e.code === 'invalid_amount',
  );
});

test('Uranus state reads exact getter fields, enriches market data and discloses ticker ambiguity', async () => {
  const f = fixture();
  const info = await f.uranus.info({ token: 'DUCK' });
  assert.equal(info.creator_fee_claimable_ton, '1');
  assert.equal(info.trade_fee_pct, '1');
  assert.equal(info.raised_ton, '500');
  assert.equal(info.target_ton, '1000');
  assert.equal(info.progress_pct, '50.0');
  assert.equal(info.migration_fee_ton, '50');
  assert.equal(info.max_supply, '1000000000');
  assert.equal(info.price_ton, '0.05');
  assert.equal(info.other_matches, 1);
  f.values.graduated = -1;
  assert.equal((await f.uranus.info({ token: meme })).graduated, true);
  f.values.target = 0n;
  await assert.rejects(f.uranus.info({ token: meme }), (e) => e.code === 'uranus_state');
});

test('Uranus trade preparation pins address, decimals, minOut and exact gas without signing', async () => {
  const f = fixture();
  const buy = await f.uranus.planners.uranus_buy.plan(
    { token: 'DUCK', amount: '2', min_out: '1.25', decimals: 6 },
    'buy',
  );
  assert.equal(buy.message.destination, meme);
  assert.equal(buy.message.amountNano, '2150000000');
  assert.equal(buy.receipt.minOut, '1250000');
  assert.equal(buy.receipt.decimals, 6);
  assert.equal(buy.receipt.jettonWallet, wallet);
  assert.doesNotThrow(() => JSON.stringify(buy));
  const sell = await f.uranus.planners.uranus_sell.plan(
    { token: meme, amount: '1.5', decimals: 6, min_out: '0.25' },
    'sell',
  );
  assert.equal(sell.message.destination, wallet);
  assert.equal(sell.message.amountNano, '200000000');
  assert.equal(sell.receipt.amount, '1500000');
  assert.equal(sell.receipt.minOut, '250000000');
  const unprotected = await f.uranus.planners.uranus_buy.plan(
    { token: meme, amount: '1' },
    'market',
  );
  assert.equal(unprotected.receipt.minOut, '0');
  assert.match(unprotected.summary, /No minimum output protection/);
  f.changeSearch(stranger);
  const searches = f.calls.filter((c) => c.search).length;
  await f.uranus.planners.uranus_buy.revalidate(buy);
  assert.equal(f.calls.filter((c) => c.search).length, searches);
  assert.ok(f.calls.filter((c) => c.method === 'get_meme_data').every((c) => c.address === meme));
});

test('Uranus buys and sells fail closed on missing state, graduation, changed token wallet and insufficient funds', async () => {
  for (const values of [
    { failGetter: 'get_meme_data' },
    { graduated: -1 },
    { migrated: -1 },
    { initialized: 0 },
    { walletOwner: stranger },
    { walletMaster: stranger },
  ]) {
    await assert.rejects(
      fixture(values).uranus.planners.uranus_buy.plan({ token: meme, amount: '1' }, 'bad'),
    );
  }
  await assert.rejects(
    fixture({ balance: 0n }).uranus.planners.uranus_sell.plan({ token: meme, amount: '1' }, 'bad'),
    (e) => e.code === 'uranus_balance',
  );
  const f = fixture();
  const plan = await f.uranus.planners.uranus_sell.plan({ token: meme, amount: '1' }, 'sell');
  f.values.balance = 0n;
  await assert.rejects(
    f.uranus.planners.uranus_sell.revalidate(plan),
    (e) => e.code === 'uranus_balance',
  );
  f.values.balance = 100000000000n;
  f.values.graduated = -1;
  await assert.rejects(
    f.uranus.planners.uranus_sell.revalidate(plan),
    (e) => e.code === 'uranus_graduated',
  );
  const undeployed = fixture({ walletState: 'uninitialized' });
  assert.equal(
    (await undeployed.uranus.planners.uranus_buy.plan({ token: meme, amount: '1' }, 'buy')).receipt
      .jettonWallet,
    wallet,
  );
  await assert.rejects(
    undeployed.uranus.planners.uranus_sell.plan({ token: meme, amount: '1' }, 'sell'),
    (e) => e.code === 'uranus_balance',
  );
});

test('creator fee preparation reads creator at stack index3 and rechecks it on confirmation', async () => {
  const f = fixture();
  const plan = await f.uranus.planners.uranus_claim_fees.plan({ token: meme }, 'claim');
  assert.equal(plan.message.amountNano, '100000000');
  assert.equal(plan.receipt.claimableNano, '1000000000');
  f.values.creator = stranger;
  await assert.rejects(
    f.uranus.planners.uranus_claim_fees.revalidate(plan),
    (e) => e.code === 'uranus_creator',
  );
  await assert.rejects(
    fixture({ creatorFee: 0n }).uranus.planners.uranus_claim_fees.plan({ token: meme }, 'claim'),
    (e) => e.code === 'uranus_no_fees',
  );
});

test('deployment preserves uint4 preset bounds and pinned metadata without repeating hosting at confirmation', async () => {
  const f = fixture();
  for (const preset of [0, 7, 15]) {
    const plan = await f.uranus.planners.uranus_deploy.plan(
      { preset_id: preset, metadata_uri: 'https://metadata.example/fixed.json', initial_buy: '2' },
      `deploy-${preset}`,
    );
    assert.equal(plan.message.destination, Address.parse(URANUS_FACTORY).toRawString());
    assert.equal(plan.message.amountNano, '2400000000');
    assert.equal(plan.receipt.presetId, preset);
    assert.equal(plan.receipt.metadataUri, 'https://metadata.example/fixed.json');
    await f.uranus.planners.uranus_deploy.revalidate(plan);
  }
  assert.equal(f.metadataCalls.length, 3);
  for (const preset of [-1, 16, 1.5])
    await assert.rejects(
      f.uranus.planners.uranus_deploy.plan({ preset_id: preset }, 'bad'),
      (e) => e.code === 'invalid_arguments',
    );
});

const node = (source, destination, body, values = {}) => ({
  address: destination,
  hash: `tx-${destination}`,
  success: true,
  in: {
    source,
    destination,
    bodyBoc: body,
    valueNano: '1000000000',
    createdLt: '102',
    bounced: false,
  },
  out: [],
  ...values,
});
const initial = (plan) =>
  node(own, plan.message.destination, plan.message.bodyBoc, { hash: 'root' });
const receive = (amount) =>
  boc(
    beginCell()
      .storeUint(URANUS_OP.receive, 32)
      .storeUint(0, 64)
      .storeCoins(amount)
      .storeAddress(null)
      .storeAddress(Address.parse(own))
      .storeCoins(0)
      .storeBit(false)
      .endCell(),
  );
const payout = (opcode = URANUS_OP.payout) =>
  boc(beginCell().storeUint(opcode, 32).storeUint(0, 64).endCell());

test('buy settlement requires successful causal token credit meeting minOut and verifies wallet identity', async () => {
  const f = fixture();
  const plan = await f.uranus.planners.uranus_buy.plan(
    { token: meme, amount: '1', min_out: '2' },
    'buy',
  );
  const credit = node(meme, wallet, receive(3000000000n));
  const settle = f.uranus.planners.uranus_buy.settle;
  assert.equal(
    (await settle(plan, { nodes: [initial(plan), credit], complete: true })).state,
    'confirmed',
  );
  assert.equal((await settle(plan, { nodes: [credit], complete: true })).state, 'submitted');
  assert.equal(
    (
      await settle(plan, {
        nodes: [initial(plan), node(meme, wallet, receive(1000000000n))],
        complete: true,
      })
    ).state,
    'failed',
  );
  assert.equal(
    (
      await settle(plan, {
        nodes: [initial(plan), node(meme, own, payout(URANUS_OP.excesses))],
        complete: true,
      })
    ).state,
    'submitted',
  );
  assert.equal(
    (await settle(plan, { nodes: [initial(plan), { ...credit, success: false }], complete: true }))
      .state,
    'failed',
  );
  f.values.walletOwner = stranger;
  await assert.rejects(
    settle(plan, { nodes: [initial(plan), credit], complete: true }),
    (e) => e.code === 'uranus_state',
  );
});

test('sell and creator fee settlement accept only explicit causal Payout messages and reject refunds and downstream failures', async () => {
  const f = fixture();
  const plan = await f.uranus.planners.uranus_sell.plan(
    { token: meme, amount: '1', min_out: '0.5' },
    'sell',
  );
  const curve = node(
    wallet,
    meme,
    boc(
      beginCell()
        .storeUint(URANUS_OP.sellToMeme, 32)
        .storeUint(0, 64)
        .storeCoins(1000000000n)
        .storeCoins(500000000n)
        .storeAddress(Address.parse(own))
        .storeAddress(Address.parse(own))
        .storeBit(false)
        .storeBit(false)
        .endCell(),
    ),
  );
  const paid = node(meme, own, payout());
  const settle = f.uranus.planners.uranus_sell.settle;
  const result = await settle(plan, { nodes: [initial(plan), curve, paid], complete: true });
  assert.equal(result.state, 'confirmed');
  assert.equal(result.received_ton, '1');
  assert.equal(result.sold_tokens_confirmed, '1');
  assert.equal(
    (
      await settle(plan, {
        nodes: [initial(plan), curve, node(meme, own, payout(URANUS_OP.excesses))],
        complete: true,
      })
    ).state,
    'submitted',
  );
  assert.equal(
    (await settle(plan, { nodes: [initial(plan), { ...curve, success: false }], complete: true }))
      .state,
    'failed',
  );
  const claim = await f.uranus.planners.uranus_claim_fees.plan({ token: meme }, 'claim');
  assert.equal(
    (
      await f.uranus.planners.uranus_claim_fees.settle(claim, {
        nodes: [initial(claim), paid],
        complete: true,
      })
    ).state,
    'confirmed',
  );
  assert.equal(
    (await settle(plan, { nodes: [initial(plan)], complete: false })).state,
    'submitted',
  );
});

test('deployment settlement proves the causal child init, creator and metadata; initial buy additionally needs actual mint', async () => {
  const f = fixture();
  const make = async (initialBuy) => {
    const plan = await f.uranus.planners.uranus_deploy.plan(
      { preset_id: 7, metadata_uri: f.values.metadataUri, initial_buy: initialBuy },
      'deploy',
    );
    const factory = plan.message.destination;
    const initBody = boc(
      beginCell()
        .storeUint(URANUS_OP.init, 32)
        .storeUint(0, 64)
        .storeCoins(BigInt(plan.receipt.initialBuy))
        .storeBit(false)
        .storeBit(false)
        .endCell(),
    );
    const child = node(factory, meme, initBody);
    const root = initial(plan);
    root.out = [{ ...child.in, initHash: meme.split(':')[1] }];
    return { plan, nodes: [root, child] };
  };
  const simple = await make('0');
  const settle = f.uranus.planners.uranus_deploy.settle;
  assert.equal(
    (await settle(simple.plan, { nodes: simple.nodes, complete: true })).state,
    'confirmed',
  );
  f.values.metadataUri = 'https://metadata.example/different.json';
  assert.equal(
    (await settle(simple.plan, { nodes: simple.nodes, complete: true })).state,
    'failed',
  );
  f.values.metadataUri = simple.plan.receipt.metadataUri;
  f.values.creator = stranger;
  assert.equal(
    (await settle(simple.plan, { nodes: simple.nodes, complete: true })).state,
    'failed',
  );
  f.values.creator = own;
  const withBuy = await make('1');
  assert.equal(
    (await settle(withBuy.plan, { nodes: withBuy.nodes, complete: true })).state,
    'submitted',
  );
  assert.equal(
    (
      await settle(withBuy.plan, {
        nodes: [...withBuy.nodes, node(meme, wallet, receive(2000000000n))],
        complete: true,
      })
    ).state,
    'confirmed',
  );
  assert.equal(decodeUranusMessage(payout(URANUS_OP.excesses)).opcode, URANUS_OP.excesses);
});
