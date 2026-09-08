import { AgentError } from '../../shared/errors.js';

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const rounded = (value) => Math.round(finite(value));
function projectPair(pair, now) {
  const created = finite(pair.pairCreatedAt);
  const age = created > 0 ? Math.max(0, Math.trunc((now - created) / 86400000)) : 0;
  const price = Number(pair.priceUsd || '0');
  const liquidity = rounded(pair.liquidity?.usd),
    volume = rounded(pair.volume?.h24);
  const marketCap = rounded(pair.marketCap || pair.fdv);
  const flags = [];
  if (liquidity < 10000) flags.push('low_liquidity');
  if (created > 0 && age < 3) flags.push('new_token');
  if (volume < 1000) flags.push('low_24h_volume');
  return {
    symbol: pair.baseToken.symbol || '',
    name: pair.baseToken.name || '',
    chain: pair.chainId,
    dex: pair.dexId || '',
    address: pair.baseToken.address,
    price_usd: Number.isFinite(price) ? Number(price.toPrecision(6)) : 0,
    liquidity_usd: liquidity,
    vol24h_usd: volume,
    ...(typeof pair.priceChange?.h1 === 'number' && Number.isFinite(pair.priceChange.h1)
      ? { change_1h: pair.priceChange.h1 }
      : {}),
    ...(typeof pair.priceChange?.h24 === 'number' && Number.isFinite(pair.priceChange.h24)
      ? { change_24h: pair.priceChange.h24 }
      : {}),
    ...(marketCap ? { market_cap_usd: marketCap } : {}),
    age_days: age,
    txns_24h: {
      buys: Math.max(0, Math.trunc(finite(pair.txns?.h24?.buys))),
      sells: Math.max(0, Math.trunc(finite(pair.txns?.h24?.sells))),
    },
    ...(flags.length ? { flags } : {}),
  };
}

export function tokenMarketResult(response, query, chain = '', now = Date.now()) {
  if (!response || !Array.isArray(response.pairs))
    throw new AgentError('invalid_response', 'DexScreener returned an invalid market response.');
  const pairs = response.pairs.filter(
    (pair) =>
      pair &&
      typeof pair.chainId === 'string' &&
      typeof pair.baseToken?.address === 'string' &&
      pair.baseToken.address,
  );
  // EVM addresses are case-insensitive; base58/TON identities remain case-sensitive.
  const sameAddress = (address) =>
    /^0x[0-9a-f]+$/i.test(address) && /^0x[0-9a-f]+$/i.test(query)
      ? address.toLowerCase() === query.toLowerCase()
      : address === query;
  const exact = pairs.filter((pair) => sameAddress(pair.baseToken.address));
  const selected = exact.length
    ? exact
    : chain
      ? pairs.filter((pair) => pair.chainId.toLowerCase() === chain.toLowerCase())
      : pairs;
  selected.sort((a, b) => finite(b.liquidity?.usd) - finite(a.liquidity?.usd));
  const seen = new Set(),
    tokens = [];
  for (const pair of selected) {
    const address = /^0x[0-9a-f]+$/i.test(pair.baseToken.address)
      ? pair.baseToken.address.toLowerCase()
      : pair.baseToken.address;
    const key = `${pair.chainId.toLowerCase()}|${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(projectPair(pair, now));
    if (tokens.length === 3) break;
  }
  return {
    query,
    matches: response.pairs.length,
    shown: tokens.length,
    tokens,
    ...(!tokens.length ? { note: 'no token found for this query' } : {}),
  };
}
