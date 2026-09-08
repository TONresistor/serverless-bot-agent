# Serverless runtime

Use the [official reference](https://core.telegram.org/bots/serverless) for the full SDK.
When using an assistant, consult Telegram documentation through MCP Context7.

## Modules

- Application SDK access enters through `src/runtime.js`.
- `schema.js` declares SQLite tables and indexes with `sdk/db`.
- Deployed project imports use bare names, such as `lib/runtime`.
- npm dependencies are bundled locally before deployment.

## Database

- Await every database operation.
- Use `db.get` for one row, `db.all` for rows and `db.run` for writes.
- Bind SQL values through parameters.
- Code publication and database migration are separate operations.

## Application constraints

- Runtime code uses injected SDK transports, not Node filesystem/process APIs.
- Native probes found no timers, global `crypto` or `AbortController`.

Project-facing declarations: [types/sdk.d.ts](../types/sdk.d.ts).
