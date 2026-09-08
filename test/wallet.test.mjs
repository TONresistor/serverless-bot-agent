import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, beginCell, Cell, external, loadMessage } from '@ton/core';
import { createPublicKey, verify } from 'node:crypto';
import { loadOutListExtendedV5R1 } from '@ton/ton/dist/wallets/v5r1/WalletV5R1Actions.js';
import { createTransfers } from '../src/application/transfers.js';
import { AgentError } from '../src/shared/errors.js';
import {
  parseAmount,
  signTransfer,
  walletContract,
  walletAddress,
  cryptoProbe,
} from '../src/domain/wallet.js';
import { inspectTransfer, inspectReceipt } from '../src/domain/transaction-proof.js';
import { scanTransactions } from '../src/application/transaction-scan.js';
import { createTonClient } from '../src/adapters/ton-client.js';
import {
  fixture,
  config,
  publicKey,
  secretKey,
  address,
  recipient,
  callback,
  transaction,
  internalMessage,
} from './helpers.mjs';

const decision = (...args) => {
  const c = callback(...args);
  return { data: c.data, actorId: c.from.id, messageId: c.message.message_id };
};

const service = (f, store = f.store) =>
  createTransfers({
    operations: store,
    telegram: f.api,
    ton: f.ton,
    config,
    sign: async (args) => signTransfer({ ...args, publicKey, secretKey, network: config.network }),
    now: f.now,
  });
const prepare = (s, key = 'test-operation') =>
  s.prepare({ to: recipient.toRawString(), amount: '0.01', comment: 'test' }, key);

test('exact amounts and V5R1 network derivation', () => {
  assert.equal(parseAmount('123456.123456789'), 123456123456789n);
  for (const input of [0.1, '0', '-1', '1e3', '0.0000000001', 'Infinity'])
    assert.throws(() => parseAmount(input));
  assert.notEqual(walletAddress(publicKey, 'mainnet'), walletAddress(publicKey, 'testnet'));
  assert.equal(cryptoProbe().valid, true);
});

test('signed transfer includes deploy StateInit and preserves amount/destination', () => {
  const signed = signTransfer({
    publicKey,
    secretKey,
    network: 'mainnet',
    destination: recipient.toRawString(),
    amountNano: '10000000',
    comment: 'test',
    seqno: 0,
    state: 'uninitialized',
    destinationState: 'uninitialized',
    now: 1_000_000,
  });
  const message = loadMessage(Cell.fromBase64(signed.boc).beginParse());
  assert.equal(message.info.type, 'external-in');
  assert.ok(message.info.dest.equals(Address.parse(address)));
  assert.ok(message.init);
  assert.equal(message.body.hash().toString('hex'), signed.bodyHash);
  assert.equal(signed.validUntil, 1120);
  const payloadBuilder = beginCell().storeBits(
    message.body.bits.substring(0, message.body.bits.length - 512),
  );
  for (const ref of message.body.refs) payloadBuilder.storeRef(ref);
  const payload = payloadBuilder.endCell();
  const signature = message.body
    .beginParse()
    .skip(message.body.bits.length - 512)
    .loadBuffer(64);
  const verificationKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(publicKey, 'hex'),
    ]),
    format: 'der',
    type: 'spki',
  });
  assert.equal(verify(null, payload.hash(), verificationKey, signature), true);
  const slice = payload.beginParse();
  assert.equal(slice.loadUint(32), 0x7369676e);
  slice.skip(32);
  assert.equal(slice.loadUint(32), signed.validUntil);
  assert.equal(slice.loadUint(32), 0);
  const actions = loadOutListExtendedV5R1(slice);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'sendMsg');
  assert.ok(actions[0].outMsg.info.dest.equals(recipient));
  assert.equal(actions[0].outMsg.info.value.coins, 10_000_000n);
});

test('requires the real external-in wallet transaction, ignoring internal body copies', () => {
  const body = beginCell().storeUint(123, 32).endCell();
  const outgoing = internalMessage();
  const actual = transaction({
    inbound: external({ to: Address.parse(address), body }),
    outbound: [outgoing],
  });
  const copied = transaction({
    inbound: internalMessage({ from: recipient, to: address, body }),
    aborted: true,
  });
  const result = inspectTransfer([copied, actual], {
    wallet: address,
    bodyHash: body.hash().toString('hex'),
    destination: recipient.toRawString(),
    amountNano: '10000000',
  });
  assert.equal(result.state, 'sent');
  assert.equal(
    inspectTransfer([copied], {
      wallet: address,
      bodyHash: body.hash().toString('hex'),
      destination: recipient.toRawString(),
      amountNano: '10000000',
    }).state,
    'unknown',
  );
});

test('a non-bounce deposit credits an uninitialized recipient despite aborted computation', () => {
  const inbound = internalMessage();
  const received = transaction({
    account: recipient,
    inbound,
    aborted: true,
    skipped: true,
    credit: 10_000_000n,
  });
  const input = {
    wallet: address,
    destination: recipient.toRawString(),
    amountNano: '10000000',
    createdLt: '110',
    bodyHash: inbound.body.hash().toString('hex'),
  };
  assert.equal(inspectReceipt([received], input).state, 'confirmed');
  const bounced = transaction({
    account: recipient,
    inbound: internalMessage({ bounce: true }),
    aborted: true,
    skipped: true,
    credit: 10_000_000n,
  });
  assert.equal(inspectReceipt([bounced], input).state, 'failed');
});

test('pagination finds a result beyond the most recent page and bounds work', async () => {
  let count = 0;
  const ton = {
    transactions: async (_address, cursor) => {
      count++;
      if (cursor) return [{ found: true }];
      return Array.from({ length: 100 }, (_, i) => ({
        transaction_id: { lt: String(1000 - i), hash: 'cursor' },
      }));
    },
  };
  const result = await scanTransactions(ton, address, (rows) => ({
    state: rows.some((r) => r.found) ? 'sent' : 'unknown',
  }));
  assert.equal(result.result.state, 'sent');
  assert.equal(count, 2);
});

test('confirmation is owner-only, cancellable, expires and cannot broadcast twice', async () => {
  const f = await fixture(),
    s = service(f);
  const pending = await prepare(s);
  assert.match(await s.decide(decision(pending.transfer_id, 'confirm', 999)), /Invalid/);
  assert.match(await s.decide(decision(pending.transfer_id, 'cancel')), /cancelled/);
  assert.match(await s.decide(decision(pending.transfer_id)), /already/);
  assert.equal(f.broadcasts.length, 0);
  const next = await prepare(s, 'next');
  f.setTime(f.now() + 300_001);
  assert.match(await s.decide({ ...decision(next.transfer_id), messageId: 2 }), /expired/);
  const last = await prepare(s, 'last');
  const cb = { ...decision(last.transfer_id), messageId: 3 };
  await Promise.all([s.decide(cb), s.decide(cb)]);
  assert.equal(f.broadcasts.length, 1);
  f.database.close();
});

test('a stale expiry read cannot release a wallet advanced to in-flight', async () => {
  const f = await fixture();
  const s = service(f);
  const pending = await prepare(s);
  const id = `transfer:${pending.transfer_id}`,
    original = await f.store.operation(id);
  await f.store.acquireWallet(id);
  await f.store.transition(id, ['pending'], 'preparing', original.data);
  let raced = false;
  const wrapped = {
    ...f.store,
    async operation(key) {
      const row = await f.store.operation(key);
      if (key === id && !raced) {
        raced = true;
        await f.store.prepareBroadcast(id, { ...row.data, signed: { bodyHash: 'x' } });
        f.setTime(row.expires_at + 1);
      }
      return row;
    },
  };
  await service(f, wrapped).reconcile();
  assert.equal((await f.store.operation(id)).state, 'in_flight');
  assert.equal((await f.store.operation('lock:wallet')).state, 'held');
  f.database.close();
});

test('a cancel racing with confirmation does not falsely report cancellation', async () => {
  const f = await fixture(),
    s = service(f);
  const pending = await prepare(s),
    id = `transfer:${pending.transfer_id}`;
  const wrapped = {
    ...f.store,
    async operation(key) {
      const row = await f.store.operation(key);
      if (key === id && row.state === 'pending')
        await f.store.transition(id, ['pending'], 'preparing', row.data);
      return row;
    },
  };
  const result = await service(f, wrapped).decide(decision(pending.transfer_id, 'cancel'));
  assert.doesNotMatch(result, /cancelled/);
  assert.equal((await f.store.operation(id)).state, 'preparing');
  f.database.close();
});

test('unknown broadcast is not repeated; proven expiry with unchanged snapshot seqno releases it', async () => {
  const f = await fixture();
  let sends = 0;
  f.ton.broadcast = async () => {
    sends++;
    throw new Error('connection lost');
  };
  const s = service(f),
    pending = await prepare(s);
  assert.match(await s.decide(decision(pending.transfer_id)), /uncertain/);
  await s.decide(decision(pending.transfer_id));
  assert.equal(sends, 1);
  assert.equal((await f.store.operation('lock:wallet')).state, 'held');
  const operation = await f.store.operation(`transfer:${pending.transfer_id}`);
  f.ton.walletState = async () => ({
    state: 'uninitialized',
    balance: '1000000000',
    seqno: 0,
    chainTime: operation.data.signed.validUntil + 61,
  });
  assert.equal((await s.reconcile()).state, 'failed');
  assert.equal((await f.store.operation('lock:wallet')).state, 'released');
  f.database.close();
});

test('explicit provider rate-limit rejection does not leave a permanent wallet lock', async () => {
  const f = await fixture();
  f.ton.broadcast = async () => {
    throw new AgentError('rate_limited', 'limited');
  };
  const s = service(f),
    pending = await prepare(s);
  await s.decide(decision(pending.transfer_id));
  assert.equal((await f.store.operation(`transfer:${pending.transfer_id}`)).state, 'failed');
  assert.equal((await f.store.operation('lock:wallet')).state, 'released');
  f.database.close();
});

test('reads wallet seqno and chain time from one validated account snapshot', async () => {
  const wallet = walletContract(publicKey, 'mainnet');
  const init = wallet.init.data.beginParse();
  init.skip(33);
  const data = beginCell()
    .storeBit(true)
    .storeUint(7, 32)
    .storeUint(init.loadUint(32), 32)
    .storeBuffer(Buffer.from(publicKey, 'hex'))
    .storeBit(false)
    .endCell();
  const result = {
    balance: '1000',
    state: 'active',
    code: wallet.init.code.toBoc().toString('base64'),
    data: data.toBoc().toString('base64'),
    sync_utime: 1234,
    last_transaction_id: { lt: '123' },
  };
  const ton = createTonClient(
    async () => new Response(JSON.stringify({ ok: true, result })),
    'mainnet',
  );
  assert.deepEqual(await ton.walletState(address, publicKey), {
    balance: '1000',
    state: 'active',
    seqno: 7,
    chainTime: 1234,
    lastTransaction: { lt: '123' },
  });
});
