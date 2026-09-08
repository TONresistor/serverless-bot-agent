import { AgentError } from '../shared/errors.js';
import { digest } from '../shared/hash.js';

/** One durable claim for the complete send; an uncertain/partial send is never replayed. */
export function createDelivery({ operations, telegram, log }) {
  return async function sendOnce(
    id,
    chatId,
    text,
    {
      format = 'plain',
      buttons = [],
      replyTo = undefined,
      threadId = undefined,
      businessConnectionId = undefined,
      guestQueryId = undefined,
      editRef = undefined,
      assertActive = async () => {},
    } = {},
  ) {
    const parts = telegram.prepareMessage(text, format);
    if (buttons.length) {
      const markup = telegram.renderButtons(buttons);
      if (markup.length > 8000) throw new Error('Button markup is too large');
      const last = parts.at(-1);
      if (last.rich_message) {
        last.rich_message.markdown += '\n\n' + markup;
        last.buttonsOnly = true;
      } else
        parts.push({ rich_message: { markdown: markup }, fallback_text: '', buttonsOnly: true });
    }
    if (editRef?.inline_message_id && parts.length > 1)
      throw new Error('An inline callback response must fit in one message.');
    const contentHash = digest(JSON.stringify({ text, buttons, format }));
    const key = `delivery:${digest(guestQueryId ? `guest:${guestQueryId}` : id)}`;
    if (!(await operations.claim(key, 'delivery', 'in_flight'))) {
      const prior = await operations.operation(key);
      if (prior?.state === 'succeeded') {
        if (guestQueryId && prior.data.content_hash !== contentHash)
          throw new AgentError(
            'guest_answered',
            'This guest query was already answered. Do not send another reply.',
            { effectNotStarted: true },
          );
        return prior.data;
      }
      throw new Error('Telegram delivery already pending or uncertain');
    }
    const messageIds = [];
    let inlineMessageId;
    const receipt = () => ({
      content_hash: contentHash,
      ...(messageIds[0] ? { message_id: messageIds[0] } : {}),
      message_ids: [...messageIds],
      ...(inlineMessageId ? { inline_message_id: inlineMessageId } : {}),
    });
    async function send(part) {
      await assertActive();
      const body = part.rich_message ? { rich_message: part.rich_message } : { text: part.text };
      const sent =
        editRef && messageIds.length === 0
          ? await telegram.editMessageText({
              ...editRef,
              ...body,
              ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
            })
          : await (part.rich_message ? telegram.sendRichMessage : telegram.sendMessage)({
              chat_id: chatId,
              ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
              ...(threadId ? { message_thread_id: threadId } : {}),
              ...(replyTo
                ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }
                : {}),
              ...(part.rich_message ? { rich_message: part.rich_message } : { text: part.text }),
            });
      if (editRef?.inline_message_id) inlineMessageId = editRef.inline_message_id;
      const messageId = sent.message_id || editRef?.message_id;
      if (messageId) messageIds.push(messageId);
      await operations.transition(key, ['in_flight'], 'in_flight', receipt());
    }
    try {
      if (guestQueryId) {
        await assertActive();
        // Guest queries have exactly one response; splitting would answer an already used query.
        const markdown = parts
          .map((part) => part.rich_message?.markdown || part.text.replace(/</g, '&lt;'))
          .join('\n');
        const sent = await telegram.answerGuestQuery({
          guest_query_id: guestQueryId,
          result: {
            id: digest(id).slice(0, 32),
            type: 'article',
            title: 'Reply',
            input_message_content: { rich_message: { markdown } },
          },
        });
        inlineMessageId = sent.inline_message_id;
      } else
        for (const part of parts) {
          try {
            await send(part);
          } catch (error) {
            if (part.buttonsOnly || !part.rich_message || !telegram.isRichFormatRejection(error))
              throw error;
            const fallback = telegram.splitPlain(part.fallback_text);
            if (editRef?.inline_message_id && fallback.length > 1) throw error;
            for (const text of fallback) await send({ text });
          }
        }
      await operations.transition(key, ['in_flight'], 'succeeded', receipt());
      return receipt();
    } catch (error) {
      await operations.transition(key, ['in_flight'], 'unknown', receipt());
      log('delivery_unknown', { event: id, delivered_parts: messageIds.length });
      throw error;
    }
  };
}
