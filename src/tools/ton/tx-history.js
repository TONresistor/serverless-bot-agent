/** @typedef {{ limit?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';

export const schema = defineSchema({
  name: 'ton_tx_history',
  description:
    "Return the agent wallet's recent TON transactions, newest first, with direction, counterparty, amount, comment and timestamp. LT values are decimal strings. Read-only.",
  properties: {
    limit: {
      type: 'integer',
      description: 'Number of transactions (default 10, max 50).',
      minimum: 1,
      maximum: 50,
    },
  },
  required: [],
});

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'txHistory'>} capabilities */
export function createTxHistoryTool({ txHistory }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'ton', exposure: 'search', keywords: ['ton', 'tx', 'history'] },
      effect: 'read',
      parallelSafe: true,
      execute: ({ limit = 10 }) => txHistory({ limit }),
    }),
  );
}
