import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebFetchTool } from '../../src/tools/web/fetch.js';
import { publicWebURL } from '../../src/shared/web-url.js';

test('web_fetch blocks normalized internal addresses and credentials before its transport', async () => {
  let called = 0;
  const tool = createWebFetchTool({
    fetchPage: async (url) => {
      called++;
      return { url, text: 'Page' };
    },
  });
  for (const url of [
    'file:///etc/passwd',
    'ftp://example.org/a',
    'https://u:secret@example.org',
    'http://localhost',
    'http://localhost.',
    'http://nested.localhost',
    'http://metadata.google.internal',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://0177.0.0.1',
    'http://10.0.0.1',
    'http://172.16.1.1',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fc00::1]',
    'http://[fe80::1]',
    'http://example.org\\@127.0.0.1',
    'http://%31%32%37.0.0.1',
  ]) {
    assert.throws(() => tool.prepare(JSON.stringify({ url })), undefined, url);
  }
  assert.equal(called, 0);
  const result = await tool.prepare('{"url":" HTTPS://Example.org/article#section "}')({
    operationId: 'page',
  });
  assert.equal(result.url, 'https://example.org/article');
  assert.equal(called, 1);
  assert.equal(publicWebURL('https://café.fr/é'), 'https://xn--caf-dma.fr/%C3%A9');
});
