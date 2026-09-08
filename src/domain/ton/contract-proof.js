import { Address, Cell, beginCell, loadTransaction, storeStateInit } from '@ton/core';

export function messageRecord(message) {
  const info = message?.info;
  if (info?.type !== 'internal') return null;
  return {
    source: info.src.toRawString(),
    destination: info.dest.toRawString(),
    valueNano: info.value.coins.toString(),
    bodyBoc: message.body.toBoc().toString('base64'),
    bodyHash: message.body.hash().toString('hex'),
    createdLt: info.createdLt.toString(),
    bounced: info.bounced,
    ...(message.init
      ? {
          initHash: beginCell()
            .store(storeStateInit(message.init))
            .endCell()
            .hash()
            .toString('hex'),
        }
      : {}),
  };
}
const txSuccess = (tx) =>
  tx.description.type === 'generic' &&
  !tx.description.aborted &&
  (tx.description.computePhase.type !== 'vm' || tx.description.computePhase.success) &&
  (!tx.description.actionPhase || tx.description.actionPhase.success) &&
  !tx.inMessage?.info?.bounced;
export function findSubmission(rows, { wallet, bodyHash, message }) {
  for (const raw of rows) {
    let tx;
    try {
      tx = loadTransaction(Cell.fromBase64(raw.data).beginParse());
    } catch {
      continue;
    }
    if (
      tx.inMessage?.info.type !== 'external-in' ||
      !tx.inMessage.info.dest.equals(Address.parse(wallet)) ||
      tx.address !== BigInt('0x' + Address.parse(wallet).hash.toString('hex')) ||
      tx.inMessage.body.hash().toString('hex') !== bodyHash
    )
      continue;
    const hash = tx.hash().toString('hex');
    if (!txSuccess(tx)) return { state: 'failed', walletTxHash: hash };
    const expectedHash = Cell.fromBase64(message.bodyBoc).hash().toString('hex');
    const outgoing = [...tx.outMessages.values()]
      .map(messageRecord)
      .find(
        (m) =>
          m &&
          m.destination === Address.parse(message.destination).toRawString() &&
          m.valueNano === message.amountNano &&
          m.bodyHash === expectedHash &&
          !m.bounced,
      );
    return outgoing
      ? { state: 'accepted', walletTxHash: hash, message: outgoing }
      : { state: 'failed', walletTxHash: hash };
  }
  return { state: 'unknown' };
}
export function findReceipt(rows, expected) {
  for (const raw of rows) {
    let tx;
    try {
      tx = loadTransaction(Cell.fromBase64(raw.data).beginParse());
    } catch {
      continue;
    }
    const incoming = messageRecord(tx.inMessage);
    if (
      !incoming ||
      incoming.source !== expected.source ||
      incoming.destination !== expected.destination ||
      incoming.createdLt !== expected.createdLt ||
      incoming.valueNano !== expected.valueNano ||
      incoming.bodyHash !== expected.bodyHash ||
      tx.address !== BigInt('0x' + Address.parse(expected.destination).hash.toString('hex'))
    )
      continue;
    return {
      address: expected.destination,
      hash: tx.hash().toString('hex'),
      success: txSuccess(tx),
      in: incoming,
      out: [...tx.outMessages.values()].map(messageRecord).filter(Boolean),
    };
  }
  return null;
}
