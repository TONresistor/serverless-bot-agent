import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUILTIN_SCHEMAS, createBuiltinRegistry } from '../src/composition/tools.js';
import { defineSchema, string } from '../src/tools/schema.js';
import { defineTool } from '../src/tools/define.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { createToolExecutor } from '../src/tools/executor.js';
import { assertToolResult } from '../src/tools/result.js';
import { fixture } from './helpers.mjs';

test('model-facing schemas match the reviewed contract fixture', async () => {
  const before = JSON.parse(
    await readFile(new URL('./fixtures/tool-schemas.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(BUILTIN_SCHEMAS, before);
  assert.throws(() => {
    BUILTIN_SCHEMAS[0].function.parameters.required.push('secret');
  }, TypeError);
});

test('registry extends without changing agent/executor, and reuses recorded results', async () => {
  const f = await fixture();
  let executions = 0;
  const tool = defineTool({
    schema: defineSchema({
      name: 'echo',
      description: 'Test extension',
      properties: { text: string('Text', 50) },
      required: ['text'],
    }),
    effect: 'read',
    execute(args) {
      executions++;
      return { text: args.text };
    },
  });
  const registry = createToolRegistry([tool]);
  const execute = createToolExecutor({
    registry,
    journal: f.repositories.operations,
    token: 'turn:test',
    assertActive: async () => {},
  });
  assert.deepEqual(await execute('echo', '{"text":"hello"}', 'call-1'), { text: 'hello' });
  assert.deepEqual(await execute('echo', '{"text":"hello"}', 'call-1'), { text: 'hello' });
  assert.equal(executions, 1);
  assert.throws(() => createToolRegistry([tool, tool]), /Duplicate tool/);
  f.database.close();
});

test('prototype names and unsupported schema keywords fail closed', () => {
  const registry = createBuiltinRegistry({ memory: {}, messenger: {}, wallet: {}, transfers: {} });
  assert.throws(() => registry.get('constructor'), /Unknown/);
  for (const extra of ['constructor', '__proto__', 'toString']) {
    assert.throws(
      () => registry.get('memory_get').prepare(`{"key":"x","${extra}":"injected"}`),
      /not allowed/,
    );
  }
  assert.throws(
    () =>
      defineSchema({
        name: 'invalid',
        description: 'Invalid schema',
        properties: { x: { type: 'string', maxLength: 5, pattern: '^a' } },
        required: [],
      }),
    /Unsupported/,
  );
});

test('external effect errors and invalid results remain unknown and are not repeated', async () => {
  const f = await fixture();
  let attempts = 0;
  const tool = defineTool({
    schema: defineSchema({
      name: 'write_test',
      description: 'Test effect',
      properties: {},
      required: [],
    }),
    effect: 'external_write',
    execute() {
      attempts++;
      return { invalid: NaN };
    },
  });
  const execute = createToolExecutor({
    registry: createToolRegistry([tool]),
    journal: f.repositories.operations,
    token: 'effect:test',
    assertActive: async () => {},
  });
  assert.equal((await execute('write_test', '{}', 'call-1')).error, 'internal_error');
  assert.equal((await execute('write_test', '{}', 'call-1')).error, 'operation_unknown');
  assert.equal(attempts, 1);
  for (const value of [{ x: undefined }, { x: 1n }, { x: new Date() }])
    assert.throws(() => assertToolResult(value));
  const circular = {};
  circular.self = circular;
  assert.throws(() => assertToolResult(circular));
  f.database.close();
});
