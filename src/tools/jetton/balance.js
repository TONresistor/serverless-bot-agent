/** @typedef {{ address: string; decimals?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'jetton_balance',
  description:
    'Read the agent wallet balance of one jetton. Pass decimals from ton_token_search (default 9). An explicitly undeployed token wallet has zero balance; RPC errors are reported.',
  properties: {
    address: string('Jetton master address.', 100),
    decimals: {
      type: 'integer',
      description: 'Token decimals (default 9).',
      minimum: 0,
      maximum: 30,
    },
  },
  required: ['address'],
});

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'jettonBalance'>} capabilities */
export function createJettonBalanceTool({ jettonBalance }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'jetton', exposure: 'search', keywords: ['jetton', 'balance'] },
      effect: 'read',
      parallelSafe: true,
      validate: (args) => {
        if (!args.address.trim()) throw new AgentError('invalid_arguments', 'Address is required.');
      },
      execute: ({ address, decimals = 9 }) => jettonBalance({ address: address.trim(), decimals }),
    }),
  );
}
