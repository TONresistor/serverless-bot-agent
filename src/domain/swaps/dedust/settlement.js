import { Cell } from '@ton/core';
import { settlementMarker } from './messages.js';

const TRANSFER = 0x0f8a7ea5,
  INTERNAL_TRANSFER = 0x178d4519;
const address = (slice) => slice.loadAddress().toRawString();
const query = (slice, receipt) => slice.loadUintBig(64).toString() === receipt.queryId;
const marker = (payload, receipt, success) =>
  payload?.equals(settlementMarker(receipt.queryId, success));
const end = (slice) => !slice.remainingBits && !slice.remainingRefs;
function forwardPayload(slice) {
  return slice.loadBit() ? slice.loadRef() : slice.asCell();
}
function payoutPayload(payload, receipt, success) {
  if (receipt.version !== 'cpmm-v2') return marker(payload, receipt, success);
  if (!payload) return false;
  const slice = payload.beginParse();
  if (slice.loadUint(32) !== 0xe8db4696) return false;
  const code = slice.loadInt(32),
    value = slice.loadMaybeRef();
  return (success ? code === 0 : code !== 0) && marker(value, receipt, success) && end(slice);
}

function jettonTransfer(node, receipt) {
  if (
    !node.success ||
    node.address !== receipt.outputPoolWallet ||
    node.in?.source !== receipt.outputVault ||
    node.in.bounced
  )
    return null;
  const slice = Cell.fromBase64(node.in.bodyBoc).beginParse();
  if (slice.loadUint(32) !== TRANSFER || !query(slice, receipt)) return null;
  const amount = slice.loadCoins();
  if (address(slice) !== receipt.owner) return null;
  slice.loadMaybeAddress();
  slice.loadMaybeRef();
  slice.loadCoins();
  return payoutPayload(forwardPayload(slice), receipt, true) ? amount : null;
}
function jettonCredit(node, receipt, amount, success = true) {
  const wallet = success ? receipt.outputWallet : receipt.inputWallet,
    sourceWallet = success ? receipt.outputPoolWallet : receipt.inputPoolWallet,
    sender = success ? receipt.outputVault : receipt.inputVault;
  if (
    !node.success ||
    node.address !== wallet ||
    node.in?.source !== sourceWallet ||
    node.in.bounced
  )
    return false;
  const slice = Cell.fromBase64(node.in.bodyBoc).beginParse();
  if (slice.loadUint(32) !== INTERNAL_TRANSFER || !query(slice, receipt)) return false;
  const received = slice.loadCoins();
  if ((amount !== null && received !== amount) || address(slice) !== sender) return false;
  slice.loadMaybeAddress();
  slice.loadCoins();
  return payoutPayload(forwardPayload(slice), receipt, success);
}
function legacyPayment(node, receipt, success = true) {
  if (
    !node.success ||
    node.address !== (success ? receipt.outputVault : receipt.inputVault) ||
    node.in?.source !== receipt.poolAddress ||
    node.in.bounced
  )
    return null;
  const slice = Cell.fromBase64(node.in.bodyBoc).beginParse();
  if (slice.loadUint(32) !== 0xad4eb6f5 || !query(slice, receipt)) return null;
  slice.loadRef();
  const amount = slice.loadCoins();
  if (
    address(slice) !== receipt.owner ||
    !marker(slice.loadMaybeRef(), receipt, success) ||
    !end(slice)
  )
    return null;
  return amount;
}
function nativeCredit(node, receipt, success = true) {
  if (
    !node.success ||
    node.address !== receipt.owner ||
    node.in?.source !== (success ? receipt.outputVault : receipt.inputVault) ||
    node.in.bounced
  )
    return null;
  const slice = Cell.fromBase64(node.in.bodyBoc).beginParse(),
    opcode = slice.loadUint(32);
  if (!query(slice, receipt)) return null;
  if (receipt.version === 'cpmm-v2') {
    if (opcode !== 0x3216ca09) return null;
    const amount = slice.loadCoins(),
      code = slice.loadInt(32);
    return (success ? code === 0 : code !== 0) &&
      marker(slice.loadMaybeRef(), receipt, success) &&
      end(slice) &&
      BigInt(node.in.valueNano) >= amount
      ? amount
      : null;
  }
  return opcode === 0x474f86cf && marker(slice.loadMaybeRef(), receipt, success) && end(slice)
    ? BigInt(node.in.valueNano)
    : null;
}

/** Only the causal trace rooted in the approved message may be supplied here.
 * A gas refund, pool acknowledgement, or unrelated balance change is no fill.
 */
/** @returns {import('../../../contracts/finance.js').Settlement} */
export function inspectDedustSettlement(receipt, evidence) {
  const nodes = evidence?.nodes || [];
  /** @returns {import('../../../contracts/finance.js').Settlement} */
  const confirmed = (node, amount) => ({
    state: 'confirmed',
    recipientTxHash: node.hash,
    amountOutRaw: amount.toString(),
    outputAsset: receipt.output,
  });
  for (const node of nodes) {
    try {
      if (
        receipt.source === 'TON'
          ? nativeCredit(node, receipt, false) !== null
          : jettonCredit(node, receipt, null, false)
      )
        return {
          state: 'failed',
          reason: 'DeDust rejected the swap and returned the input asset.',
          recipientTxHash: node.hash,
        };
      if (receipt.output === 'TON') {
        const received = nativeCredit(node, receipt);
        if (received === null) continue;
        let paid = received;
        if (receipt.version !== 'cpmm-v2') {
          paid = null;
          for (const candidate of nodes) {
            try {
              const value = legacyPayment(candidate, receipt);
              if (value !== null) {
                paid = value;
                break;
              }
            } catch {
              /* Unrelated descendant. */
            }
          }
          if (paid === null || received < paid) continue;
        }
        if (paid >= BigInt(receipt.minOut)) return confirmed(node, paid);
      } else {
        const paid = jettonTransfer(node, receipt);
        if (paid === null || paid < BigInt(receipt.minOut)) continue;
        if (
          receipt.version !== 'cpmm-v2' &&
          !nodes.some((candidate) => {
            try {
              return legacyPayment(candidate, receipt) === paid;
            } catch {
              return false;
            }
          })
        )
          continue;
        for (const credit of nodes) {
          try {
            if (jettonCredit(credit, receipt, paid)) return confirmed(credit, paid);
          } catch {
            /* Unrelated descendant. */
          }
        }
      }
    } catch {
      /* Malformed or unrelated descendant is never proof of payment. */
    }
  }
  return { state: 'submitted' };
}
