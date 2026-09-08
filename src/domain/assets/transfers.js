import { beginCell, Cell } from '@ton/core';
import { digest } from '../../shared/hash.js';
import { AgentError } from '../../shared/errors.js';

export function assetAmount(amount, decimals = 9) {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 30 ||
    typeof amount !== 'string' ||
    !/^\d{1,38}(?:\.\d{1,30})?$/.test(amount)
  )
    throw new AgentError(
      'invalid_amount',
      'Use a positive decimal amount and token decimals between 0 and 30.',
    );
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > decimals)
    throw new AgentError('invalid_amount', `Amount has more than ${decimals} decimal places.`);
  const raw = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (raw <= 0n || raw >= 1n << 120n)
    throw new AgentError('invalid_amount', 'Amount is outside the supported token range.');
  return raw;
}

export const assetQueryId = (operationId) => BigInt('0x' + digest(operationId).slice(0, 16));

export function jettonTransferBody({ queryId, amountRaw, recipient, responseTo }) {
  return beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(queryId, 64)
    .storeCoins(amountRaw)
    .storeAddress(recipient)
    .storeAddress(responseTo)
    .storeBit(false)
    .storeCoins(0)
    .storeBit(false)
    .endCell();
}

export function nftTransferBody({ queryId, recipient, responseTo }) {
  return beginCell()
    .storeUint(0x5fcc3d14, 32)
    .storeUint(queryId, 64)
    .storeAddress(recipient)
    .storeAddress(responseTo)
    .storeBit(false)
    .storeCoins(0)
    .storeBit(false)
    .endCell();
}

export function internalJettonTransfer(bodyBoc) {
  try {
    const slice = Cell.fromBase64(bodyBoc).beginParse();
    if (slice.loadUint(32) !== 0x178d4519) return null;
    return {
      queryId: slice.loadUintBig(64).toString(),
      amountRaw: slice.loadCoins().toString(),
      from: slice.loadAddress().toRawString(),
    };
  } catch {
    return null;
  }
}
