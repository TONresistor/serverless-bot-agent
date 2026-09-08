/** @typedef {{  }} Args */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';

export const schema = defineSchema({
  name: 'ton_price',
  description: 'Get the current native TON price in USD from the STON.fi DEX spot price.',
  properties: {},
  required: [],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'tonPrice'>} capabilities */
export function createTonPriceTool({ tonPrice }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'ton',
        exposure: 'search',
        keywords: ['price', 'usd', 'market', 'value'],
      },
      execute: () => tonPrice(),
    }),
  );
}
