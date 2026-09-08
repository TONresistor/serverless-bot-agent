import { Address, beginCell } from '@ton/core';
import { normalizeDomain, dnsRecords } from '../../domain/chain/dns.js';
import { friendlyAddress } from '../../domain/chain/values.js';
import { AgentError } from '../../shared/errors.js';
import { readNftData } from './nfts.js';

export function createDnsReads({ chain, network }) {
  async function resolve(input) {
    const { domain, bytes } = normalizeDomain(input);
    const config = await chain.configParam(4);
    let resolver = new Address(-1, config.beginParse().loadBuffer(32)),
      rest = bytes;
    const visited = new Set();
    for (let depth = 0; depth < 16; depth++) {
      const key = resolver.toRawString() + ':' + rest.toString('hex');
      if (visited.has(key))
        throw new AgentError('dns_cycle', 'The DNS delegation contains a loop.');
      visited.add(key);
      const { stack } = await chain.runGetMethod(resolver.toRawString(), 'dnsresolve', [
        { type: 'slice', cell: beginCell().storeBuffer(rest).endCell() },
        { type: 'int', value: 0n },
      ]);
      const bits = stack.readNumber(),
        data = stack.readCellOpt();
      if (bits < 0 || bits > rest.length * 8 || bits % 8)
        throw new AgentError('dns_invalid', 'The DNS resolver returned an invalid prefix length.');
      if (!data) return { domain, resolver, wallet: null, site: '' };
      if (bits === 0)
        throw new AgentError(
          'dns_invalid',
          'The DNS resolver did not consume any part of the domain.',
        );
      if (bits === rest.length * 8) return { domain, resolver, ...dnsRecords(data) };
      const next = data.beginParse();
      if (next.loadUint(16) !== 0xba93)
        throw new AgentError(
          'dns_invalid',
          'The DNS delegation returned an invalid resolver record.',
        );
      resolver = next.loadAddress();
      rest = rest.subarray(bits / 8);
    }
    throw new AgentError('dns_depth', 'The DNS delegation exceeds the depth limit.');
  }
  const walletResult = (wallet) => ({
    non_bounceable_address: friendlyAddress(wallet, network, false),
    bounceable_address: friendlyAddress(wallet, network),
  });
  return {
    async dnsResolve({ domain }) {
      const result = await resolve(domain);
      return result.wallet
        ? { domain: result.domain, resolved: true, ...walletResult(result.wallet) }
        : {
            domain: result.domain,
            resolved: false,
            note: 'domain resolves but has no linked wallet address',
          };
    },
    async dnsInfo({ domain }) {
      const result = await resolve(domain);
      let nft;
      try {
        nft = await readNftData(chain, result.resolver);
      } catch {
        /* Unregistered domains may have no NFT data. */
      }
      return {
        domain: result.domain,
        owner: nft?.owner
          ? friendlyAddress(nft.owner, network)
          : 'unknown (domain may be unregistered)',
        resolves_to: result.wallet ? walletResult(result.wallet) : null,
        ...(result.site ? { site: result.site } : {}),
        ...(nft?.collection ? { collection: friendlyAddress(nft.collection, network) } : {}),
      };
    },
  };
}
