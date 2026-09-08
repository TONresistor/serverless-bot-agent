import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { parse } from 'acorn';
import { BUILTIN_SCHEMAS } from '../src/composition/tools.js';

const root = resolve('src');
async function sources(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sources(path)));
    else if (path.endsWith('.js')) result.push(path);
  }
  return result;
}

const allowed = {
  agent: ['agent', 'shared'],
  tools: ['tools', 'shared'],
  domain: ['domain', 'shared'],
  application: ['application', 'agent', 'tools', 'domain', 'shared'],
  adapters: ['adapters', 'domain', 'shared'],
  composition: ['composition', 'application', 'adapters', 'domain', 'agent', 'tools', 'shared'],
  platform: ['platform'],
  shared: ['shared'],
};

test('source dependency boundaries and SDK ownership are enforced', async () => {
  const files = await sources(root);
  const graph = new Map();
  for (const file of files) {
    const name = relative(root, file);
    const layer = name.split('/')[0];
    const tree = parse(await readFile(file, 'utf8'), {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
    const imports = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          node.type,
        ) &&
        node.source
      )
        imports.push(node.source.value);
      if (node.type === 'ImportExpression')
        throw new Error(`Runtime dynamic import forbidden: ${name}`);
      if (node.type === 'CallExpression' && ['require', 'eval'].includes(node.callee?.name))
        throw new Error(`Runtime loader/eval forbidden: ${name}`);
      if (node.type === 'NewExpression' && node.callee?.name === 'Function')
        throw new Error(`Dynamic code generation forbidden: ${name}`);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    }
    visit(tree);
    const edges = [];
    for (const dependency of imports) {
      if (dependency.startsWith('.')) {
        const target = resolve(dirname(file), dependency);
        assert.ok(files.includes(target), `${name}: missing ${dependency}`);
        const targetLayer = relative(root, target).split('/')[0];
        assert.ok(
          name === 'runtime.js'
            ? targetLayer === 'composition'
            : allowed[layer]?.includes(targetLayer),
          `${name} must not depend on ${dependency}`,
        );
        edges.push(target);
      } else if (dependency === 'sdk' || dependency.startsWith('sdk/')) {
        assert.equal(name, 'runtime.js', `SDK escaped composition entrypoint: ${name}`);
      } else {
        assert.ok(!dependency.startsWith('node:'), `Node dependency in runtime: ${name}`);
        const dedustContract =
          (name.startsWith('domain/swaps/dedust/') || name.startsWith('adapters/swaps/dedust/')) &&
          (dependency.startsWith('@dedust/sdk/dist/contracts/') ||
            dependency.startsWith('@dedust/kit/dist/cpmm-v2/abi/'));
        const permitted =
          dedustContract ||
          dependency === 'buffer' ||
          (layer === 'shared' && dependency === 'whatwg-url') ||
          (layer === 'domain' &&
            (dependency.startsWith('@ton/') || dependency.startsWith('@ston-fi/sdk/'))) ||
          (layer === 'adapters' && ['@ton/core', 'marked'].includes(dependency)) ||
          (['domain', 'shared'].includes(layer) && dependency.startsWith('@noble/'));
        assert.ok(permitted, `${name}: unexpected external dependency ${dependency}`);
      }
    }
    graph.set(file, edges);
  }
  const done = new Set();
  function walk(file, ancestors = new Set()) {
    assert.ok(!ancestors.has(file), `Circular dependency at ${relative(root, file)}`);
    if (done.has(file)) return;
    const path = new Set([...ancestors, file]);
    graph.get(file).forEach((edge) => walk(edge, path));
    done.add(file);
  }
  files.forEach((file) => walk(file));
});

test('one implementation module per built-in tool', async () => {
  const files = await sources(resolve(root, 'tools'));
  const definitions = files.filter((path) =>
    /tools\/(memory|telegram|ton|workspace|web|market|jetton|nft|uranus|media|swaps)\//.test(path),
  );
  assert.equal(definitions.length, BUILTIN_SCHEMAS.length);
  for (const file of definitions) {
    const text = await readFile(file, 'utf8');
    assert.equal((text.match(/defineSchema\(/g) || []).length, 1, file);
    assert.equal((text.match(/defineTool\(/g) || []).length, 1, file);
  }
});
