/** @typedef {{ path: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
export const schema = defineSchema({
  name: 'workspace_read',
  description: 'Read a workspace text file, including SOUL.md, HEARTBEAT.md or task state.',
  properties: { path: string('Relative workspace path.', 512) },
  required: ['path'],
});
/** @param {Pick<import('../../contracts/capabilities.js').WorkspacePort, 'read' | 'validate'>} capabilities */
export function createWorkspaceRead({ read, validate }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'workspace',
        exposure: 'search',
        keywords: ['file', 'read', 'instructions', 'heartbeat'],
      },
      validate: (args) => validate(args.path),
      execute: (args) => read(args.path),
    }),
  );
}
