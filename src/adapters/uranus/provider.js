import { AgentError } from '../../shared/errors.js';
import { formatUnits, friendlyAddress } from '../../domain/chain/values.js';
import {
  buildBuy,
  buildSell,
  buildDeploy,
  buildClaim,
  parseUranusAmount,
  URANUS_FACTORY,
  URANUS_GAS,
} from '../../domain/uranus/abi.js';
import { createUranusReader, presentUranus } from './reader.js';
import { createUranusSettlement } from './settlement.js';

export function createUranusCapabilities({ chain, market, walletAddress, network, metadata }) {
  const reader = createUranusReader({ chain, walletAddress, network });
  const owner = reader.address(walletAddress).toRawString(),
    factory = reader.address(URANUS_FACTORY).toRawString();
  const mainnet = () => {
    if (network !== 'mainnet')
      throw new AgentError('uranus_network', 'Uranus is available on mainnet only.', {
        effectNotStarted: true,
      });
  };
  const friendly = (input) => friendlyAddress(reader.address(input), network);
  const decimals = (value = 9) => {
    if (!Number.isInteger(value) || value < 0 || value > 30)
      throw new AgentError('invalid_arguments', 'Token decimals must be between 0 and 30.');
    return value;
  };
  async function resolve(token) {
    if (typeof token !== 'string' || !token.trim())
      throw new AgentError('invalid_arguments', 'A token ticker or address is required.');
    const input = token.trim();
    if (/^(?:-?\d+:|[EU]Q.{40,}|[k0]Q.{40,})/.test(input))
      return { address: reader.address(input).toRawString(), alternatives: 0, market: null };
    if (!market?.uranusSearch)
      throw new AgentError(
        'uranus_search',
        'Token discovery is unavailable; provide the token address.',
      );
    const result = await market.uranusSearch({ query: input, limit: 10 });
    if (!result.results?.length)
      throw new AgentError('token_not_found', 'No Uranus token matches this ticker.');
    const best = result.results[0];
    return {
      address: reader.address(best.address).toRawString(),
      alternatives: result.results.length - 1,
      market: best,
    };
  }
  const tradable = (data) => {
    if (!data.initialized)
      throw new AgentError('uranus_uninitialized', 'The token is not initialized.', {
        effectNotStarted: true,
      });
    if (data.graduated || data.migrated)
      throw new AgentError(
        'uranus_graduated',
        'The token has graduated. Trade it on the DeDust pool instead of the bonding curve.',
        { effectNotStarted: true },
      );
  };
  function message(destination, amountNano, body) {
    return {
      destination,
      amountNano: amountNano.toString(),
      bodyBoc: body.toBoc({ idx: false }).toString('base64'),
      bounce: true,
    };
  }
  function receipt(kind, fields = {}) {
    return { kind, owner, queryId: '0', ...fields };
  }
  async function activeFactory() {
    mainnet();
    if ((await chain.state(factory)).state !== 'active')
      throw new AgentError('uranus_factory', 'The configured Uranus factory is not active.', {
        effectNotStarted: true,
      });
  }
  async function tradePlan(kind, args) {
    mainnet();
    const dec = decimals(args.decimals),
      amount = parseUranusAmount(args.amount, kind === 'buy' ? 9 : dec);
    const minOut = parseUranusAmount(args.min_out?.trim() || '0', kind === 'buy' ? dec : 9, true);
    const resolved = await resolve(args.token),
      data = await reader.data(resolved.address);
    tradable(data);
    const holding = await reader.holding(resolved.address);
    if (kind === 'sell' && BigInt(holding.balance) < amount)
      throw new AgentError('uranus_balance', 'The agent does not hold enough of this token.', {
        effectNotStarted: true,
      });
    const destination = kind === 'buy' ? resolved.address : holding.address;
    const gas = URANUS_GAS[kind],
      spend = kind === 'buy' ? amount + gas : gas;
    const minLabel =
      minOut === 0n
        ? 'No minimum output protection (minimum: 0).'
        : `Minimum output: ${formatUnits(minOut, kind === 'buy' ? dec : 9)} ${kind === 'buy' ? 'tokens' : 'TON'}.`;
    return {
      summary: `${kind === 'buy' ? 'Buy' : 'Sell'} ${formatUnits(amount, kind === 'buy' ? 9 : dec)} ${kind === 'buy' ? 'TON of' : 'tokens of'} ${friendly(resolved.address)} on mainnet.\n${minLabel}\nGas budget: ${formatUnits(gas)} TON. Excess returns to the agent wallet.`,
      message: message(
        destination,
        spend,
        kind === 'buy' ? buildBuy(owner, amount, minOut) : buildSell(owner, amount, minOut),
      ),
      receipt: receipt(`uranus_${kind}`, {
        meme: resolved.address,
        jettonWallet: holding.address,
        amount: amount.toString(),
        minOut: minOut.toString(),
        decimals: dec,
      }),
      details: {
        action: kind,
        meme: friendly(resolved.address),
        amount: args.amount,
        min_out: args.min_out || '0',
        decimals: dec,
        gas_ton: formatUnits(gas),
        other_matches: resolved.alternatives,
      },
    };
  }
  async function revalidateTrade(plan) {
    mainnet();
    const approved = plan.receipt;
    if (approved.owner !== owner)
      throw new AgentError('uranus_owner', 'The approved wallet changed.', {
        effectNotStarted: true,
      });
    tradable(await reader.data(approved.meme));
    const holding = await reader.holding(approved.meme, approved.jettonWallet);
    if (approved.kind === 'uranus_sell' && BigInt(holding.balance) < BigInt(approved.amount))
      throw new AgentError('uranus_balance', 'The token balance is no longer sufficient.', {
        effectNotStarted: true,
      });
  }
  const settle = createUranusSettlement(reader);
  const planners = {
    uranus_buy: { plan: (args) => tradePlan('buy', args), revalidate: revalidateTrade, settle },
    uranus_sell: { plan: (args) => tradePlan('sell', args), revalidate: revalidateTrade, settle },
    uranus_claim_fees: {
      async plan(args) {
        mainnet();
        const resolved = await resolve(args.token),
          data = await reader.data(resolved.address);
        if (!data.initialized || data.creator !== owner)
          throw new AgentError(
            'uranus_creator',
            'Only the agent wallet that created the token can claim its fees.',
            { effectNotStarted: true },
          );
        if (BigInt(data.creatorFeeNano) === 0n)
          throw new AgentError('uranus_no_fees', 'No creator fees are available to claim.', {
            effectNotStarted: true,
          });
        return {
          summary: `Claim creator fees for ${friendly(resolved.address)} on mainnet.\nCurrently claimable: ${formatUnits(data.creatorFeeNano)} TON.\nGas budget: ${formatUnits(URANUS_GAS.claim)} TON. Fees and excess return to the agent wallet.`,
          message: message(resolved.address, URANUS_GAS.claim, buildClaim(owner)),
          receipt: receipt('uranus_claim_fees', {
            meme: resolved.address,
            claimableNano: data.creatorFeeNano,
          }),
          details: {
            action: 'claim_fees',
            meme: friendly(resolved.address),
            creator_fee_claimable_ton: formatUnits(data.creatorFeeNano),
          },
        };
      },
      async revalidate(plan) {
        mainnet();
        const data = await reader.data(plan.receipt.meme);
        if (plan.receipt.owner !== owner || !data.initialized || data.creator !== owner)
          throw new AgentError('uranus_creator', 'The agent is not the token creator.', {
            effectNotStarted: true,
          });
        if (BigInt(data.creatorFeeNano) === 0n)
          throw new AgentError('uranus_no_fees', 'No creator fees remain to claim.', {
            effectNotStarted: true,
          });
      },
      settle,
    },
    uranus_deploy: {
      async plan(args, operationId) {
        mainnet();
        if (!Number.isInteger(args.preset_id) || args.preset_id < 0 || args.preset_id > 15)
          throw new AgentError(
            'invalid_arguments',
            'The Uranus preset must fit uint4 (0 through 15); the documented common presets are 3 through 9.',
          );
        const initialBuy = parseUranusAmount(args.initial_buy?.trim() || '0', 9, true);
        await activeFactory();
        if (!metadata?.prepare)
          throw new AgentError(
            'metadata_unavailable',
            'Token metadata preparation is unavailable.',
          );
        const hosted = await metadata.prepare(
          {
            name: args.name,
            symbol: args.symbol,
            description: args.description,
            image: args.image,
            imageFileId: args.image_file_id,
            metadataUri: args.metadata_uri,
          },
          operationId,
        );
        if (
          typeof hosted?.metadataUri !== 'string' ||
          !hosted.metadataUri.trim() ||
          hosted.metadataUri.length > 4096
        )
          throw new AgentError('metadata_invalid', 'A valid metadata URI is required.');
        return {
          summary: `Deploy a Uranus token on mainnet using preset ${args.preset_id}.\nMetadata: ${hosted.metadataUri}\nInitial buy: ${formatUnits(initialBuy)} TON. Gas budget: ${formatUnits(URANUS_GAS.deploy)} TON.\nFactory: ${URANUS_FACTORY}`,
          message: message(
            factory,
            initialBuy + URANUS_GAS.deploy,
            buildDeploy(args.preset_id, hosted.metadataUri, initialBuy),
          ),
          receipt: receipt('uranus_deploy', {
            presetId: args.preset_id,
            metadataUri: hosted.metadataUri,
            initialBuy: initialBuy.toString(),
          }),
          details: {
            action: 'deploy',
            preset_id: args.preset_id,
            metadata_uri: hosted.metadataUri,
            initial_buy: args.initial_buy || '0',
          },
        };
      },
      async revalidate(plan) {
        if (plan.receipt.owner !== owner || plan.message.destination !== factory)
          throw new AgentError('uranus_factory', 'The approved launch destination changed.', {
            effectNotStarted: true,
          });
        await activeFactory();
      },
      settle,
    },
  };
  return Object.freeze({
    planners,
    async info(args) {
      mainnet();
      const resolved = await resolve(args.token),
        state = await reader.data(resolved.address);
      let context = resolved.market;
      if (market?.uranusCoin) {
        try {
          context = (await market.uranusCoin(resolved.address)) || context;
        } catch {
          /* Market enrichment is optional; on-chain state remains authoritative. */
        }
      }
      const result = {
        ...presentUranus(state, network),
        ...(context
          ? Object.fromEntries(
              [
                'ticker',
                'name',
                'price_usd',
                'price_ton',
                'market_cap_usd',
                'liquidity_ton',
                'holders',
                'change_24h_pct',
                'created_at',
              ]
                .filter((key) => context[key] !== undefined)
                .map((key) => [key, context[key]]),
            )
          : {}),
      };
      return {
        ...result,
        ...(resolved.alternatives
          ? {
              other_matches: resolved.alternatives,
              note: 'Other tokens share this ticker; picked the most liquid. Use uranus_token_search to compare.',
            }
          : {}),
      };
    },
  });
}
