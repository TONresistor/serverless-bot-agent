import { createMemorySetTool, schema as memorySet } from '../../tools/memory/set.js';
import { createMemoryGetTool, schema as memoryGet } from '../../tools/memory/get.js';
import { createMemorySearchTool, schema as memorySearch } from '../../tools/memory/search.js';
export const schemas = [memorySet, memoryGet, memorySearch];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ memory }) => [
  createMemorySetTool({ set: memory.set }),
  createMemoryGetTool({ get: memory.get }),
  createMemorySearchTool({ search: memory.search }),
];
