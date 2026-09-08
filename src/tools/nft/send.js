/** @typedef {{ nft_address: string; to: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'nft_send',
  description:
    'Prepare transfer of an NFT owned by the agent wallet. The owner must confirm the exact NFT and recipient using Telegram buttons before signing. Attaches 0.05 TON for gas; unused gas returns.',
  properties: {
    nft_address: string('NFT item address; the agent wallet must own it.', 100),
    to: string('Recipient wallet address.', 100),
  },
  required: ['nft_address', 'to'],
});

/** @param {import('../../contracts/finance.js').FinancialPreparation} financial */
export function createNftSendTool(financial) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: {
        family: 'nft',
        exposure: 'search',
        keywords: ['send', 'transfer', 'collectible', 'wallet'],
      },
      effect: 'external_write',
      validate: (args) => financial.validate?.('nft_send', args),
      execute: (args, { operationId }) => financial.prepare('nft_send', args, operationId),
    }),
  );
}
