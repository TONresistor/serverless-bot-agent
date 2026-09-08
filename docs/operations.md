# Operations

## Repository status

- `scripts/` and `deploy/` are local-only and excluded from Git.
- `package.json`, CI and some tests still reference excluded or deleted files.
- A fresh clone does not currently contain the complete build/setup workflow.

## Local deployment

With the retained local scripts:

1. Configure `.env.local`; existing environment variables take priority.
2. Build with `npm run build`.
3. Deploy with `npm run deploy -- --skip-build`.
4. Check the selected bot with `npm run status` and `npm run webhook`.

Deployment authenticates, publishes the schema, applies safe migrations, then publishes code.
Back up the previous modules first; keep the existing owner, wallet and credentials.

## Scheduled execution

- The optional external clock invokes due tasks on Telegram.
- It runs no inference or wallet signing.
- Its Linux service files remain local under `deploy/`.
- Normal conversations work without that clock.

## Diagnostics

- `turn_finished`: actual outcome and reason.
- `diagnostic`: error category, phase and sanitized code locations.
- Histories and operation archives are retained; no global purge is configured.

For wallet settlement and recovery, see [TON tools](ton-tools.md).
