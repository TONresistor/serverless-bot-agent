import { createJettonSendTool, schema as jettonSend } from '../../tools/jetton/send.js';
import { createNftSendTool, schema as nftSend } from '../../tools/nft/send.js';

export const schemas = [jettonSend, nftSend];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ financial }) =>
  financial ? [createJettonSendTool(financial), createNftSendTool(financial)] : [];
