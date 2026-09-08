import { beginCell } from '@ton/core';
import {
  chainAddress,
  friendlyAddress,
  formatUnits,
  nonnegative,
} from '../../domain/chain/values.js';
import { AgentError } from '../../shared/errors.js';

/** @param {import('../../contracts/chain.js').ChainOptions} options */
export function createJettonReads({ chain, walletAddress, network }) {
  return {
    async jettonInfo({ address, decimals = 9 }) {
      const master = chainAddress(address, network);
      const { stack } = await chain.runGetMethod(master.toRawString(), 'get_jetton_data');
      const supply = nonnegative(stack.readBigNumber());
      const mintable = stack.readBoolean();
      const admin = stack.readAddressOpt();
      // Require the complete standard tuple, not a convenient partial response.
      stack.readCell();
      stack.readCell();
      return {
        address: address.trim(),
        total_supply_raw: supply.toString(),
        total_supply: formatUnits(supply, decimals),
        mintable,
        admin_address: admin ? friendlyAddress(admin, network) : '',
        immutable: !admin,
      };
    },
    async jettonBalance({ address, decimals = 9 }) {
      const master = chainAddress(address, network),
        owner = chainAddress(walletAddress, network);
      const resolved = await chain.runGetMethod(master.toRawString(), 'get_wallet_address', [
        { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
      ]);
      const wallet = resolved.stack.readAddress();
      const state = await chain.account(wallet.toRawString());
      let balance;
      if (state.state === 'uninitialized') balance = 0n;
      else if (state.state === 'active') {
        const { stack } = await chain.runGetMethod(wallet.toRawString(), 'get_wallet_data');
        balance = nonnegative(stack.readBigNumber());
        const actualOwner = stack.readAddress(),
          actualMaster = stack.readAddress();
        stack.readCell();
        if (!owner.equals(actualOwner) || !master.equals(actualMaster))
          throw new AgentError(
            'jetton_identity',
            'The jetton wallet does not match its owner and master.',
          );
      } else
        throw new AgentError('jetton_unavailable', 'The jetton wallet is frozen or unavailable.');
      return {
        address: address.trim(),
        jetton_wallet: friendlyAddress(wallet, network),
        balance_raw: balance.toString(),
        balance: formatUnits(balance, decimals),
      };
    },
  };
}
