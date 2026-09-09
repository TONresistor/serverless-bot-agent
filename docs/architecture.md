# Architecture

One JavaScript application, assembled through explicit dependency injection.

| Location           | Responsibility                                         |
| ------------------ | ------------------------------------------------------ |
| `src/runtime.js`   | Connect the application to the Telegram SDK            |
| `src/composition/` | Bind providers, storage and tool capabilities          |
| `src/agent/`       | Run the model/tool loop                                |
| `src/application/` | Coordinate conversations, delivery and actions         |
| `src/tools/`       | Define tool inputs, permissions metadata and behavior  |
| `src/adapters/`    | Access external services and SQLite                    |
| `src/domain/`      | Encode and validate domain data and transaction proofs |
| `src/contracts/`   | Describe interfaces used by JSDoc                      |
| `src/shared/`      | Shared errors, policies and utilities                  |

## Add a tool

1. Create one module in `src/tools/<family>/` with its schema, `Args` type and implementation.
2. Define its narrow capability in `src/contracts/`.
3. Register it in composition and declare its access grants.
4. Test its inputs and effects; update the schema fixture if the public contract changes.

Tools receive specific capabilities, never the database, credentials or wallet signer.
The loop stays independent of individual tools and providers.

## References

- [Loop](agent-loop.md) — execution, budgets and recovery.
- [Features](features.md) — owner controls and permissions.
- [Telegram](telegram-tools.md), [TON](ton-tools.md), [web](web-tools.md) — tool behavior.
- [Serverless](tgcloud-sdk.md) — runtime constraints.
- [Configuration](configuration.md) — settings and keys.
- [Deployment](operations.md) — installation and updates.
