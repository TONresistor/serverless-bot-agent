import { Cell } from '@ton/core';

// STON.fi dex-core-v2 contracts/common/op.fc and contracts/router/msgs/pool.fc.
const PAY_TO = 0x657b54f5,
  SWAP_OK = 0xc64370e5,
  TRANSFER = 0x0f8a7ea5,
  INTERNAL_TRANSFER = 0x178d4519,
  TON_TRANSFER = 0x01f3835d;
const address = (slice) => slice.loadAddress().toRawString();

function payment(node, receipt) {
  if (
    !node.success ||
    node.address !== receipt.routerAddress ||
    node.in?.source !== receipt.poolAddress ||
    node.in.bounced
  )
    return null;
  try {
    const slice = Cell.fromBase64(node.in.bodyBoc).beginParse();
    if (
      slice.loadUint(32) !== PAY_TO ||
      slice.loadUintBig(64).toString() !== receipt.queryId ||
      address(slice) !== receipt.owner
    )
      return null;
    address(slice);
    if (address(slice) !== receipt.owner) return null;
    const exitCode = slice.loadUint(32);
    slice.loadMaybeRef();
    const extra = slice.loadRef().beginParse();
    extra.loadCoins();
    const first = { amount: extra.loadCoins(), wallet: address(extra) },
      second = { amount: extra.loadCoins(), wallet: address(extra) };
    if (!(
      [first.wallet, second.wallet].includes(receipt.routerOfferWallet) &&
      [first.wallet, second.wallet].includes(receipt.routerAskWallet)
    ))
      return null;
    const output = first.wallet === receipt.routerAskWallet ? first : second;
    return { exitCode, amount: output.amount };
  } catch {
    return null;
  }
}

function transferToOwner(node, receipt, amount) {
  if (
    !node.success ||
    node.address !== receipt.routerAskWallet ||
    node.in?.source !== receipt.routerAddress ||
    node.in.bounced
  )
    return false;
  try {
    const slice = Cell.fromBase64(node.in.bodyBoc).beginParse();
    return (
      slice.loadUint(32) === TRANSFER &&
      slice.loadUintBig(64).toString() === receipt.queryId &&
      slice.loadCoins() === amount &&
      address(slice) === receipt.owner
    );
  } catch {
    return false;
  }
}

/** Evidence contains only descendants pinned to the approved message by the financial reconciler. */
/** @returns {import('../../contracts/finance.js').Settlement} */
export function inspectSwapSettlement(receipt, evidence) {
  const nodes = evidence?.nodes || [];
  for (const node of nodes) {
    const paid = payment(node, receipt);
    if (!paid) continue;
    if (paid.exitCode !== SWAP_OK)
      return {
        state: 'failed',
        reason: 'The pool rejected the swap; do not report an output fill.',
        recipientTxHash: node.hash,
      };
    if (paid.amount < BigInt(receipt.minOut))
      return {
        state: 'failed',
        reason: 'The pool output does not satisfy the approved minimum.',
        recipientTxHash: node.hash,
      };
    if (!nodes.some((candidate) => transferToOwner(candidate, receipt, paid.amount)))
      return { state: 'submitted' };
    for (const credit of nodes) {
      if (
        !credit.success ||
        credit.address !== receipt.outputWallet ||
        credit.in?.source !== receipt.routerAskWallet ||
        credit.in.bounced
      )
        continue;
      try {
        if (receipt.output === 'TON') {
          if (BigInt(credit.in.valueNano) < paid.amount) continue;
          // pTON owner.fc sends ton_transfer, not an excess/refund message.
          const slice = Cell.fromBase64(credit.in.bodyBoc).beginParse();
          if (
            slice.loadUint(32) !== TON_TRANSFER ||
            slice.loadUintBig(64).toString() !== receipt.queryId ||
            slice.loadCoins() !== paid.amount
          )
            continue;
          address(slice);
          if (slice.loadBit()) slice.loadRef();
        } else {
          const slice = Cell.fromBase64(credit.in.bodyBoc).beginParse();
          if (
            slice.loadUint(32) !== INTERNAL_TRANSFER ||
            slice.loadUintBig(64).toString() !== receipt.queryId ||
            slice.loadCoins() !== paid.amount ||
            address(slice) !== receipt.routerAddress
          )
            continue;
        }
        return {
          state: 'confirmed',
          recipientTxHash: credit.hash,
          amountOutRaw: paid.amount.toString(),
          outputAsset: receipt.output,
        };
      } catch {
        /* A malformed or unrelated descendant is not proof of payment. */
      }
    }
  }
  return { state: 'submitted' };
}
