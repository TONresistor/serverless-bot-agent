import type { Cell, TupleItem, TupleReader } from '@ton/core';
import type { Fetcher } from './runtime.js';

export type Network = 'mainnet' | 'testnet';
export type AccountState = 'active' | 'uninitialized' | 'frozen';
export type TransactionCursor = { lt: string; hash: string };
export type RawTransaction = { data: string; transaction_id?: TransactionCursor; utime?: number };
export type AccountSnapshot = {
  balance: string;
  state: AccountState;
  code?: string;
  data?: string;
  sync_utime?: number;
  last_transaction_id?: TransactionCursor;
};
export type WalletSnapshot = {
  balance: string;
  state: AccountState;
  seqno: number;
  chainTime?: number;
  lastTransaction?: TransactionCursor;
};
export type ChainReadPort = {
  account(address: string): Promise<AccountSnapshot>;
  state(address: string): Promise<Pick<AccountSnapshot, 'balance' | 'state'>>;
  runGetMethod(
    address: string,
    method: string,
    args?: TupleItem[],
  ): Promise<{ stack: TupleReader; gasUsed?: number; blockId?: unknown }>;
  configParam(id: number): Promise<Cell>;
  // Indexed JSON has provider-specific shapes and is validated by its adapter.
  indexed(path: string, params?: Record<string, string | number | boolean>): Promise<unknown>;
  transactions(address: string, cursor?: TransactionCursor | null): Promise<RawTransaction[]>;
};
export type ChainPort = ChainReadPort & {
  walletState(address: string, publicKey: string): Promise<WalletSnapshot>;
  seqno(address: string, state: AccountState): Promise<number>;
  broadcast(boc: string): Promise<void>;
};
export type ChainOptions = { chain: ChainReadPort; walletAddress: string; network: Network };
export type SwapOptions = ChainOptions & { fetcher: Fetcher; now?: () => number };
