/** Bounded diagnostics: latest group update and latest addressed update, never message content. */
export function createReceptionTrace({ operations }) {
  return async function trace(incoming, stage, details = {}) {
    if (!['group', 'supergroup'].includes(incoming.chat?.type)) return;
    const data = {
      update_id: incoming.updateId,
      message_id: incoming.messageId,
      chat_id: incoming.chat.id,
      chat_id_type: typeof incoming.chat.id,
      actor_id: incoming.actor?.id,
      actor_id_type: typeof incoming.actor?.id,
      actor_is_bot: incoming.actor?.isBot,
      sender_chat: incoming.senderChat || null,
      mentioned: incoming.mentioned,
      replied_to_bot: incoming.repliedToBot,
      foreign_command: incoming.foreignCommand,
      ...details,
    };
    for (const key of [
      `reception:${incoming.chat.id}`,
      ...(incoming.mentioned || incoming.repliedToBot
        ? [`reception-addressed:${incoming.chat.id}`]
        : []),
    ]) {
      try {
        if (!(await operations.claim(key, 'reception', stage, data)))
          await operations.transition(
            key,
            ['received', 'normalized', 'handled', 'failed'],
            stage,
            data,
          );
      } catch {
        /* Diagnostic storage must never break delivery. */
      }
    }
  };
}
