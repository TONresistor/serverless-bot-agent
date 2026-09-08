import { createWorkspaceList, schema as list } from '../../tools/workspace/list.js';
import { createWorkspaceRead, schema as read } from '../../tools/workspace/read.js';
import { createWorkspaceWrite, schema as write } from '../../tools/workspace/write.js';
export const schemas = [list, read, write];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ workspace }) => [
  createWorkspaceList(workspace),
  createWorkspaceRead(workspace),
  createWorkspaceWrite(workspace),
];
