/** @typedef {{  }} Args */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';

export const schema = defineSchema({
  name: 'jetton_portfolio',
  description:
    'List the jettons held by the agent wallet: token address, balance, estimated value in TON and portfolio total, most valuable first. Native TON is separate: use ton_get_balance.',
  properties: {},
  required: [],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'portfolio'>} capabilities */
export function createJettonPortfolioTool({ portfolio }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'jetton',
        exposure: 'search',
        keywords: ['portfolio', 'holdings', 'wallet', 'tokens', 'balance', 'value'],
      },
      execute: () => portfolio(),
    }),
  );
}
