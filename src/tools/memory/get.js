/** @typedef {{ key: string }} Args */
import { AgentError } from '../../shared/errors.js';
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'memory_get',
  description: 'Read a fact by its exact key.',
  properties: {
    key: string('Fact key.', 128),
  },
  required: ['key'],
});

/** @param {Pick<import('../../contracts/tools.js').MemoryPort, 'get'>} memory */
export function createMemoryGetTool({ get }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'memory', exposure: 'direct', keywords: ['recall', 'remember'] },
      parallelSafe: true,
      effect: 'read',
      validate(args) {
        if (!args.key.trim()) throw new AgentError('invalid_arguments', 'The memory key is empty.');
      },
      async execute(args) {
        return { note: await get(args.key.trim()) };
      },
    }),
  );
}
