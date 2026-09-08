import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemorySetTool } from '../../src/tools/memory/set.js';

test('memory_set normalizes its key and only invokes its write capability', async () => {
  let stored;
  const tool = createMemorySetTool({
    set: async (...args) => {
      stored = args;
    },
  });
  assert.deepEqual(await tool.prepare('{"key":" name ","value":"Duck"}')({ operationId: 'test' }), {
    saved: true,
    key: 'name',
  });
  assert.deepEqual(stored, ['name', 'Duck', []]);
  assert.throws(() => tool.prepare('{"key":"api","value":"sk-or-test-secret"}'), /secret/);
});
