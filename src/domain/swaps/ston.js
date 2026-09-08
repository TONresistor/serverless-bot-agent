import { beginCell, openContract } from '@ton/core';
import { DEX as V21 } from '@ston-fi/sdk/dex/v2_1';
import { DEX as V22 } from '@ston-fi/sdk/dex/v2_2';
import { chainAddress } from '../chain/values.js';
import { unsigned } from './input.js';
import { AgentError } from '../../shared/errors.js';

const types = {
  ConstantProduct: 'CPI',
  constant_product: 'CPI',
  StableSwap: 'Stable',
  stableswap: 'Stable',
  WeightedConstProduct: 'WCPI',
  weighted_const_product: 'WCPI',
  WeightedStableSwap: 'WStable',
  weighted_stableswap: 'WStable',
};
const reject = (message) => {
  throw new AgentError('unsupported_swap_route', message, { effectNotStarted: true });
};
const raw = (value) => chainAddress(value, 'mainnet').toRawString();
export const equalAddress = (a, b) => raw(a) === raw(b);

/** SDK contracts receive only getter/open capabilities. Every send method fails closed. */
export function readProvider(chain, address) {
  const unavailable = async () => {
    throw new AgentError('read_only_provider', 'The swap builder cannot send transactions.');
  };
  return /** @type {import('@ton/core').ContractProvider} */ ({
    get: (method, args) => chain.runGetMethod(raw(address), method, args),
    open: (contract) =>
      openContract(contract, ({ address: child }) => readProvider(chain, child.toRawString())),
    getState: unavailable,
    getTransactions: unavailable,
    external: unavailable,
    internal: unavailable,
  });
}

export function parseSimulation(response, parsed) {
  if (
    !response ||
    !response.router ||
    !equalAddress(response.offer_address, parsed.source.apiAddress) ||
    !equalAddress(response.ask_address, parsed.output.apiAddress) ||
    unsigned(response.offer_units, 'simulated input', true) !== parsed.inputUnits
  )
    reject('The STON.fi simulation does not match the requested assets and amount.');
  const info = response.router,
    type = types[info.router_type];
  if (
    info.major_version !== 2 ||
    ![1, 2].includes(info.minor_version) ||
    !type ||
    info.pton_version !== '2.1' ||
    !equalAddress(info.address, response.router_address)
  )
    reject('Only direct STON.fi v2.1/v2.2 routes with pTON v2.1 are supported.');
  const expectedOut = unsigned(response.ask_units, 'expected output', true),
    suppliedMin = unsigned(response.min_ask_units, 'minimum output', true);
  const floor = (BigInt(expectedOut) * BigInt(10000 - parsed.slippageBps)) / 10000n;
  if (floor === 0n || BigInt(suppliedMin) < floor || BigInt(suppliedMin) > BigInt(expectedOut))
    reject('The simulation does not enforce the requested slippage.');
  const forwardGas = unsigned(response.gas_params?.forward_gas, 'forward gas', true);
  return {
    routerAddress: raw(info.address),
    poolAddress: raw(response.pool_address),
    ptonMaster: raw(info.pton_master_address),
    ptonRouterWallet: raw(info.pton_wallet_address),
    routerVersion: `2.${info.minor_version}`,
    routerType: type,
    routerOfferWallet: raw(response.offer_jetton_wallet),
    routerAskWallet: raw(response.ask_jetton_wallet),
    expectedOut,
    minOut: suppliedMin,
    forwardGas,
  };
}

export async function verifyRoute(chain, parsed, route, owner) {
  const dex = route.routerVersion === '2.1' ? V21 : V22;
  const router = dex.Router[route.routerType].create(route.routerAddress),
    provider = readProvider(chain, route.routerAddress);
  const version = await router.getRouterVersion(provider),
    data = await router.getRouterData(provider);
  if (
    version.major !== 2 ||
    `2.${version.minor}` !== route.routerVersion ||
    data.isLocked ||
    types[data.dexType] !== route.routerType
  )
    reject('The on-chain router is locked or does not match the quoted route.');
  async function wallet(master, ownerAddress) {
    const result = await chain.runGetMethod(master, 'get_wallet_address', [
      {
        type: 'slice',
        cell: beginCell().storeAddress(chainAddress(ownerAddress, 'mainnet')).endCell(),
      },
    ]);
    return result.stack.readAddress().toRawString();
  }
  const inputMaster = parsed.source.address === 'TON' ? route.ptonMaster : parsed.source.address;
  const outputMaster = parsed.output.address === 'TON' ? route.ptonMaster : parsed.output.address;
  const inputRouterWallet = await wallet(inputMaster, route.routerAddress),
    outputRouterWallet = await wallet(outputMaster, route.routerAddress);
  if (inputRouterWallet !== route.routerOfferWallet || outputRouterWallet !== route.routerAskWallet)
    reject('The quoted token wallets do not belong to the router.');
  if ((await wallet(route.ptonMaster, route.routerAddress)) !== route.ptonRouterWallet)
    reject('The quoted pTON wallet does not belong to the router.');
  const pool = await router.getPoolAddress(provider, {
    token0: inputRouterWallet,
    token1: outputRouterWallet,
  });
  if (pool.toRawString() !== route.poolAddress)
    reject('The quoted pool does not belong to this router and token pair.');
  const inputWallet =
    parsed.source.address === 'TON' ? raw(owner) : await wallet(inputMaster, owner);
  const outputWallet =
    parsed.output.address === 'TON' ? raw(owner) : await wallet(outputMaster, owner);
  return {
    router,
    provider,
    proxyTon: dex.pTON.create(route.ptonMaster),
    inputWallet,
    outputWallet,
  };
}

export function gasBudget(parsed, route, router, proxyTon) {
  if (parsed.source.address === 'TON')
    return (BigInt(route.forwardGas) + proxyTon.gasConstants.tonTransfer).toString();
  const constants =
    parsed.output.address === 'TON'
      ? router.gasConstants.swapJettonToTon
      : router.gasConstants.swapJettonToJetton;
  const required = BigInt(route.forwardGas) + constants.gasAmount - constants.forwardGasAmount;
  return (required > constants.gasAmount ? required : constants.gasAmount).toString();
}

export async function buildSwapMessage(parsed, route, contracts, owner, queryId, deadline) {
  const gasNano = gasBudget(parsed, route, contracts.router, contracts.proxyTon);
  const params = {
    userWalletAddress: owner,
    receiverAddress: owner,
    refundAddress: owner,
    excessesAddress: owner,
    transferExcessAddress: owner,
    offerAmount: parsed.inputUnits,
    minAskAmount: route.minOut,
    queryId: BigInt(queryId),
    deadline,
    referralValue: 0,
    askJettonWalletAddress: route.routerAskWallet,
    forwardGasAmount: route.forwardGas,
  };
  let transaction;
  if (parsed.source.address === 'TON')
    transaction = await contracts.router.getSwapTonToJettonTxParams(contracts.provider, {
      ...params,
      proxyTon: contracts.proxyTon,
      askJettonAddress: parsed.output.address,
      offerJettonWalletAddress: route.routerOfferWallet,
    });
  else if (parsed.output.address === 'TON')
    transaction = await contracts.router.getSwapJettonToTonTxParams(contracts.provider, {
      ...params,
      offerJettonAddress: parsed.source.address,
      offerJettonWalletAddress: contracts.inputWallet,
      proxyTon: contracts.proxyTon,
      gasAmount: gasNano,
    });
  else
    transaction = await contracts.router.getSwapJettonToJettonTxParams(contracts.provider, {
      ...params,
      offerJettonAddress: parsed.source.address,
      offerJettonWalletAddress: contracts.inputWallet,
      askJettonAddress: parsed.output.address,
      gasAmount: gasNano,
    });
  return {
    message: {
      destination: transaction.to.toRawString(),
      amountNano: transaction.value.toString(),
      bodyBoc: transaction.body.toBoc().toString('base64'),
      bounce: true,
    },
    gasNano,
  };
}
