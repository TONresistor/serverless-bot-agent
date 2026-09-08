# TON, market and media tools

| Family  | Capabilities                                                         |
| ------- | -------------------------------------------------------------------- |
| TON     | Wallet address, balance, transfers, history, account details and DNS |
| Jettons | Metadata, balance, price, portfolio and transfers                    |
| NFTs    | Item/collection information and transfers                            |
| Uranus  | Discovery, holdings, curve trading, token deployment and fee claims  |
| Swaps   | `ton_swap_quote` and `ton_swap`                                      |
| Market  | `token_market` via DexScreener                                       |
| Media   | `save_media` stores images up to 5 MiB                               |

Blockchain access uses TON Center HTTP APIs. No liteserver is required.
Amounts use decimal strings and BigInt.

## Wallet actions

- Require an enabled tool and owner confirmation in private chat.
- Recheck balances, permissions and the approved transaction before signing.
- Save the signed message before submission.
- Confirm settlement from transaction evidence, not a balance change alone.
- `/wallet` inspects and reconciles pending operations.

## Swaps

- `dex: "stonfi"` is the default; `dex: "dedust"` selects DeDust.
- STON.fi supports v2.1/v2.2; DeDust supports vault pools and verified CPMM v2 revisions.
- Routes are direct: TON/jetton or jetton/jetton. Multi-hop is not implemented.
- Use exact jetton master addresses and decimals. Slippage defaults to 100 bps.
- DeDust accepts an optional `pool_address`; automatic discovery includes Uranus graduation pools.

Graduated Uranus tokens use DeDust swaps. Curve trades default to `min_out=0` unless supplied.
Token deployment accepts a ready `metadata_uri`; automatic hosting requires Pinata.

Source: [tool registration](../src/composition/tools.js) and [financial workflow](../src/application/finance/operations.js).
