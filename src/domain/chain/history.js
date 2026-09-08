import { Cell, loadTransaction } from '@ton/core';
import { friendlyAddress, formatUnits } from './values.js';
import { snakeBytes } from './metadata.js';
import { AgentError } from '../../shared/errors.js';

function comment(body) {
  try {
    const slice = body.beginParse();
    return slice.remainingBits >= 32 && slice.loadUint(32) === 0
      ? snakeBytes(slice.asCell(), false, 4096).toString('utf8')
      : '';
  } catch {
    return '';
  }
}

export function decodeHistory(rows, wallet, network, limit) {
  const parsed = rows
    .map((raw) => {
      try {
        const tx = loadTransaction(Cell.fromBase64(raw.data).beginParse());
        if (tx.address !== BigInt('0x' + wallet.hash.toString('hex'))) throw new Error();
        return tx;
      } catch {
        throw new AgentError(
          'invalid_chain_response',
          'The provider returned invalid transaction data.',
        );
      }
    })
    .sort((a, b) => (a.lt > b.lt ? -1 : a.lt < b.lt ? 1 : 0))
    .slice(0, limit);
  const transactions = parsed.map((tx) => {
    let incoming = 0n,
      outgoing = 0n,
      counterparty = '',
      text = '';
    if (tx.inMessage?.info.type === 'internal') {
      incoming = tx.inMessage.info.value.coins;
      counterparty = friendlyAddress(tx.inMessage.info.src, network);
      text = comment(tx.inMessage.body);
    }
    for (const message of tx.outMessages.values()) {
      if (message.info.type !== 'internal') continue;
      outgoing += message.info.value.coins;
      counterparty = friendlyAddress(message.info.dest, network);
      if (!text) text = comment(message.body);
    }
    return {
      direction: outgoing > 0n ? 'out' : incoming > 0n ? 'in' : 'other',
      counterparty,
      value_ton: formatUnits(outgoing > 0n ? outgoing : incoming),
      comment: text,
      time: tx.now,
      // LT is a uint64; a decimal string preserves values above JS safe integers.
      lt: tx.lt.toString(),
      hash: tx.hash().toString('hex'),
    };
  });
  return { count: transactions.length, transactions };
}
