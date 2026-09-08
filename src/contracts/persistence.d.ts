import type { Clock } from './runtime.js';

// SQLite/JSON decoding is the dynamic storage boundary. Consumers should narrow
// operation data by kind before using it; generic T describes each stored payload.
export type OperationRecord<T = any> = {
  id: string;
  kind: string;
  state: string;
  data: T;
  data_json: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
};
export type Database = {
  get<Row = Record<string, any>>(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<Row | null>;
  all<Row = Record<string, any>>(query: string, params?: Record<string, unknown>): Promise<Row[]>;
  run(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<{ rowsAffected: number; rows: unknown[] }>;
};
export type OperationsRepository = {
  operation(id: string): Promise<OperationRecord | null>;
  claim(
    id: string,
    kind: string,
    state?: string,
    data?: unknown,
    expiresAt?: number,
  ): Promise<boolean>;
  transition(id: string, from: string[], state: string, data: unknown): Promise<boolean>;
  transitionFromSnapshot(snapshot: OperationRecord, state: string, data: unknown): Promise<boolean>;
  acquireWallet(operationId: string): Promise<boolean>;
  releaseWallet(operationId: string): Promise<void>;
  prepareBroadcast(id: string, data: unknown): Promise<boolean>;
  recentContractActions(): Promise<OperationRecord[]>;
  recentTransfers(): Promise<OperationRecord[]>;
  pendingDrafts(): Promise<OperationRecord[]>;
  consumeButton(id: string, cardId: string): Promise<boolean>;
  allowReply(
    chatId: string | number,
    actorId: string | number,
    eventId: string,
    limit: number,
  ): Promise<boolean>;
};
export type HistoryTurn = { id: string; messages: Array<Record<string, any>> };
export type ConversationsRepository = {
  acquireChat(chatId: string | number, token: string, durationMs?: number): Promise<boolean>;
  assertChat(chatId: string | number, token: string): Promise<void>;
  releaseChat(chatId: string | number, token: string): Promise<void>;
  history(chatId: string | number): Promise<HistoryTurn[]>;
  saveHistory(chatId: string | number, token: string, history: HistoryTurn[]): Promise<void>;
};
export type RepositoryFactory<T> = (db: Database, now: Clock) => T;
