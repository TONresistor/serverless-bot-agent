# Web tools

| Tool         | Input                                 | Result                                     |
| ------------ | ------------------------------------- | ------------------------------------------ |
| `web_search` | `query`, optional `count` and `topic` | Titles, URLs, snippets and optional answer |
| `web_fetch`  | One public HTTP/HTTPS `url`           | Extracted text and source URL              |

Search returns 5 results by default, up to 10.
Topics are `general`, `news` and `finance`.

## Providers

- Tavily uses Search and Extract.
- A compatible HTTPS proxy can provide `/search` and `/fetch`.
- `configureWeb` selects the provider; `getWebSettings` reports its status.
- These are authenticated management exports, not model tools.
- Web tools are unavailable until a provider is configured.

## Boundaries

- Credentials and provider endpoints remain outside model arguments.
- Results fit the loop budget while preserving source URLs.
- Local/private URL literals and embedded credentials are rejected.
- The extraction provider must also protect DNS resolution and redirects.
- Retrieved content is data, never authorization to act.

Source: [provider adapter](../src/adapters/web/provider.js) and [configuration](../src/application/web.js).
