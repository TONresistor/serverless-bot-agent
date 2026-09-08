export type StringParameter = {
  type: 'string';
  description?: string;
  maxLength: number;
  enum?: string[];
};
export type Parameter =
  | StringParameter
  | { type: 'integer'; description?: string; minimum: number; maximum: number }
  | { type: 'boolean'; description?: string }
  | {
      type: 'object';
      description?: string;
      properties: Record<string, Parameter>;
      required: string[];
      additionalProperties: boolean;
      maxProperties: number;
    }
  | { type: 'array'; description?: string; items: Parameter; maxItems: number };
export type InputSchema = {
  type: 'object';
  properties: Record<string, Parameter>;
  required: string[];
  additionalProperties: false;
};
export type ToolSchema = {
  type: 'function';
  function: { name: string; description: string; parameters: InputSchema };
};
export type ToolEffect = 'read' | 'state_write' | 'external_write';
export type ToolResult = Record<string, unknown>;
export type Invocation = Readonly<{ operationId: string }>;
export type ToolMetadata = {
  family: string;
  keywords: string[];
  exposure: 'direct' | 'search';
  methods?: Record<string, Record<string, { type: string; required: boolean }>>;
};
export type PreparedInvocation = ((invocation: Invocation) => Promise<ToolResult>) & {
  args: Record<string, unknown>;
  effect: ToolEffect;
  parallelSafe: boolean;
};
export type Tool = Readonly<{
  name: string;
  schema: ToolSchema;
  effect: ToolEffect;
  metadata: Readonly<ToolMetadata>;
  prepare(raw: string): PreparedInvocation;
}>;
export type ToolSpecification<Args> = {
  schema: ToolSchema;
  effect: ToolEffect;
  metadata?: ToolMetadata;
  effectFor?: (args: Args) => ToolEffect;
  parallelSafe?: boolean;
  maxArgumentBytes?: number;
  validate?: (args: Args) => void;
  execute(args: Args, invocation: Invocation): ToolResult | Promise<ToolResult>;
};
export type ToolRegistry = Readonly<{
  schemas: readonly ToolSchema[];
  names: readonly string[];
  get(name: string): Tool;
}>;

export type Note = { key: string; value: string; tags: string[]; updated_at: number };
export type MemoryPort = {
  set(key: string, value: string, tags: string[]): Promise<void>;
  get(key: string): Promise<Note | null>;
  search(query: string, limit: number): Promise<Note[]>;
};
export type MessagePort = {
  validate?: (args: any) => void;
  send(
    text: string,
    invocation: Invocation,
    options?: { chat_id?: string; reply_to_message_id?: number; rich_buttons?: object[] },
  ): Promise<{ message_id?: number; inline_message_id?: string; reply_delivered?: boolean }>;
};
export type WalletIdentity = { address: string; network: string };
export type WalletReadPort = {
  identity(): WalletIdentity;
  balance(): Promise<WalletIdentity & { balance_nano: string; balance_ton: string }>;
};
export type TransferArgs = { to: string; amount: string; comment?: string };
export type TransferPreparationPort = {
  validate?: (args: TransferArgs) => void;
  prepare(args: TransferArgs, operationId: string): Promise<ToolResult>;
};
export type ToolJournal = {
  operation(id: string): Promise<{ state: string; data: { result?: ToolResult } } | null>;
  claim(id: string, kind: string, state: string, data: unknown): Promise<boolean>;
  transition(id: string, from: string[], state: string, data: unknown): Promise<boolean>;
};

export type WebSearchPort = {
  search(input: { query: string; count: number; topic: string }): Promise<ToolResult>;
};
export type WebFetchPort = { fetchPage(url: string): Promise<ToolResult> };
