import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Address, beginCell, Cell, TupleReader } from '@ton/core';
import { createAssetPlanners } from '../src/adapters/assets/index.js';
import {
  assetAmount,
  assetQueryId,
  jettonTransferBody,
  nftTransferBody,
} from '../src/domain/assets/transfers.js';

const address = (byte) => new Address(0, Buffer.alloc(32, byte));
const owner = address(0),
  recipient = address(1),
  master = address(2),
  senderWallet = address(3),
  recipientWallet = address(4),
  item = address(5);
const slice = (value) => ({ type: 'slice', cell: beginCell().storeAddress(value).endCell() });
const num = (value) => ({ type: 'int', value: BigInt(value) });
const code = { type: 'cell', cell: beginCell().endCell() };
const tuple = (...items) => ({ stack: new TupleReader(items) });

function fixture() {
  const state = { balance: 1500001n, nftOwner: owner, wrongMaster: false, recipientDeployed: true };
  const chain = {
    account: async (target) => ({
      state:
        target === recipientWallet.toRawString() && !state.recipientDeployed
          ? 'uninitialized'
          : 'active',
    }),
    runGetMethod: async (target, method, args) => {
      if (method === 'get_wallet_address') {
        assert.equal(target, master.toRawString());
        return tuple(
          slice(
            args[0].cell.beginParse().loadAddress().equals(owner) ? senderWallet : recipientWallet,
          ),
        );
      }
      if (method === 'get_wallet_data') {
        const sender = target === senderWallet.toRawString();
        return tuple(
          num(sender ? state.balance : 0),
          slice(sender ? owner : recipient),
          slice(state.wrongMaster ? item : master),
          code,
        );
      }
      if (method === 'get_nft_data')
        return tuple(num(-1), num(1), slice(master), slice(state.nftOwner), code);
      throw new Error('Unexpected getter ' + method);
    },
  };
  return {
    state,
    chain,
    planners: createAssetPlanners({
      chain,
      walletAddress: owner.toRawString(),
      network: 'mainnet',
    }),
  };
}

function origin(plan, success = true) {
  return {
    address: plan.message.destination,
    hash: 'origin-tx',
    success,
    in: {
      source: plan.receipt.wallet,
      destination: plan.message.destination,
      valueNano: plan.message.amountNano,
      bodyBoc: plan.message.bodyBoc,
      createdLt: '111',
      bounced: false,
    },
    out: [],
  };
}

function jettonReceipt(plan, source) {
  const body = beginCell()
    .storeUint(0x178d4519, 32)
    .storeUint(BigInt(plan.receipt.queryId), 64)
    .storeCoins(BigInt(plan.receipt.amountRaw))
    .storeAddress(owner)
    .storeAddress(owner)
    .storeCoins(0)
    .storeBit(false)
    .endCell();
  const message = {
    source: senderWallet.toRawString(),
    destination: recipientWallet.toRawString(),
    valueNano: '20000000',
    bodyBoc: body.toBoc().toString('base64'),
    createdLt: '222',
    bodyHash: body.hash().toString('hex'),
    bounced: false,
  };
  source.out.push(message);
  return {
    address: recipientWallet.toRawString(),
    hash: 'recipient-tx',
    success: true,
    in: { ...message },
    out: [],
  };
}

test('TEP-74 and TEP-62 payloads match independent Go typed-serializer vectors', async () => {
  const golden = JSON.parse(
    await readFile(new URL('./fixtures/asset-transfer-vectors.json', import.meta.url), 'utf8'),
  );
  const args = {
    queryId: BigInt(golden.query_id),
    recipient: Address.parse(golden.recipient),
    responseTo: Address.parse(golden.owner),
  };
  for (const [kind, body] of [
    ['jetton', jettonTransferBody({ ...args, amountRaw: BigInt(golden.amount_raw) })],
    ['nft', nftTransferBody(args)],
  ]) {
    assert.equal(body.hash().toString('hex'), golden[kind + '_body_hash']);
    assert.equal(
      Cell.fromBoc(Buffer.from(golden[kind + '_body_hex'], 'hex'))[0].equals(body),
      true,
    );
  }
  assert.equal(assetAmount('1.500001', 6), 1500001n);
  assert.equal(assetQueryId('stable-operation'), assetQueryId('stable-operation'));
  assert.notEqual(assetQueryId('other-operation'), assetQueryId('stable-operation'));
  for (const input of ['0', '-1', '1e3', '0.0000001', '9'.repeat(38)])
    assert.throws(() => assetAmount(input, 6));
});

test('jetton planner verifies owner/master and exact token balance, preserving fixed contract payload and gas', async () => {
  const f = fixture(),
    planner = f.planners.jetton_send;
  const plan = await planner.plan(
    { address: master.toRawString(), to: recipient.toRawString(), amount: '1.500001', decimals: 6 },
    'send-one',
  );
  assert.equal(plan.message.destination, senderWallet.toRawString());
  assert.equal(plan.message.amountNano, '50000000');
  assert.equal(plan.receipt.amountRaw, '1500001');
  assert.equal(plan.receipt.recipientWallet, recipientWallet.toRawString());
  assert.match(plan.summary, /MAINNET/);
  assert.match(plan.summary, /1.500001/);
  JSON.stringify(plan);
  const immutableBody = plan.message.bodyBoc;
  await planner.revalidate(plan);
  assert.equal(plan.message.bodyBoc, immutableBody);
  f.state.balance = 1n;
  await assert.rejects(planner.revalidate(plan), /no longer has enough/);
  await assert.rejects(
    planner.plan(
      { address: master.toRawString(), to: recipient.toRawString(), amount: '2' },
      'too-much',
    ),
    /insufficient/,
  );
  f.state.wrongMaster = true;
  await assert.rejects(planner.revalidate(plan), /does not match/);
  assert.throws(
    () =>
      planner.validate({
        address: master.toRawString(),
        to: recipient.toString({ testOnly: true }),
        amount: '1',
      }),
    /Invalid TON address/,
  );
});

test('jetton settlement requires the emitted exact internal_transfer and its successful recipient transaction', async () => {
  const f = fixture(),
    planner = f.planners.jetton_send;
  const plan = await planner.plan(
    { address: master.toRawString(), to: recipient.toRawString(), amount: '1', decimals: 6 },
    'send-two',
  );
  const sent = origin(plan),
    received = jettonReceipt(plan, sent);
  assert.equal((await planner.settle(plan, { nodes: [], complete: false })).state, 'submitted');
  assert.equal(
    (await planner.settle(plan, { nodes: [received], complete: true })).state,
    'submitted',
  );
  assert.equal((await planner.settle(plan, { nodes: [sent], complete: false })).state, 'submitted');
  const mismatch = { ...received, in: { ...received.in, createdLt: 'unrelated' } };
  assert.equal(
    (await planner.settle(plan, { nodes: [sent, mismatch], complete: true })).state,
    'submitted',
  );
  assert.equal(
    (await planner.settle(plan, { nodes: [sent, received], complete: true })).state,
    'confirmed',
  );
  received.success = false;
  assert.equal(
    (await planner.settle(plan, { nodes: [sent, received], complete: true })).state,
    'failed',
  );
  assert.equal(
    (await planner.settle(plan, { nodes: [origin(plan, false)], complete: true })).state,
    'failed',
  );
});

test('jetton evidence with changed amount/query ID or a wrong master never confirms', async () => {
  const f = fixture(),
    planner = f.planners.jetton_send;
  const plan = await planner.plan(
    { address: master.toRawString(), to: recipient.toRawString(), amount: '1', decimals: 6 },
    'send-three',
  );
  const sent = origin(plan);
  const altered = JSON.parse(JSON.stringify(plan));
  altered.receipt.amountRaw = '9';
  const received = jettonReceipt(altered, sent);
  assert.equal(
    (await planner.settle(plan, { nodes: [sent, received], complete: true })).state,
    'submitted',
  );
  const newSent = origin(plan),
    good = jettonReceipt(plan, newSent);
  f.state.wrongMaster = true;
  await assert.rejects(
    planner.settle(plan, { nodes: [newSent, good], complete: true }),
    /does not match/,
  );
});

test('NFT confirmation rechecks actual ownership; settlement needs causal transfer and resulting new owner', async () => {
  const f = fixture(),
    planner = f.planners.nft_send;
  const plan = await planner.plan(
    { nft_address: item.toRawString(), to: recipient.toRawString() },
    'nft-one',
  );
  assert.equal(plan.message.destination, item.toRawString());
  assert.equal(plan.message.amountNano, '50000000');
  await planner.revalidate(plan);
  assert.equal(
    (await planner.settle(plan, { nodes: [origin(plan)], complete: true })).state,
    'submitted',
  );
  f.state.nftOwner = recipient;
  await assert.rejects(planner.revalidate(plan), /does not own/);
  assert.equal((await planner.settle(plan, { nodes: [], complete: true })).state, 'submitted');
  assert.equal(
    (await planner.settle(plan, { nodes: [origin(plan)], complete: true })).state,
    'confirmed',
  );
  assert.equal(
    (await planner.settle(plan, { nodes: [origin(plan, false)], complete: true })).state,
    'failed',
  );
  const wrongSource = origin(plan);
  wrongSource.in.source = recipient.toRawString();
  assert.equal(
    (await planner.settle(plan, { nodes: [wrongSource], complete: true })).state,
    'submitted',
  );
});
