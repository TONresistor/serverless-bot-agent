/** @typedef {{ token: string; amount: string; min_out?: string; decimals?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'uranus_buy',
  description:
    'Prepare a Uranus bonding-curve purchase for owner confirmation. amount is TON to spend; 0.15 TON gas is added and excess returned. min_out is token units; omitted or zero means no minimum output protection. Nothing is signed until the owner confirms.',
  properties: {
    token: string('Ticker or Uranus token address.', 160),
    amount: string('Positive TON amount as a decimal string.', 80),
    min_out: string('Minimum tokens received; default 0 gives no output protection.', 80),
    decimals: {
      type: 'integer',
      description: 'Token decimals for min_out, default 9.',
      minimum: 0,
      maximum: 30,
    },
  },
  required: ['token', 'amount'],
});
/** @param {import('../../contracts/finance.js').FinancialPreparation} financial */
export function createUranusBuyTool({ prepare }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'external_write',
      metadata: {
        family: 'uranus',
        exposure: 'search',
        keywords: ['buy', 'trade', 'memecoin', 'bonding', 'curve'],
      },
      execute: (args, { operationId }) => prepare('uranus_buy', args, operationId),
    }),
  );
}
