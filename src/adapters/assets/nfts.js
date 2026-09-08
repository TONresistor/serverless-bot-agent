import { chainAddress, friendlyAddress } from '../../domain/chain/values.js';
import { assetQueryId, nftTransferBody } from '../../domain/assets/transfers.js';
import { matchingOrigin, sameAddress } from '../../domain/assets/evidence.js';
import { readNftData } from '../chain/nfts.js';
import { AgentError } from '../../shared/errors.js';

/** @param {import('../../contracts/chain.js').ChainOptions} options */
export function createNftSendPlanner({ chain, walletAddress, network }) {
  const wallet = chainAddress(walletAddress, network);
  function validate(args) {
    chainAddress(args.nft_address, network);
    chainAddress(args.to, network);
  }
  async function owned(item) {
    const data = await readNftData(chain, item);
    if (!data.initialized || !data.owner?.equals(wallet))
      throw new AgentError('nft_not_owned', 'The agent wallet does not own this initialized NFT.');
  }
  return {
    validate,
    async plan(args, operationId) {
      validate(args);
      const item = chainAddress(args.nft_address, network),
        recipient = chainAddress(args.to, network),
        queryId = assetQueryId(operationId);
      await owned(item);
      const body = nftTransferBody({ queryId, recipient, responseTo: wallet });
      return {
        summary: `NFT transfer — ${network.toUpperCase()}\n\nNFT: ${friendlyAddress(item, network)}\nRecipient: ${friendlyAddress(recipient, network, false)}\nAttached gas: 0.05 TON; unused gas returns to this wallet.`,
        message: {
          destination: item.toRawString(),
          amountNano: '50000000',
          bodyBoc: body.toBoc({ idx: false }).toString('base64'),
          bounce: true,
        },
        receipt: {
          kind: 'nft_send',
          wallet: wallet.toRawString(),
          nftAddress: item.toRawString(),
          recipientOwner: recipient.toRawString(),
          queryId: queryId.toString(),
        },
        details: { network },
      };
    },
    async revalidate(plan) {
      if (!sameAddress(plan.receipt.wallet, wallet.toRawString()))
        throw new AgentError('nft_identity', 'The signing wallet changed. Request a new transfer.');
      await owned(chainAddress(plan.receipt.nftAddress, network));
    },
    /** @returns {Promise<import('../../contracts/finance.js').Settlement>} */
    async settle(plan, evidence) {
      const origin = matchingOrigin(plan, evidence);
      if (!origin) return { state: 'submitted' };
      if (origin.success === false)
        return { state: 'failed', txHash: origin.hash, reason: 'nft_rejected_transfer' };
      if (origin.success !== true) return { state: 'submitted' };
      const current = await readNftData(chain, chainAddress(plan.receipt.nftAddress, network));
      return current.initialized &&
        current.owner &&
        sameAddress(current.owner.toRawString(), plan.receipt.recipientOwner)
        ? { state: 'confirmed', txHash: origin.hash, recipientOwner: plan.receipt.recipientOwner }
        : { state: 'submitted' };
    },
  };
}
