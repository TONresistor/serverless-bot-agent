import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Address, beginCell, Cell, Dictionary } from '@ton/core';
import { Blockchain, createShardAccount, internal } from '@ton/sandbox';
import { PoolConfig } from '@dedust/kit/dist/cpmm-v2/abi/types/PoolConfig.js';
import { Asset } from '@dedust/kit/dist/cpmm-v2/abi/types/Asset.js';
import { Activation } from '@dedust/kit/dist/cpmm-v2/abi/types/Activation.js';
import { FeeIn } from '@dedust/kit/dist/cpmm-v2/abi/types/FeeIn.js';
import { SwapEvent } from '@dedust/kit/dist/cpmm-v2/abi/events/SwapEvent.js';
import { readCpmmState, quoteCpmm } from '../src/domain/swaps/dedust/cpmm.js';
import { buildDedustMessage } from '../src/domain/swaps/dedust/messages.js';
import { inspectDedustSettlement } from '../src/domain/swaps/dedust/settlement.js';
import { messageRecord } from '../src/domain/ton/contract-proof.js';
import { walletContract } from '../src/domain/wallet.js';

const fixtures = JSON.parse(
  await readFile(new URL('./fixtures/swaps/dedust-cpmm-bytecode.json', import.meta.url), 'utf8'),
);
const http = JSON.parse(
  await readFile(new URL('./fixtures/swaps/dedust-http.json', import.meta.url), 'utf8'),
);
const libraryData = JSON.parse(
  await readFile(new URL('./fixtures/swaps/dedust-libraries.json', import.meta.url), 'utf8'),
);
const owner = Address.parse(http.owner);
const libs = Dictionary.empty(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
for (const lib of [...libraryData.libraries, ...fixtures.pools.map((p) => p.library)]) {
  const code = Cell.fromBase64(lib.data);
  assert.equal(code.hash().toString('base64'), lib.hash);
  libs.set(code.hash(), code);
}
const libraries = beginCell().storeDictDirect(libs).endCell();

function configuredData(original, creator, feeIn) {
  const data = Cell.fromBase64(original),
    cfg = PoolConfig.load(data.refs[0].beginParse());
  // kit0.0.4 PoolConfig.store writes activation inline but load expects refs.
  // Keep independent reference serialization for these controlled fee vectors.
  const config = beginCell()
    .store(Asset.store(cfg.assetX))
    .store(Asset.store(cfg.assetY))
    .storeAddress(owner)
    .storeUint(cfg.baseFeeBPS, 16)
    .storeUint(creator, 16)
    .storeMaybeRef(
      cfg.depositActivation
        ? beginCell().store(Activation.store(cfg.depositActivation)).endCell()
        : null,
    )
    .storeMaybeRef(
      cfg.swapActivation ? beginCell().store(Activation.store(cfg.swapActivation)).endCell() : null,
    )
    .store(FeeIn.store({ kind: 'dedust.cpmm.v2.FeeIn', type: feeIn }))
    .storeDict(cfg.customResolvers)
    .storeDict(cfg.allowedRewards)
    .endCell();
  return new Cell({ bits: data.bits, refs: [config, ...data.refs.slice(1)] });
}
const record = (tx) => ({
  address: tx.inMessage.info.dest.toRawString(),
  hash: tx.hash().toString('hex'),
  success:
    tx.description.type === 'generic' &&
    !tx.description.aborted &&
    (!tx.description.actionPhase || tx.description.actionPhase.success) &&
    (tx.description.computePhase.type !== 'vm' || tx.description.computePhase.success),
  in: messageRecord(tx.inMessage),
  out: [...tx.outMessages.values()].map(messageRecord).filter(Boolean),
});

test('DeDust CPMM quotes equal both real mainnet bytecodes for fee strategies, creator shares and both directions', async () => {
  for (const fixture of fixtures.pools)
    for (const creator of [0, 10000])
      for (const feeIn of ['both', 'assetX', 'assetY'])
        for (const native of [true, false]) {
          const data = configuredData(fixture.state.data, creator, feeIn),
            state = readCpmmState({ ...fixture.state, data: data.toBoc().toString('base64') });
          const token = state.assetX === 'TON' ? state.assetY : state.assetX,
            source = native ? 'TON' : token,
            amount = native ? 10000001n : 100000000123n;
          const expected = quoteCpmm(state, source, amount),
            pool = Address.parse(fixture.pool);
          const message = buildDedustMessage(
            { source: { address: source }, inputUnits: amount.toString() },
            {
              version: 'cpmm-v2',
              poolAddress: pool.toRawString(),
              inputWallet: owner.toRawString(),
              minOut: expected.amountOut.toString(),
            },
            owner.toRawString(),
            '77',
            1800000900,
          ).message;
          let body = Cell.fromBase64(message.bodyBoc),
            sender = owner;
          if (!native) {
            const transfer = body.beginParse();
            transfer.skip(96);
            transfer.loadCoins();
            transfer.loadAddress();
            transfer.loadAddress();
            transfer.loadMaybeRef();
            transfer.loadCoins();
            transfer.loadBit();
            body = beginCell()
              .storeUint(0x7362d09c, 32)
              .storeUint(77, 64)
              .storeCoins(amount)
              .storeAddress(owner)
              .storeBit(true)
              .storeRef(transfer.loadRef())
              .endCell();
            sender = state.extra.walletsByAssets.get(Address.parse(token).hash);
          }
          const chain = await Blockchain.create();
          chain.now = 1800000000;
          chain.libs = libraries;
          await chain.setShardAccount(
            pool,
            createShardAccount({
              address: pool,
              code: Cell.fromBase64(fixture.state.code),
              data,
              balance: BigInt(fixture.state.balance),
            }),
          );
          const iter = await chain.sendMessageIter(
              internal({ from: sender, to: pool, value: BigInt(message.amountNano), body }),
            ),
            { value: tx } = await iter.next();
          assert.equal(tx.description.computePhase.exitCode, 0);
          const eventMessage = [...tx.outMessages.values()].find(
            (m) => m.body.bits.length >= 32 && m.body.beginParse().loadUint(32) === 0x78e79ba4,
          );
          assert.ok(eventMessage, 'Swap must execute, not refund');
          const event = SwapEvent.fromCell(eventMessage.body);
          assert.equal(event.amountIn, amount);
          assert.equal(event.amountOut, expected.amountOut);
          assert.equal(
            event.fees.lpFee + event.fees.protocolFee + event.fees.creatorFee,
            expected.feeAmount,
          );
        }
});

async function replay(plan, minimum = plan.receipt.minOut) {
  const chain = await Blockchain.create();
  chain.now = 1800000000;
  chain.libs = libraries;
  // The financial workflow activates the sender wallet before a swap can be
  // submitted. Seed its V5 receive handler at our synthetic fixture address.
  const wallet = walletContract('01'.repeat(32), 'mainnet');
  await chain.setShardAccount(
    owner,
    createShardAccount({ address: owner, ...wallet.init, balance: 1000000000n }),
  );
  for (const [key, response] of Object.entries(http.records)) {
    if (!key.includes('getAddressInformation') || response.result.state !== 'active') continue;
    const request = JSON.parse(JSON.parse(key)[2]),
      state = response.result,
      address = Address.parse(request.params.address);
    await chain.setShardAccount(
      address,
      createShardAccount({
        address,
        code: Cell.fromBase64(state.code),
        data: Cell.fromBase64(state.data),
        balance: BigInt(state.balance),
      }),
    );
  }
  const parsed = { source: { address: plan.receipt.source }, inputUnits: plan.receipt.inputUnits };
  const message = buildDedustMessage(
    parsed,
    { ...plan.receipt, minOut: minimum },
    http.owner,
    plan.receipt.queryId,
    plan.receipt.deadline,
  ).message;
  const result = await chain.sendMessage(
    internal({
      from: owner,
      to: Address.parse(message.destination),
      value: BigInt(message.amountNano),
      body: Cell.fromBase64(message.bodyBoc),
    }),
  );
  return {
    chain,
    result,
    evidence: {
      complete: true,
      nodes: result.transactions.filter((tx) => tx.inMessage?.info.type === 'internal').map(record),
    },
  };
}

test('DeDust vault and CPMM native input settle only after real jetton credit; slippage refunds never become fills', async () => {
  for (const item of http.cases) {
    const plan = item.plan,
      { evidence } = await replay(plan),
      outcome = inspectDedustSettlement(plan.receipt, evidence);
    assert.equal(
      outcome.state,
      'confirmed',
      JSON.stringify({
        case: item.name,
        nodes: evidence.nodes.map((n) => ({
          address: n.address,
          success: n.success,
          opcode: Cell.fromBase64(n.in.bodyBoc).beginParse().loadUint(32).toString(16),
        })),
      }),
    );
    assert.ok(BigInt(outcome.amountOutRaw) >= BigInt(plan.receipt.minOut));
    const partial = structuredClone(evidence);
    partial.nodes = partial.nodes.filter((n) => n.address !== plan.receipt.outputWallet);
    assert.equal(inspectDedustSettlement(plan.receipt, partial).state, 'submitted');
    for (const tamper of [
      (n) => {
        n.success = false;
      },
      (n) => {
        n.in.bounced = true;
      },
      (n) => {
        n.in.source = http.owner;
      },
      (n) => {
        n.in.bodyBoc = Cell.EMPTY.toBoc().toString('base64');
      },
    ]) {
      const altered = structuredClone(evidence);
      altered.nodes.filter((n) => n.address === plan.receipt.outputWallet).forEach(tamper);
      assert.equal(inspectDedustSettlement(plan.receipt, altered).state, 'submitted');
    }
    const rejected = await replay(plan, (1n << 119n).toString());
    assert.equal(
      inspectDedustSettlement(plan.receipt, rejected.evidence).state,
      'failed',
      JSON.stringify({ case: item.name, nodes: rejected.evidence.nodes }),
    );
  }
});

test('DeDust reverse swaps follow real owner jetton transfers and count native principal without gas excess', async () => {
  for (const item of http.cases) {
    const { chain, evidence: bought } = await replay(item.plan),
      original = item.plan.receipt;
    const amount = inspectDedustSettlement(original, bought).amountOutRaw;
    const receipt = {
      ...original,
      source: original.output,
      output: 'TON',
      inputUnits: amount,
      minOut: '1',
      queryId: '123',
      inputVault: original.outputVault,
      outputVault: original.inputVault,
      inputPoolWallet: original.outputPoolWallet,
      outputPoolWallet: original.inputPoolWallet,
      inputWallet: original.outputWallet,
      outputWallet: http.owner,
    };
    const saved = await chain.snapshot();
    async function sell(minOut) {
      const { message } = buildDedustMessage(
        { source: { address: receipt.source }, inputUnits: amount },
        { ...receipt, minOut },
        http.owner,
        receipt.queryId,
        receipt.deadline,
      );
      const result = await chain.sendMessage(
        internal({
          from: owner,
          to: Address.parse(message.destination),
          value: BigInt(message.amountNano),
          body: Cell.fromBase64(message.bodyBoc),
        }),
      );
      return {
        complete: true,
        nodes: result.transactions
          .filter((tx) => tx.inMessage?.info.type === 'internal')
          .map(record),
      };
    }
    const evidence = await sell('1'),
      result = inspectDedustSettlement(receipt, evidence);
    assert.equal(result.state, 'confirmed', item.name);
    assert.ok(
      BigInt(result.amountOutRaw) > 0n && BigInt(result.amountOutRaw) < BigInt(original.inputUnits),
      'Roundtrip output excludes excess gas',
    );
    const missingCredit = {
      ...evidence,
      nodes: evidence.nodes.filter((node) => node.address !== http.owner),
    };
    assert.equal(inspectDedustSettlement(receipt, missingCredit).state, 'submitted');
    const forged = structuredClone(evidence);
    for (const node of forged.nodes)
      if (node.address === http.owner) {
        node.in.bodyBoc = beginCell()
          .storeUint(0xd53276db, 32)
          .storeUint(BigInt(receipt.queryId), 64)
          .endCell()
          .toBoc()
          .toString('base64');
        node.in.valueNano = '1000000000000';
      }
    assert.equal(inspectDedustSettlement(receipt, forged).state, 'submitted');
    await chain.loadFrom(saved);
    const rejected = await sell((1n << 119n).toString());
    assert.equal(
      inspectDedustSettlement(receipt, rejected).state,
      'failed',
      item.name + ' reverse refund',
    );
    const missingRefund = {
      ...rejected,
      nodes: rejected.nodes.filter((node) => node.address !== receipt.inputWallet),
    };
    assert.equal(inspectDedustSettlement(receipt, missingRefund).state, 'submitted');
  }
});
