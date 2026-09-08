/** @typedef {{ query: string; limit?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'ton_token_search',
  description:
    'Search TON jettons by name or symbol on STON.fi. Returns master address, decimals, price and verified status. Prefer a verified result and confirm the token before swapping.',
  properties: {
    query: string('Token name or symbol, such as USDT or NOT.', 160),
    limit: {
      type: 'integer',
      description: 'Maximum results, default 8, maximum 25.',
      minimum: 1,
      maximum: 25,
    },
  },
  required: ['query'],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'searchTokens'>} capabilities */
export function createTokenSearchTool({ searchTokens }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'ton',
        exposure: 'search',
        keywords: ['token', 'jetton', 'search', 'symbol', 'decimals', 'verified'],
      },
      validate: (args) => {
        if (!String(args.query).trim())
          throw new AgentError('invalid_arguments', 'A token query is required.');
      },
      execute: (args) =>
        searchTokens({ query: String(args.query).trim(), limit: Number(args.limit ?? 8) }),
    }),
  );
}
