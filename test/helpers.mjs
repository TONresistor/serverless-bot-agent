import initSqlJs from 'sql.js';
import {
  Address,
  beginCell,
  Cell,
  Dictionary,
  loadMessage,
  storeMessage,
  storeTransaction,
} from '@ton/core';
import { createRepositories } from '../src/adapters/sqlite/index.js';
import { publicKeyFromSeed } from '../src/domain/crypto.js';
import { walletAddress } from '../src/domain/wallet.js';

const SQL = await initSqlJs();
export const seed = Buffer.alloc(32, 7); // Public deterministic test vector, not a live wallet.
export const publicKey = publicKeyFromSeed(seed).toString('hex');
export const secretKey = Buffer.concat([seed, Buffer.from(publicKey, 'hex')]).toString('hex');
export const ownerId = 42;
export const config = {
  ownerId,
  botId: 99,
  model: 'google/gemini-3.8-flash',
  network: 'mainnet',
  walletPublicKey: publicKey,
};
export const address = walletAddress(publicKey, 'mainnet');
export const recipient = new Address(0, Buffer.alloc(32, 8));

export async function fixture() {
  const database = new SQL.Database();
  database.run(`
    CREATE TABLE agent_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE agent_secrets(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE agent_conversations(chat_id TEXT PRIMARY KEY,history_json TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);
    CREATE TABLE agent_notes(key TEXT PRIMARY KEY,value TEXT NOT NULL,tags_json TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);
    CREATE TABLE agent_scoped_notes(id TEXT PRIMARY KEY,scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,tags_json TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);
    CREATE TABLE agent_turns(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,actor_id TEXT NOT NULL,status TEXT NOT NULL,settings_json TEXT NOT NULL,checkpoint_json TEXT NOT NULL DEFAULT '{}',cancel_requested INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX agent_turns_session_status_time ON agent_turns(session_id,status,created_at);
    CREATE TABLE agent_summaries(session_id TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE agent_tasks(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,definition_json TEXT NOT NULL,enabled INTEGER NOT NULL,next_run_at INTEGER NOT NULL,lease_token TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE agent_task_runs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,task_revision INTEGER NOT NULL,scheduled_at INTEGER NOT NULL,trigger TEXT NOT NULL,status TEXT NOT NULL,snapshot_json TEXT NOT NULL,result_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE agent_workspace(id TEXT PRIMARY KEY,scope TEXT NOT NULL,path TEXT NOT NULL,content TEXT NOT NULL,content_kind TEXT NOT NULL DEFAULT 'text',content_bytes BLOB,byte_count INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE agent_operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,state TEXT NOT NULL,data_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL DEFAULT 0);
  `);
  const rows = (query, params = {}) => {
    const parameters = [
      ...new Set(query.replace(/'(?:''|[^'])*'/g, '').match(/:[a-zA-Z][a-zA-Z0-9_]*/g) || []),
    ];
    if (
      parameters.length !== Object.keys(params).length ||
      parameters.some((key) => !Object.hasOwn(params, key))
    )
      throw new Error('Native SQLite parameter mismatch');
    const statement = database.prepare(query);
    try {
      statement.bind(params);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally {
      statement.free();
    }
  };
  const db = {
    async get(q, p) {
      return rows(q, p)[0] || null;
    },
    async all(q, p) {
      return rows(q, p);
    },
    async run(q, p) {
      const result = rows(q, p);
      return { rowsAffected: database.getRowsModified(), rows: result };
    },
  };
  let time = 1_000_000;
  const now = () => time;
  const repositories = createRepositories(db, now);
  // Test fixture facade only; production consumers receive separate ports.
  const store = Object.assign({}, ...Object.values(repositories));
  await store.setConfig(config);
  await db.run("INSERT INTO agent_settings(key,value) VALUES('access_policy',:value)", {
    ':value': JSON.stringify({
      revision: 1,
      value: {
        version: 1,
        dm: { mode: 'off' },
        group: { mode: 'all', groups: [] },
        rate: { per_user_hour: 10 },
        trusted: [],
        tools: {
          ton_send: { enabled: true },
          telegram_admin: { enabled: true },
          telegram_chat_automation: { enabled: true },
          telegram_gifts: { enabled: true },
          request_star_payment: { enabled: true },
        },
      },
    }),
  });
  await store.setSecret('wallet_key', secretKey);
  await store.setSecret('openrouter', 'test-api-key');
  const sent = [];
  const api = {
    async getMe() {
      return { id: config.botId, username: 'TestBot' };
    },
    async sendRichMessage(message) {
      sent.push({ ...message, text: message.rich_message.markdown.trimEnd() });
      return { message_id: sent.length };
    },
    async editMessageText(message) {
      const prior = sent[message.message_id - 1] || {};
      sent.push({
        ...prior,
        ...message,
        edited: true,
        ...(message.rich_message ? { text: message.rich_message.markdown.trimEnd() } : {}),
      });
      return { message_id: message.message_id };
    },
    async sendMessage(message) {
      sent.push(message);
      return { message_id: sent.length };
    },
    async sendChatAction() {},
    async answerCallbackQuery() {},
  };
  const broadcasts = [];
  const ton = {
    async state() {
      return { balance: '1000000000', state: 'uninitialized' };
    },
    async walletState() {
      return {
        balance: '1000000000',
        state: 'uninitialized',
        seqno: 0,
        chainTime: 1000,
        lastTransaction: { lt: '0' },
      };
    },
    async seqno() {
      return 0;
    },
    async transactions() {
      return [];
    },
    async broadcast(boc) {
      broadcasts.push(boc);
    },
  };
  return {
    database,
    db,
    store,
    repositories,
    api,
    sent,
    ton,
    broadcasts,
    now,
    setTime: (value) => {
      time = value;
    },
  };
}

export const message = (text, id = 1, from = ownerId) => ({
  message_id: id,
  from: { id: from },
  chat: { id: from, type: 'private' },
  text,
});
export const context = (id) => ({ update: { update_id: id } });
export const callback = (id, action = 'confirm', actor = ownerId) => ({
  id: 'callback',
  from: { id: actor },
  message: { message_id: 1, chat: { id: actor, type: 'private' } },
  data: `${action}:${id}`,
});
export const call = (name, args, id = 'call-1') => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
export const completion = (content, calls) => ({
  message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) },
  usage: {},
  requestId: 'test',
});

export function internalMessage({
  from = address,
  to = recipient,
  amount = 10_000_000n,
  lt = 110n,
  body = Cell.EMPTY,
  bounce = false,
} = {}) {
  return {
    info: {
      type: 'internal',
      ihrDisabled: true,
      bounce,
      bounced: false,
      src: typeof from === 'string' ? Address.parse(from) : from,
      dest: typeof to === 'string' ? Address.parse(to) : to,
      value: { coins: amount },
      ihrFee: 0n,
      forwardFee: 0n,
      createdLt: lt,
      createdAt: 1000,
    },
    body,
  };
}

export function transaction({
  account = address,
  inbound,
  outbound = [],
  aborted = false,
  skipped = false,
  credit = null,
  lt = 120n,
} = {}) {
  const values = {
    serialize(value, builder) {
      builder.storeRef(beginCell().store(storeMessage(value)).endCell());
    },
    parse(slice) {
      return loadMessage(slice.loadRef().beginParse());
    },
  };
  const outMessages = Dictionary.empty(Dictionary.Keys.Uint(15), values);
  outbound.forEach((value, index) => outMessages.set(index, value));
  const tx = {
    address: BigInt(
      '0x' + (typeof account === 'string' ? Address.parse(account) : account).hash.toString('hex'),
    ),
    lt,
    prevTransactionHash: 0n,
    prevTransactionLt: 0n,
    now: 1000,
    outMessagesCount: outbound.length,
    oldStatus: skipped ? 'uninitialized' : 'active',
    endStatus: skipped ? 'uninitialized' : 'active',
    inMessage: inbound,
    outMessages,
    totalFees: { coins: 0n },
    stateUpdate: { oldHash: Buffer.alloc(32), newHash: Buffer.alloc(32) },
    description: {
      type: 'generic',
      creditFirst: true,
      aborted,
      destroyed: false,
      ...(credit === null ? {} : { creditPhase: { credit: { coins: credit } } }),
      computePhase: skipped
        ? { type: 'skipped', reason: 'no-state' }
        : {
            type: 'vm',
            success: !aborted,
            messageStateUsed: false,
            accountActivated: false,
            gasFees: 0n,
            gasUsed: 1n,
            gasLimit: 1n,
            mode: 0,
            exitCode: aborted ? 10 : 0,
            vmSteps: 1,
            vmInitStateHash: 0n,
            vmFinalStateHash: 0n,
          },
      ...(skipped
        ? {}
        : {
            actionPhase: {
              success: !aborted,
              valid: true,
              noFunds: false,
              statusChange: 'unchanged',
              resultCode: 0,
              totalActions: outbound.length,
              specActions: 0,
              skippedActions: 0,
              messagesCreated: outbound.length,
              actionListHash: 0n,
              totalMessageSize: { cells: 1n, bits: 1n },
            },
          }),
    },
  };
  const cell = beginCell().store(storeTransaction(tx)).endCell();
  return {
    data: cell.toBoc().toString('base64'),
    transaction_id: { lt: lt.toString(), hash: cell.hash().toString('base64') },
    utime: 1000,
  };
}
