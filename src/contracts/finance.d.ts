import type { ChainPort, Network } from './chain.js';
import type { OperationsRepository } from './persistence.js';
import type { Clock, ReportError } from './runtime.js';
import type { ToolResult } from './tools.js';

export type ContractMessage = {
  destination: string;
  amountNano: string;
  bodyBoc: string;
  bounce: boolean;
};
export type ContractPlan<Receipt extends Record<string, unknown> = Record<string, unknown>> = {
  summary: string;
  message: ContractMessage;
  receipt: Receipt;
  details?: Record<string, unknown>;
};
export type TraceMessage = {
  source: string;
  destination: string;
  valueNano: string;
  bodyBoc: string;
  bodyHash: string;
  createdLt: string;
  bounced: boolean;
  initHash?: string;
};
export type TraceNode = {
  address: string;
  hash: string;
  success: boolean;
  in: TraceMessage;
  out: TraceMessage[];
};
export type TraceEvidence = {
  complete: boolean;
  nodes: TraceNode[];
  cursors?: Record<string, unknown>;
  readErrors?: string[];
};
export type Settlement = {
  state: 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  recipientTxHash?: string;
  reason?: string;
  amountOutRaw?: string;
  outputAsset?: string;
  [key: string]: unknown;
};
export type FinancialPlanner<
  Args = Record<string, unknown>,
  Receipt extends Record<string, unknown> = Record<string, unknown>,
> = {
  validate?(args: Args): void;
  plan(args: Args, operationId: string): Promise<ContractPlan<Receipt>>;
  revalidate(plan: ContractPlan<Receipt>): Promise<void>;
  settle?(plan: ContractPlan<Receipt>, evidence: TraceEvidence): Settlement | Promise<Settlement>;
};
export type FinancialPreparation = {
  validate?(tool: string, args: Record<string, unknown>): void;
  prepare(tool: string, args: Record<string, unknown>, operationId: string): Promise<ToolResult>;
};
export type SignedContractMessage = {
  boc: string;
  bodyHash: string;
  seqno: number;
  validUntil: number;
  beforeLt?: string;
};
export type FinanceDependencies = {
  operations: OperationsRepository;
  telegram: {
    sendMessage(args: {
      chat_id: number | string;
      text: string;
      reply_markup?: unknown;
    }): Promise<{ message_id: number }>;
  };
  chain: ChainPort;
  config: { ownerId: number; walletAddress: string; walletPublicKey: string; network: Network };
  planners: Record<string, FinancialPlanner>;
  sign(args: {
    message: ContractMessage;
    seqno: number;
    state: string;
    now: number;
  }): Promise<SignedContractMessage>;
  authorize(tool: string): Promise<void>;
  reconcileLegacy(): Promise<{ state: string } | null>;
  now?: Clock;
  report?: ReportError;
};
