/** @typedef {{ token: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'uranus_info',
  description:
    'Inspect a DeDust Uranus memecoin by ticker or address. Returns current bonding curve, graduation, supply, creator fees and available market context. Ticker lookups select the most liquid candidate and disclose alternatives.',
  properties: { token: string('Uranus ticker, name or token address.', 160) },
  required: ['token'],
});
/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'info'>} capabilities */
export function createUranusInfoTool({ info }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'uranus',
        exposure: 'search',
        keywords: ['memecoin', 'curve', 'graduation', 'creator', 'fees', 'price', 'supply'],
      },
      validate: (args) => {
        if (!String(args.token).trim())
          throw new AgentError('invalid_arguments', 'A token ticker or address is required.');
      },
      execute: (args) => info({ token: String(args.token).trim() }),
    }),
  );
}
