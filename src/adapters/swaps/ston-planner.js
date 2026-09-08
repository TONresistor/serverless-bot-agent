import { createStonSwapAPI } from './api.js';
import { normalizeSwap, swapArguments } from '../../domain/swaps/input.js';
import { parseSimulation, verifyRoute, buildSwapMessage } from '../../domain/swaps/ston.js';
import { inspectSwapSettlement } from '../../domain/swaps/settlement.js';
import { chainAddress, formatUnits } from '../../domain/chain/values.js';
import { digest } from '../../shared/hash.js';
import { AgentError } from '../../shared/errors.js';

/** @param {import('../../contracts/chain.js').SwapOptions} options */
export function createStonSwapPlanner({
  chain,
  fetcher,
  walletAddress,
  network,
  now = () => Date.now(),
}) {
  const api = createStonSwapAPI(fetcher),
    owner = chainAddress(walletAddress, network).toRawString();
  async function resolve(args, pool = undefined) {
    const parsed = normalizeSwap(args, network);
    for (const asset of [parsed.source, parsed.output]) {
      if (asset.address === 'TON') continue;
      const info = await api.asset(asset.address),
        decimals = info?.meta?.decimals ?? info?.decimals;
      if (
        !info ||
        chainAddress(info.contract_address, network).toRawString() !== asset.address ||
        decimals !== asset.decimals
      )
        throw new AgentError(
          'swap_decimals',
          'The token decimals do not match STON.fi metadata. Resolve this asset again before swapping.',
          { effectNotStarted: true },
        );
      if (info.taxable === true)
        throw new AgentError(
          'unsupported_swap_route',
          'Transfer-tax tokens are not supported by this direct swap path.',
          { effectNotStarted: true },
        );
    }
    const route = parseSimulation(await api.simulate(parsed, pool), parsed);
    const contracts = await verifyRoute(chain, parsed, route, owner);
    return { parsed, route, contracts };
  }
  function view(parsed, route, gasNano) {
    return {
      from: parsed.source.address,
      to: parsed.output.address,
      amount_in: parsed.amount,
      expected_out: formatUnits(route.expectedOut, parsed.output.decimals),
      minimum_out: formatUnits(route.minOut, parsed.output.decimals),
      route: `STON.fi v${route.routerVersion} ${route.routerType} direct`,
      gas_budget_ton: formatUnits(gasNano, 9),
      slippage_bps: parsed.slippageBps,
      note: 'Indicative direct STON.fi route. ton_swap prepares an exact transaction for owner confirmation; its minimum output is enforced on-chain.',
    };
  }
  async function inputBalance(parsed, contracts) {
    if (parsed.source.address === 'TON') return;
    const { stack } = await chain.runGetMethod(contracts.inputWallet, 'get_wallet_data');
    const balance = stack.readBigNumber(),
      actualOwner = stack.readAddress(),
      master = stack.readAddress();
    stack.readCell();
    if (actualOwner.toRawString() !== owner || master.toRawString() !== parsed.source.address)
      throw new AgentError(
        'jetton_identity',
        'The input wallet does not match the owner and token master.',
        { effectNotStarted: true },
      );
    if (balance < BigInt(parsed.inputUnits))
      throw new AgentError(
        'insufficient_jetton',
        'The wallet does not hold enough input tokens for this swap.',
        { effectNotStarted: true },
      );
  }
  return Object.freeze({
    validate: (args) => {
      normalizeSwap(args, network);
    },
    async quote(args) {
      const { parsed, route, contracts } = await resolve(args);
      const { gasNano } = await buildSwapMessage(
        parsed,
        route,
        contracts,
        owner,
        '1',
        Math.floor(now() / 1000) + 900,
      );
      return view(parsed, route, gasNano);
    },
    async plan(args, operationId) {
      const { parsed, route, contracts } = await resolve(args);
      await inputBalance(parsed, contracts);
      const queryId = BigInt('0x' + digest(`ston:${operationId}`).slice(0, 16)).toString(),
        deadline = Math.floor(now() / 1000) + 900;
      const { message, gasNano } = await buildSwapMessage(
        parsed,
        route,
        contracts,
        owner,
        queryId,
        deadline,
      );
      const details = view(parsed, route, gasNano);
      return {
        summary: `Swap ${details.amount_in} ${details.from} for at least ${details.minimum_out} ${details.to} via ${details.route}. Slippage: ${details.slippage_bps} bps. TON gas budget: ${details.gas_budget_ton}.`,
        message,
        receipt: {
          kind: 'swap',
          protocol: 'stonfi',
          network,
          owner,
          args: swapArguments(parsed),
          source: parsed.source.address,
          output: parsed.output.address,
          sourceDecimals: parsed.source.decimals,
          outputDecimals: parsed.output.decimals,
          inputUnits: parsed.inputUnits,
          ...route,
          inputWallet: contracts.inputWallet,
          outputWallet: contracts.outputWallet,
          queryId,
          deadline,
          gasNano,
        },
        details,
      };
    },
    async revalidate(plan) {
      const receipt = plan.receipt;
      if (
        receipt.kind !== 'swap' ||
        receipt.protocol !== 'stonfi' ||
        receipt.owner !== owner ||
        receipt.network !== network ||
        receipt.deadline <= Math.floor(now() / 1000) + 30
      )
        throw new AgentError(
          'swap_expired',
          'This swap approval expired. Request a fresh quote and confirmation.',
          { effectNotStarted: true },
        );
      const { parsed, route, contracts } = await resolve(receipt.args, receipt.poolAddress);
      await inputBalance(parsed, contracts);
      for (const key of [
        'routerAddress',
        'poolAddress',
        'ptonMaster',
        'ptonRouterWallet',
        'routerVersion',
        'routerType',
        'routerOfferWallet',
        'routerAskWallet',
      ])
        if (route[key] !== receipt[key])
          throw new AgentError(
            'swap_route_changed',
            'The swap route changed. Request a new confirmation.',
            { effectNotStarted: true },
          );
      if (
        parsed.inputUnits !== receipt.inputUnits ||
        parsed.source.address !== receipt.source ||
        parsed.output.address !== receipt.output ||
        BigInt(route.minOut) < BigInt(receipt.minOut)
      )
        throw new AgentError(
          'swap_price_changed',
          'The fresh quote no longer satisfies the approved minimum output.',
          { effectNotStarted: true },
        );
      if (BigInt(route.forwardGas) > BigInt(receipt.forwardGas))
        throw new AgentError(
          'swap_debit_changed',
          'The approved swap transaction changed. Request a new confirmation.',
          { effectNotStarted: true },
        );
      const { message, gasNano } = await buildSwapMessage(
        parsed,
        { ...route, minOut: receipt.minOut, forwardGas: receipt.forwardGas },
        contracts,
        owner,
        receipt.queryId,
        receipt.deadline,
      );
      if (
        BigInt(gasNano) > BigInt(receipt.gasNano) ||
        message.destination !== plan.message.destination ||
        message.amountNano !== plan.message.amountNano ||
        message.bodyBoc !== plan.message.bodyBoc
      )
        throw new AgentError(
          'swap_debit_changed',
          'The approved swap transaction changed. Request a new confirmation.',
          { effectNotStarted: true },
        );
    },
    settle: (plan, evidence) => inspectSwapSettlement(plan.receipt, evidence),
  });
}
