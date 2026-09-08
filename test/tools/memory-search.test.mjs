import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemorySearchTool } from '../../src/tools/memory/search.js';

test('memory_search applies its default result count and enforces bounds', async () => {
  const tool = createMemorySearchTool({
    search: async (query, limit) => {
      assert.equal(query, 'duck');
      assert.equal(limit, 5);
      return [];
    },
  });
  assert.deepEqual(await tool.prepare('{"query":"duck"}')({ operationId: 'test' }), { notes: [] });
  assert.throws(() => tool.prepare('{"query":"duck","limit":11}'), /bounds/);
});
