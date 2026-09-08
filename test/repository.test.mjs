import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

async function markdown(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await markdown(path)));
    else if (entry.name.endsWith('.md')) result.push(path);
  }
  return result;
}

test('published documentation resolves local links without sibling repositories', async () => {
  const root = resolve('.');
  for (const file of [
    resolve('README.md'),
    resolve('CONTRIBUTING.md'),
    resolve('SECURITY.md'),
    ...(await markdown('docs')),
  ]) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(match[1])) continue;
      const target = resolve(dirname(file), match[1]);
      assert.ok(!relative(root, target).startsWith('..'), file + ': link escapes repository');
      await assert.doesNotReject(access(target), file + ': missing ' + match[1]);
    }
  }
});
