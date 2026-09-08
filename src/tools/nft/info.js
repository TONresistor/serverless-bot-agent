/** @typedef {{ address: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'nft_info',
  description:
    'Inspect an NFT item: owner, collection, index, and available display metadata. Provide the NFT item address. Read-only.',
  properties: { address: string('NFT item address.', 100) },
  required: ['address'],
});

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'nftInfo'>} capabilities */
export function createNftInfoTool({ nftInfo }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'nft', exposure: 'search', keywords: ['nft', 'info'] },
      effect: 'read',
      parallelSafe: true,
      validate: (args) => {
        if (!args.address.trim()) throw new AgentError('invalid_arguments', 'Address is required.');
      },
      execute: ({ address }) => nftInfo({ address: address.trim() }),
    }),
  );
}
