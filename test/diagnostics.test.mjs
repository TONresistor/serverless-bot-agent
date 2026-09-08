import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticReporter } from '../src/shared/diagnostics.js';
import { createRuntime } from '../src/composition/runtime.js';
import { fixture, message, context } from './helpers.mjs';

test('diagnostics retain code locations but exclude secrets, payloads and raw exception text', () => {
  const entries = [],
    report = createDiagnosticReporter((event, fields) => entries.push({ event, fields }));
  const error = new TypeError('SENSITIVE_TOKEN');
  error.stack =
    'TypeError: SENSITIVE_TOKEN\n    at work (/private/SENSITIVE_TOKEN/src/agent/loop.js:32:8)\n    at remote (https://api.example/SENSITIVE_TOKEN:4:7)';
  report(error, { phase: 'model', event: 'update:123', payload: 'SENSITIVE_TOKEN' });
  assert.equal(entries[0].fields.type, 'TypeError');
  assert.deepEqual(entries[0].fields.locations, ['src/agent/loop.js:32:8']);
  assert.equal(JSON.stringify(entries).includes('SENSITIVE_TOKEN'), false);
  assert.doesNotThrow(() =>
    createDiagnosticReporter(() => {
      throw new Error('bad logger');
    })(error),
  );
});

test('a model exception is diagnosed and the turn logs its actual failed status', async () => {
  const f = await fixture(),
    logs = [];
  const app = createRuntime({
    db: f.db,
    api: f.api,
    now: f.now,
    chainFactory: () => f.ton,
    fetcher: async () => {
      throw new Error('No network');
    },
    log: (event, fields) => logs.push({ event, fields }),
    modelFactory: () => async () => {
      throw new TypeError('SENSITIVE_TOKEN');
    },
  });
  const result = await app.onMessage(message('Hello'), context(4001));
  assert.equal(result.status, 'failed');
  assert.ok(
    logs.some(
      (e) =>
        e.event === 'diagnostic' && e.fields.phase === 'model' && e.fields.type === 'TypeError',
    ),
  );
  assert.ok(
    logs.some(
      (e) =>
        e.event === 'turn_finished' &&
        e.fields.status === 'failed' &&
        e.fields.reason === 'internal_error',
    ),
  );
  assert.equal(JSON.stringify(logs).includes('SENSITIVE_TOKEN'), false);
  assert.equal(
    logs.some((e) => e.event === 'turn_completed'),
    false,
  );
});

test('turn recovery lookup uses its dedicated index', async () => {
  const f = await fixture();
  const plan = await f.db.all(
    "EXPLAIN QUERY PLAN SELECT * FROM agent_turns WHERE session_id=:session AND status='running' ORDER BY created_at",
    { ':session': '42' },
  );
  assert.ok(plan.some((row) => row.detail.includes('agent_turns_session_status_time')));
  assert.equal(
    plan.some(
      (row) => row.detail.includes('SCAN agent_turns') || row.detail.includes('TEMP B-TREE'),
    ),
    false,
  );
});
