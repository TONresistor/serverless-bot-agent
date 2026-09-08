/** @typedef {{ address: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'ton_address_info',
  description:
    'Inspect any TON account: balance, account status and contract-code presence. Read-only.',
  properties: { address: string('TON address (friendly or raw).', 100) },
  required: ['address'],
});

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'addressInfo'>} capabilities */
export function createAddressInfoTool({ addressInfo }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'ton', exposure: 'search', keywords: ['ton', 'address', 'info'] },
      effect: 'read',
      parallelSafe: true,
      validate: (args) => {
        if (!args.address.trim()) throw new AgentError('invalid_arguments', 'Address is required.');
      },
      execute: ({ address }) => addressInfo({ address: address.trim() }),
    }),
  );
}
