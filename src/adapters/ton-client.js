import { encodeStack, decodeStack } from '../domain/ton/stack.js';
import { Cell } from '@ton/core';
import { walletContract } from '../domain/wallet.js';
import { AgentError } from '../shared/errors.js';
import { requestJSON } from './http.js';

export const RPC_URLS = {
  testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
  mainnet: 'https://toncenter.com/api/v2/jsonRPC',
};

/** @param {import('../contracts/runtime.js').Fetcher} fetcher
 * @param {import('../contracts/chain.js').Network} network
 * @param {string} [apiKey]
 * @returns {import('../contracts/chain.js').ChainPort} */
export function createTonClient(fetcher, network, apiKey = '') {
  const endpoint = RPC_URLS[network];
  if (!endpoint) throw new AgentError('wallet_config', 'Invalid TON network.');
  async function rpc(method, params) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    const data = await requestJSON(fetcher, endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 'agent', method, params }),
    });
    if (data.ok === false || data.error || data.result == null)
      throw new AgentError('ton_rpc', 'The TON network did not return a usable result.');
    return data.result;
  }
  async function account(address) {
    const result = await rpc('getAddressInformation', { address });
    if (
      typeof result.balance !== 'string' ||
      !/^\d+$/.test(result.balance) ||
      !['active', 'uninitialized', 'frozen'].includes(result.state)
    )
      throw new AgentError('ton_rpc', 'Invalid TON account state.');
    return result;
  }
  return {
    account,
    async runGetMethod(address, method, args = []) {
      const result = await rpc('runGetMethod', { address, method, stack: encodeStack(args) });
      if (![0, 1].includes(result.exit_code))
        throw new AgentError(
          'ton_getter_failed',
          `Contract getter failed (exit ${result.exit_code}).`,
        );
      return {
        stack: decodeStack(result.stack),
        gasUsed: result.gas_used,
        blockId: result.block_id,
      };
    },
    async configParam(id) {
      if (!Number.isInteger(id) || id < 0)
        throw new AgentError('ton_config', 'Invalid chain configuration parameter.');
      const result = await rpc('getConfigParam', { config_id: id });
      try {
        return Cell.fromBase64(result.config?.bytes || result.bytes);
      } catch {
        throw new AgentError('ton_config', 'Invalid chain configuration response.');
      }
    },
    async indexed(path, params = {}) {
      if (
        ![
          '/nft/items',
          '/nft/collections',
          '/traces',
          '/actions',
          '/jetton/wallets',
          '/messages',
        ].includes(path)
      )
        throw new AgentError('ton_index', 'Unsupported indexed query.');
      const query = Object.entries(params)
        .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
        .join('&');
      return requestJSON(
        fetcher,
        `https://${network === 'testnet' ? 'testnet.' : ''}toncenter.com/api/v3${path}?${query}`,
        { headers: apiKey ? { 'X-API-Key': apiKey } : {} },
        2097152,
      );
    },
    async state(address) {
      const result = await account(address);
      return { balance: result.balance, state: result.state };
    },
    async walletState(address, publicKey) {
      const result = await account(address);
      let seqno = 0;
      if (result.state === 'active') {
        const expected = walletContract(publicKey, network);
        const code = Cell.fromBase64(result.code);
        if (!code.hash().equals(expected.init.code.hash()))
          throw new AgentError('wallet_code', 'The wallet contract has changed.');
        const data = Cell.fromBase64(result.data).beginParse();
        if (!data.loadBit())
          throw new AgentError('wallet_signature_disabled', 'Wallet signing is disabled.');
        seqno = data.loadUint(32);
        const walletId = data.loadUint(32);
        const expectedData = expected.init.data.beginParse();
        expectedData.skip(33);
        if (
          walletId !== expectedData.loadUint(32) ||
          data.loadBuffer(32).toString('hex') !== publicKey
        )
          throw new AgentError('wallet_identity', 'Wallet identity mismatch.');
      } else if (result.state !== 'uninitialized')
        throw new AgentError('wallet_frozen', 'The wallet cannot send in this state.');
      return {
        balance: result.balance,
        state: result.state,
        seqno,
        chainTime: result.sync_utime,
        lastTransaction: result.last_transaction_id,
      };
    },
    async seqno(address, state) {
      if (state === 'uninitialized') return 0;
      if (state !== 'active')
        throw new AgentError('wallet_frozen', 'The wallet cannot send transactions in this state.');
      const result = await rpc('runGetMethod', { address, method: 'seqno', stack: [] });
      const value = result.stack?.[0];
      if (![0, 1].includes(result.exit_code) || value?.[0] !== 'num')
        throw new AgentError('ton_rpc', 'Unable to read the wallet sequence number.');
      const n = Number(BigInt(value[1]));
      if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff)
        throw new AgentError('ton_rpc', 'Invalid wallet sequence number.');
      return n;
    },
    async broadcast(boc) {
      await rpc('sendBoc', { boc });
    },
    async transactions(address, cursor = null) {
      const result = await rpc('getTransactions', {
        address,
        limit: 100,
        archival: true,
        ...(cursor ? { lt: cursor.lt, hash: cursor.hash } : {}),
      });
      if (!Array.isArray(result))
        throw new AgentError('ton_rpc', 'Invalid TON transaction history.');
      return result;
    },
  };
}
