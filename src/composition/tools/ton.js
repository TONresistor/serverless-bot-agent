import { createGetAddressTool, schema as getAddress } from '../../tools/ton/get-address.js';
import { createGetBalanceTool, schema as getBalance } from '../../tools/ton/get-balance.js';
import { createSendTonTool, schema as sendTon } from '../../tools/ton/send.js';
export const schemas = [getAddress, getBalance, sendTon];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ wallet, transfers }) => [
  createGetAddressTool({ identity: wallet.identity }),
  createGetBalanceTool({ balance: wallet.balance }),
  createSendTonTool(transfers),
];
