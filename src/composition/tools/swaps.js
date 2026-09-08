import { createSwapQuoteTool, schema as quoteSchema } from '../../tools/swaps/quote.js';
import { createSwapTool, schema as swapSchema } from '../../tools/swaps/swap.js';

export const schemas = [quoteSchema, swapSchema];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ swaps, financial }) =>
  swaps
    ? [
        createSwapQuoteTool(swaps),
        ...(financial
          ? [createSwapTool({ prepare: financial.prepare, validate: swaps.validate })]
          : []),
      ]
    : [];
