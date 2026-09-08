/** @typedef {{ token: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'uranus_claim_fees',
  description:
    'Prepare collection of accrued creator fees for an Uranus token created by the agent wallet. The creator is checked on-chain. Fees and excess return to the agent wallet; 0.10 TON funds gas. Owner confirmation is required.',
  properties: { token: string('Ticker or address of a token created by the agent.', 160) },
  required: ['token'],
});
/** @param {import('../../contracts/finance.js').FinancialPreparation} financial */
export function createUranusClaimFeesTool({ prepare }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'external_write',
      metadata: {
        family: 'uranus',
        exposure: 'search',
        keywords: ['creator', 'fees', 'claim', 'revenue', 'memecoin'],
      },
      execute: (args, { operationId }) => prepare('uranus_claim_fees', args, operationId),
    }),
  );
}
