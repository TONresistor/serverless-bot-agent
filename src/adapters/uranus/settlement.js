import { Cell } from '@ton/core';
import { chainAddress, formatUnits } from '../../domain/chain/values.js';
import { decodeUranusMessage, URANUS_OP } from '../../domain/uranus/abi.js';

const raw = (value) => {
  try {
    return chainAddress(value, 'mainnet').toRawString();
  } catch {
    return '';
  }
};
const bodyHash = (boc) => {
  try {
    return Cell.fromBase64(boc).hash().toString('hex');
  } catch {
    return '';
  }
};
const incoming = (node, source, destination) =>
  raw(node?.in?.source) === source &&
  raw(node?.address) === destination &&
  raw(node?.in?.destination) === destination &&
  !node.in.bounced;
/** @returns {import('../../contracts/finance.js').Settlement} */
const pending = () => ({
  state: 'submitted',
  note: 'The transaction was submitted; the asset outcome is not yet proven.',
});
/** @returns {import('../../contracts/finance.js').Settlement} */
const failed = (reason) => ({ state: 'failed', note: reason });

/** Consume only the causal transaction graph pinned to this approved outgoing message. */
export function createUranusSettlement(reader) {
  /** @returns {Promise<import('../../contracts/finance.js').Settlement>} */
  return async function settle(plan, evidence) {
    const receipt = plan.receipt;
    if (!Array.isArray(evidence?.nodes)) return pending();
    const nodes = evidence.nodes;
    const root = nodes.find(
      (node) =>
        incoming(node, receipt.owner, plan.message.destination) &&
        bodyHash(node.in.bodyBoc) === bodyHash(plan.message.bodyBoc),
    );
    if (!root) return pending();
    if (root.success === false) return failed('The approved Uranus contract call failed on-chain.');
    if (root.success !== true) return pending();
    if (receipt.kind === 'uranus_buy') {
      for (const node of nodes) {
        if (!incoming(node, receipt.meme, receipt.jettonWallet)) continue;
        const message = decodeUranusMessage(node.in.bodyBoc);
        if (
          !message ||
          message.opcode !== URANUS_OP.receive ||
          message.queryId !== receipt.queryId ||
          BigInt(message.amount) <= 0n
        )
          continue;
        if (node.success === false) return failed('The Uranus token credit failed on-chain.');
        if (node.success !== true) continue;
        if (BigInt(message.amount) < BigInt(receipt.minOut))
          return failed('The on-chain token credit is below the approved minimum.');
        const holding = await reader.holding(receipt.meme, receipt.jettonWallet);
        if (!holding.deployed) return pending();
        return {
          state: 'confirmed',
          action: 'buy',
          meme: receipt.meme,
          filled: true,
          received_tokens: formatUnits(message.amount, receipt.decimals),
          received_raw: message.amount,
          asset_transaction_hash: node.hash,
        };
      }
    } else if (['uranus_sell', 'uranus_claim_fees'].includes(receipt.kind)) {
      if (receipt.kind === 'uranus_sell') {
        const memeCall = nodes.find((node) => {
          const message = decodeUranusMessage(node.in?.bodyBoc);
          return (
            incoming(node, receipt.jettonWallet, receipt.meme) &&
            message?.opcode === URANUS_OP.sellToMeme &&
            message.queryId === receipt.queryId &&
            message.amount === receipt.amount &&
            message.minOut === receipt.minOut &&
            message.from === receipt.owner
          );
        });
        if (!memeCall) return pending();
        if (memeCall.success === false) return failed('The bonding curve rejected the sell.');
        if (memeCall.success !== true) return pending();
      }
      for (const node of nodes) {
        if (!incoming(node, receipt.meme, receipt.owner)) continue;
        const message = decodeUranusMessage(node.in.bodyBoc);
        if (
          !message ||
          message.opcode !== URANUS_OP.payout ||
          message.queryId !== receipt.queryId ||
          !/^\d+$/.test(node.in.valueNano || '') ||
          BigInt(node.in.valueNano) <= 0n
        )
          continue;
        if (node.success === false) return failed('The Uranus TON payout failed on-chain.');
        if (node.success !== true) continue;
        if (receipt.kind === 'uranus_sell' && BigInt(node.in.valueNano) < BigInt(receipt.minOut))
          return failed('The TON payout is below the approved minimum.');
        return {
          state: 'confirmed',
          action: receipt.kind === 'uranus_sell' ? 'sell' : 'claim_fees',
          meme: receipt.meme,
          ...(receipt.kind === 'uranus_sell'
            ? { filled: true, sold_tokens_confirmed: formatUnits(receipt.amount, receipt.decimals) }
            : {}),
          received_ton: formatUnits(node.in.valueNano),
          asset_transaction_hash: node.hash,
        };
      }
    } else if (receipt.kind === 'uranus_deploy') {
      for (const output of root.out || []) {
        if (!output.initHash || raw(output.source) !== plan.message.destination) continue;
        const child = raw(output.destination);
        const init = decodeUranusMessage(output.bodyBoc);
        if (
          !child ||
          output.initHash !== child.split(':')[1] ||
          !/^\d+$/.test(String(output.createdLt)) ||
          !init ||
          init.opcode !== URANUS_OP.init ||
          init.queryId !== receipt.queryId ||
          init.amount !== receipt.initialBuy
        )
          continue;
        const node = nodes.find(
          (candidate) =>
            incoming(candidate, plan.message.destination, child) &&
            bodyHash(candidate.in.bodyBoc) === bodyHash(output.bodyBoc) &&
            String(candidate.in.createdLt) === String(output.createdLt),
        );
        if (!node) continue;
        if (node.success === false) return failed('The new Uranus token failed to initialize.');
        if (node.success !== true) continue;
        const data = await reader.data(child),
          metadataUri = await reader.metadataUri(child);
        if (
          !data.initialized ||
          data.creator !== receipt.owner ||
          metadataUri !== receipt.metadataUri
        )
          return failed('The deployed token does not match the approved creator and metadata.');
        if (BigInt(receipt.initialBuy) > 0n) {
          const wallet = await reader.wallet(child);
          const credit = nodes.find((candidate) => {
            const message = decodeUranusMessage(candidate.in?.bodyBoc);
            return (
              incoming(candidate, child, wallet) &&
              candidate.success === true &&
              message?.opcode === URANUS_OP.receive &&
              message.queryId === receipt.queryId &&
              BigInt(message.amount) > 0n
            );
          });
          if (!credit)
            return {
              ...pending(),
              deployed_meme: child,
              note: 'Token deployment is proven; the initial buy token credit is still unconfirmed.',
            };
          await reader.holding(child, wallet);
        }
        return {
          state: 'confirmed',
          action: 'deploy',
          meme: child,
          preset_id: receipt.presetId,
          metadata_uri: receipt.metadataUri,
          asset_transaction_hash: node.hash,
        };
      }
    }
    return pending();
  };
}
