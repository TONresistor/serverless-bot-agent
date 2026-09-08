import { chainAddress, formatUnits } from '../chain/values.js';
import { TON_ASSET } from '../market/stonfi.js';
import { AgentError } from '../../shared/errors.js';

const invalid = (message) => {
  throw new AgentError('invalid_swap', message, { effectNotStarted: true });
};
export function unsigned(value, label, positive = false) {
  if (
    typeof value !== 'string' ||
    !/^\d{1,37}$/.test(value) ||
    BigInt(value) >= 1n << 120n ||
    (positive && BigInt(value) === 0n)
  )
    invalid(`Invalid ${label}.`);
  return BigInt(value).toString();
}
export function normalizeSwap(args, network) {
  if (network !== 'mainnet') invalid('Direct swaps are available on mainnet only.');
  const dex = args.dex === undefined ? 'stonfi' : args.dex;
  if (!['stonfi', 'dedust'].includes(dex)) invalid('Choose stonfi or dedust.');
  const poolAddress =
    args.pool_address === undefined
      ? undefined
      : chainAddress(args.pool_address, network).toRawString();
  if (poolAddress && dex !== 'dedust') invalid('pool_address is available for DeDust only.');
  const from = typeof args.from === 'string' && args.from.trim() ? args.from.trim() : 'TON';
  const to = typeof args.to === 'string' ? args.to.trim() : '';
  if (!to) invalid('The output asset is required.');
  function asset(value, decimals, label) {
    if (value.toUpperCase() === 'TON')
      return { address: 'TON', apiAddress: TON_ASSET, decimals: 9 };
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30)
      invalid(
        `${label}_decimals is required for a jetton (0..30). Use ton_token_search to get its address and decimals.`,
      );
    const address = chainAddress(value, network).toRawString();
    if (address === chainAddress(TON_ASSET, network).toRawString())
      invalid('Use TON to select the native asset.');
    return { address, apiAddress: address, decimals };
  }
  const source = asset(from, args.from_decimals, 'from'),
    output = asset(to, args.to_decimals, 'to');
  if (source.address === output.address) invalid('Choose two different assets.');
  if (
    typeof args.amount !== 'string' ||
    !/^\d+(?:\.\d+)?$/.test(args.amount.trim()) ||
    args.amount.length > 80
  )
    invalid('The input amount must be a positive decimal string.');
  const [whole, fraction = ''] = args.amount.trim().split('.');
  if (fraction.length > source.decimals)
    invalid('The input amount has more precision than this asset supports.');
  const inputUnits = unsigned(
    (whole + fraction.padEnd(source.decimals, '0')).replace(/^0+(?=\d)/, ''),
    'input amount',
    true,
  );
  const slippageBps =
    args.max_slippage_bps === undefined || args.max_slippage_bps === 0
      ? 100
      : args.max_slippage_bps;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 9999)
    invalid('Slippage must be between 1 and 9999 basis points.');
  return {
    dex,
    poolAddress,
    source,
    output,
    inputUnits,
    amount: formatUnits(inputUnits, source.decimals),
    slippageBps,
  };
}

export function swapArguments(parsed) {
  return {
    dex: parsed.dex,
    ...(parsed.poolAddress ? { pool_address: parsed.poolAddress } : {}),
    from: parsed.source.address,
    to: parsed.output.address,
    amount: parsed.amount,
    from_decimals: parsed.source.decimals,
    to_decimals: parsed.output.decimals,
    max_slippage_bps: parsed.slippageBps,
  };
}
