import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Address } from '@ton/core';
import { createMarketCapabilities } from '../src/adapters/market/provider.js';
import {
  cleanPrice,
  compareDecimal,
  decimal,
  ratioPercent,
  sumFixed,
} from '../src/domain/market/decimal.js';
import { searchAssets } from '../src/domain/market/stonfi.js';
import { coinsResult, holdingsResult, portfolioResult } from '../src/domain/market/dedust.js';
import { tokenMarketResult } from '../src/domain/market/dexscreener.js';

const raw = (n) => `0:${n.toString(16).padStart(64, '0')}`;
const friendly = (n) => Address.parse(raw(n)).toString({ bounceable: true });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const asset = (n, overrides = {}) => ({
  contract_address: friendly(n),
  kind: 'Jetton',
  meta: { symbol: 'USDT', display_name: 'Tether USD', decimals: 6 },
  tags: [],
  ...overrides,
});
const balance = (n, overrides = {}) => ({
  asset: `jetton:${raw(n)}`,
  balance_formatted: '1.000000000000000001',
  value_ton: '1.00005',
  metadata: { ticker: `T${n}`, name: `Token ${n}` },
  ...overrides,
});

test('market decimal arithmetic preserves balances beyond Number precision and rounds only presentation', () => {
  assert.equal(decimal('9007199254740993.000000001'), '9007199254740993.000000001');
  assert.equal(decimal('1.234e-9'), '0.000000001234');
  assert.equal(compareDecimal('9007199254740993.01', '9007199254740993.00'), 1);
  assert.equal(sumFixed(['9007199254740993.00005', '0.00005']), '9007199254740993.0001');
  assert.equal(cleanPrice('1.80000000000000004'), '1.8');
  assert.equal(cleanPrice('0.000000000123456789012345'), '0.000000000123456789');
  assert.equal(cleanPrice('9999999999.6'), '10000000000');
  assert.equal(ratioPercent('2', '3'), '66.7');
  assert.equal(ratioPercent('1', '0'), '0');
  for (const value of ['NaN', 'Infinity', '-1', '1e999', {}, 1])
    assert.throws(
      () => decimal(value),
      (e) => e.code === 'invalid_response',
    );
});

test('STON token search ranks canonical USD₮ above impersonators and removes native, deprecated and blacklisted assets', () => {
  const source = [
    asset(1),
    asset(2, {
      meta: { symbol: 'USD₮', display_name: 'Tether USD', decimals: 6 },
      tags: ['asset:default_symbol'],
      dex_price_usd: '1.0000000000000001',
    }),
    asset(3, { tags: ['asset:blacklisted'] }),
    asset(4, { tags: ['asset:deprecated'] }),
    asset(5, { kind: 'Ton' }),
    asset(6, { meta: { symbol: 'NOT', decimals: 9 } }),
  ];
  const result = searchAssets(source, 'usdt', 8);
  assert.equal(result.count, 2);
  assert.equal(result.results[0].address, friendly(2));
  assert.equal(result.results[0].verified, true);
  assert.equal(result.results[0].price_usd, '1.0000000000000001');
  assert.equal(searchAssets(source, 'usdt', 1).count, 1);
  assert.equal(
    searchAssets([asset(2), asset(2, { contract_address: raw(2) })], 'usdt', 8).count,
    1,
  );
});

test('captured STON response finds canonical USDT only with a real nonempty condition, across all liquidity tiers', async () => {
  const captured = JSON.parse(
    await readFile(new URL('./fixtures/market/ston-assets-usdt.json', import.meta.url), 'utf8'),
  );
  const market = createMarketCapabilities({
    network: 'mainnet',
    walletAddress: friendly(9),
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.ston.fi/v1/assets/query');
      const body = JSON.parse(options.body);
      return response(
        body.condition === 'asset:popular | !asset:popular' ? captured : { asset_list: [] },
      );
    },
  });
  const result = await market.searchTokens({ query: 'USDT', limit: 3 });
  assert.ok(result.count > 0);
  assert.equal(result.results[0].address, 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');
  assert.equal(result.results[0].verified, true);
  assert.equal(result.results[0].decimals, 6);
  assert.ok(captured.asset_list.some((asset) => asset.tags.includes('asset:liquidity:no')));
});

test('captured DeDust feed requires current sorting and server-side Uranus filtering before limiting', async () => {
  const latest = JSON.parse(
    await readFile(new URL('./fixtures/market/dedust-coins-latest.json', import.meta.url), 'utf8'),
  );
  const legacy = JSON.parse(
    await readFile(new URL('./fixtures/market/dedust-coins-legacy.json', import.meta.url), 'utf8'),
  );
  const requests = [];
  const market = createMarketCapabilities({
    network: 'mainnet',
    walletAddress: friendly(9),
    fetcher: async (input) => {
      const url = new URL(input);
      requests.push(url);
      const current =
        url.searchParams.get('filter_by_tags') === 'dedust_v3_memepad' &&
        url.searchParams.get('sort_direction') === 'desc' &&
        ['age', 'liquidity'].includes(url.searchParams.get('sort_by'));
      return response(current ? latest : legacy);
    },
  });
  const result = await market.uranusSearch({ limit: 1 });
  assert.equal(result.count, 1);
  assert.equal(result.results[0].created_at, latest.items[0].created_at);
  assert.equal(requests[0].searchParams.get('sort_by'), 'age');
  assert.equal(requests[0].searchParams.get('limit'), '1');
  await market.uranusSearch({ query: 'REGRAM', limit: 10 });
  assert.equal(requests[1].searchParams.get('sort_by'), 'liquidity');
  assert.equal(requests[1].searchParams.get('query'), 'REGRAM');
  assert.equal(coinsResult(legacy.items, '', 1).results.length, 0);
  assert.ok(
    latest.items.every(
      (coin, i) =>
        i === 0 || Date.parse(latest.items[i - 1].created_at) >= Date.parse(coin.created_at),
    ),
  );
});

test('captured DeDust USD change is already a percent, matching its first-party coin table', async () => {
  const captured = JSON.parse(
    await readFile(new URL('./fixtures/market/dedust-coins-latest.json', import.meta.url), 'utf8'),
  );
  assert.equal(captured.items[0].price.usd_change.h24, -2.91104450182052);
  const result = coinsResult(captured.items, '', 3);
  assert.equal(result.results[0].change_24h_pct, '-2.9');
  assert.equal(result.results[1].change_24h_pct, '-22.9');
  assert.equal(result.results[2].change_24h_pct, '-15.3');
});

test('public provider binds endpoints and wallet address, uses bounded query API and preserves public tool shapes', async () => {
  const calls = [];
  const market = createMarketCapabilities({
    network: 'mainnet',
    walletAddress: friendly(9),
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/assets/query')) return response({ asset_list: [asset(1)] });
      if (url.includes('/assets/'))
        return response({
          asset: {
            ...asset(1),
            symbol: 'USD₮',
            display_name: 'Tether',
            decimals: 6,
            dex_price_usd: '0.99999999999999',
            meta: undefined,
          },
        });
      return response({ jetton_balances: [] });
    },
  });
  assert.equal((await market.searchTokens({ query: 'usdt', limit: 8 })).count, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://api.ston.fi/v1/assets/query');
  assert.equal(body.condition, 'asset:popular | !asset:popular');
  assert.deepEqual(body.search_terms, ['usdt']);
  assert.equal(body.limit, 800);
  assert.deepEqual(JSON.parse(calls[1].options.body).search_terms, ['USD₮']);
  assert.deepEqual(await market.jettonPrice({ address: friendly(1) }), {
    address: friendly(1),
    symbol: 'USD₮',
    name: 'Tether',
    decimals: 6,
    price_usd: '1',
    source: 'ston.fi',
  });
  assert.deepEqual(await market.tonPrice(), { symbol: 'TON', price_usd: '1', source: 'ston.fi' });
  await market.portfolio();
  await market.uranusHoldings();
  assert.equal(calls[4].url, `https://mainnet.api.dedust.io/v4/api/portfolio/${friendly(9)}`);
  assert.equal(
    calls[5].url,
    `https://mainnet.api.dedust.io/v4/api/portfolio/${friendly(9)}?memecoin_extra_details=true`,
  );
  assert.ok(calls.every(({ options }) => !options.headers.Authorization));
});

test('DeDust portfolio is sorted and capped after filtering, with exact balances, unpriced positions and total', () => {
  const result = portfolioResult([
    balance(1),
    balance(2, { value_ton: '9007199254740993.00005' }),
    balance(3, { value_ton: '' }),
    balance(4, { balance_formatted: '0' }),
    { asset: 'native', balance_formatted: '100000' },
  ]);
  assert.equal(result.count, 3);
  assert.equal(result.jettons[0].address, friendly(2));
  assert.equal(result.jettons[2].address, friendly(3));
  assert.equal(result.jettons[0].balance, '1.000000000000000001');
  assert.equal(result.total_value_ton, '9007199254740994.0001');
  const capped = portfolioResult(
    Array.from({ length: 60 }, (_, i) => balance(i + 1, { value_ton: String(i + 1) })),
  );
  assert.equal(capped.count, 50);
  assert.equal(capped.jettons[0].address, friendly(60));
});

test('Uranus search excludes other launchpads, ranks queried candidates and preserves latest ordering', () => {
  const coin = (n, liquidity, tags = ['dedust_v3_memepad']) => ({
    asset: `jetton:${raw(n)}`,
    tags,
    metadata: { ticker: 'DUCK', name: 'Duck', usd_price: '0.000000000001' },
    holders: n,
    market_cap: '123.456',
    liquidity,
    created_at: '2026-09-07T00:00:00Z',
    price: { usd_change: { h24: 5.2 } },
  });
  const source = [
    coin(1, '1'),
    coin(2, '9007199254740993'),
    coin(3, '9007199254740994'),
    coin(4, '999999999999999999', ['other_memepad']),
  ];
  const queried = coinsResult(source, 'DUCK', 10);
  assert.equal(queried.count, 3);
  assert.equal(queried.results[0].address, friendly(3));
  assert.equal(queried.results[0].change_24h_pct, '5.2');
  assert.equal(coinsResult(source, '', 1).results[0].address, friendly(1));
  assert.deepEqual(coinsResult([], 'DUCK', 10), {
    query: 'DUCK',
    results: [],
    note: 'No Uranus memecoin matched.',
  });
});

test('Uranus holdings compare actual owner addresses and derive creator and graduation fields', () => {
  const extra = {
    contract_type: 'dedust_v3_memepad',
    author: `jetton:${raw(9)}`,
    curve_ton_collected: '2',
    curve_ton_max: '3',
  };
  const result = holdingsResult(
    [
      balance(1),
      balance(2, { memecoin_extra_details: extra }),
      balance(3, { memecoin_extra_details: { ...extra, author: raw(8) } }),
    ],
    friendly(9),
  );
  assert.equal(result.count, 2);
  assert.equal(result.holdings[0].created_by_you, true);
  assert.equal(result.holdings[1].created_by_you, false);
  assert.equal(result.holdings[0].graduation_pct, '66.7');
});

test('DexScreener projection matches reference captured response: top3, deduplication, chain filtering and exact address precedence', async () => {
  const source = JSON.parse(
    await readFile(new URL('./fixtures/market/search_not.json', import.meta.url), 'utf8'),
  );
  const now = 1781536000000;
  const result = tokenMarketResult(source, 'NOT', '', now);
  assert.ok(result.shown > 0 && result.shown <= 3);
  assert.equal(result.matches, source.pairs.length);
  assert.ok(
    result.tokens.every(
      (token, i) => i === 0 || result.tokens[i - 1].liquidity_usd >= token.liquidity_usd,
    ),
  );
  assert.equal(new Set(result.tokens.map((t) => `${t.chain}|${t.address}`)).size, result.shown);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1500);
  assert.ok(tokenMarketResult(source, 'NOT', 'ton', now).tokens.every((t) => t.chain === 'ton'));
  const exact = 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT';
  const matched = tokenMarketResult(source, exact, 'ethereum', now);
  assert.equal(matched.shown, 1);
  assert.equal(matched.tokens[0].address, exact);
  const empty = JSON.parse(
    await readFile(new URL('./fixtures/market/search_empty.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(tokenMarketResult(empty, 'missing'), {
    query: 'missing',
    matches: 0,
    shown: 0,
    tokens: [],
    note: 'no token found for this query',
  });
});

test('DexScreener flags preserve known-vs-missing age and do not conflate case-sensitive addresses', () => {
  const pair = {
    chainId: 'ton',
    dexId: 'dedust',
    priceUsd: '0.00001234',
    baseToken: { address: 'EQrug', name: 'Rug', symbol: 'RUG' },
    liquidity: { usd: 420 },
    volume: { h24: 12 },
    priceChange: { h24: -55.2, h1: Infinity },
    txns: { h24: { buys: 1, sells: 40 } },
    marketCap: 900,
    pairCreatedAt: 1781400000000,
  };
  const projected = tokenMarketResult({ pairs: [pair] }, 'RUG', '', 1781536000000).tokens[0];
  assert.deepEqual(projected.flags, ['low_liquidity', 'new_token', 'low_24h_volume']);
  assert.equal(projected.change_24h, -55.2);
  assert.equal(Object.hasOwn(projected, 'change_1h'), false);
  const changedCase = { ...pair, baseToken: { ...pair.baseToken, address: 'EQRUG' } };
  assert.equal(tokenMarketResult({ pairs: [pair, changedCase] }, 'RUG').shown, 2);
  assert.equal(
    tokenMarketResult(
      { pairs: [{ ...pair, pairCreatedAt: undefined }] },
      'RUG',
    ).tokens[0].flags.includes('new_token'),
    false,
  );
});

test('malformed, oversized, wrong-network and unlisted reads fail clearly without pretending zero balances', async () => {
  const config = { network: 'mainnet', walletAddress: friendly(9) };
  for (const data of [
    {},
    { jetton_balances: 'wrong' },
    { jetton_balances: [balance(1, { balance_formatted: 'unknown' })] },
  ]) {
    await assert.rejects(
      createMarketCapabilities({ ...config, fetcher: async () => response(data) }).portfolio(),
      (e) => e.code === 'invalid_response',
    );
  }
  await assert.rejects(
    createMarketCapabilities({ ...config, fetcher: async () => response({}) }).jettonPrice({
      address: friendly(1),
    }),
    (e) => e.code === 'token_unlisted',
  );
  await assert.rejects(
    createMarketCapabilities({
      ...config,
      fetcher: async () => response({ private: 'provider key' }, 429),
    }).portfolio(),
    (e) => e.code === 'rate_limited' && !e.message.includes('provider key'),
  );
  await assert.rejects(
    createMarketCapabilities({
      ...config,
      fetcher: async () => response({ pairs: [], huge: 'x'.repeat(2 * 1024 * 1024) }),
    }).tokenMarket({ query: 'NOT' }),
    (e) => e.code === 'response_too_large',
  );
  await assert.rejects(
    createMarketCapabilities({
      ...config,
      network: 'testnet',
      fetcher: async () => {
        throw new Error('Must not fetch mainnet data');
      },
    }).portfolio(),
    (e) => e.code === 'market_network',
  );
});
