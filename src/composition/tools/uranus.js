import { createUranusInfoTool, schema as info } from '../../tools/uranus/info.js';
import { createUranusBuyTool, schema as buy } from '../../tools/uranus/buy.js';
import { createUranusSellTool, schema as sell } from '../../tools/uranus/sell.js';
import { createUranusDeployTool, schema as deploy } from '../../tools/uranus/deploy.js';
import { createUranusClaimFeesTool, schema as claim } from '../../tools/uranus/claim-fees.js';

export const schemas = [info, buy, sell, deploy, claim];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ uranus, financial }) => [
  ...(uranus ? [createUranusInfoTool(uranus)] : []),
  ...(financial
    ? [
        createUranusBuyTool(financial),
        createUranusSellTool(financial),
        createUranusDeployTool(financial),
        createUranusClaimFeesTool(financial),
      ]
    : []),
];
