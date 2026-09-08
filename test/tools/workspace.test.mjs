import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../helpers.mjs';
import { createWorkspaceList } from '../../src/tools/workspace/list.js';
import { createWorkspaceRead } from '../../src/tools/workspace/read.js';
import { createWorkspaceWrite } from '../../src/tools/workspace/write.js';

test('workspace tools preserve relative files, hide dotfiles from listing and enforce UTF-8 limits', async () => {
  const f = await fixture();
  const port = f.repositories.workspace.port();
  const list = createWorkspaceList(port),
    read = createWorkspaceRead(port),
    write = createWorkspaceWrite(port);
  await write.prepare(JSON.stringify({ path: 'notes/today.md', content: 'Hello 🌍' }))({
    operationId: 'write:1',
  });
  await write.prepare(JSON.stringify({ path: '.internal.md', content: 'hidden from listing' }))({
    operationId: 'write:2',
  });
  assert.deepEqual(await list.prepare('{}')({ operationId: 'list' }), {
    files: ['notes/today.md'],
  });
  assert.equal(
    (await read.prepare('{"path":"notes/today.md"}')({ operationId: 'read' })).content,
    'Hello 🌍',
  );
  assert.throws(
    () => write.prepare(JSON.stringify({ path: 'large.md', content: 'é'.repeat(140000) })),
    /256 KiB/,
  );
  assert.throws(() => read.prepare('{"path":"../outside"}'), /path/);
});
