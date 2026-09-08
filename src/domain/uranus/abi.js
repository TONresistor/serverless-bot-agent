import { Address, beginCell, Cell } from '@ton/core';
import { AgentError } from '../../shared/errors.js';

// DeDust kit0.0.4 generated ABI; MyDuckAI d680eba targets factory v3.1.
export const URANUS_FACTORY = 'EQAmkd4Pd_xgUW4b9MLrygf0SOfR2EUVa_iCtVWGnYB2hItG';
export const URANUS_OP = Object.freeze({
  buy: 0x94826557,
  sell: 0xb7459e2c,
  sellToMeme: 0x646ad424,
  deploy: 0x6ff416dc,
  claim: 0xad7269a8,
  init: 0x796f5a0c,
  receive: 0x178d4519,
  payout: 0x66c8ad72,
  excesses: 0xd53276db,
});
export const URANUS_GAS = Object.freeze({
  buy: 150000000n,
  sell: 200000000n,
  deploy: 400000000n,
  claim: 100000000n,
});

export function parseUranusAmount(value, decimals = 9, zero = false) {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 30 ||
    typeof value !== 'string' ||
    !/^\d{1,38}(?:\.\d{1,30})?$/.test(value.trim())
  )
    throw new AgentError(
      'invalid_amount',
      'Use a positive decimal amount with supported token decimals.',
    );
  const [whole, fraction = ''] = value.trim().split('.');
  if (fraction.length > decimals)
    throw new AgentError('invalid_amount', `Amount exceeds ${decimals} decimal places.`);
  const result = BigInt(whole + fraction.padEnd(decimals, '0'));
  if ((!zero && result === 0n) || result >= 1n << 120n)
    throw new AgentError(
      'invalid_amount',
      'The amount is zero or exceeds the contract coin limit.',
    );
  return result;
}

export function buildBuy(owner, amount, minOut) {
  return beginCell()
    .storeUint(URANUS_OP.buy, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeCoins(minOut)
    .storeAddress(Address.parse(owner))
    .storeBit(false)
    .storeBit(false)
    .endCell();
}
export function buildSell(owner, amount, minOut) {
  return beginCell()
    .storeUint(URANUS_OP.sell, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeCoins(minOut)
    .storeAddress(Address.parse(owner))
    .storeBit(false)
    .storeBit(false)
    .endCell();
}
export function buildDeploy(presetId, metadataUri, initialBuy) {
  return beginCell()
    .storeUint(URANUS_OP.deploy, 32)
    .storeUint(0, 64)
    .storeUint(presetId, 4)
    .storeStringRefTail(metadataUri)
    .storeCoins(initialBuy)
    .storeBit(false)
    .storeBit(false)
    .endCell();
}
export function buildClaim(owner) {
  return beginCell()
    .storeUint(URANUS_OP.claim, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(owner))
    .storeAddress(Address.parse(owner))
    .endCell();
}

/** Only decode supported incoming settlement messages, never infer success from an opcode alone. */
export function decodeUranusMessage(bodyBoc) {
  try {
    const slice = Cell.fromBase64(bodyBoc).beginParse();
    const opcode = slice.loadUint(32),
      queryId = slice.loadUintBig(64).toString();
    if (opcode === URANUS_OP.receive) {
      const amount = slice.loadCoins().toString(),
        from = slice.loadMaybeAddress(),
        excesses = slice.loadMaybeAddress();
      slice.loadCoins();
      if (slice.loadBit()) slice.loadRef();
      return {
        opcode,
        queryId,
        amount,
        from: from?.toRawString() || '',
        excesses: excesses?.toRawString() || '',
      };
    }
    if (opcode === URANUS_OP.init) {
      const amount = slice.loadCoins().toString();
      if (slice.loadBit() || slice.loadBit() || slice.remainingBits || slice.remainingRefs)
        return null;
      return { opcode, queryId, amount };
    }
    if (opcode === URANUS_OP.sellToMeme) {
      const amount = slice.loadCoins().toString(),
        minOut = slice.loadCoins().toString();
      const from = slice.loadAddress().toRawString(),
        excesses = slice.loadMaybeAddress()?.toRawString() || '';
      if (slice.loadBit() || slice.loadBit() || slice.remainingBits || slice.remainingRefs)
        return null;
      return { opcode, queryId, amount, minOut, from, excesses };
    }
    if (
      (opcode === URANUS_OP.payout || opcode === URANUS_OP.excesses) &&
      !slice.remainingBits &&
      !slice.remainingRefs
    )
      return { opcode, queryId };
    return null;
  } catch {
    return null;
  }
}
