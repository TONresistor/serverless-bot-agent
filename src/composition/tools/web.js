import { createWebSearchTool, schema as searchSchema } from '../../tools/web/search.js';
import { createWebFetchTool, schema as fetchSchema } from '../../tools/web/fetch.js';
export const schemas = [searchSchema, fetchSchema];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ web }) =>
  web ? [createWebSearchTool(web), createWebFetchTool(web)] : [];
