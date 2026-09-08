/** @typedef {{ query?: string; limit?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'uranus_token_search',
  description:
    'Find DeDust Uranus memecoins by ticker or name. Returns token address, market cap, price, liquidity, holders and age. Empty query lists newest launches. Matching tickers may be impersonators: compare liquidity and confirm the address before trading.',
  properties: {
    query: string('Ticker or name. Empty lists newest Uranus launches.', 160),
    limit: {
      type: 'integer',
      description: 'Maximum candidates, default 10, maximum 50.',
      minimum: 1,
      maximum: 50,
    },
  },
  required: [],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'uranusSearch'>} capabilities */
export function createUranusTokenSearchTool({ uranusSearch }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'uranus',
        exposure: 'search',
        keywords: ['memecoin', 'launch', 'search', 'ticker', 'discovery', 'dedust'],
      },
      execute: (args) =>
        uranusSearch({ query: String(args.query || '').trim(), limit: Number(args.limit ?? 10) }),
    }),
  );
}
