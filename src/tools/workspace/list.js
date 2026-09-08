/** @typedef {{  }} Args */
import { defineTool } from '../define.js';
import { defineSchema } from '../schema.js';
export const schema = defineSchema({
  name: 'workspace_list',
  description: 'List the persistent workspace files available in this context.',
  properties: {},
  required: [],
});
/** @param {Pick<import('../../contracts/capabilities.js').WorkspacePort, 'list'>} capabilities */
export function createWorkspaceList({ list }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: { family: 'workspace', exposure: 'search', keywords: ['files', 'documents'] },
      execute: () => list(),
    }),
  );
}
