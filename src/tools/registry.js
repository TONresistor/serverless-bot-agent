import { AgentError } from '../shared/errors.js';

/** @param {import('../contracts/tools.js').Tool[]} tools @returns {import('../contracts/tools.js').ToolRegistry} */
export function createToolRegistry(tools) {
  const byName = new Map();
  for (const tool of tools) {
    if (tool.name !== tool.schema.function.name || typeof tool.prepare !== 'function')
      throw new Error('Invalid registry entry');
    if (byName.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    byName.set(tool.name, tool);
  }
  return Object.freeze({
    schemas: Object.freeze(tools.map((tool) => tool.schema)),
    names: Object.freeze(tools.map((tool) => tool.name)),
    get(name) {
      const tool = byName.get(name);
      if (!tool) throw new AgentError('unknown_tool', 'Unknown tool.');
      return tool;
    },
  });
}
