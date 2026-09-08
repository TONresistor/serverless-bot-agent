import { Address } from '@ton/core';
import { AgentError } from '../../shared/errors.js';
import { decimal } from './decimal.js';

export const TON_ASSET = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
export const normalizeToken = (value) => value.trim().toLowerCase().replaceAll('₮', 't');

export function assetView(asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.contract_address !== 'string')
    throw new AgentError('invalid_response', 'STON.fi returned an invalid asset.');
  try {
    Address.parse(asset.contract_address);
  } catch {
    throw new AgentError('invalid_response', 'STON.fi returned an invalid asset address.');
  }
  const tags = Array.isArray(asset.tags) ? asset.tags : [];
  const meta = asset.meta || asset;
  const symbol = typeof meta.symbol === 'string' ? meta.symbol : '';
  const decimals = meta.decimals ?? 9;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new AgentError('invalid_response', 'STON.fi returned invalid token decimals.');
  return {
    address: asset.contract_address,
    kind: asset.kind,
    symbol,
    name: typeof meta.display_name === 'string' && meta.display_name ? meta.display_name : symbol,
    decimals,
    price_usd: decimal(asset.dex_price_usd || asset.third_party_price_usd || '', { empty: true }),
    verified: asset.default_symbol === true || tags.includes('asset:default_symbol'),
    excluded:
      asset.blacklisted === true ||
      asset.deprecated === true ||
      tags.includes('asset:blacklisted') ||
      tags.includes('asset:deprecated') ||
      asset.kind === 'Ton',
    community: asset.community !== false,
    tags,
  };
}

export function scoreAsset(asset, query) {
  if (asset.excluded) return 0;
  const symbol = normalizeToken(asset.symbol),
    name = normalizeToken(asset.name);
  let score =
    symbol === query
      ? 100
      : symbol.startsWith(query)
        ? 80
        : symbol.includes(query)
          ? 60
          : name === query
            ? 50
            : name.startsWith(query)
              ? 40
              : name.includes(query)
                ? 30
                : 0;
  if (!score) return 0;
  if (asset.verified) score += 1000;
  if (asset.tags.includes('asset:essential')) score += 10;
  if (asset.tags.includes('asset:popular')) score += 5;
  if (!asset.community) score += 3;
  return score;
}

export function searchAssets(assets, query, limit) {
  const q = normalizeToken(query);
  const seen = new Set();
  const hits = assets
    .map(assetView)
    .filter((asset) => {
      const raw = Address.parse(asset.address).toRawString();
      if (seen.has(raw)) return false;
      seen.add(raw);
      return true;
    })
    .map((asset) => ({ asset, score: scoreAsset(asset, q) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    query,
    count: hits.length,
    results: hits.map(({ asset }) => ({
      symbol: asset.symbol,
      name: asset.name,
      address: asset.address,
      decimals: asset.decimals,
      ...(asset.price_usd ? { price_usd: asset.price_usd } : {}),
      verified: asset.verified,
    })),
    note: "Pass a result's address and decimals to the swap tools. Confirm the token before trading.",
  };
}
