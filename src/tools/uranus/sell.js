/** @typedef {{ token: string; amount: string; min_out?: string; decimals?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'uranus_sell',
  description:
    'Prepare a Uranus bonding-curve sale for owner confirmation. amount is tokens to sell; 0.20 TON funds gas. min_out is TON received; omitted or zero means no minimum output protection. Use uranus_my_tokens to identify holdings first.',
  properties: {
    token: string('Ticker or Uranus token address.', 160),
    amount: string('Positive token amount in human units.', 80),
    min_out: string('Minimum TON received; default 0 gives no output protection.', 80),
    decimals: {
      type: 'integer',
      description: 'Token decimals for amount, default 9.',
      minimum: 0,
      maximum: 30,
    },
  },
  required: ['token', 'amount'],
});
/** @param {import('../../contracts/finance.js').FinancialPreparation} financial */
export function createUranusSellTool({ prepare }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'external_write',
      metadata: {
        family: 'uranus',
        exposure: 'search',
        keywords: ['sell', 'trade', 'memecoin', 'bonding', 'curve'],
      },
      execute: (args, { operationId }) => prepare('uranus_sell', args, operationId),
    }),
  );
}
