import type { FinancialPreparation } from './finance.js';
import type { ToolResult, Invocation } from './tools.js';

export type AssetInput = { address: string; decimals?: number };
export type SwapInput = {
  dex?: 'stonfi' | 'dedust';
  pool_address?: string;
  from?: string;
  to: string;
  amount: string;
  from_decimals?: number;
  to_decimals?: number;
  max_slippage_bps?: number;
};
export type ReadCapabilities = {
  txHistory(input: { limit?: number }): Promise<ToolResult>;
  addressInfo(input: { address: string }): Promise<ToolResult>;
  dnsResolve(input: { domain: string }): Promise<ToolResult>;
  dnsInfo(input: { domain: string }): Promise<ToolResult>;
  jettonInfo(input: AssetInput): Promise<ToolResult>;
  jettonBalance(input: AssetInput): Promise<ToolResult>;
  nftInfo(input: { address: string }): Promise<ToolResult>;
  nftCollectionInfo(input: { address: string }): Promise<ToolResult>;
  searchTokens(input: { query: string; limit?: number }): Promise<ToolResult>;
  tonPrice(): Promise<ToolResult>;
  jettonPrice(input: { address: string }): Promise<ToolResult>;
  portfolio(): Promise<ToolResult>;
  tokenMarket(input: { query: string; chain?: string }): Promise<ToolResult>;
  uranusSearch(input: { query?: string; limit?: number }): Promise<ToolResult>;
  uranusHoldings(): Promise<ToolResult>;
  info(input: { token: string; decimals?: number }): Promise<ToolResult>;
};
export type SwapQuotePort = {
  validate(args: SwapInput): void;
  quote(args: SwapInput): Promise<ToolResult>;
};
export type SwapPreparePort = Pick<FinancialPreparation, 'prepare'> &
  Pick<SwapQuotePort, 'validate'>;
export type WorkspacePort = {
  validate(path: string, content?: string): void;
  list(): Promise<ToolResult>;
  read(path: string): Promise<ToolResult | null>;
  write(path: string, content: string, expectedRevision?: number): Promise<ToolResult>;
};
export type MediaPort = {
  validateSave(fileId: string, filename: string): void;
  save(fileId: string, filename: string, invocation: Invocation): Promise<ToolResult>;
};
export type TelegramMethodPort = {
  validate?(args: { method: string; params: Record<string, unknown> }): void;
  call(
    method: string,
    params: Record<string, unknown>,
    invocation: Invocation,
  ): Promise<ToolResult>;
};

export type BuiltinPorts = {
  memory: import('./tools.js').MemoryPort;
  messenger: import('./tools.js').MessagePort;
  wallet: import('./tools.js').WalletReadPort;
  transfers: import('./tools.js').TransferPreparationPort;
  workspace?: WorkspacePort;
  web?: import('./tools.js').WebSearchPort & import('./tools.js').WebFetchPort;
  chainReads?: Pick<
    ReadCapabilities,
    | 'txHistory'
    | 'addressInfo'
    | 'dnsResolve'
    | 'dnsInfo'
    | 'jettonInfo'
    | 'jettonBalance'
    | 'nftInfo'
    | 'nftCollectionInfo'
  >;
  market?: Pick<
    ReadCapabilities,
    | 'searchTokens'
    | 'tonPrice'
    | 'jettonPrice'
    | 'portfolio'
    | 'tokenMarket'
    | 'uranusSearch'
    | 'uranusHoldings'
  >;
  uranus?: Pick<ReadCapabilities, 'info'>;
  swaps?: SwapQuotePort;
  financial?: FinancialPreparation;
  media?: MediaPort;
  admin?: TelegramMethodPort;
  business?: TelegramMethodPort;
  gifts?: TelegramMethodPort;
  payments?: {
    request(
      args: { chat_id?: string; amount: number; title?: string; description: string },
      invocation: Invocation,
    ): Promise<ToolResult>;
  };
};
