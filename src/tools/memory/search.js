/** @typedef {{ query: string; limit?: number }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'memory_search',
  description: 'Search saved facts.',
  properties: {
    query: string('Search text; leave empty for the most recent facts.', 200),
    limit: { type: 'integer', minimum: 1, maximum: 10 },
  },
  required: ['query'],
});

/** @param {Pick<import('../../contracts/tools.js').MemoryPort, 'search'>} memory */
export function createMemorySearchTool({ search }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'memory', exposure: 'direct', keywords: ['find', 'recall'] },
      parallelSafe: true,
      effect: 'read',
      async execute(args) {
        return { notes: await search(args.query, args.limit || 5) };
      },
    }),
  );
}
