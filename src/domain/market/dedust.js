import { Address } from '@ton/core';
import { AgentError } from '../../shared/errors.js';
import { compareDecimal, decimal, ratioPercent, sumFixed } from './decimal.js';

const text = (value, max = 512) => (typeof value === 'string' ? value.slice(0, max) : '');
export function rawAsset(value) {
  try {
    return Address.parse(String(value).replace(/^jetton:/, '')).toRawString();
  } catch {
    throw new AgentError('invalid_response', 'DeDust returned an invalid token address.');
  }
}
const friendly = (value) => Address.parse(rawAsset(value)).toString({ bounceable: true });
export function coinsResult(items, query, limit) {
  let coins = items
    .filter((item) => item?.tags?.includes('dedust_v3_memepad'))
    .map((item) => {
      if (
        !item.metadata ||
        !Number.isSafeInteger(item.holders) ||
        item.holders < 0 ||
        typeof item.created_at !== 'string'
      )
        throw new AgentError('invalid_response', 'DeDust returned incomplete token data.');
      const change = item.price?.usd_change?.h24 ?? 0;
      if (typeof change !== 'number' || !Number.isFinite(change))
        throw new AgentError('invalid_response', 'DeDust returned an invalid price change.');
      // DeDust already returns percentage units; its coin table adds '%' without scaling.
      return {
        ticker: text(item.metadata.ticker, 80),
        name: text(item.metadata.name),
        address: friendly(item.asset),
        market_cap_usd: decimal(item.market_cap, { empty: true }),
        price_usd: decimal(item.metadata.usd_price, { empty: true }),
        liquidity_ton: decimal(item.liquidity, { empty: true }),
        holders: item.holders,
        change_24h_pct: change.toFixed(1),
        created_at: item.created_at,
      };
    });
  if (query.trim()) coins.sort((a, b) => compareDecimal(b.liquidity_ton, a.liquidity_ton));
  coins = coins.slice(0, limit);
  if (!coins.length) return { query, results: [], note: 'No Uranus memecoin matched.' };
  return {
    query,
    count: coins.length,
    results: coins,
    note: query.trim()
      ? 'Ranked by liquidity. Same ticker can be faked: pick by liquidity/market cap/holders and confirm before trading.'
      : 'Newest Uranus launches. Confirm the token address before trading.',
  };
}

export function portfolioResult(balances) {
  const assets = balances
    .filter((b) => typeof b?.asset === 'string' && b.asset.startsWith('jetton:'))
    .map((b) => ({
      ticker: text(b.metadata?.ticker, 80),
      name: text(b.metadata?.name),
      address: friendly(b.asset),
      balance: decimal(b.balance_formatted),
      value_ton: decimal(b.value_ton, { empty: true }),
    }))
    .filter((b) => compareDecimal(b.balance, '0') > 0);
  assets.sort((a, b) => compareDecimal(b.value_ton, a.value_ton));
  const jettons = assets.slice(0, 50);
  return {
    count: jettons.length,
    jettons,
    total_value_ton: sumFixed(jettons.map((a) => a.value_ton)),
    note: 'Token holdings via DeDust, most valuable first. Native TON is separate: use ton_get_balance. Values are approximate market estimates.',
  };
}

export function holdingsResult(balances, walletAddress) {
  const own = rawAsset(walletAddress);
  const holdings = balances
    .filter((b) => b?.memecoin_extra_details?.contract_type === 'dedust_v3_memepad')
    .map((b) => {
      const extra = b.memecoin_extra_details;
      return {
        ticker: text(b.metadata?.ticker, 80),
        name: text(b.metadata?.name),
        address: friendly(b.asset),
        balance: decimal(b.balance_formatted),
        value_ton: decimal(b.value_ton, { empty: true }),
        created_by_you: Boolean(extra.author) && rawAsset(extra.author) === own,
        graduation_pct: ratioPercent(extra.curve_ton_collected, extra.curve_ton_max),
      };
    });
  return {
    count: holdings.length,
    holdings,
    note: 'To sell, pass an address to uranus_sell. To claim fees, use uranus_claim_fees on a token where created_by_you is true.',
  };
}
