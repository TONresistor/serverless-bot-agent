import { digest } from '../../shared/hash.js';
import { AgentError } from '../../shared/errors.js';

export function createTelegramMessages({
  operations,
  deliver,
  ownerId,
  now,
  scope = undefined,
  validateAction = undefined,
}) {
  function validateOptions(options) {
    const current = scope || {
      owner: true,
      group: false,
      actorId: ownerId,
      destination: ownerId,
      threadId: undefined,
      replyTo: undefined,
    };
    const chatId = options.chat_id || String(current.destination);
    if (
      (current.boundDestination ||
        current.group ||
        !current.owner ||
        ['guest', 'business'].includes(current.surface)) &&
      String(chatId) !== String(current.destination)
    )
      throw new AgentError(
        'forbidden_destination',
        'This turn can send only to its current conversation.',
      );
    if (!/^-?[1-9][0-9]{0,15}$/.test(chatId))
      throw new AgentError('invalid_arguments', 'A numeric destination chat ID is required.');
    for (const button of options.rich_buttons || []) {
      if (!button.label.trim() || (button.type !== 'disabled' && !button.value?.trim()))
        throw new AgentError('invalid_arguments', 'Button label and value must not be empty.');
      if (button.type === 'url' && !/^(https?:\/\/|tg:\/\/)/i.test(button.value))
        throw new AgentError('invalid_arguments', 'Button URL must use HTTP, HTTPS or tg.');
      if (button.type === 'copy' && [...button.value].length > 256)
        throw new AgentError('invalid_arguments', 'Copy button text exceeds 256 characters.');
      if (button.type !== 'callback' && button.execute)
        throw new AgentError('invalid_arguments', 'Only callback buttons can execute a tool.');
      if (button.execute) validateAction?.(button.execute);
    }
    return { current, chatId };
  }
  return {
    validate: (args) => {
      validateOptions(args);
    },
    async send(text, invocation, options = {}) {
      const { current, chatId } = validateOptions(options);
      const pending = [],
        buttons = [];
      for (const [index, button] of (options.rich_buttons || []).entries()) {
        if (button.type === 'callback') {
          const id = `button:${digest(`${invocation.operationId}:${index}`).slice(0, 40)}`;
          const data = {
            ownerId,
            actorId: current.actorId,
            sourceChatId: current.destination,
            sourceGroup: current.group,
            sourceThreadId: current.threadId || 0,
            surface: current.surface,
            businessConnectionId: current.businessConnectionId,
            cardId: invocation.operationId,
            chatId,
            text,
            value: button.value,
            ...(button.execute ? { execute: button.execute } : {}),
          };
          pending.push({ id, data });
          buttons.push({ ...button, value: id });
        } else buttons.push(button);
      }
      for (const { id, data } of pending) {
        if (!(await operations.claim(id, 'telegram_button', 'preparing', data, now() + 86400000)))
          throw new AgentError('button_exists', 'This interaction was already prepared.');
      }
      const receipt = await deliver(`tool-message:${invocation.operationId}`, chatId, text, {
        format: 'rich',
        buttons,
        replyTo:
          options.reply_to_message_id ||
          (String(chatId) === String(current.destination) ? current.replyTo : undefined),
        threadId: current.threadId,
        businessConnectionId: current.businessConnectionId,
        guestQueryId: current.editRef ? undefined : current.guestQueryId,
        editRef: current.editRef,
        assertActive: current.assertActive,
      });
      for (const { id, data } of pending)
        await operations.transition(id, ['preparing'], 'pending', {
          ...data,
          messageId: receipt.message_ids.at(-1),
          inlineMessageId: receipt.inline_message_id,
        });
      return { ...receipt, reply_delivered: String(chatId) === String(current.destination) };
    },
    async consume(incoming) {
      const button = await operations.operation(incoming.data);
      if (
        !button ||
        button.kind !== 'telegram_button' ||
        button.state !== 'pending' ||
        button.expires_at <= now() ||
        incoming.actor?.isBot ||
        String(incoming.actor?.id) !== String(button.data.actorId || ownerId) ||
        (button.data.inlineMessageId
          ? incoming.inlineMessageId !== button.data.inlineMessageId
          : String(incoming.chat?.id) !== button.data.chatId ||
            incoming.messageId !== button.data.messageId)
      )
        return null;
      if (!(await operations.consumeButton(button.id, button.data.cardId))) return null;
      return button.data;
    },
  };
}
