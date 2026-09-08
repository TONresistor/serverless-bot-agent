import { AgentError } from '../shared/errors.js';
import { digest } from '../shared/hash.js';
import {
  parseAmount,
  parseDestination,
  formatTON,
  walletAddress,
  GAS_RESERVE,
} from '../domain/wallet.js';
import { inspectTransfer, inspectReceipt } from '../domain/transaction-proof.js';
import { scanTransactions } from './transaction-scan.js';

export function createTransfers({
  operations,
  telegram,
  ton,
  config,
  sign,
  authorize = async () => {},
  now = () => Date.now(),
  report = (_error, _context) => {},
}) {
  const address = walletAddress(config.walletPublicKey, config.network);
  const display = (data) =>
    `TON transfer — ${data.network === 'testnet' ? 'TESTNET' : 'MAINNET'}\n\nAmount: ${formatTON(data.amountNano)} TON\nRecipient: ${data.friendly}\nComment: ${data.comment || '(none)'}\n\nNetwork fees apply in addition. Confirmation is valid for 5 minutes.`;

  async function reconcile() {
    const lock = await operations.operation('lock:wallet');
    if (!lock || lock.state !== 'held') return null;
    const operation = await operations.operation(lock.data);
    if (!operation) return { state: 'unknown' };
    if (operation.kind !== 'transfer') return operation;
    if (['pending', 'preparing'].includes(operation.state)) {
      if (operation.expires_at <= now()) {
        if (
          await operations.transition(
            operation.id,
            ['pending', 'preparing'],
            'expired',
            operation.data,
          )
        )
          await operations.releaseWallet(operation.id);
      }
      return operation;
    }
    if (['confirmed', 'failed', 'cancelled', 'expired'].includes(operation.state)) {
      await operations.releaseWallet(operation.id);
      return operation;
    }
    if (!operation.data.signed) return operation;
    const data = operation.data;
    let proof = data.senderProof;
    if (!proof) {
      const current = await ton.walletState(address, config.walletPublicKey);
      // Use the provider's chain timestamp and seqno from ONE account snapshot,
      // not the local clock or a changed seqno alone, to prove non-acceptance.
      if (
        Number.isSafeInteger(current.chainTime) &&
        current.chainTime > data.signed.validUntil + 60 &&
        current.seqno === data.signed.seqno
      ) {
        if (
          await operations.transition(
            operation.id,
            ['in_flight', 'unknown', 'submitted'],
            'failed',
            { ...data, reason: 'expired_unaccepted' },
          )
        )
          await operations.releaseWallet(operation.id);
        return operations.operation(operation.id);
      }
      const scanned = await scanTransactions(
        ton,
        address,
        (rows) =>
          inspectTransfer(rows, {
            ...data.signed,
            wallet: address,
            destination: data.destination,
            amountNano: data.amountNano,
          }),
        data.senderCursor,
        data.signed.beforeLt || '0',
      );
      proof = scanned.result;
      if (proof.state === 'unknown') {
        await operations.transition(
          operation.id,
          ['in_flight', 'unknown', 'submitted'],
          operation.state,
          { ...data, senderCursor: scanned.cursor },
        );
        return operations.operation(operation.id);
      }
    }
    if (proof.state === 'failed') {
      await operations.transition(operation.id, ['in_flight', 'unknown', 'submitted'], 'failed', {
        ...data,
        senderProof: proof,
      });
      await operations.releaseWallet(operation.id);
      return operations.operation(operation.id);
    }
    const scanned = await scanTransactions(
      ton,
      data.destination,
      (rows) =>
        inspectReceipt(rows, {
          wallet: address,
          destination: data.destination,
          amountNano: data.amountNano,
          createdLt: proof.createdLt,
          bodyHash: proof.bodyHash,
        }),
      data.recipientCursor,
      proof.createdLt,
    );
    const receipt = scanned.result.state === 'unknown' ? { state: 'submitted' } : scanned.result;
    await operations.transition(
      operation.id,
      ['in_flight', 'unknown', 'submitted'],
      receipt.state,
      { ...data, senderProof: proof, receipt, recipientCursor: scanned.cursor },
    );
    if (['confirmed', 'failed'].includes(receipt.state))
      await operations.releaseWallet(operation.id);
    return operations.operation(operation.id);
  }

  return {
    address,
    reconcile,
    validate(args) {
      parseAmount(args.amount);
      parseDestination(args.to, config.network);
    },
    async prepare(args, operationKey) {
      await authorize();
      const amount = parseAmount(args.amount);
      const destination = parseDestination(args.to, config.network);
      const id = digest(operationKey).slice(0, 24);
      const data = {
        ownerId: String(config.ownerId),
        network: config.network,
        wallet: address,
        publicKey: config.walletPublicKey,
        destination: destination.raw,
        friendly: destination.friendly,
        amountNano: amount.toString(),
        comment: args.comment || '',
      };
      const inserted = await operations.claim(
        `transfer:${id}`,
        'transfer',
        'pending',
        data,
        now() + 300_000,
      );
      if (!inserted)
        return { transfer_id: id, state: (await operations.operation(`transfer:${id}`)).state };
      const result = await telegram.sendMessage({
        chat_id: config.ownerId,
        text: display(data),
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Confirm', callback_data: `confirm:${id}` },
              { text: 'Cancel', callback_data: `cancel:${id}` },
            ],
          ],
        },
      });
      await operations.transition(`transfer:${id}`, ['pending'], 'pending', {
        ...data,
        messageId: result.message_id,
      });
      return {
        transfer_id: id,
        state: 'pending_confirmation',
        reply_delivered: true,
        sent_text: display(data),
      };
    },
    async decide(callback) {
      const match = /^(confirm|cancel):([a-f0-9]{24})$/.exec(callback.data || '');
      if (!match) return 'Unknown button.';
      const id = `transfer:${match[2]}`;
      const operation = await operations.operation(id);
      if (
        !operation ||
        operation.kind !== 'transfer' ||
        operation.data.ownerId !== String(callback.actorId) ||
        operation.data.network !== config.network ||
        operation.data.publicKey !== config.walletPublicKey ||
        (operation.data.messageId && operation.data.messageId !== callback.messageId)
      )
        return 'Invalid confirmation.';
      if (operation.state !== 'pending') return 'This request has already been processed.';
      if (operation.expires_at <= now()) {
        return (await operations.transition(id, ['pending'], 'expired', operation.data))
          ? 'This confirmation has expired. Request a new transfer.'
          : 'This request is already being processed.';
      }
      if (match[1] === 'cancel') {
        return (await operations.transition(id, ['pending'], 'cancelled', operation.data))
          ? 'Transfer cancelled.'
          : 'This request is already being processed.';
      }
      await reconcile();
      if (!(await operations.acquireWallet(id)))
        return 'A previous transfer is still awaiting network confirmation. Check /wallet.';
      if (!(await operations.transition(id, ['pending'], 'preparing', operation.data))) {
        await operations.releaseWallet(id);
        return 'This request has already been processed.';
      }
      let data;
      try {
        const source = await ton.walletState(address, config.walletPublicKey);
        if (BigInt(source.balance) < BigInt(operation.data.amountNano) + GAS_RESERVE)
          throw new AgentError(
            'insufficient_balance',
            'Insufficient balance: keep an additional 0.05 TON for network fees.',
          );
        const destination = await ton.state(operation.data.destination);
        const seqno = source.seqno;
        await authorize();
        const signed = await sign({
          destination: operation.data.destination,
          amountNano: operation.data.amountNano,
          comment: operation.data.comment,
          seqno,
          state: source.state,
          destinationState: destination.state,
          now: now(),
        });
        data = {
          ...operation.data,
          signed: { ...signed, beforeLt: source.lastTransaction?.lt || '0' },
        };
        if (!(await operations.prepareBroadcast(id, data)))
          throw new AgentError(
            'expired_confirmation',
            'Confirmation expired before sending. Request a new transfer.',
          );
      } catch (error) {
        await operations.transition(id, ['preparing'], 'failed', operation.data);
        await operations.releaseWallet(id);
        throw error;
      }
      try {
        await authorize();
      } catch (error) {
        if (
          await operations.transition(id, ['in_flight'], 'failed', {
            ...data,
            reason: 'permission_revoked_before_broadcast',
          })
        )
          await operations.releaseWallet(id);
        throw error;
      }
      try {
        await ton.broadcast(data.signed.boc);
        await operations.transition(id, ['in_flight'], 'submitted', data);
      } catch (error) {
        report(error, { phase: 'ton_broadcast', operationId: id });
        if (error instanceof AgentError && error.code === 'rate_limited') {
          if (
            await operations.transition(id, ['in_flight'], 'failed', {
              ...data,
              reason: 'provider_rate_limit',
            })
          )
            await operations.releaseWallet(id);
          return 'The TON provider rejected the submission due to its rate limit. It will not be resent automatically.';
        }
        await operations.transition(id, ['in_flight'], 'unknown', data);
        return 'The submission outcome is uncertain. It will not be resent automatically. Check /wallet to verify.';
      }
      try {
        const updated = await reconcile();
        if (updated?.state === 'confirmed')
          return `Transfer confirmed: ${formatTON(data.amountNano)} TON reached ${data.friendly}.`;
        if (updated?.state === 'failed')
          return 'The transfer failed on the network. Check /wallet for its status.';
      } catch (error) {
        report(error, { phase: 'ton_reconcile', operationId: id });
        /* The signed operation remains durable for a later read. */
      }
      return 'Transaction submitted. Network confirmation is pending; check /wallet to verify.';
    },
  };
}
