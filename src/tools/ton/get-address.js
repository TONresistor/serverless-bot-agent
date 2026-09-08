/** @typedef {{  }} Args */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';

export const schema = defineSchema({
  name: 'ton_get_address',
  description: 'Get the wallet receiving address and network.',
  properties: {},
  required: [],
});

/** @param {Pick<import('../../contracts/tools.js').WalletReadPort, 'identity'>} wallet */
export function createGetAddressTool({ identity }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'ton', exposure: 'search', keywords: ['address', 'receive', 'wallet'] },
      parallelSafe: true,
      effect: 'read',
      execute: () => identity(),
    }),
  );
}
