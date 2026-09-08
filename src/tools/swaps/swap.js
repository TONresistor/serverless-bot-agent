/**
 * @typedef {object} Args
 * @property {"stonfi" | "dedust"} [dex]
 * @property {string} [pool_address]
 * @property {string} [from]
 * @property {string} to
 * @property {string} amount
 * @property {number} [from_decimals]
 * @property {number} [to_decimals]
 * @property {number} [max_slippage_bps]
 */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';
import { parameters } from './quote.js';

export const schema = defineSchema({
  name: 'ton_swap',
  description:
    'Prepare a direct STON.fi v2 or DeDust swap from the agent wallet. Use dex=dedust for graduated Uranus tokens. Shows the exact input, output minimum, slippage and TON gas budget. The owner must confirm with Telegram buttons before the transaction is signed or sent. Never repeat an uncertain swap.',
  properties: /** @type {Record<string, import('../../contracts/tools.js').Parameter>} */ (
    parameters
  ),
  required: ['to', 'amount'],
});
/** @param {import('../../contracts/capabilities.js').SwapPreparePort} capabilities */
export function createSwapTool({ prepare, validate }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'external_write',
      metadata: {
        family: 'swaps',
        exposure: 'search',
        keywords: [
          'swap',
          'trade',
          'exchange',
          'buy',
          'sell',
          'stonfi',
          'dedust',
          'graduated',
          'uranus',
        ],
      },
      validate,
      execute: (args, { operationId }) => prepare('ton_swap', args, operationId),
    }),
  );
}
