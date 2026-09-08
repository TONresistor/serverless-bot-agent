import { Buffer } from 'buffer';
import { Dictionary } from '@ton/core';
import { digest } from '../../shared/hash.js';
import { AgentError } from '../../shared/errors.js';

export function normalizeDomain(input) {
  if (typeof input !== 'string')
    throw new AgentError('invalid_domain', 'A .ton domain is required.');
  let domain = input.trim().toLowerCase().replace(/\.$/, '');
  if (domain && !domain.includes('.')) domain += '.ton';
  const labels = domain.split('.');
  if (
    !domain.endsWith('.ton') ||
    labels.some((label) => !/^[a-z0-9_-]{1,63}$/.test(label)) ||
    Buffer.byteLength(domain) + 1 > 127
  )
    throw new AgentError(
      'invalid_domain',
      'Use a valid .ton domain of at most 126 ASCII characters.',
    );
  return { domain, bytes: Buffer.from(labels.reverse().join('\0') + '\0', 'utf8') };
}

export function dnsRecords(cell) {
  if (!cell) return { wallet: null, site: '' };
  const records = Dictionary.loadDirect(
    Dictionary.Keys.BigUint(256),
    Dictionary.Values.Cell(),
    cell,
  );
  const walletRecord = records.get(BigInt('0x' + digest('wallet')));
  const siteRecord = records.get(BigInt('0x' + digest('site')));
  let wallet = null,
    site = '';
  if (walletRecord) {
    const slice = walletRecord.beginParse();
    if (slice.loadUint(16) === 0x9fd3) wallet = slice.loadMaybeAddress();
  }
  if (siteRecord) {
    const slice = siteRecord.beginParse();
    const category = slice.loadUint(16);
    if (category === 0xad01 || category === 0x7473)
      site =
        (category === 0xad01 ? 'adnl:' : 'ton-storage:') + slice.loadBuffer(32).toString('hex');
  }
  return { wallet, site };
}
