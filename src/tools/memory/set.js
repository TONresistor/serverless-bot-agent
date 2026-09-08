/** @typedef {{ key: string; value: string; tags?: Array<string> }} Args */
import { AgentError } from '../../shared/errors.js';
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'memory_set',
  description: 'Save a persistent fact. Never store secrets.',
  properties: {
    key: string('Stable fact key.', 128),
    value: string('Fact to save.', 8192),
    tags: { type: 'array', items: string('Short tag.', 40), maxItems: 10 },
  },
  required: ['key', 'value'],
});

/** @param {Pick<import('../../contracts/tools.js').MemoryPort, 'set'>} memory */
export function createMemorySetTool({ set }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'memory', exposure: 'direct', keywords: ['remember', 'save'] },
      effect: 'state_write',
      validate(args) {
        if (!args.key.trim()) throw new AgentError('invalid_arguments', 'The memory key is empty.');
        if (/sk-or-[A-Za-z0-9_-]+|app\d+:[A-Za-z0-9_-]+|\b[a-f0-9]{128}\b/i.test(args.value))
          throw new AgentError('secret_in_memory', 'A secret key must not be stored as a fact.');
      },
      async execute(args) {
        const key = args.key.trim();
        await set(key, args.value, args.tags || []);
        return { saved: true, key };
      },
    }),
  );
}
