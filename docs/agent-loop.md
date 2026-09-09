# Agent loop

## Execution

1. Load the conversation, saved summary and authorized tools.
2. Ask the model for an answer or tool calls.
3. Validate calls and save a checkpoint before executing them.
4. Record results and continue until completion, cancellation or a budget limit.
5. Deliver the final response.

Telegram and memory tools are exposed directly.
Other capabilities use `tool_search` → `tool_call`; search includes complete input schemas.

## Default budgets

| Limit              | Default                        |
| ------------------ | ------------------------------ |
| Model / tool calls | 12 / 32                        |
| Turn duration      | 120 seconds; 300 for heartbeat |
| Context / output   | 32,768 / 2,048 tokens          |
| Parallel reads     | 1                              |

Edit `loop` in `agent.config.json` and run `npm run configure`.
Changes apply to the next turn.
Model profiles may lower the token limits.

## Recovery and stopping

- Older exchanges are summarized; checkpoints retain execution history.
- Recovery uses recorded results without repeating tool effects.
- An uncertain external write is never automatically retried.
- `/stop` halts subsequent work and message parts, including during final delivery.
- Each final message part checks the conversation lease and cancellation state.
- An in-flight provider request cannot be cancelled by the application.

Source: [loop](../src/agent/loop.js) and [settings](../src/agent/settings.js).
