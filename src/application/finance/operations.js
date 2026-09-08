import { validateContractPlan } from '../../domain/ton/contract-plan.js';
import { AgentError, errorCode, userError } from '../../shared/errors.js';
import { digest } from '../../shared/hash.js';
import { canonicalJSON } from '../../shared/canonical.js';
import { formatTON, GAS_RESERVE } from '../../domain/wallet.js';
import { findSubmission } from '../../domain/ton/contract-proof.js';
import { scanTransactions } from '../transaction-scan.js';
import { collectContractTrace } from './trace.js';

const terminal = ['confirmed', 'failed', 'cancelled', 'expired'];
/** @param {import('../../contracts/finance.js').FinanceDependencies} dependencies */
export function createFinancialOperations({
  operations,
  telegram,
  chain,
  config,
  planners,
  sign,
  authorize,
  reconcileLegacy,
  now = () => Date.now(),
  report = (_error, _context) => {},
}) {
  async function reconcile(id = undefined) {
    if (!id) {
      const lock = await operations.operation('lock:wallet');
      if (!lock || lock.state !== 'held') return null;
      id = lock.data;
    }
    const operation = await operations.operation(id);
    if (!operation) return null;
    if (operation.kind !== 'contract_action') return reconcileLegacy();
    if (terminal.includes(operation.state)) {
      await operations.releaseWallet(id);
      return operation;
    }
    if (['pending', 'preparing', 'notification_unknown'].includes(operation.state)) {
      if (
        operation.expires_at <= now() &&
        (await operations.transition(id, [operation.state], 'expired', operation.data))
      )
        await operations.releaseWallet(id);
      return operations.operation(id);
    }
    let data = operation.data;
    if (!data.signed) return operation;
    let submission = data.submission;
    if (!submission) {
      const scanned = await scanTransactions(
        chain,
        data.wallet,
        (rows) =>
          findSubmission(rows, {
            wallet: data.wallet,
            bodyHash: data.signed.bodyHash,
            message: data.plan.message,
          }),
        data.cursor,
        data.signed.beforeLt || '0',
      );
      submission = scanned.result;
      if (submission.state === 'unknown') {
        const current = await chain.walletState(data.wallet, config.walletPublicKey);
        if (
          Number.isSafeInteger(current.chainTime) &&
          current.chainTime > data.signed.validUntil + 60 &&
          current.seqno === data.signed.seqno
        ) {
          if (
            await operations.transitionFromSnapshot(operation, 'failed', {
              ...data,
              reason: 'expired_unaccepted',
            })
          )
            await operations.releaseWallet(id);
        } else
          await operations.transitionFromSnapshot(operation, operation.state, {
            ...data,
            cursor: scanned.cursor,
          });
        return operations.operation(id);
      }
      data = { ...data, submission };
      if (submission.state === 'failed') {
        if (await operations.transitionFromSnapshot(operation, 'failed', data))
          await operations.releaseWallet(id);
        return operations.operation(id);
      }
      // Wallet acceptance resolves seqno uncertainty. Settlement remains a separate record.
      if (!(await operations.transitionFromSnapshot(operation, 'submitted', data)))
        return operations.operation(id);
    }
    await operations.releaseWallet(id);
    const accepted = await operations.operation(id);
    if (accepted.state !== 'submitted') return accepted;
    data = accepted.data;
    const evidence = await collectContractTrace(chain, submission.message, data.trace);
    let settlement = { state: 'submitted' };
    if (evidence.nodes[0]?.success === false) settlement = { state: 'failed' };
    else if (planners[data.tool]?.settle)
      settlement = await planners[data.tool].settle(data.plan, evidence);
    if (!['submitted', 'confirmed', 'failed'].includes(settlement?.state))
      throw new AgentError('invalid_receipt', 'The contract result could not be verified.');
    await operations.transitionFromSnapshot(accepted, settlement.state, {
      ...data,
      settlement,
      trace: evidence,
    });
    return operations.operation(id);
  }
  return {
    reconcile,
    validate(tool, args) {
      if (!planners[tool])
        throw new AgentError('unknown_tool', 'Unsupported financial operation.', {
          effectNotStarted: true,
        });
      planners[tool].validate?.(args);
    },
    async reconcileRecent() {
      for (const row of await operations.recentContractActions())
        try {
          await reconcile(row.id);
        } catch (error) {
          report(error, { phase: 'financial_reconcile', operationId: row.id });
          /* Next explicit status check retries reads only. */
        }
    },
    async prepare(tool, args, operationKey) {
      await authorize(tool);
      if (!planners[tool])
        throw new AgentError('unknown_tool', 'Unsupported financial operation.', {
          effectNotStarted: true,
        });
      const id = `action:${digest(operationKey).slice(0, 24)}`;
      const previous = await operations.operation(id);
      if (previous)
        return {
          operation_id: id,
          state: previous.state,
          reply_delivered: Boolean(previous.data.messageId),
          ...(previous.state === 'notification_unknown'
            ? { error: 'notification_unknown', operation_state: 'unknown' }
            : {}),
        };
      const plan = validateContractPlan(
        await planners[tool].plan(args, operationKey),
        config.network,
      );
      const data = {
        tool,
        ownerId: String(config.ownerId),
        wallet: config.walletAddress,
        publicKey: config.walletPublicKey,
        network: config.network,
        plan,
        planHash: digest(canonicalJSON(plan)),
      };
      if (!(await operations.claim(id, 'contract_action', 'pending', data, now() + 300000)))
        return { operation_id: id, state: 'already_prepared' };
      try {
        await authorize(tool);
        const message = await telegram.sendMessage({
          chat_id: config.ownerId,
          text: `${plan.summary}\n\nNetwork: ${config.network.toUpperCase()}\nMaximum attached: ${formatTON(plan.message.amountNano)} TON\nContract: ${plan.message.destination}\n\nConfirm within 5 minutes. No transaction has been sent.`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Confirm', callback_data: `action_confirm:${id.slice(7)}` },
                { text: 'Cancel', callback_data: `action_cancel:${id.slice(7)}` },
              ],
            ],
          },
        });
        await operations.transition(id, ['pending'], 'pending', {
          ...data,
          messageId: message.message_id,
        });
      } catch (error) {
        await operations.transition(id, ['pending'], 'notification_unknown', data);
        throw error;
      }
      return { operation_id: id, state: 'pending_confirmation', reply_delivered: true };
    },
    async decide(callback) {
      const match = /^action_(confirm|cancel):([a-f0-9]{24})$/.exec(callback.data || '');
      if (!match) return 'Unknown action button.';
      const id = `action:${match[2]}`,
        operation = await operations.operation(id);
      if (
        !operation ||
        operation.kind !== 'contract_action' ||
        operation.data.ownerId !== String(callback.actorId) ||
        !operation.data.messageId ||
        operation.data.messageId !== callback.messageId ||
        operation.data.publicKey !== config.walletPublicKey ||
        operation.data.network !== config.network
      )
        return 'Invalid action confirmation.';
      if (operation.state !== 'pending') return 'This request has already been processed.';
      if (match[1] === 'cancel')
        return (await operations.transition(id, ['pending'], 'cancelled', operation.data))
          ? 'Operation cancelled.'
          : 'This request is already being processed.';
      if (operation.expires_at <= now()) {
        await operations.transition(id, ['pending'], 'expired', operation.data);
        return 'This confirmation has expired. Request the operation again.';
      }
      await authorize(operation.data.tool);
      await reconcile();
      if (!(await operations.acquireWallet(id)))
        return 'A previous wallet submission still needs verification. Check /wallet.';
      if (!(await operations.transition(id, ['pending'], 'preparing', operation.data))) {
        await operations.releaseWallet(id);
        return 'This request has already been processed.';
      }
      let data = operation.data;
      try {
        if (data.planHash !== digest(canonicalJSON(data.plan)))
          throw new AgentError('invalid_plan', 'The approved operation changed.');
        const source = await chain.walletState(data.wallet, config.walletPublicKey);
        if (BigInt(source.balance) < BigInt(data.plan.message.amountNano) + GAS_RESERVE)
          throw new AgentError(
            'insufficient_balance',
            'Insufficient TON for the operation and wallet gas reserve.',
          );
        await planners[data.tool].revalidate(data.plan);
        await authorize(data.tool);
        const signed = await sign({
          message: data.plan.message,
          seqno: source.seqno,
          state: source.state,
          now: now(),
        });
        data = { ...data, signed: { ...signed, beforeLt: source.lastTransaction?.lt || '0' } };
        if (!(await operations.prepareBroadcast(id, data)))
          throw new AgentError('expired_confirmation', 'The confirmation expired before sending.');
        await authorize(data.tool);
      } catch (error) {
        report(error, { phase: 'financial_prepare', operationId: id });
        if (
          await operations.transition(id, ['preparing', 'in_flight'], 'failed', {
            ...data,
            reason: errorCode(error),
          })
        )
          await operations.releaseWallet(id);
        return userError(error);
      }
      try {
        await chain.broadcast(data.signed.boc);
        await operations.transition(id, ['in_flight'], 'submitted', data);
      } catch (error) {
        report(error, { phase: 'financial_broadcast', operationId: id });
        if (error instanceof AgentError && error.code === 'rate_limited') {
          if (
            await operations.transition(id, ['in_flight'], 'failed', {
              ...data,
              reason: 'provider_rate_limit',
            })
          )
            await operations.releaseWallet(id);
          return 'The provider rejected the submission. It will not be resent automatically.';
        }
        await operations.transition(id, ['in_flight'], 'unknown', data);
        return 'The submission outcome is uncertain. It will not be resent automatically. Check /wallet.';
      }
      try {
        const result = await reconcile(id);
        if (result?.state === 'confirmed') return 'Operation confirmed on-chain.';
        if (result?.state === 'failed') return 'The operation failed on-chain. Check /wallet.';
      } catch (error) {
        report(error, { phase: 'financial_reconcile', operationId: id });
        /* Reconciliation continues only on a later status request. */
      }
      return 'Transaction submitted. Final operation confirmation is pending; check /wallet.';
    },
  };
}
