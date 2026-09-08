import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebProvider } from '../src/adapters/web/provider.js';
import { fitWebResult } from '../src/shared/web-results.js';
import { createRuntime } from '../src/composition/runtime.js';
import { fixture, message, context, completion, call } from './helpers.mjs';

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const search = {
  query: 'test',
  answer: 'Answer',
  results: [{ title: 'Source', url: 'https://example.org/a', content: 'Snippet', score: 1 }],
};

test('Tavily search and extraction use fixed endpoints, bound authorization and normalized result shapes', async () => {
  const requests = [];
  const web = createWebProvider(
    async (url, options) => {
      requests.push({ url, ...options });
      return response(
        url.endsWith('/search')
          ? search
          : { results: [{ url: 'https://example.org/a', raw_content: '# Article' }] },
      );
    },
    { provider: 'tavily', apiKey: 'private-provider-key' },
  );
  assert.deepEqual(await web.search({ query: 'test', count: 5, topic: 'news' }), search);
  assert.deepEqual(await web.fetchPage('https://example.org/a'), {
    url: 'https://example.org/a',
    text: '# Article',
  });
  assert.equal(requests[0].url, 'https://api.tavily.com/search');
  assert.equal(requests[0].headers.Authorization, 'Bearer private-provider-key');
  assert.deepEqual(JSON.parse(requests[0].body), {
    query: 'test',
    max_results: 5,
    topic: 'news',
    search_depth: 'basic',
    include_answer: true,
  });
  assert.equal(requests[1].url, 'https://api.tavily.com/extract');
  assert.deepEqual(JSON.parse(requests[1].body), {
    urls: ['https://example.org/a'],
    extract_depth: 'basic',
    format: 'markdown',
    timeout: 30,
  });
});

test('MyDuckAI-compatible proxy preserves metadata, count/topic and never fetches model URLs directly', async () => {
  const requests = [];
  const page = {
    url: 'https://example.org/final',
    text: '# Heading\n\nReadable body',
    title: 'Article',
    site: 'Example',
    author: 'Author',
    published: '2026-09-07',
    secret: 'must be omitted',
  };
  const web = createWebProvider(
    async (url, options) => {
      requests.push({ url, ...options });
      return response(url.endsWith('/search') ? search : page);
    },
    { provider: 'proxy', endpoint: 'https://bridge.example.org/web', apiKey: 'key' },
  );
  await web.search({ query: 'news', count: 3, topic: 'finance' });
  const result = await web.fetchPage('https://example.org/start');
  assert.deepEqual(
    requests.map((r) => r.url),
    ['https://bridge.example.org/web/search', 'https://bridge.example.org/web/fetch'],
  );
  assert.deepEqual(JSON.parse(requests[0].body), { query: 'news', count: 3, topic: 'finance' });
  assert.equal(result.url, page.url);
  assert.equal(result.author, 'Author');
  assert.equal(result.secret, undefined);
});

test('web output preserves complete citation URLs and Unicode under even the smallest loop budget', () => {
  const result = fitWebResult(
    {
      query: 'é'.repeat(2000),
      answer: 'a'.repeat(2000),
      results: Array.from({ length: 10 }, (_, i) => ({
        title: 't'.repeat(512),
        url: `https://example.org/source/${i}`,
        content: '🦆'.repeat(2000),
        score: 1,
      })),
    },
    1024,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
  assert.equal(result.truncated, true);
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every((r) => /^https:\/\/example.org\/source\/\d$/.test(r.url)));
  assert.ok(!JSON.stringify(result).includes('�'));
  const page = fitWebResult({ url: 'https://example.org/article', text: '🦆'.repeat(12000) }, 1024);
  assert.equal(page.url, 'https://example.org/article');
  assert.ok(page.text.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1024);
});

test('malformed, oversized, failed and malicious provider responses cannot expose credentials or claim readable content', async () => {
  const input = { query: 'q', count: 5, topic: 'general' };
  for (const [body, status, code] of [
    [{ error: 'private-provider-key' }, 429, 'rate_limited'],
    [{}, 200, 'invalid_response'],
    [
      { results: [], failed_results: [{ error: 'private-provider-key' }] },
      200,
      'web_extract_failed',
    ],
  ]) {
    const web = createWebProvider(async () => response(body, status), {
      provider: 'tavily',
      apiKey: 'private-provider-key',
    });
    await assert.rejects(
      code === 'web_extract_failed' ? web.fetchPage('https://example.org') : web.search(input),
      (e) => e.code === code && !e.message.includes('private-provider-key'),
    );
  }
  const web = createWebProvider(
    async () => response({ results: [{ ...search.results[0], url: 'http://127.0.0.1' }] }),
    { provider: 'proxy', endpoint: 'https://bridge.example.org' },
  );
  assert.equal((await web.search(input)).results.length, 0);
  const huge = createWebProvider(
    async () => response({ results: [], answer: 'x'.repeat(1048577) }),
    { provider: 'tavily', apiKey: 'secret' },
  );
  await assert.rejects(huge.search(input), (e) => e.code === 'response_too_large');
});

test('web tools are discovered, called and journaled through the existing loop, including permission revocation', async () => {
  const f = await fixture();
  let round = 0,
    calls = 0;
  const app = createRuntime({
    db: f.db,
    api: f.api,
    now: f.now,
    chainFactory: () => f.ton,
    fetcher: async () => {
      calls++;
      return response(search);
    },
    modelFactory: () => async (messages, schemas) => {
      assert.ok(!schemas.some((t) => ['web_search', 'web_fetch'].includes(t.function.name)));
      if (round++ === 0)
        return completion(null, [call('tool_search', { query: 'web_search' }, 'find')]);
      if (round === 2) {
        const result = JSON.parse(messages.at(-1).content);
        assert.equal(result.matches[0].schema.properties.count.maximum, 10);
        return completion(null, [
          call('tool_call', { name: 'web_search', arguments: { query: 'test' } }, 'search'),
        ]);
      }
      assert.equal(JSON.parse(messages.at(-1).content).results[0].url, 'https://example.org/a');
      return completion('Source found.');
    },
  });
  await app.configureWeb({ provider: 'tavily', apiKey: 'secret' });
  assert.deepEqual(await app.getWebSettings(), { configured: true, provider: 'tavily' });
  assert.equal(
    (await app.onMessage(message('Find current sources'), context(700))).completed,
    true,
  );
  assert.equal(calls, 1);
  assert.ok(
    (await f.db.all("SELECT data_json FROM agent_operations WHERE kind='tool'")).some(
      (r) => JSON.parse(r.data_json).name === 'web_search',
    ),
  );
  const policy = await app.getAccessPolicy();
  await app.updateAccessPolicy({
    expectedRevision: policy.revision,
    value: { ...policy.value, tools: { ...policy.value.tools, web_search: { enabled: false } } },
  });
  const blocked = createRuntime({
    db: f.db,
    api: f.api,
    now: f.now,
    chainFactory: () => f.ton,
    fetcher: async () => {
      throw new Error('Revoked tool must not call the provider');
    },
    modelFactory: () => async () => completion(null, [call('web_search', { query: 'no' })]),
  });
  await blocked.onMessage(message('Search again'), context(701));
  assert.equal(calls, 1);
});
