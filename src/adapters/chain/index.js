import { Cell } from '@ton/core';
import { chainAddress, friendlyAddress, formatUnits } from '../../domain/chain/values.js';
import { decodeHistory } from '../../domain/chain/history.js';
import { createJettonReads } from './jettons.js';
import { createNftReads } from './nfts.js';
import { createDnsReads } from './dns.js';

/** @param {import('../../contracts/chain.js').ChainOptions} options */
export function createChainCapabilities({ chain, walletAddress, network }) {
  return Object.freeze({
    ...createJettonReads({ chain, walletAddress, network }),
    ...createNftReads({ chain, network }),
    ...createDnsReads({ chain, network }),
    async txHistory({ limit = 10 } = {}) {
      const wallet = chainAddress(walletAddress, network);
      return decodeHistory(await chain.transactions(wallet.toRawString()), wallet, network, limit);
    },
    async addressInfo({ address }) {
      const accountAddress = chainAddress(address, network),
        account = await chain.account(accountAddress.toRawString());
      let hasCode = false;
      if (account.code) {
        const code = Cell.fromBase64(account.code);
        hasCode = code.bits.length > 0 || code.refs.length > 0;
      }
      return {
        non_bounceable_address: friendlyAddress(accountAddress, network, false),
        bounceable_address: friendlyAddress(accountAddress, network),
        balance_ton: formatUnits(account.balance),
        balance_nano: account.balance,
        status: account.state === 'uninitialized' ? 'uninit' : account.state,
        is_active: account.state === 'active',
        is_contract: hasCode,
      };
    },
  });
}
