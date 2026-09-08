/** @typedef {{ query: string; chain?: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'token_market',
  description:
    'Look up crypto tokens across DEXes using DexScreener. Returns up to three distinct tokens with USD price, liquidity, volume, market cap, age, buy/sell counts and risk flags. Query by symbol, name or contract address; optionally filter by chain.',
  properties: {
    query: string('Token symbol, name or contract address.', 200),
    chain: string('Optional chain filter such as ton. Omit to search all chains.', 40),
  },
  required: ['query'],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'tokenMarket'>} capabilities */
export function createTokenMarketTool({ tokenMarket }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'market',
        exposure: 'search',
        keywords: ['crypto', 'token', 'market', 'liquidity', 'volume', 'risk', 'dexscreener'],
      },
      validate: (args) => {
        if (!String(args.query).trim())
          throw new AgentError('invalid_arguments', 'A token query is required.');
      },
      execute: (args) =>
        tokenMarket({
          query: String(args.query).trim(),
          chain: String(args.chain || '')
            .trim()
            .toLowerCase(),
        }),
    }),
  );
}
