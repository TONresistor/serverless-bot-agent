/** @typedef {{ path: string; content: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
export const schema = defineSchema({
  name: 'workspace_write',
  description:
    'Write or replace a workspace text file. Use for checklists, notes and automation state. Supply the complete new content.',
  properties: {
    path: string('Relative workspace path.', 512),
    content: string('Full new content, at most 256 KiB UTF-8.', 262144),
  },
  required: ['path', 'content'],
});
/** @param {Pick<import('../../contracts/capabilities.js').WorkspacePort, 'write' | 'validate'>} capabilities */
export function createWorkspaceWrite({ write, validate }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'state_write',
      maxArgumentBytes: 2000000,
      metadata: {
        family: 'workspace',
        exposure: 'search',
        keywords: ['file', 'save', 'checklist'],
      },
      validate: (args) => validate(args.path, args.content),
      execute: (args) => write(args.path, args.content),
    }),
  );
}
