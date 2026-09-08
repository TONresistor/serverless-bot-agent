import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, beginCell, Cell, external, loadMessage } from '@ton/core';
import { loadOutListExtendedV5R1 } from '@ton/ton/dist/wallets/v5r1/WalletV5R1Actions.js';
import { createFinancialOperations } from '../src/application/finance/operations.js';
import { collectContractTrace } from '../src/application/finance/trace.js';
import { messageRecord, findSubmission } from '../src/domain/ton/contract-proof.js';
import { signContractMessage } from '../src/domain/wallet.js';
import { AgentError } from '../src/shared/errors.js';
import {
  fixture,
  config,
  publicKey,
  secretKey,
  address,
  recipient,
  transaction,
  internalMessage,
} from './helpers.mjs';

const body = beginCell().storeUint(0x12345678, 32).storeUint(7, 64).endCell();
const plan = () => ({
  summary: 'Transfer one test asset to the approved recipient.',
  message: {
    destination: recipient.toRawString(),
    amountNano: '50000000',
    bodyBoc: body.toBoc().toString('base64'),
    bounce: true,
  },
  receipt: { kind: 'test' },
});
function service(
  f,
  {
    planner = {},
    report = () => {},
    chain = f.ton,
    authorize = async () => {},
    sign = async (args) =>
      signContractMessage({ ...args, publicKey, secretKey, network: 'mainnet' }),
  } = {},
) {
  return createFinancialOperations({
    report,
    operations: f.repositories.operations,
    telegram: f.api,
    chain,
    config: { ...config, walletAddress: address },
    planners: {
      jetton_send: {
        plan: async () => plan(),
        revalidate: async () => {},
        settle: async () => ({ state: 'submitted' }),
        ...planner,
      },
    },
    authorize,
    sign,
    reconcileLegacy: async () => null,
    now: f.now,
  });
}
const decision = (op, action = 'confirm', actorId = 42, messageId = 1) => ({
  data: `action_${action}:${op.operation_id.slice(7)}`,
  actorId,
  messageId,
});

test('contract signing preserves the exact body, value, destination and standard V5R1 envelope', () => {
  const signed = signContractMessage({
    publicKey,
    secretKey,
    network: 'mainnet',
    message: plan().message,
    seqno: 0,
    state: 'uninitialized',
    now: 1000000,
  });
  const message = loadMessage(Cell.fromBase64(signed.boc).beginParse());
  assert.ok(message.init);
  const slice = message.body.beginParse();
  assert.equal(slice.loadUint(32), 0x7369676e);
  slice.skip(32);
  assert.equal(slice.loadUint(32), 1120);
  assert.equal(slice.loadUint(32), 0);
  const actions = loadOutListExtendedV5R1(slice);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].mode, 3);
  assert.equal(actions[0].outMsg.info.dest.toRawString(), recipient.toRawString());
  assert.equal(actions[0].outMsg.info.value.coins, 50000000n);
  assert.ok(actions[0].outMsg.body.equals(body));
});

test('contract callbacks require bound owner/message and cannot duplicate an uncertain broadcast', async () => {
  const f = await fixture(),
    s = service(f);
  const op = await s.prepare('jetton_send', {}, 'first');
  assert.match(await s.decide(decision(op, 'confirm', 9)), /Invalid/);
  assert.match(await s.decide(decision(op, 'confirm', 42, 999)), /Invalid/);
  await Promise.all([s.decide(decision(op)), s.decide(decision(op))]);
  assert.equal(f.broadcasts.length, 1);
  assert.ok((await f.store.operation(op.operation_id)).data.signed);
  assert.match(await s.decide(decision(op)), /already/);
  assert.equal(f.broadcasts.length, 1);
});

test('revoked or changed approvals cannot sign; cancellation and expiry never broadcast', async () => {
  const f = await fixture();
  let signed = 0,
    allowed = true;
  const s = service(f, {
    authorize: async () => {
      if (!allowed) throw new AgentError('tool_forbidden', 'Disabled');
    },
    sign: async () => {
      signed++;
      throw new Error('Must not sign');
    },
    planner: {
      revalidate: async () => {
        allowed = false;
      },
    },
  });
  const op = await s.prepare('jetton_send', {}, 'revoke');
  assert.match(await s.decide(decision(op)), /Disabled/);
  assert.equal(signed, 0);
  assert.equal(f.broadcasts.length, 0);
  assert.equal((await f.store.operation('lock:wallet')).state, 'released');
  allowed = true;
  const cancelled = await s.prepare('jetton_send', {}, 'cancel');
  assert.match(await s.decide(decision(cancelled, 'cancel', 42, 2)), /cancelled/);
  const expired = await s.prepare('jetton_send', {}, 'expired');
  f.setTime(f.now() + 300001);
  assert.match(await s.decide(decision(expired, 'confirm', 42, 3)), /expired/);
});

async function seeded(f, state = 'in_flight', accepted = false) {
  const extBody = beginCell().storeUint(111, 32).endCell();
  const outgoing = internalMessage({
    to: recipient,
    amount: 50000000n,
    body,
    lt: 110n,
    bounce: true,
  });
  const walletTx = transaction({
    inbound: external({ to: Address.parse(address), body: extBody }),
    outbound: [outgoing],
  });
  const submission = findSubmission([walletTx], {
    wallet: address,
    bodyHash: extBody.hash().toString('hex'),
    message: plan().message,
  });
  const data = {
    tool: 'jetton_send',
    wallet: address,
    plan: plan(),
    signed: { bodyHash: extBody.hash().toString('hex'), seqno: 0, validUntil: 1120, beforeLt: '0' },
    ...(accepted ? { submission } : {}),
  };
  await f.store.claim('action:seed', 'contract_action', state, data);
  await f.store.acquireWallet('action:seed');
  return { walletTx, outgoing, submission };
}

test('restart releases a matching lock when wallet acceptance was already saved', async () => {
  const f = await fixture();
  await seeded(f, 'submitted', true);
  const row = await service(f).reconcile('action:seed');
  assert.equal(row.state, 'submitted');
  assert.equal(row.data.submission.state, 'accepted');
  assert.equal((await f.store.operation('lock:wallet')).state, 'released');
});

test('a stale unknown reconciliation cannot erase acceptance or regress its phase', async () => {
  const f = await fixture(),
    { walletTx } = await seeded(f);
  let n = 0,
    release,
    ready;
  const waiting = new Promise((r) => {
      ready = r;
    }),
    gate = new Promise((r) => {
      release = r;
    });
  const chain = {
    ...f.ton,
    transactions: async (a) => (a === address ? (n++ === 0 ? [] : [walletTx]) : []),
    walletState: async () => {
      ready();
      await gate;
      return { seqno: 0, chainTime: 1000 };
    },
  };
  const s = service(f, { chain }),
    slow = s.reconcile('action:seed');
  await waiting;
  await s.reconcile('action:seed');
  release();
  await slow;
  const row = await f.store.operation('action:seed');
  assert.equal(row.state, 'submitted');
  assert.equal(row.data.submission.state, 'accepted');
  assert.equal((await f.store.operation('lock:wallet')).state, 'released');
});

test('receipt traversal paginates past busy accounts and resumes saved per-message cursors', async () => {
  const outgoing = internalMessage({
    to: recipient,
    amount: 50000000n,
    body,
    lt: 110n,
    bounce: true,
  });
  const expected = messageRecord(outgoing);
  const receipt = transaction({ account: recipient, inbound: outgoing, lt: 120n });
  let calls = 0;
  const chain = {
    transactions: async (_a, cursor) => {
      calls++;
      return cursor
        ? [receipt]
        : Array.from({ length: 100 }, (_, i) => ({
            transaction_id: { lt: String(1000 - i), hash: 'cursor' },
          }));
    },
  };
  const evidence = await collectContractTrace(chain, expected);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.nodes.length, 1);
  assert.equal(calls, 2);
  let page = 0;
  const paged = {
    transactions: async (_a, cursor) => {
      if (cursor?.lt === '601') return [receipt];
      const start = 1000 - page++ * 100;
      return Array.from({ length: 100 }, (_, i) => ({
        transaction_id: { lt: String(start - i), hash: 'cursor' },
      }));
    },
  };
  const first = await collectContractTrace(paged, expected);
  assert.equal(first.complete, false);
  assert.equal(Object.keys(first.cursors).length, 1);
  const second = await collectContractTrace(paged, expected, first);
  assert.equal(second.nodes.length, 1);
  assert.equal(second.complete, true);
});

test('temporary RPC limits preserve verified trace nodes for the next status check', async () => {
  const sink = new Address(0, Buffer.alloc(32, 9));
  const first = internalMessage({ to: recipient, amount: 50000000n, body, lt: 110n, bounce: true });
  const child = internalMessage({
    from: recipient,
    to: sink,
    amount: 10000000n,
    body,
    lt: 120n,
    bounce: true,
  });
  const root = transaction({ account: recipient, inbound: first, outbound: [child], lt: 120n });
  const received = transaction({ account: sink, inbound: child, lt: 130n });
  const partial = await collectContractTrace(
    {
      transactions: async (a) => {
        if (a === recipient.toRawString()) return [root];
        throw new AgentError('rate_limited', 'Limited');
      },
    },
    messageRecord(first),
  );
  assert.equal(partial.complete, false);
  assert.equal(partial.nodes.length, 1);
  assert.deepEqual(partial.readErrors, ['rate_limited']);
  const resumed = await collectContractTrace(
    {
      transactions: async (a) => {
        assert.equal(a, sink.toRawString());
        return [received];
      },
    },
    messageRecord(first),
    partial,
  );
  assert.equal(resumed.complete, true);
  assert.equal(resumed.nodes.length, 2);
  assert.equal(resumed.readErrors, undefined);
});

test('handled financial failures emit diagnostics without changing uncertainty rules', async () => {
  const f = await fixture(),
    reports = [];
  const flow = service(f, {
    chain: {
      ...f.ton,
      broadcast: async () => {
        throw new TypeError('private provider detail');
      },
    },
    report: (_error, context) => reports.push(context),
  });
  const op = await flow.prepare('jetton_send', {}, 'diagnostic-finance');
  const result = await flow.decide(decision(op));
  assert.match(result, /uncertain/);
  assert.equal((await f.repositories.operations.operation(op.operation_id)).state, 'unknown');
  assert.ok(
    reports.some(
      (row) => row.phase === 'financial_broadcast' && row.operationId === op.operation_id,
    ),
  );
});
