import { createSaveMediaTool, schema } from '../../tools/media/save.js';

export const schemas = [schema];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ media }) => (media ? [createSaveMediaTool(media)] : []);
