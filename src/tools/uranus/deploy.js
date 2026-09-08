/**
 * @typedef {object} Args
 * @property {number} preset_id
 * @property {string} [name]
 * @property {string} [symbol]
 * @property {string} [description]
 * @property {string} [image]
 * @property {string} [image_file_id]
 * @property {string} [metadata_uri]
 * @property {string} [initial_buy]
 */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'uranus_deploy',
  description:
    'Prepare a new Uranus token launch on the v3.1 factory for owner confirmation. Supply ready metadata_uri, or name/symbol/image with configured IPFS hosting. An image can be a saved workspace path or attached image_file_id. initial_buy defaults to 0; 0.40 TON gas is added. Presets 3/4/5 raise 1000 TON, 6/7 raise 1500, 8/9 raise 2500.',
  properties: {
    preset_id: {
      type: 'integer',
      description:
        'Preset uint4 (0..15); common documented presets are 3..9. Fees: 3/6/8 = 1%, 4/7/9 = 3%, 5 = 5%.',
      minimum: 0,
      maximum: 15,
    },
    name: string('Token name for hosted metadata.', 128),
    symbol: string('Ticker for hosted metadata.', 32),
    description: string('Token description.', 2000),
    image: string('Saved workspace image path.', 512),
    image_file_id: string('Attached Telegram image file ID.', 512),
    metadata_uri: string('Ready metadata JSON URI; bypasses hosting.', 4096),
    initial_buy: string('Optional initial buy in TON, default 0.', 80),
  },
  required: ['preset_id'],
});
/** @param {import('../../contracts/finance.js').FinancialPreparation} financial */
export function createUranusDeployTool({ prepare }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'external_write',
      metadata: {
        family: 'uranus',
        exposure: 'search',
        keywords: ['deploy', 'launch', 'create', 'memecoin', 'metadata', 'token'],
      },
      execute: (args, { operationId }) => prepare('uranus_deploy', args, operationId),
    }),
  );
}
