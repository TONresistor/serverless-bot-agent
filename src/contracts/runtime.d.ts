export type Clock = () => number;
export type AssertActive = () => Promise<void>;
export type Log = (event: string, fields: Record<string, unknown>) => void;
export type DiagnosticContext = {
  phase?: string;
  tool?: string;
  operationId?: string;
  event?: string;
};
export type ReportError = (error: unknown, context?: DiagnosticContext) => void;
export type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  body?: AsyncIterable<Uint8Array>;
};
export type FetchOptions = { method?: string; headers?: Record<string, string>; body?: unknown };
export type Fetcher = (url: string, options?: FetchOptions) => Promise<FetchResponse>;
export type TurnStatus = 'running' | 'completed' | 'partial' | 'cancelled' | 'failed';
export type ChatScope = {
  owner: boolean;
  group: boolean;
  actorId: number;
  destination: number | string;
  sessionId: string;
  surface: 'dm' | 'group' | 'guest' | 'business' | 'task' | 'heartbeat';
  threadId?: number;
  replyTo?: number;
  businessConnectionId?: string;
  guestQueryId?: string;
  assertActive?: AssertActive;
};
export type DeliveryReceipt = {
  message_id?: number;
  message_ids: number[];
  inline_message_id?: string;
  reply_delivered?: boolean;
  content_hash?: string;
};
