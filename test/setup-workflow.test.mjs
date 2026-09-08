import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { deploy } from '../scripts/deploy.mjs';

test('deployment authenticates before building or publishing and stops on failure', async () => {
  const calls = [],
    env = { TGCLOUD_TOKEN: 'fixture-only' };
  await assert.rejects(
    deploy({
      env,
      run: (_node, args) => {
        calls.push(args.slice(1));
        return { status: 1 };
      },
      build: async () => assert.fail('Must not build before authentication'),
    }),
    /Cannot authenticate/,
  );
  assert.deepEqual(calls, [['webhook']]);
  calls.length = 0;
  await deploy({
    env,
    run: (_node, args, options) => {
      assert.equal(options.env, env);
      calls.push(args.slice(1));
      return { status: 0 };
    },
    build: async () => calls.push(['build']),
  });
  assert.deepEqual(calls, [
    ['webhook'],
    ['build'],
    ['push', 'schema.js'],
    ['migrate', '--safe'],
    ['push'],
  ]);
  calls.length = 0;
  await assert.rejects(
    deploy({
      skipBuild: true,
      run: (_node, args) => {
        calls.push(args.slice(1));
        return { status: args.includes('migrate') ? 1 : 0 };
      },
    }),
    /migrate/,
  );
  assert.deepEqual(calls, [['webhook'], ['push', 'schema.js'], ['migrate', '--safe']]);
});

test('.env.local supplies configuration while existing environment variables retain priority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-env-'));
  try {
    const path = join(directory, '.env.local');
    await writeFile(path, 'TGCLOUD_TOKEN=file-fixture\nAGENT_FIXTURE_VALUE=loaded\n');
    const module = pathToFileURL(resolve('scripts/cloud.mjs')).href;
    const source = `import {loadLocalEnv} from ${JSON.stringify(module)};loadLocalEnv(process.argv[1]);console.log(JSON.stringify({token:process.env.TGCLOUD_TOKEN,value:process.env.AGENT_FIXTURE_VALUE}));`;
    const childEnv = { ...process.env, TGCLOUD_TOKEN: 'environment-fixture' };
    delete childEnv.AGENT_FIXTURE_VALUE;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', source, path], {
      env: childEnv,
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(output), { token: 'environment-fixture', value: 'loaded' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
