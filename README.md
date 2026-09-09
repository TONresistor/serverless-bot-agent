# serverless-bot-agent

A JavaScript AI agent on [Telegram Serverless](https://core.telegram.org/bots/serverless), powered by OpenRouter.

- Telegram chats, groups and Business tools.
- Persistent memory, workspace and Tavily web search.
- TON mainnet wallet, jettons, NFTs, STON.fi, DeDust and Uranus tools.

Wallet transactions require owner confirmation.

## Configure and deploy

Requires Node.js 22 and Telegram Serverless beta access.

```sh
npm ci
cp .env.example .env
```

1. Fill `TGCLOUD_TOKEN` and `OPENROUTER_API_KEY` in `.env`.
2. Set your Telegram `ownerId` in [agent.config.json](agent.config.json).
3. Run `npm run deploy`.

The first deployment builds the bot, applies the schema and initializes its wallet and settings.
Keep `.env` and `.local/wallet-mainnet.json` private; back up the wallet file.

- `npm run deploy` updates code on an existing bot without resetting its settings.
- `npm run configure` applies edits to the config and keys.
- `npm run status` checks the configured bot and webhook.

See [configuration](docs/configuration.md) for model, tools and group access.

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
