import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
export const schema = defineSchema({
  name: 'tool_search',
  description:
    'Find authorized tools with their complete input contracts. Search in English by intent or use an exact tool name/id. Call a returned id with tool_call using its schema or method parameters. Fewer complete matches are returned when the result budget is tight.',
  properties: {
    query: string('Capability or action to find.', 512),
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
  required: ['query'],
});
export function createSearchTool(catalog) {
  return defineTool({
    schema,
    effect: 'read',
    parallelSafe: true,
    metadata: { family: 'discovery', exposure: 'direct', keywords: [] },
    execute: (args) => catalog.search(args.query, args.limit),
  });
}
