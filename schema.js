import { table, integer, text, index, blob } from 'sdk/db';

export const settings = table('agent_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const secrets = table('agent_secrets', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const conversations = table('agent_conversations', {
  chatId: text('chat_id').primaryKey(),
  history: text('history_json').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
});
export const notes = table('agent_notes', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  tags: text('tags_json').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
});
export const operations = table(
  'agent_operations',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    data: text('data_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at').notNull().default(0),
  },
  (t) => ({
    kindStateTime: index('agent_operations_kind_state_time').on(t.kind, t.state, t.createdAt),
  }),
);

export const scopedNotes = table('agent_scoped_notes', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  tags: text('tags_json').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
});

export const turns = table(
  'agent_turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    actorId: text('actor_id').notNull(),
    status: text('status').notNull(),
    settings: text('settings_json').notNull(),
    checkpoint: text('checkpoint_json').notNull().default('{}'),
    cancelRequested: integer('cancel_requested').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    sessionStatusTime: index('agent_turns_session_status_time').on(
      t.sessionId,
      t.status,
      t.createdAt,
    ),
  }),
);
export const summaries = table('agent_summaries', {
  sessionId: text('session_id').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const workspace = table('agent_workspace', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  path: text('path').notNull(),
  content: text('content').notNull(),
  contentKind: text('content_kind').notNull().default('text'),
  contentBytes: blob('content_bytes'),
  byteCount: integer('byte_count').notNull().default(0),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const tasks = table(
  'agent_tasks',
  {
    id: text('id').primaryKey(),
    revision: integer('revision').notNull(),
    definition: text('definition_json').notNull(),
    enabled: integer('enabled').notNull(),
    nextRunAt: integer('next_run_at').notNull(),
    leaseToken: text('lease_token').notNull().default(''),
    leaseUntil: integer('lease_until').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ due: index('agent_tasks_due').on(t.enabled, t.nextRunAt) }),
);
export const taskRuns = table(
  'agent_task_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    taskRevision: integer('task_revision').notNull(),
    scheduledAt: integer('scheduled_at').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull(),
    snapshot: text('snapshot_json').notNull(),
    result: text('result_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ history: index('agent_task_runs_history').on(t.taskId, t.createdAt) }),
);
