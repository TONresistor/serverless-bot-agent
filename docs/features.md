# Owner controls

These commands are available in the owner's private chat.

| Command                             | Purpose                                       |
| ----------------------------------- | --------------------------------------------- |
| `/access`                           | Read permissions; `/access JSON` updates them |
| `/workspace list`                   | List files                                    |
| `/workspace read PATH`              | Read a text file                              |
| `/workspace write JSON`             | Write `{path, content, expectedRevision}`     |
| `/soul` or `/soul TEXT`             | Read or replace the personality               |
| `/secretary on` or `/secretary off` | Enable or pause Business replies              |
| `/heartbeat` or `/heartbeat run`    | Inspect or manually run the heartbeat         |

## Permissions and files

- Access policy controls callers, groups and individual tools.
- Updates require `{expectedRevision, value}`; existing overrides are preserved.
- Workspace reads are shared by default, subject to conversation access. Keep credentials in the secret store.
- `SOUL.md` sets personality; `HEARTBEAT.md` defines checks; `SECRETARY.md` guides Business replies.

## Scheduled tasks

- `/tasks list`, `show ID`, `history ID`: inspect tasks and runs.
- `/tasks save JSON`: create or update `{id, expectedRevision, definition}`; revision `0` creates.
- Definitions need `prompt` and `runAt` in UTC milliseconds. Recurring tasks also need `everySeconds`.
- `/tasks pause ID`, `resume ID`, `run ID`, `stop ID`: control execution.
- Modes: `deliver_dm`, `post_direct`, or `draft_approve`.
- `/tasks drafts`, `approve DRAFT_ID`, `reject DRAFT_ID`: review drafts.
- Evolving tasks retain state in `automations/ID.md`.

Heartbeat is disabled by default. Enable it with `/heartbeat {"enabled":true,"everySeconds":3600}`.
Automatic runs require the external clock described in [operations](operations.md).

Source: [commands](../src/application/feature-commands.js) and [task definitions](../src/domain/tasks.js).
