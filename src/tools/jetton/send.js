/** @typedef {{ address: string; to: string; amount: string; decimals?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'jetton_send',
  description:
    'Prepare an exact jetton transfer from the agent wallet. The owner must confirm the token, recipient, amount and gas using Telegram buttons before signing. Pass token decimals from ton_token_search (default 9).',
  properties: {
    address: string('Jetton master address.', 100),
    to: string('Recipient wallet address.', 100),
    amount: string('Positive human token amount as a decimal string.', 72),
    decimals: {
      type: 'integer',
      description: 'Token decimals (default 9).',
      minimum: 0,
      maximum: 30,
    },
  },
  required: ['address', 'to', 'amount'],
});

/** @param {import('../../contracts/finance.js').FinancialPreparation} financial */
export function createJettonSendTool(financial) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: {
        family: 'jetton',
        exposure: 'search',
        keywords: ['send', 'transfer', 'token', 'wallet'],
      },
      effect: 'external_write',
      validate: (args) => financial.validate?.('jetton_send', args),
      execute: (args, { operationId }) => financial.prepare('jetton_send', args, operationId),
    }),
  );
}
