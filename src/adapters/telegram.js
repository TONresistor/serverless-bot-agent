import { extractTrigger } from './telegram/triggers.js';
import { renderButtons } from './telegram/buttons.js';
import { prepareMessage, splitPlain, isRichFormatRejection } from './telegram/rich-message.js';

/** SDK-facing Telegram port; consumers receive only the methods they need. */
export function createTelegramAdapter(api) {
  return Object.freeze({
    call: (method, params) => api[method](params),
    prepareMessage,
    splitPlain,
    isRichFormatRejection,
    renderButtons,
    editMessageText: (params) => api.editMessageText(params),
    answerGuestQuery: (params) => api.answerGuestQuery(params),
    sendRichMessageDraft: (params) => api.sendRichMessageDraft(params),
    sendRichMessage: (params) => api.sendRichMessage(params),
    sendMessage: (params) => api.sendMessage(params),
    sendChatAction: (params) => api.sendChatAction(params),
    answerCallbackQuery: (params) => api.answerCallbackQuery(params),
    getMe: () => api.getMe(),
  });
}

export function normalizeMessage(message, context, identity = {}) {
  return {
    updateId: context?.update?.update_id,
    actor: message?.from && { id: message.from.id, isBot: Boolean(message.from.is_bot) },
    chat: message?.chat && { id: message.chat.id, type: message.chat.type },
    messageId: message?.message_id ?? message?.id,
    mediaFileId: message?.photo?.at(-1)?.file_id,
    businessConnectionId: message?.business_connection_id,
    guestQueryId: message?.guest_query_id,
    ...extractTrigger(message || {}, identity),
    senderChat: message?.sender_chat?.id,
    threadId: message?.message_thread_id,
    replyText: message?.reply_to_message?.text || message?.reply_to_message?.caption,
    replyAuthorId: message?.reply_to_message?.from?.id,
  };
}

export function normalizeCallback(callback, context) {
  return {
    updateId: context?.update?.update_id,
    actor: callback?.from && { id: callback.from.id, isBot: Boolean(callback.from.is_bot) },
    chat: callback?.message?.chat && {
      id: callback.message.chat.id,
      type: callback.message.chat.type,
    },
    messageId: callback?.message?.message_id,
    threadId: callback?.message?.message_thread_id,
    callbackId: callback?.id,
    inlineMessageId: callback?.inline_message_id,
    data: callback?.data,
  };
}
