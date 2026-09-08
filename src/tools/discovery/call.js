import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
export const schema = defineSchema({
  name: 'tool_call',
  description:
    'Call an authorized tool discovered in the catalog. The runtime validates the target inputs and enforces its actual permissions and effects.',
  properties: {
    name: string('Exact tool name or search result id.', 160),
    arguments: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
      maxProperties: 40,
    },
  },
  required: ['name', 'arguments'],
});
export function createCallTool() {
  return defineTool({
    schema,
    effect: 'external_write',
    metadata: { family: 'discovery', exposure: 'direct', keywords: [] },
    execute: () => {
      throw new Error('Discovery calls must be resolved before execution');
    },
  });
}
