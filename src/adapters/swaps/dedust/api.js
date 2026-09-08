import { requestJSON } from '../../http.js';
import { rejectDedust } from '../../../domain/swaps/dedust/contracts.js';
import { rawAddress } from './common.js';

export function createDedustAPI(fetcher) {
  return Object.freeze({
    async verifyAsset(asset) {
      if (asset.address === 'TON') return;
      const response = await requestJSON(
        fetcher,
        `https://mainnet.api.dedust.io/v4/api/coins?query=${encodeURIComponent('jetton:' + asset.address)}&limit=10`,
        { headers: { Accept: 'application/json' } },
        262144,
      );
      if (!Array.isArray(response?.items)) rejectDedust('DeDust did not return token metadata.');
      const coin = response.items.find((item) => {
        try {
          return (
            typeof item.asset === 'string' &&
            item.asset.startsWith('jetton:') &&
            rawAddress(item.asset.slice(7)) === asset.address
          );
        } catch {
          return false;
        }
      });
      if (!coin || coin.metadata?.decimals !== asset.decimals)
        rejectDedust(
          'The token decimals do not match DeDust metadata. Resolve the exact token and decimals again.',
        );
      if (coin.buy_tax !== 0 || coin.sell_tax !== 0)
        rejectDedust('Tokens with transfer taxes or unknown tax metadata are not supported.');
    },
  });
}
