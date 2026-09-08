# Telegram tools

| Tool                       | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `telegram_send_message`    | Send rich text and buttons                         |
| `telegram_admin`           | Manage members, messages, chat details and invites |
| `telegram_chat_automation` | Act through the owner's Business connection        |
| `telegram_gifts`           | Bot-owned gift and Stars operations                |
| `request_star_payment`     | Issue Stars invoices and track payment             |

Method names and parameters come from the [curated catalog](../src/shared/telegram-methods.js).

## Conversations

- Groups respond to mentions, replies to the bot and supported commands.
- History and notes are isolated by conversation and group topic.
- Guest Mode answers an incoming guest query; it cannot initiate messages there.
- Business secretary requires an active connection and reply rights.
- [Access settings](features.md) determine who can use each capability.

## Messages and interactions

- Rich Markdown supports tables, spoilers and expandable quotes.
- Buttons support URLs, copying text and callbacks.
- Callbacks retain the initiating actor and conversation permissions.
- Long replies split into parts with separate delivery receipts.
- Progress drafts appear in private chat; native Stop is not enabled.

An invoice is paid only after a matching `successful_payment` update.
Sending the invoice alone does not confirm payment.
