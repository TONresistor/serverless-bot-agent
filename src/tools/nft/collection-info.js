/** @typedef {{ address: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'nft_collection_info',
  description:
    'Inspect an NFT collection: owner, minted item count and available display metadata. Read-only.',
  properties: { address: string('NFT collection address.', 100) },
  required: ['address'],
});

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'nftCollectionInfo'>} capabilities */
export function createNftCollectionInfoTool({ nftCollectionInfo }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'nft', exposure: 'search', keywords: ['nft', 'collection', 'info'] },
      effect: 'read',
      parallelSafe: true,
      validate: (args) => {
        if (!args.address.trim()) throw new AgentError('invalid_arguments', 'Address is required.');
      },
      execute: ({ address }) => nftCollectionInfo({ address: address.trim() }),
    }),
  );
}
