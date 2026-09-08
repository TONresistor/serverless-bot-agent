import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSearchTool } from '../../src/tools/web/search.js';

test('web_search uses reference defaults and validates the complete contract before invoking its read port', async () => {
  const calls = [];
  const tool = createWebSearchTool({
    search: async (input) => {
      calls.push(input);
      return { query: input.query, answer: '', results: [] };
    },
  });
  const prepared = tool.prepare('{"query":"  current news  "}');
  assert.equal(prepared.effect, 'read');
  assert.equal(prepared.parallelSafe, true);
  await prepared({ operationId: 'test' });
  assert.deepEqual(calls, [{ query: 'current news', count: 5, topic: 'general' }]);
  await tool.prepare('{"query":"TON","count":10,"topic":"finance"}')({ operationId: 'finance' });
  assert.equal(calls[1].topic, 'finance');
  for (const args of [
    { query: ' ' },
    { query: 'x', count: 11 },
    { query: 'x', topic: 'images' },
    { query: 'x', apiKey: 'override' },
  ])
    assert.throws(() => tool.prepare(JSON.stringify(args)));
  assert.equal(calls.length, 2);
});
