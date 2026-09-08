import { beginCell } from '@ton/core';
import { AgentError } from '../../shared/errors.js';
import {
  chainAddress,
  formatUnits,
  friendlyAddress,
  nonnegative,
} from '../../domain/chain/values.js';
import { ratioPercent } from '../../domain/market/decimal.js';

const malformed = () =>
  new AgentError('uranus_state', 'The contract returned an invalid Uranus state.');
const boolean = (reader) => {
  const value = reader.readBigNumber();
  if (![0n, -1n, 1n].includes(value)) throw malformed();
  return value !== 0n;
};

export function createUranusReader({ chain, walletAddress, network }) {
  const owner = chainAddress(walletAddress, network);
  const address = (value) => {
    const result = chainAddress(value, network);
    if (result.workChain !== 0)
      throw new AgentError('uranus_workchain', 'Uranus supports basechain addresses only.');
    return result;
  };
  async function data(input) {
    const meme = address(input);
    const [md, bc] = await Promise.all([
      chain.runGetMethod(meme.toRawString(), 'get_meme_data'),
      chain.runGetMethod(meme.toRawString(), 'get_bonding_curve_data'),
    ]);
    try {
      const m = md.stack,
        b = bc.stack;
      const initialized = boolean(m),
        migrated = boolean(m);
      const controller = m.readAddressOpt(),
        creator = m.readAddressOpt();
      const creatorFee = nonnegative(m.readBigNumber());
      const seed = nonnegative(m.readBigNumber());
      const graduated = boolean(m);
      nonnegative(m.readBigNumber());
      nonnegative(m.readBigNumber());
      nonnegative(m.readBigNumber());
      const tradeFee = nonnegative(m.readBigNumber()),
        raised = nonnegative(m.readBigNumber()),
        supply = nonnegative(m.readBigNumber());
      const curveGraduated = boolean(b),
        maxSupply = nonnegative(b.readBigNumber());
      nonnegative(b.readBigNumber());
      nonnegative(b.readBigNumber());
      nonnegative(b.readBigNumber());
      const target = nonnegative(b.readBigNumber()),
        migrationFee = nonnegative(b.readBigNumber());
      nonnegative(b.readBigNumber());
      nonnegative(b.readBigNumber());
      nonnegative(b.readBigNumber());
      if (m.remaining || b.remaining || seed >= 1n << 128n || tradeFee > 10000n || target === 0n)
        throw malformed();
      return {
        meme: meme.toRawString(),
        creator: creator?.toRawString() || '',
        controller: controller?.toRawString() || '',
        initialized,
        migrated,
        graduated: graduated || curveGraduated,
        creatorFeeNano: creatorFee.toString(),
        raisedNano: raised.toString(),
        targetNano: target.toString(),
        migrationFeeNano: migrationFee.toString(),
        tradeFeeBps: tradeFee.toString(),
        currentSupply: supply.toString(),
        maxSupply: maxSupply.toString(),
      };
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw malformed();
    }
  }
  async function wallet(input) {
    const meme = address(input);
    const result = await chain.runGetMethod(meme.toRawString(), 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
    ]);
    try {
      const resolved = result.stack.readAddress();
      if (result.stack.remaining || resolved.workChain !== 0) throw malformed();
      return resolved.toRawString();
    } catch {
      throw malformed();
    }
  }
  async function holding(input, expectedWallet = '') {
    const meme = address(input).toRawString(),
      resolved = await wallet(meme);
    if (expectedWallet && resolved !== expectedWallet)
      throw new AgentError(
        'uranus_wallet_changed',
        'The token wallet address changed after approval.',
      );
    const state = await chain.state(resolved);
    if (state.state === 'uninitialized')
      return { address: resolved, balance: '0', deployed: false };
    if (state.state !== 'active')
      throw new AgentError('uranus_wallet_state', 'The token wallet is unavailable.');
    const result = await chain.runGetMethod(resolved, 'get_wallet_data');
    try {
      const balance = nonnegative(result.stack.readBigNumber());
      const actualOwner = result.stack.readAddress(),
        master = result.stack.readAddress();
      result.stack.readCell();
      if (!actualOwner.equals(owner) || master.toRawString() !== meme || result.stack.remaining)
        throw malformed();
      return { address: resolved, balance: balance.toString(), deployed: true };
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw malformed();
    }
  }
  async function metadataUri(input) {
    const result = await chain.runGetMethod(address(input).toRawString(), 'get_jetton_data');
    try {
      result.stack.skip(3);
      const content = result.stack.readCell().beginParse();
      if (content.loadUint(8) !== 1) return null;
      return content.loadStringTail();
    } catch {
      throw malformed();
    }
  }
  return { address, data, wallet, holding, metadataUri };
}

export function presentUranus(data, network) {
  return {
    meme: friendlyAddress(chainAddress(data.meme, network), network),
    initialized: data.initialized,
    graduated: data.graduated || data.migrated,
    migrated: data.migrated,
    trade_fee_pct: formatUnits(data.tradeFeeBps, 2),
    creator_fee_claimable_ton: formatUnits(data.creatorFeeNano),
    raised_ton: formatUnits(data.raisedNano),
    target_ton: formatUnits(data.targetNano),
    progress_pct: ratioPercent(data.raisedNano, data.targetNano),
    migration_fee_ton: formatUnits(data.migrationFeeNano),
    current_supply: formatUnits(data.currentSupply),
    max_supply: formatUnits(data.maxSupply),
  };
}
