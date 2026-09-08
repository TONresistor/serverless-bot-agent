import { Address, Cell } from '@ton/core';
import { PoolConfig } from '@dedust/kit/dist/cpmm-v2/abi/types/PoolConfig.js';
import { PoolExtra } from '@dedust/kit/dist/cpmm-v2/abi/types/PoolExtra.js';
import { rejectDedust, verifyCode } from './contracts.js';

const assetAddress = (asset) =>
  asset.value === null
    ? 'TON'
    : asset.value instanceof Address && asset.value.workChain === 0
      ? asset.value.toRawString()
      : rejectDedust('Only native TON and basechain jettons are supported.');

/** One account snapshot pins code, configuration, wallets and both reserves.
 * Do not use kit 0.0.4 PoolStorage.create/load: it copies reserveX into reserveY.
 * Layout: official DeDust CPMM v2 PoolStorage / TON ABI registry.
 */
export function readCpmmState(state) {
  const hash = verifyCode(state, 'cpmm'),
    data = Cell.fromBase64(state.data).beginParse();
  const configCell = data.loadRef(),
    config = PoolConfig.load(configCell.beginParse());
  data.loadRef(); // Accumulated fees are separate from trading reserves.
  const extra = PoolExtra.load(data.loadRef().beginParse());
  if (!extra.controller.equals(PoolExtra.DEFAULT_CONTROLLER))
    rejectDedust('The DeDust pool has an untrusted upgrade controller.');
  data.loadMaybeRef(); // Rewards dictionary.
  if (data.loadUint(2) !== 2) rejectDedust('The DeDust pool has not completed initialization.');
  data.loadBit();
  if (!data.loadBit()) rejectDedust('Swaps are paused on this DeDust pool.');
  const liquidity = data.loadCoins(),
    reserveX = data.loadCoins(),
    reserveY = data.loadCoins();
  if (
    data.remainingBits ||
    data.remainingRefs ||
    liquidity <= 0n ||
    reserveX <= 0n ||
    reserveY <= 0n
  )
    rejectDedust('The DeDust pool has no usable liquidity or an unsupported state.');
  if (config.customResolvers.size || extra.resolutions.size)
    rejectDedust('Custom or unresolved DeDust asset resolvers are not supported.');
  if (config.baseFeeBPS >= 10000 || config.creatorFeeBPS > 10000)
    rejectDedust('The DeDust pool fee configuration is invalid.');
  return {
    codeHash: hash,
    configHash: configCell.hash().toString('hex'),
    assetX: assetAddress(config.assetX),
    assetY: assetAddress(config.assetY),
    reserveX,
    reserveY,
    feeBps: config.baseFeeBPS,
    feeIn: config.feeIn.type,
    extra,
  };
}

/** Inclusive fee accounting, verified against both deployed pool bytecodes.
 * creatorFeeBPS splits the LP fee; it is not an extra charge to the trader.
 */
export function quoteCpmm(state, source, amount) {
  const xToY = source === state.assetX;
  if (!xToY && source !== state.assetY)
    rejectDedust('The input asset is not part of the DeDust pool.');
  const inputReserve = BigInt(xToY ? state.reserveX : state.reserveY),
    outputReserve = BigInt(xToY ? state.reserveY : state.reserveX),
    inputAmount = BigInt(amount);
  const inputFee = state.feeIn === 'both' || state.feeIn === (xToY ? 'assetX' : 'assetY');
  const fee = (value) => value - (value * 10000n) / BigInt(10000 + state.feeBps);
  const netInput = inputFee ? inputAmount - fee(inputAmount) : inputAmount;
  const grossOutput = (netInput * outputReserve) / (inputReserve + netInput);
  const amountOut = inputFee ? grossOutput : grossOutput - fee(grossOutput);
  if (netInput <= 0n || amountOut <= 0n)
    rejectDedust('The swap amount is too small for this pool.');
  return {
    amountOut,
    feeAmount: inputFee ? inputAmount - netInput : grossOutput - amountOut,
    feeAsset: inputFee ? source : xToY ? state.assetY : state.assetX,
    xToY,
  };
}
