/** @typedef {{ address: string; decimals?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'jetton_info',
  description:
    'Read a jetton master contract: total supply, mintability, admin and immutability. Pass decimals from ton_token_search for display (default 9). Read-only.',
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

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'jettonInfo'>} capabilities */
export function createJettonInfoTool({ jettonInfo }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'jetton', exposure: 'search', keywords: ['jetton', 'info'] },
      effect: 'read',
      parallelSafe: true,
      validate: (args) => {
        if (!args.address.trim()) throw new AgentError('invalid_arguments', 'Address is required.');
      },
      execute: ({ address, decimals = 9 }) => jettonInfo({ address: address.trim(), decimals }),
    }),
  );
}
