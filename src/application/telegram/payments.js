import { digest } from '../../shared/hash.js';
import { AgentError } from '../../shared/errors.js';

export function createStarPayments({ operations, telegram, ownerId, now }) {
  return {
    async request(args, { operationId }) {
      const chatId = args.chat_id || String(ownerId);
      if (
        !/^-?[1-9][0-9]{0,15}$/.test(chatId) ||
        !args.description.trim() ||
        (args.title !== undefined && !args.title.trim())
      )
        throw new AgentError(
          'invalid_arguments',
          'A numeric chat and nonempty invoice text are required.',
        );
      const payload = `stars:${digest(operationId).slice(0, 40)}`;
      const data = { chatId, amount: args.amount, currency: 'XTR' };
      if (!(await operations.claim(payload, 'star_invoice', 'pending', data, now() + 86400000)))
        throw new AgentError(
          'invoice_exists',
          'This invoice has already been prepared. Do not repeat it.',
        );
      const message = await telegram.call('sendInvoice', {
        chat_id: chatId,
        title: args.title || 'Payment',
        description: args.description,
        payload,
        currency: 'XTR',
        provider_token: '',
        prices: [{ label: args.title || 'Payment', amount: args.amount }],
      });
      await operations.transition(payload, ['pending'], 'pending', {
        ...data,
        messageId: message.message_id,
      });
      return {
        message_id: message.message_id,
        invoice_id: payload,
        state: 'pending_payment',
        reply_delivered: String(chatId) === String(ownerId),
      };
    },
    async preCheckout(query) {
      const invoice = await operations.operation(query.invoice_payload);
      let ok =
        invoice?.kind === 'star_invoice' &&
        (invoice.state === 'pending' ||
          (invoice.state === 'checkout_approved' && invoice.data.checkoutId === query.id)) &&
        invoice.expires_at > now() &&
        query.currency === 'XTR' &&
        query.total_amount === invoice.data.amount &&
        (invoice.data.chatId.startsWith('-') || String(query.from?.id) === invoice.data.chatId);
      if (ok && invoice.state === 'pending') {
        ok = await operations.transition(invoice.id, ['pending'], 'checkout_approved', {
          ...invoice.data,
          checkoutId: query.id,
        });
        if (!ok) {
          const current = await operations.operation(invoice.id);
          ok =
            current?.state === 'checkout_approved' &&
            current.data.checkoutId === query.id &&
            current.expires_at > now();
        }
      }
      await telegram.call('answerPreCheckoutQuery', {
        pre_checkout_query_id: query.id,
        ok: Boolean(ok),
        ...(!ok ? { error_message: 'This invoice is invalid, expired or already paid.' } : {}),
      });
      return { accepted: Boolean(ok) };
    },
    async successful(message) {
      const payment = message.successful_payment;
      if (
        typeof payment?.invoice_payload !== 'string' ||
        typeof payment.telegram_payment_charge_id !== 'string' ||
        !payment.telegram_payment_charge_id
      )
        return { ignored: true };
      const invoice = await operations.operation(payment.invoice_payload);
      if (
        !invoice ||
        invoice.kind !== 'star_invoice' ||
        String(message.chat?.id) !== invoice.data.chatId ||
        payment.currency !== 'XTR' ||
        payment.total_amount !== invoice.data.amount
      )
        return { ignored: true };
      const changed = await operations.transition(
        invoice.id,
        ['pending', 'checkout_approved'],
        'paid',
        { ...invoice.data, chargeId: payment.telegram_payment_charge_id, paidAt: now() },
      );
      return { paid: changed, duplicate: !changed };
    },
  };
}
