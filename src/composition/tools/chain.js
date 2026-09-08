import { createTxHistoryTool, schema as history } from '../../tools/ton/tx-history.js';
import { createAddressInfoTool, schema as address } from '../../tools/ton/address-info.js';
import { createDnsResolveTool, schema as dns } from '../../tools/ton/dns-resolve.js';
import { createDnsInfoTool, schema as dnsInfo } from '../../tools/ton/dns-info.js';
import { createJettonInfoTool, schema as jetton } from '../../tools/jetton/info.js';
import { createJettonBalanceTool, schema as balance } from '../../tools/jetton/balance.js';
import { createNftInfoTool, schema as nft } from '../../tools/nft/info.js';
import {
  createNftCollectionInfoTool,
  schema as collection,
} from '../../tools/nft/collection-info.js';
export const schemas = [history, address, dns, dnsInfo, jetton, balance, nft, collection];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ chainReads }) =>
  chainReads
    ? [
        createTxHistoryTool(chainReads),
        createAddressInfoTool(chainReads),
        createDnsResolveTool(chainReads),
        createDnsInfoTool(chainReads),
        createJettonInfoTool(chainReads),
        createJettonBalanceTool(chainReads),
        createNftInfoTool(chainReads),
        createNftCollectionInfoTool(chainReads),
      ]
    : [];
