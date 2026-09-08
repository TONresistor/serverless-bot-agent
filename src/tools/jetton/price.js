/** @typedef {{ address: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'jetton_price',
  description:
    'Get a TON jetton USD price, symbol and decimals from STON.fi using its master address.',
  properties: { address: string('Jetton master address from ton_token_search.', 100) },
  required: ['address'],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'jettonPrice'>} capabilities */
export function createJettonPriceTool({ jettonPrice }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'jetton',
        exposure: 'search',
        keywords: ['token', 'price', 'usd', 'market', 'value'],
      },
      execute: (args) => jettonPrice({ address: String(args.address).trim() }),
    }),
  );
}
