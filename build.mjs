import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'acorn';

const require = createRequire(import.meta.url);
const core = require('@ton/core');
const stonCoreImports = {
  name: 'ston-contract-core-imports',
  setup(build) {
    build.onResolve({ filter: /^@ton\/ton$/ }, async ({ importer }) => {
      if (!importer.includes('/node_modules/@ston-fi/sdk/')) return;
      const tree = parse(await readFile(importer, 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });
      const imports = tree.body.filter(
        (node) => node.type === 'ImportDeclaration' && node.source.value === '@ton/ton',
      );
      if (
        !imports.length ||
        imports.some((node) =>
          node.specifiers.some(
            (spec) => spec.type !== 'ImportSpecifier' || !Object.hasOwn(core, spec.imported.name),
          ),
        )
      )
        throw new Error('STON SDK added a non-core TON dependency; review the build mapping.');
      return { path: require.resolve('@ton/core') };
    });
  },
};

export async function buildAgent(entry = 'src/runtime.js', outfile = 'lib/runtime.js') {
  await mkdir('lib', { recursive: true });
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    charset: 'utf8',
    minify: true,
    legalComments: 'inline',
    metafile: true,
    plugins: [stonCoreImports],
    external: ['sdk', 'sdk/db'],
    inject: [resolve('src/platform/buffer.js')],
    alias: { '@ton/crypto': resolve('src/domain/crypto.js') },
  });
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !['sdk', 'sdk/db'].includes(dependency.path))
        throw new Error(`Unsupported runtime import: ${dependency.path}`);
    }
  }
  await mkdir('.local', { recursive: true });
  await writeFile('.local/build-meta.json', JSON.stringify(result.metafile, null, 2));
  return result;
}

if (process.argv[1] === resolve('build.mjs')) {
  await buildAgent();
  console.log('Serverless bundle built.');
}
