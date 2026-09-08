/** @typedef {{  }} Args */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';

export const schema = defineSchema({
  name: 'ton_get_balance',
  description: 'Get the current wallet balance in TON.',
  properties: {},
  required: [],
});

/** @param {Pick<import('../../contracts/tools.js').WalletReadPort, 'balance'>} wallet */
export function createGetBalanceTool({ balance }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'ton', exposure: 'search', keywords: ['balance', 'funds', 'wallet'] },
      parallelSafe: true,
      effect: 'read',
      execute: () => balance(),
    }),
  );
}
