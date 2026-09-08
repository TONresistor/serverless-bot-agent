import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJSON } from '../src/adapters/http.js';
import { createOpenRouter } from '../src/adapters/openrouter.js';

test('bounds streamed JSON and does not echo malformed response contents', async () => {
  await assert.rejects(
    requestJSON(async () => new Response('x'.repeat(1024)), 'https://example.com', {}, 100),
    (e) => e.code === 'response_too_large',
  );
  await assert.rejects(
    requestJSON(async () => new Response('secret-test-key'), 'https://example.com'),
    (e) => e.code === 'invalid_response' && !e.message.includes('secret'),
  );
});

test('OpenRouter sends tools on every round and preserves provider tool messages', async () => {
  const inputs = [];
  const complete = createOpenRouter(
    async (_url, options) => {
      inputs.push(JSON.parse(options.body));
      return new Response(
        JSON.stringify({
          id: 'r',
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { total_tokens: 10 },
        }),
      );
    },
    { apiKey: 'test-api-key', model: 'google/gemini-3.8-flash' },
  );
  const tools = [{ type: 'function', function: { name: 'test' } }];
  assert.equal((await complete([{ role: 'user', content: 'hello' }], tools)).message.content, 'ok');
  assert.deepEqual(inputs[0].tools, tools);
  assert.equal(inputs[0].stream, false);
  assert.deepEqual(inputs[0].provider, { require_parameters: true });
});
