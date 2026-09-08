import { Address } from '@ton/core';
import { Asset } from '@dedust/sdk/dist/contracts/dex/common/Asset.js';
import { Factory } from '@dedust/sdk/dist/contracts/dex/factory/Factory.js';
import { Pool } from '@dedust/sdk/dist/contracts/dex/pool/Pool.js';
import { VaultNative } from '@dedust/sdk/dist/contracts/dex/vault/VaultNative.js';
import { VaultJetton } from '@dedust/sdk/dist/contracts/dex/vault/VaultJetton.js';
import {
  DEDUST_FACTORY,
  rejectDedust,
  verifyCode,
} from '../../../domain/swaps/dedust/contracts.js';
import { unsigned } from '../../../domain/swaps/input.js';
import { getterProvider, jettonWallet, rawAddress, verifyJettonWallet } from './common.js';

const assetOf = (address) =>
  address === 'TON' ? Asset.native() : Asset.jetton(Address.parse(address));
const addressOf = (asset) => (asset.type === 0 ? 'TON' : asset.address?.toRawString());

export function createLegacyDedust(chain) {
  const factory = Factory.createFromAddress(Address.parse(DEDUST_FACTORY)),
    provider = getterProvider(chain, DEDUST_FACTORY);
  async function candidates(parsed) {
    verifyCode(await chain.account(rawAddress(DEDUST_FACTORY)), 'factory');
    const assets = /** @type {[Asset, Asset]} */ ([
        assetOf(parsed.source.address),
        assetOf(parsed.output.address),
      ]),
      results = [];
    for (const poolType of [0, 1])
      results.push({
        address: (await factory.getPoolAddress(provider, { poolType, assets })).toRawString(),
        poolType,
      });
    return results;
  }
  async function vault(asset) {
    const address = (await factory.getVaultAddress(provider, assetOf(asset))).toRawString();
    verifyCode(await chain.account(address), asset === 'TON' ? 'nativeVault' : 'jettonVault');
    const port = getterProvider(chain, address),
      contract = (asset === 'TON' ? VaultNative : VaultJetton).createFromAddress(
        Address.parse(address),
      );
    if (addressOf(await contract.getAsset(port)) !== asset)
      rejectDedust('The DeDust vault holds a different asset.');
    if (
      (await port.get('get_factory_addr', [])).stack.readAddress().toRawString() !==
      rawAddress(DEDUST_FACTORY)
    )
      rejectDedust('The DeDust vault belongs to a different factory.');
    if (asset === 'TON') return { address, wallet: address };
    if (!(await port.get('is_ready', [])).stack.readBoolean())
      rejectDedust('The DeDust jetton vault is not ready.');
    const wallet = await jettonWallet(chain, asset, address);
    if ((await port.get('get_wallet_addr', [])).stack.readAddress().toRawString() !== wallet)
      rejectDedust('The DeDust vault has an unexpected jetton wallet.');
    await verifyJettonWallet(chain, wallet, asset, address);
    return { address, wallet };
  }
  async function resolve(parsed, candidate, state) {
    const hash = verifyCode(state, 'vaultPool'),
      pool = Pool.createFromAddress(Address.parse(candidate.address)),
      port = getterProvider(chain, candidate.address);
    const assets = (await pool.getAssets(port)).map(addressOf);
    if (!assets.includes(parsed.source.address) || !assets.includes(parsed.output.address))
      rejectDedust('The DeDust pool does not contain the requested asset pair.');
    const reserves = await pool.getReserves(port);
    if (reserves.some((value) => value <= 0n))
      rejectDedust('The DeDust pool has no usable liquidity.');
    const simulation = await pool.getEstimatedSwapOut(port, {
      assetIn: assetOf(parsed.source.address),
      amountIn: BigInt(parsed.inputUnits),
    });
    if (addressOf(simulation.assetOut) !== parsed.output.address || simulation.tradeFee < 0n)
      rejectDedust('The DeDust quote does not match the output asset.');
    const expectedOut = unsigned(simulation.amountOut.toString(), 'DeDust expected output', true);
    const input = await vault(parsed.source.address),
      output = await vault(parsed.output.address);
    return {
      version: 'vault-v2',
      poolType: candidate.poolType,
      poolAddress: candidate.address,
      codeHash: hash,
      configHash: '',
      expectedOut,
      feeAmount: simulation.tradeFee.toString(),
      feeAsset: parsed.source.address,
      inputVault: input.address,
      outputVault: output.address,
      inputPoolWallet: input.wallet,
      outputPoolWallet: output.wallet,
      feeBps: null,
      feeIn: 'input',
      xToY: assets[0] === parsed.source.address,
    };
  }
  return { candidates, resolve };
}
