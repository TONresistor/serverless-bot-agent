import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from '../src/tools/catalog.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/define.js';
import { defineSchema, string } from '../src/tools/schema.js';
import { DEFAULT_SETTINGS } from '../src/agent/settings.js';
import { projectResult } from '../src/agent/results.js';
import { createRuntime } from '../src/composition/runtime.js';
import { fixture, message, context, call, completion } from './helpers.mjs';

function entry(name, fieldDescription = 'Text') {
  return defineTool({
    schema: defineSchema({
      name,
      description: 'Inventory lookup with a complete structured input contract.',
      properties: {
        query: string(fieldDescription, 200),
        mode: { ...string('Lookup mode', 20), enum: ['exact', 'prefix'] },
        options: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 7 },
            archived: { type: 'boolean' },
          },
          required: ['limit'],
          additionalProperties: false,
          maxProperties: 2,
        },
      },
      required: ['query', 'mode', 'options'],
    }),
    effect: 'read',
    metadata: { family: 'inventory', exposure: 'search', keywords: ['inventory'] },
    execute: () => ({ ok: true }),
  });
}

test('an exact search returns one complete contract including nested types, enums and constraints', () => {
  const target = entry('inventory_lookup'),
    other = entry('inventory_lookup_other');
  const catalog = createCatalog(createToolRegistry([other, target]), DEFAULT_SETTINGS);
  const result = catalog.search('INVENTORY_LOOKUP', 10);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0].schema, target.schema.function.parameters);
  assert.equal(result.matches[0].description, target.schema.function.description);
});

test('catalog and per-round budgets drop whole contracts without cutting Unicode or schema fields', () => {
  const tools = ['inventory_a', 'inventory_b', 'inventory_c'].map((name) =>
    entry(name, 'Unicode é😀 '.repeat(40)),
  );
  const registry = createToolRegistry(tools);
  const all = createCatalog(registry, { ...DEFAULT_SETTINGS, toolResultMaxBytes: 32768 }).search(
    'inventory',
  );
  assert.equal(all.matches.length, 3);
  const budget = Buffer.byteLength(
    JSON.stringify({ result_kind: 'tool_catalog', matches: [all.matches[0]], truncated: true }),
  );
  const bounded = createCatalog(registry, {
    ...DEFAULT_SETTINGS,
    toolResultMaxBytes: budget,
  }).search('inventory');
  assert.equal(bounded.matches.length, 1);
  assert.equal(bounded.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= budget);
  assert.deepEqual(bounded.matches[0], all.matches[0]);
  const projected = JSON.parse(projectResult(all, budget));
  assert.deepEqual(projected, bounded);
  assert.equal(projected.preview, undefined);
});

test('an oversized single contract returns an explicit error rather than a partial schema', () => {
  const registry = createToolRegistry([
    entry('inventory_huge', 'Large field description. '.repeat(100)),
  ]);
  const result = createCatalog(registry, { ...DEFAULT_SETTINGS, toolResultMaxBytes: 1024 }).search(
    'inventory_huge',
  );
  assert.equal(result.error, 'schema_too_large');
  assert.deepEqual(result.matches, []);
  assert.ok(result.required_bytes > 1024);
  assert.deepEqual(JSON.parse(projectResult(result, 1024)), result);
  assert.equal(result.preview, undefined);
});

test('a deferred wallet read completes with search then call and no description round', async () => {
  const f = await fixture();
  let rounds = 0;
  const app = createRuntime({
    ...f,
    fetcher: async () => {
      throw new Error('Unexpected HTTP');
    },
    chainFactory: () => f.ton,
    modelFactory: () => async (messages, schemas) => {
      assert.ok(!schemas.some((s) => s.function.name === 'tool_describe'));
      rounds++;
      if (rounds === 1)
        return completion(null, [call('tool_search', { query: 'ton_get_address' })]);
      if (rounds === 2) {
        const match = JSON.parse(messages.at(-1).content).matches[0];
        assert.deepEqual(match.schema, {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        });
        return completion(null, [call('tool_call', { name: match.id, arguments: {} })]);
      }
      assert.ok(JSON.parse(messages.at(-1).content).address);
      return completion('Wallet address available.');
    },
  });
  const result = await app.onMessage(message('Find the wallet address'), context(5001));
  assert.equal(result.completed, true);
  assert.equal(rounds, 3); // Search, call, then final reply.
  const turn = await f.repositories.turns.get('update:5001');
  assert.equal(turn.checkpoint.budget.tool_calls, 2);
  assert.equal(f.sent.length, 1);
});
