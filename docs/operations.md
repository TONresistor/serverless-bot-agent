# Deployment

Set up [configuration](configuration.md), then run:

```sh
npm run deploy
npm run status
```

## First deployment

- Authenticate and prepare or reuse a private wallet backup.
- Build `lib/runtime.js` from `src/` and synchronize the CLI snapshot.
- Publish the schema, apply safe migrations and publish the code.
- Initialize the agent's settings and workspace.

## Updates

- `npm run deploy` updates code and schema; existing settings are preserved.
- `npm run configure` applies configuration changes separately.
- Configuration requires the matching `.local/wallet-mainnet.json` backup.
- The CLI refuses to replace an existing owner, network or wallet.
- If initialization is interrupted after creating the agent, rerun `npm run configure`.

## Development

```sh
npm run check
npm test
npm run build
```

## Scheduled tasks

Automatic heartbeat and scheduled tasks need an external clock calling the existing task management exports.
That clock is not installed by this deployment command. Normal conversations do not require it.
