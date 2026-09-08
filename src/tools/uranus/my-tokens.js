/** @typedef {{  }} Args */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';

export const schema = defineSchema({
  name: 'uranus_my_tokens',
  description:
    'List Uranus memecoins held by the agent wallet, including balance, value, graduation progress and whether the agent created each token. Use first when selling or claiming creator fees without an address.',
  properties: {},
  required: [],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'uranusHoldings'>} capabilities */
export function createUranusMyTokensTool({ uranusHoldings }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'uranus',
        exposure: 'search',
        keywords: ['holdings', 'wallet', 'memecoin', 'creator', 'fees', 'sell', 'portfolio'],
      },
      execute: () => uranusHoldings(),
    }),
  );
}
