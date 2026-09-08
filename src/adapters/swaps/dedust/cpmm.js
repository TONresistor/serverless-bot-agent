import { Address } from '@ton/core';
import { readCpmmState, quoteCpmm } from '../../../domain/swaps/dedust/cpmm.js';
import { rejectDedust } from '../../../domain/swaps/dedust/contracts.js';
import { jettonWallet, verifyJettonWallet } from './common.js';

export async function resolveCpmm(chain, parsed, poolAddress, account) {
  const state = readCpmmState(account);
  if (
    ![state.assetX, state.assetY].includes(parsed.source.address) ||
    ![state.assetX, state.assetY].includes(parsed.output.address)
  )
    rejectDedust('The DeDust CPMM pool does not contain the requested asset pair.');
  async function poolWallet(asset) {
    if (asset === 'TON') return poolAddress;
    const master = Address.parse(asset),
      wallet = await jettonWallet(chain, asset, poolAddress);
    const registered = state.extra.walletsByAssets.get(master.hash),
      reverse = state.extra.assetsByWallets.get(Address.parse(wallet).hash);
    if (
      registered?.toRawString() !== wallet ||
      !(reverse?.value instanceof Address) ||
      reverse.value.toRawString() !== asset
    )
      rejectDedust('The DeDust pool has an unexpected registered jetton wallet.');
    await verifyJettonWallet(chain, wallet, asset, poolAddress);
    return wallet;
  }
  const inputPoolWallet = await poolWallet(parsed.source.address),
    outputPoolWallet = await poolWallet(parsed.output.address);
  const quote = quoteCpmm(state, parsed.source.address, BigInt(parsed.inputUnits));
  return {
    version: 'cpmm-v2',
    poolType: null,
    poolAddress,
    codeHash: state.codeHash,
    configHash: state.configHash,
    expectedOut: quote.amountOut.toString(),
    feeAmount: quote.feeAmount.toString(),
    feeAsset: quote.feeAsset,
    inputVault: poolAddress,
    outputVault: poolAddress,
    inputPoolWallet,
    outputPoolWallet,
    feeBps: state.feeBps,
    feeIn: state.feeIn,
    xToY: quote.xToY,
  };
}
