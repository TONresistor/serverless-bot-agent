import { requestJSON } from '../http.js';
import { formatUnits } from '../../domain/chain/values.js';

const BASE = 'https://api.ston.fi/v1';
export function createStonSwapAPI(fetcher) {
  const read = (path) =>
    requestJSON(fetcher, BASE + path, { headers: { Accept: 'application/json' } }, 131072);
  return Object.freeze({
    async asset(address) {
      return (await read(`/assets/${encodeURIComponent(address)}`)).asset;
    },
    async simulate(parsed, pool = undefined) {
      const query = {
        offer_address: parsed.source.apiAddress,
        ask_address: parsed.output.apiAddress,
        units: parsed.inputUnits,
        slippage_tolerance: formatUnits(String(parsed.slippageBps), 4),
        dex_v2: 'true',
        dex_version: '2',
        ...(pool ? { pool_address: pool } : {}),
      };
      const search = Object.entries(query)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
      return requestJSON(
        fetcher,
        `${BASE}/swap/simulate?${search}`,
        { method: 'POST', headers: { Accept: 'application/json' } },
        131072,
      );
    },
  });
}
