# Configuration

## Agent settings: `agent.config.json`

| Field            | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `ownerId`        | Your numeric Telegram user ID; replace `0`                           |
| `model`          | An OpenRouter model supporting tool calls                            |
| `network`        | `mainnet`                                                            |
| `loop.defaults`  | Loop limits; listed fields override runtime defaults                 |
| `loop.overrides` | Limits per `dm`, `group`, `guest`, `business`, `task` or `heartbeat` |
| `access`         | Callers, groups and individual tool grants                           |

- Set `access.group.mode` to `"all"` to allow group mentions and replies.
- Keep it `"off"` to restrict group access to the owner.
- Enable a tool with an entry such as `"ton_swap_quote": {"enabled": true}` in `access.tools`.
- Edit personality with `/soul` and other workspace files with `/workspace`.

## Keys: `.env`

Copy [.env.example](../.env.example) to `.env` at the project root.
The real `.env` is intentionally excluded from Git.

| Variable             | Required for                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `TGCLOUD_TOKEN`      | Serverless CLI access, obtained from BotFather; not a Bot API token |
| `OPENROUTER_API_KEY` | Initial setup and `npm run configure`                               |
| `TONCENTER_API_KEY`  | Optional authenticated blockchain reads                             |
| `TAVILY_API_KEY`     | Optional web search and page reading                                |
| `PINATA_JWT`         | Optional token metadata hosting                                     |

Existing environment variables take priority over `.env.local`, then `.env`.
Never put keys in `agent.config.json`.

## Apply changes

Run `npm run configure` after editing settings or keys.
It checks the existing owner and wallet, applies listed loop fields and replaces the supplied access policy.
Omitted optional keys are preserved; current personality files remain unchanged.

Settings are stored in Telegram SQLite. Editing local files alone does not update the running bot.
