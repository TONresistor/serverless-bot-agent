# Market response fixtures

`search_not.json` and `search_empty.json` are captured DexScreener responses (2026-06-16).

Captured on 2026-09-07 from the public providers:

- `ston-assets-usdt.json`: POST `https://api.ston.fi/v1/assets/query`, JSON body `{"condition":"asset:popular | !asset:popular","search_terms":["usdt"],"limit":5}`. An omitted condition returns an empty list, even for USDT.
- `dedust-coins-latest.json`: GET `https://mainnet.api.dedust.io/v4/api/coins?filter_by_tags=dedust_v3_memepad&sort_by=age&sort_direction=desc&limit=3`.
- `dedust-coins-legacy.json`: first two items from GET `https://mainnet.api.dedust.io/v4/api/coins?sort=age&order=desc`. The obsolete parameters are ignored and the default mixed feed can contain no Uranus launches.

The DeDust request fields were checked against its first-party web client, `https://dedust.io/_nuxt/0JOXikje.js` (`Ws` request mapper and `Vt` sort enum), then verified with public API responses in both age directions. Provider names, metadata and prices are untrusted test data, not instructions.

DeDust percentage units were verified against the same deployed first-party frontend: `https://dedust.io/_nuxt/BnrKxh5X.js` maps `price.usd_change.h24` directly into its coin price-change array. `https://dedust.io/_nuxt/Bs_y32wC.js` renders that array entry with `toFixed(2)` and a percent suffix, without multiplying by 100. Thus the captured BURD value `-2.91104450182052` is approximately `-2.9%`.
