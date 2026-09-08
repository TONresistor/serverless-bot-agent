import { createStarPayments } from './payments.js';
import { createTelegramMessages } from './messages.js';

export function createTelegramEvents({
  configuration,
  connections,
  operations,
  telegram,
  deliver,
  app,
  now,
}) {
  const payments = (config) =>
    createStarPayments({ operations, telegram, ownerId: config.ownerId, now });
  return {
    async onBusinessConnection(connection) {
      const config = await configuration.getConfig();
      if (!config || String(connection.user?.id) !== String(config.ownerId))
        return { ignored: true };
      // The connection's live rights and owner are rechecked before every tool call.
      await connections.set({ id: connection.id, enabled: connection.is_enabled });
      return { connected: Boolean(connection.is_enabled) };
    },
    async onPreCheckout(query) {
      const config = await configuration.getConfig();
      if (!config) return { ignored: true };
      return payments(config).preCheckout(query);
    },
    async onPayment(message) {
      const config = await configuration.getConfig();
      if (!config) return { ignored: true };
      return payments(config).successful(message);
    },
    async onButton(incoming) {
      const config = await configuration.getConfig();
      if (!config || !Number.isSafeInteger(incoming.updateId) || incoming.updateId < 0)
        return { ignored: true };
      if (await operations.operation(`update:${incoming.updateId}`)) return { duplicate: true };
      const messages = createTelegramMessages({
        operations,
        deliver,
        ownerId: config.ownerId,
        now,
      });
      const data = await messages.consume(incoming);
      try {
        await telegram.answerCallbackQuery({
          callback_query_id: incoming.callbackId,
          ...(!data ? { text: 'This button is unavailable, expired or already used.' } : {}),
        });
      } catch {
        /* Acknowledgement is cosmetic. */
      }
      if (!data) return { ignored: true };
      const result = await app.onMessage({
        updateId: incoming.updateId,
        actor: { id: incoming.actor.id, isBot: false },
        chat: {
          id: data.sourceChatId || config.ownerId,
          type: data.sourceGroup ? 'supergroup' : 'private',
        },
        mentioned: true,
        surface: data.surface,
        businessConnectionId: data.businessConnectionId,
        editRef: data.inlineMessageId
          ? { inline_message_id: data.inlineMessageId }
          : { chat_id: Number(data.chatId), message_id: incoming.messageId },
        threadId: data.sourceThreadId || undefined,
        messageId: data.sourceGroup ? incoming.messageId : 0,
        text: data.execute
          ? 'A stored tool action was selected.'
          : `A Telegram button was selected.\nMessage excerpt: ${[...data.text].slice(0, 2000).join('')}\nSelection: ${data.value}`,
        ...(data.execute ? { directTool: data.execute } : {}),
      });
      if (result.busy || result.rate_limited)
        await operations.transition(incoming.data, ['consumed'], 'pending', data);
      return result;
    },
  };
}
