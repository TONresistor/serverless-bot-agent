import { createJettonSendPlanner } from './jettons.js';
import { createNftSendPlanner } from './nfts.js';

/** @param {import('../../contracts/chain.js').ChainOptions} options */
export function createAssetPlanners({ chain, walletAddress, network }) {
  return Object.freeze({
    jetton_send: createJettonSendPlanner({ chain, walletAddress, network }),
    nft_send: createNftSendPlanner({ chain, walletAddress, network }),
  });
}
