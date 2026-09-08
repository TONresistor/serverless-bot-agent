/** @typedef {{ chat_id?: string; amount: number; title?: string; description: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'request_star_payment',
  description:
    'Send a Telegram Stars invoice. The recipient must pay through Telegram; sending an invoice does not mean payment succeeded. Stars are separate from TON.',
  properties: {
    chat_id: string('Recipient numeric chat ID. Defaults to the owner.', 30),
    amount: { type: 'integer', minimum: 1, maximum: 100000 },
    title: string('Invoice title. Defaults to Payment.', 32),
    description: string('Purpose of the payment.', 255),
  },
  required: ['amount', 'description'],
});

/** @param {NonNullable<import('../../contracts/capabilities.js').BuiltinPorts['payments']>} payments */
export function createRequestStarPaymentTool({ request }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'telegram', exposure: 'direct', keywords: [] },
      effect: 'external_write',
      execute: (args, invocation) => request(args, invocation),
    }),
  );
}
