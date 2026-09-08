import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryGetTool } from '../../src/tools/memory/get.js';

test('memory_get preserves absent facts and rejects blank keys', async () => {
  const tool = createMemoryGetTool({
    get: async (key) => {
      assert.equal(key, 'absent');
      return null;
    },
  });
  assert.deepEqual(await tool.prepare('{"key":" absent "}')({ operationId: 'test' }), {
    note: null,
  });
  assert.throws(() => tool.prepare('{"key":"  "}'), /empty/);
});
