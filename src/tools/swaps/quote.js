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
import { defineSchema, string } from '../schema.js';

export const parameters = {
  dex: {
    type: 'string',
    description:
      'Exchange to use: stonfi (default) or dedust. Use dedust for graduated Uranus tokens.',
    enum: ['stonfi', 'dedust'],
    maxLength: 6,
  },
  pool_address: string(
    'Optional exact DeDust pool address. Otherwise discover factory pools and Uranus graduation pools. The pool is verified on-chain.',
    100,
  ),
  from: string('Input asset: TON or a jetton master address. Defaults to TON.', 100),
  to: string(
    'Output asset: TON or a jetton master address. Use ton_token_search to resolve a symbol first.',
    100,
  ),
  amount: string('Positive input amount in human units as a decimal string.', 80),
  from_decimals: {
    type: 'integer',
    description: 'Required for a non-TON input. Obtain from ton_token_search.',
    minimum: 0,
    maximum: 30,
  },
  to_decimals: {
    type: 'integer',
    description: 'Required for a non-TON output. Obtain from ton_token_search.',
    minimum: 0,
    maximum: 30,
  },
  max_slippage_bps: {
    type: 'integer',
    description: 'Maximum slippage in basis points (100 = 1%). Omitted or zero uses 100.',
    minimum: 0,
    maximum: 9999,
  },
};
export const schema = defineSchema({
  name: 'ton_swap_quote',
  description:
    'Preview a direct STON.fi v2 or DeDust swap without moving funds. DeDust supports vault pools and CPMM v2, including graduated Uranus tokens. Returns expected output, minimum output, route and TON gas budget. Assets are TON or exact jetton master addresses; first resolve token symbols.',
  properties: /** @type {Record<string, import('../../contracts/tools.js').Parameter>} */ (
    parameters
  ),
  required: ['to', 'amount'],
});

/** @param {import('../../contracts/capabilities.js').SwapQuotePort} capabilities */
export function createSwapQuoteTool({ quote, validate }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'swaps',
        exposure: 'search',
        keywords: [
          'swap',
          'quote',
          'trade',
          'exchange',
          'price',
          'stonfi',
          'dedust',
          'graduated',
          'uranus',
        ],
      },
      validate,
      execute: (args) => quote(args),
    }),
  );
}
