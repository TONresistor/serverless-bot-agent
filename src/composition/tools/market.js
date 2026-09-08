import { createTokenSearchTool, schema as tokenSearch } from '../../tools/ton/token-search.js';
import { createTonPriceTool, schema as tonPrice } from '../../tools/ton/price.js';
import { createJettonPriceTool, schema as jettonPrice } from '../../tools/jetton/price.js';
import { createJettonPortfolioTool, schema as portfolio } from '../../tools/jetton/portfolio.js';
import {
  createUranusTokenSearchTool,
  schema as uranusSearch,
} from '../../tools/uranus/token-search.js';
import {
  createUranusMyTokensTool,
  schema as uranusHoldings,
} from '../../tools/uranus/my-tokens.js';
import { createTokenMarketTool, schema as tokenMarket } from '../../tools/market/token-market.js';

export const schemas = [
  tokenSearch,
  tonPrice,
  jettonPrice,
  portfolio,
  uranusSearch,
  uranusHoldings,
  tokenMarket,
];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ market }) =>
  market
    ? [
        createTokenSearchTool(market),
        createTonPriceTool(market),
        createJettonPriceTool(market),
        createJettonPortfolioTool(market),
        createUranusTokenSearchTool(market),
        createUranusMyTokensTool(market),
        createTokenMarketTool(market),
      ]
    : [];
