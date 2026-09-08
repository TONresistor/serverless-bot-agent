import { Address } from '@ton/core';
import { requestJSON } from '../http.js';
import { parseDestination } from '../../domain/wallet.js';
import { AgentError } from '../../shared/errors.js';
import { assetView, normalizeToken, searchAssets, TON_ASSET } from '../../domain/market/stonfi.js';
import { coinsResult, holdingsResult, portfolioResult } from '../../domain/market/dedust.js';
import { tokenMarketResult } from '../../domain/market/dexscreener.js';
import { cleanPrice } from '../../domain/market/decimal.js';
import { decimal } from '../../domain/market/decimal.js';

const STON = 'https://api.ston.fi/v1';
const DEDUST = 'https://mainnet.api.dedust.io/v4/api';
const jsonOptions = { headers: { Accept: 'application/json' } };
const array = (value, key, provider) => {
  if (!Array.isArray(value?.[key]))
    throw new AgentError('invalid_response', `${provider} returned an incomplete response.`);
  return value[key];
};

/** Read-only public HTTP capabilities. Addresses, endpoint selection and wallet scope are bound here. */
export function createMarketCapabilities({
  fetcher,
  walletAddress,
  network,
  now = () => Date.now(),
}) {
  const mainnet = () => {
    if (network !== 'mainnet')
      throw new AgentError('market_network', 'Market tools are available on TON mainnet only.');
  };
  const address = (input) => parseDestination(input, network).raw;
  async function asset(input) {
    mainnet();
    const result = await requestJSON(
      fetcher,
      `${STON}/assets/${encodeURIComponent(address(input))}`,
      jsonOptions,
      65536,
    );
    if (!result?.asset)
      throw new AgentError('token_unlisted', 'The token is not listed on STON.fi.');
    return assetView(result.asset);
  }
  async function balances(uranus = false) {
    mainnet();
    const wallet = Address.parse(address(walletAddress)).toString({
      bounceable: true,
      testOnly: false,
    });
    const result = await requestJSON(
      fetcher,
      `${DEDUST}/portfolio/${wallet}${uranus ? '?memecoin_extra_details=true' : ''}`,
      jsonOptions,
      4 * 1024 * 1024,
    );
    return array(result, 'jetton_balances', 'DeDust');
  }
  return Object.freeze({
    async searchTokens({ query, limit = 8 }) {
      mainnet();
      const terms = [query.trim()];
      if (normalizeToken(query) === 'usdt' && !query.includes('₮')) terms.push('USD₮');
      // An omitted condition returns no assets. This tautology searches every liquidity tier.
      // Fetch the Tether spelling separately and merge candidates before canonical scoring.
      const responses = await Promise.all(
        terms.map((term) =>
          requestJSON(
            fetcher,
            `${STON}/assets/query`,
            {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                condition: 'asset:popular | !asset:popular',
                search_terms: [term],
                limit: 800,
              }),
            },
            2 * 1024 * 1024,
          ),
        ),
      );
      return searchAssets(
        responses.flatMap((response) => array(response, 'asset_list', 'STON.fi')),
        query,
        limit,
      );
    },
    async tonPrice() {
      const data = await asset(TON_ASSET);
      return { symbol: 'TON', price_usd: cleanPrice(data.price_usd), source: 'ston.fi' };
    },
    async jettonPrice({ address: input }) {
      const data = await asset(input);
      return {
        address: input,
        symbol: data.symbol,
        name: data.name,
        decimals: data.decimals,
        price_usd: cleanPrice(data.price_usd),
        source: 'ston.fi',
      };
    },
    async portfolio() {
      return portfolioResult(await balances());
    },
    async uranusSearch({ query = '', limit = 10 }) {
      mainnet();
      const suffix = `filter_by_tags=dedust_v3_memepad&sort_by=${query.trim() ? 'liquidity' : 'age'}&sort_direction=desc&limit=${limit}${query.trim() ? `&query=${encodeURIComponent(query.trim())}` : ''}`;
      const response = await requestJSON(
        fetcher,
        `${DEDUST}/coins?${suffix}`,
        jsonOptions,
        4 * 1024 * 1024,
      );
      return coinsResult(array(response, 'items', 'DeDust'), query, limit);
    },
    async uranusCoin(input) {
      mainnet();
      const raw = address(input);
      const response = await requestJSON(
        fetcher,
        `${DEDUST}/coins?query=${encodeURIComponent(`jetton:${raw}`)}`,
        jsonOptions,
        4 * 1024 * 1024,
      );
      const items = array(response, 'items', 'DeDust').filter((item) => {
        try {
          return address(String(item?.asset || '').replace(/^jetton:/, '')) === raw;
        } catch {
          return false;
        }
      });
      const projected = coinsResult(items, '', 1).results[0];
      if (!projected) return null;
      return { ...projected, price_ton: decimal(items[0].price?.ton_value, { empty: true }) };
    },
    async uranusHoldings() {
      return holdingsResult(await balances(true), walletAddress);
    },
    async tokenMarket({ query, chain = '' }) {
      const response = await requestJSON(
        fetcher,
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query.trim())}`,
        jsonOptions,
        2 * 1024 * 1024,
      );
      return tokenMarketResult(response, query.trim(), chain.trim().toLowerCase(), now());
    },
  });
}
