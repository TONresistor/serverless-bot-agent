import * as chain from './tools/chain.js';
import * as market from './tools/market.js';
import * as media from './tools/media.js';
import * as assets from './tools/assets.js';
import * as uranus from './tools/uranus.js';
import * as swaps from './tools/swaps.js';
import * as web from './tools/web.js';
import * as workspace from './tools/workspace.js';
import { createToolRegistry } from '../tools/registry.js';
import * as memory from './tools/memory.js';
import * as telegram from './tools/telegram.js';
import * as ton from './tools/ton.js';

const families = [
  memory,
  telegram,
  ton,
  workspace,
  web,
  chain,
  market,
  media,
  assets,
  uranus,
  swaps,
];
export const BUILTIN_SCHEMAS = Object.freeze(
  families
    .flatMap((family) => family.schemas)
    .sort((a, b) => a.function.name.localeCompare(b.function.name)),
);
/** @returns {Promise<never>} */
async function unavailable() {
  throw new Error('Telegram capability unavailable');
}
/** @param {import('../contracts/capabilities.js').BuiltinPorts} ports */
export function createBuiltinRegistry(ports) {
  const bound = {
    workspace: { list: unavailable, read: unavailable, write: unavailable, validate: () => {} },
    admin: { call: unavailable },
    business: { call: unavailable },
    gifts: { call: unavailable },
    payments: { request: unavailable },
    ...ports,
  };
  return createToolRegistry(
    families
      .flatMap((family) => family.createTools(bound))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}
