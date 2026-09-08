import { createDedustAPI } from './api.js';
import { createLegacyDedust } from './legacy.js';
import { resolveCpmm } from './cpmm.js';
import { ownerWallets, rawAddress, verifyJettonWallet } from './common.js';
import { normalizeSwap, swapArguments } from '../../../domain/swaps/input.js';
import { DEDUST_CODE, codeHash, rejectDedust } from '../../../domain/swaps/dedust/contracts.js';
import { buildDedustMessage } from '../../../domain/swaps/dedust/messages.js';
import { inspectDedustSettlement } from '../../../domain/swaps/dedust/settlement.js';
import { formatUnits } from '../../../domain/chain/values.js';
import { digest } from '../../../shared/hash.js';
import { AgentError } from '../../../shared/errors.js';

/** @param {import('../../../contracts/chain.js').SwapOptions} options */
export function createDedustSwapPlanner({
  chain,
  fetcher,
  walletAddress,
  network,
  now = () => Date.now(),
}) {
  const owner = rawAddress(walletAddress),
    api = createDedustAPI(fetcher),
    legacy = createLegacyDedust(chain);
  async function resolve(args) {
    const parsed = normalizeSwap(args, network);
    if (parsed.dex !== 'dedust') rejectDedust('Choose dex=dedust for a DeDust swap.');
    await api.verifyAsset(parsed.source);
    await api.verifyAsset(parsed.output);
    let legacyPools;
    const getLegacy = async () => (legacyPools ||= await legacy.candidates(parsed));
    const candidates = [];
    if (parsed.poolAddress) candidates.push(parsed.poolAddress);
    else {
      // Factory discovery covers volatile and stable vault pools. Graduation
      // messages add CPMM candidates; public indexing is discovery, not trust.
      candidates.push(...(await getLegacy()).map((pool) => pool.address));
      for (const asset of [parsed.source, parsed.output]) {
        if (asset.address === 'TON') continue;
        const result = await chain.indexed('/messages', {
          source: asset.address,
          direction: 'out',
          opcode: '0xde8402ce',
          limit: 4,
        });
        if (
          !result ||
          typeof result !== 'object' ||
          !('messages' in result) ||
          !Array.isArray(result.messages)
        )
          rejectDedust('TON Center did not return DeDust pool discovery data.');
        for (const message of result.messages.slice(0, 4)) {
          if (
            rawAddress(message.source) !== asset.address ||
            message.opcode !== '0xde8402ce' ||
            !message.destination
          )
            continue;
          candidates.push(rawAddress(message.destination));
        }
      }
    }
    const routes = [];
    for (const address of [...new Set(candidates)]) {
      const state = await chain.account(address);
      if (state.state !== 'active' && !parsed.poolAddress) continue;
      try {
        let route;
        if (DEDUST_CODE.cpmm.includes(codeHash(state)))
          route = await resolveCpmm(chain, parsed, address, state);
        else {
          const candidate = (await getLegacy()).find((pool) => pool.address === address);
          if (!candidate)
            rejectDedust('The supplied address is not a supported DeDust pool for this pair.');
          route = await legacy.resolve(parsed, candidate, state);
        }
        const minOut = (BigInt(route.expectedOut) * BigInt(10000 - parsed.slippageBps)) / 10000n;
        if (minOut <= 0n) rejectDedust('The requested amount produces a zero minimum output.');
        routes.push({ ...route, minOut: minOut.toString() });
      } catch (error) {
        // Reject only definitively unsupported candidates. Provider outages
        // must remain visible instead of silently selecting an incomplete set.
        if (
          parsed.poolAddress ||
          !(error instanceof AgentError) ||
          error.code !== 'unsupported_dedust_route'
        )
          throw error;
      }
    }
    routes.sort((a, b) =>
      BigInt(a.expectedOut) > BigInt(b.expectedOut)
        ? -1
        : BigInt(a.expectedOut) < BigInt(b.expectedOut)
          ? 1
          : a.poolAddress.localeCompare(b.poolAddress),
    );
    if (!routes.length)
      rejectDedust(
        'No supported liquid direct DeDust pool was found. For another CPMM pool, supply its exact pool_address. Multi-hop swaps are not supported.',
      );
    return { parsed, route: { ...routes[0], ...(await ownerWallets(chain, parsed, owner)) } };
  }
  const inputBalance = async (parsed, route) => {
    if (
      parsed.source.address !== 'TON' &&
      (await verifyJettonWallet(chain, route.inputWallet, parsed.source.address, owner)) <
        BigInt(parsed.inputUnits)
    )
      rejectDedust('The wallet does not hold enough input tokens for this swap.');
  };
  function view(parsed, route, gasNano) {
    return {
      dex: 'dedust',
      from: parsed.source.address,
      to: parsed.output.address,
      amount_in: parsed.amount,
      expected_out: formatUnits(route.expectedOut, parsed.output.decimals),
      minimum_out: formatUnits(route.minOut, parsed.output.decimals),
      route: `DeDust ${route.version === 'cpmm-v2' ? 'CPMM v2' : route.poolType === 1 ? 'vault stable' : 'vault volatile'} direct`,
      pool_address: route.poolAddress,
      fee_amount_raw: route.feeAmount,
      fee_asset: route.feeAsset,
      gas_budget_ton: formatUnits(gasNano, 9),
      slippage_bps: parsed.slippageBps,
      note: 'Indicative direct pool quote. ton_swap rechecks the selected pool and prepares an exact transaction for owner confirmation. Minimum output and deadline are enforced on-chain.',
    };
  }
  return Object.freeze({
    async quote(args) {
      const { parsed, route } = await resolve(args),
        { gasNano } = buildDedustMessage(parsed, route, owner, '1', Math.floor(now() / 1000) + 900);
      return view(parsed, route, gasNano);
    },
    async plan(args, operationId) {
      const { parsed, route } = await resolve(args);
      await inputBalance(parsed, route);
      const queryId = BigInt('0x' + digest(`dedust:${operationId}`).slice(0, 16)).toString(),
        deadline = Math.floor(now() / 1000) + 900;
      const { message, gasNano } = buildDedustMessage(parsed, route, owner, queryId, deadline),
        details = view(parsed, route, gasNano);
      return {
        summary: `Swap ${details.amount_in} ${details.from} for at least ${details.minimum_out} ${details.to} via ${details.route}. Pool: ${details.pool_address}. Slippage: ${details.slippage_bps} bps. TON gas budget: ${details.gas_budget_ton}.`,
        message,
        receipt: {
          kind: 'swap',
          protocol: 'dedust',
          network,
          owner,
          args: { ...swapArguments(parsed), pool_address: route.poolAddress },
          source: parsed.source.address,
          output: parsed.output.address,
          sourceDecimals: parsed.source.decimals,
          outputDecimals: parsed.output.decimals,
          inputUnits: parsed.inputUnits,
          ...route,
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
        receipt.protocol !== 'dedust' ||
        receipt.owner !== owner ||
        receipt.network !== network ||
        receipt.deadline <= Math.floor(now() / 1000) + 30
      )
        rejectDedust('This swap approval expired. Request a fresh quote and confirmation.');
      const { parsed, route } = await resolve(receipt.args);
      await inputBalance(parsed, route);
      for (const key of [
        'version',
        'poolAddress',
        'codeHash',
        'configHash',
        'inputVault',
        'outputVault',
        'inputPoolWallet',
        'outputPoolWallet',
        'inputWallet',
        'outputWallet',
      ])
        if (route[key] !== receipt[key])
          rejectDedust('The approved DeDust route changed. Request a new confirmation.');
      if (
        parsed.inputUnits !== receipt.inputUnits ||
        parsed.source.address !== receipt.source ||
        parsed.output.address !== receipt.output ||
        BigInt(route.minOut) < BigInt(receipt.minOut)
      )
        rejectDedust('The fresh quote no longer satisfies the approved minimum output.');
      const { message, gasNano } = buildDedustMessage(
        parsed,
        { ...route, minOut: receipt.minOut },
        owner,
        receipt.queryId,
        receipt.deadline,
      );
      if (
        gasNano !== receipt.gasNano ||
        message.destination !== plan.message.destination ||
        message.amountNano !== plan.message.amountNano ||
        message.bodyBoc !== plan.message.bodyBoc
      )
        rejectDedust('The approved DeDust transaction changed. Request a new confirmation.');
    },
    settle: (plan, evidence) => inspectDedustSettlement(plan.receipt, evidence),
  });
}
