import { Address, Cell, loadTransaction } from '@ton/core';

export function inspectTransfer(transactions, transfer) {
  for (const raw of transactions) {
    let tx;
    try {
      tx = loadTransaction(Cell.fromBase64(raw.data).beginParse());
    } catch {
      continue;
    }
    if (
      tx.inMessage?.info.type !== 'external-in' ||
      !tx.inMessage.info.dest.equals(Address.parse(transfer.wallet)) ||
      tx.address !== BigInt('0x' + Address.parse(transfer.wallet).hash.toString('hex')) ||
      tx.inMessage.body.hash().toString('hex') !== transfer.bodyHash
    )
      continue;
    const description = tx.description;
    if (
      description.type !== 'generic' ||
      description.aborted ||
      (description.computePhase.type === 'vm' && !description.computePhase.success) ||
      !description.actionPhase?.success
    )
      return { state: 'failed', txHash: tx.hash().toString('hex') };
    for (const message of tx.outMessages.values()) {
      const info = message.info;
      if (
        info.type === 'internal' &&
        info.dest.equals(Address.parse(transfer.destination)) &&
        info.value.coins === BigInt(transfer.amountNano)
      ) {
        return {
          state: 'sent',
          txHash: tx.hash().toString('hex'),
          createdLt: info.createdLt.toString(),
          bodyHash: message.body.hash().toString('hex'),
        };
      }
    }
    return { state: 'failed', txHash: tx.hash().toString('hex') };
  }
  return { state: 'unknown' };
}

export function inspectReceipt(
  transactions,
  { wallet, destination, amountNano, createdLt, bodyHash },
) {
  for (const raw of transactions) {
    let tx;
    try {
      tx = loadTransaction(Cell.fromBase64(raw.data).beginParse());
    } catch {
      continue;
    }
    const info = tx.inMessage?.info;
    if (
      info?.type !== 'internal' ||
      !info.src.equals(Address.parse(wallet)) ||
      !info.dest.equals(Address.parse(destination)) ||
      info.createdLt.toString() !== createdLt ||
      tx.inMessage.body.hash().toString('hex') !== bodyHash ||
      info.value.coins !== BigInt(amountNano)
    )
      continue;
    if (tx.address !== BigInt('0x' + Address.parse(destination).hash.toString('hex'))) continue;
    const description = tx.description;
    // A non-bouncing deposit to an uninitialized account credits funds even
    // though computation is skipped and the generic transaction is aborted.
    const credited =
      description.type === 'generic' &&
      !info.bounce &&
      !info.bounced &&
      !description.bouncePhase &&
      description.creditPhase?.credit.coins === BigInt(amountNano);
    return {
      state:
        description.type === 'generic' && (!description.aborted || credited)
          ? 'confirmed'
          : 'failed',
      recipientTxHash: tx.hash().toString('hex'),
    };
  }
  return { state: 'submitted' };
}
