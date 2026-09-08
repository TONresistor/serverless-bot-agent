import { Address, beginCell } from '@ton/core';
import { rejectDedust } from '../../../domain/swaps/dedust/contracts.js';

export const rawAddress = (value) => Address.parse(value).toRawString();
export const getterProvider = (chain, address) =>
  /** @type {import('@ton/core').ContractProvider} */ ({
    get: (method, args) => chain.runGetMethod(rawAddress(address), method, args),
  });

export async function jettonWallet(chain, master, owner) {
  const { stack } = await chain.runGetMethod(master, 'get_wallet_address', [
    { type: 'slice', cell: beginCell().storeAddress(Address.parse(owner)).endCell() },
  ]);
  return stack.readAddress().toRawString();
}
export async function verifyJettonWallet(chain, wallet, master, owner) {
  const { stack } = await chain.runGetMethod(wallet, 'get_wallet_data');
  const balance = stack.readBigNumber(),
    actualOwner = stack.readAddress(),
    actualMaster = stack.readAddress();
  stack.readCell();
  if (balance < 0n || actualOwner.toRawString() !== owner || actualMaster.toRawString() !== master)
    rejectDedust('The jetton wallet does not match the expected owner and token.');
  return balance;
}
export async function ownerWallets(chain, parsed, owner) {
  return {
    inputWallet:
      parsed.source.address === 'TON'
        ? owner
        : await jettonWallet(chain, parsed.source.address, owner),
    outputWallet:
      parsed.output.address === 'TON'
        ? owner
        : await jettonWallet(chain, parsed.output.address, owner),
  };
}
