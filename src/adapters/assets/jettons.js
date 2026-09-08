import { beginCell } from '@ton/core';
import { chainAddress, friendlyAddress, nonnegative } from '../../domain/chain/values.js';
import {
  assetAmount,
  assetQueryId,
  jettonTransferBody,
  internalJettonTransfer,
} from '../../domain/assets/transfers.js';
import { matchingOrigin, sameAddress, emittedReceipt } from '../../domain/assets/evidence.js';
import { AgentError } from '../../shared/errors.js';

/** @param {import('../../contracts/chain.js').ChainOptions} options */
export function createJettonSendPlanner({ chain, walletAddress, network }) {
  const wallet = chainAddress(walletAddress, network);
  function validate(args) {
    chainAddress(args.address, network);
    chainAddress(args.to, network);
    assetAmount(args.amount, args.decimals ?? 9);
  }
  async function holding(master, owner) {
    const resolved = await chain.runGetMethod(master.toRawString(), 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
    ]);
    const address = resolved.stack.readAddress();
    const state = await chain.account(address.toRawString());
    if (state.state === 'uninitialized') return { address, balance: 0n };
    if (state.state !== 'active')
      throw new AgentError('jetton_unavailable', 'The jetton wallet is frozen or unavailable.');
    const { stack } = await chain.runGetMethod(address.toRawString(), 'get_wallet_data');
    const balance = nonnegative(stack.readBigNumber()),
      actualOwner = stack.readAddress(),
      actualMaster = stack.readAddress();
    stack.readCell();
    if (!actualOwner.equals(owner) || !actualMaster.equals(master))
      throw new AgentError('jetton_identity', 'Jetton wallet ownership or master does not match.');
    return { address, balance };
  }
  return {
    validate,
    async plan(args, operationId) {
      validate(args);
      const master = chainAddress(args.address, network),
        recipient = chainAddress(args.to, network);
      const decimals = args.decimals ?? 9,
        amountRaw = assetAmount(args.amount, decimals),
        queryId = assetQueryId(operationId);
      const sender = await holding(master, wallet);
      if (sender.balance < amountRaw)
        throw new AgentError('insufficient_jettons', 'The wallet has insufficient jetton balance.');
      const destination = await holding(master, recipient);
      const body = jettonTransferBody({ queryId, amountRaw, recipient, responseTo: wallet });
      return {
        summary: `Jetton transfer — ${network.toUpperCase()}\n\nToken: ${friendlyAddress(master, network)}\nAmount: ${args.amount} (${decimals} decimals)\nRecipient: ${friendlyAddress(recipient, network, false)}\nAttached gas: 0.05 TON; unused gas returns to this wallet.`,
        message: {
          destination: sender.address.toRawString(),
          amountNano: '50000000',
          bodyBoc: body.toBoc({ idx: false }).toString('base64'),
          bounce: true,
        },
        receipt: {
          kind: 'jetton_send',
          wallet: wallet.toRawString(),
          master: master.toRawString(),
          senderWallet: sender.address.toRawString(),
          recipientOwner: recipient.toRawString(),
          recipientWallet: destination.address.toRawString(),
          amountRaw: amountRaw.toString(),
          queryId: queryId.toString(),
        },
        details: { network, amount: args.amount, decimals },
      };
    },
    async revalidate(plan) {
      const receipt = plan.receipt,
        master = chainAddress(receipt.master, network),
        recipient = chainAddress(receipt.recipientOwner, network);
      const sender = await holding(master, wallet),
        destination = await holding(master, recipient);
      if (
        !sameAddress(receipt.wallet, wallet.toRawString()) ||
        !sameAddress(sender.address.toRawString(), receipt.senderWallet) ||
        !sameAddress(destination.address.toRawString(), receipt.recipientWallet)
      )
        throw new AgentError(
          'jetton_identity',
          'The transfer wallet addresses changed. Request a new transfer.',
        );
      if (sender.balance < BigInt(receipt.amountRaw))
        throw new AgentError(
          'insufficient_jettons',
          'The wallet no longer has enough jettons for this transfer.',
        );
    },
    /** @returns {Promise<import('../../contracts/finance.js').Settlement>} */
    async settle(plan, evidence) {
      const origin = matchingOrigin(plan, evidence);
      if (!origin) return { state: 'submitted' };
      if (origin.success === false)
        return { state: 'failed', txHash: origin.hash, reason: 'jetton_wallet_rejected_transfer' };
      if (origin.success !== true) return { state: 'submitted' };
      for (const message of origin.out || []) {
        if (
          !sameAddress(message.source, plan.receipt.senderWallet) ||
          !sameAddress(message.destination, plan.receipt.recipientWallet) ||
          message.bounced
        )
          continue;
        const transfer = internalJettonTransfer(message.bodyBoc);
        if (
          !transfer ||
          transfer.queryId !== plan.receipt.queryId ||
          transfer.amountRaw !== plan.receipt.amountRaw ||
          !sameAddress(transfer.from, plan.receipt.wallet)
        )
          continue;
        const received = emittedReceipt(message, evidence.nodes || []);
        if (received?.success === false)
          return {
            state: 'failed',
            txHash: received.hash,
            reason: 'recipient_jetton_wallet_rejected_transfer',
          };
        if (received?.success !== true) continue;
        const destination = await holding(
          chainAddress(plan.receipt.master, network),
          chainAddress(plan.receipt.recipientOwner, network),
        );
        if (!sameAddress(destination.address.toRawString(), plan.receipt.recipientWallet))
          return { state: 'submitted' };
        return {
          state: 'confirmed',
          txHash: origin.hash,
          recipientTxHash: received.hash,
          amountRaw: plan.receipt.amountRaw,
        };
      }
      return { state: 'submitted' };
    },
  };
}
