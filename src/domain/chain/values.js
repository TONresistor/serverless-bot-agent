import { Address } from '@ton/core';
import { AgentError } from '../../shared/errors.js';

export function chainAddress(value, network) {
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error();
    const input = value.trim();
    if (
      Address.isFriendly(input) &&
      network === 'mainnet' &&
      Address.parseFriendly(input).isTestOnly
    )
      throw new Error();
    return Address.parse(input);
  } catch {
    throw new AgentError('invalid_address', 'Invalid TON address for this network.');
  }
}

export const friendlyAddress = (address, network, bounceable = true) =>
  address.toString({ bounceable, testOnly: network === 'testnet' });

export function formatUnits(value, decimals = 9) {
  if (
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 30 ||
    !/^\d+$/.test(String(value))
  )
    throw new AgentError('invalid_chain_value', 'Invalid token amount or decimals.');
  const text = BigInt(value)
    .toString()
    .padStart(decimals + 1, '0');
  if (!decimals) return text;
  const fraction = text.slice(-decimals).replace(/0+$/, '');
  return text.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}

export function nonnegative(value) {
  if (typeof value !== 'bigint' || value < 0n)
    throw new AgentError('invalid_chain_value', 'The contract returned an invalid unsigned value.');
  return value;
}
