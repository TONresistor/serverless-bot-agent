import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findProjectRoot } from '../node_modules/@tgcloud/cli/src/core/project-root.js';
import { runCommand, validateConfig, loadWallet, createCloudClient } from '../agent.mjs';
import { DEFAULT_ACCESS } from '../src/shared/access-policy.js';
import { createRuntime } from '../src/composition/runtime.js';
import { fixture, config as runtimeConfig, publicKey, secretKey } from './helpers.mjs';

const configuration = () => ({
  ownerId: 42,
  model: 'provider/model',
  network: 'mainnet',
  loop: { defaults: { maxModelCalls: 12 } },
  access: structuredClone(DEFAULT_ACCESS),
});
function harness(existing = null) {
  const calls = [],
    env = { TGCLOUD_TOKEN: 'app1:fixture', OPENROUTER_API_KEY: 'fixture-key' };
  const cloud = {
    inspect: async () => {
      calls.push(['inspect']);
      return existing;
    },
    invoke: async (name, input) => {
      calls.push([name, input]);
      return { revision: 7 };
    },
    webhook: async () => ({ in_sync: true, pending_update_count: 0 }),
  };
  return {
    calls,
    options: {
      env,
      config: configuration(),
      cloud,
      build: async () => calls.push(['build']),
      prepareProject: async () => calls.push(['project']),
      wallet: async (_config, previous) => {
        calls.push(['wallet', previous]);
        return { publicKey, secretKey };
      },
      run: (_node, args, options) => {
        assert.equal(options.env, env);
        assert.equal(options.cwd, process.cwd());
        assert.ok(!args.includes(env.TGCLOUD_TOKEN));
        calls.push(args.slice(1));
        return { status: 0 };
      },
    },
  };
}
const existingAgent = () => ({
  ...configuration(),
  walletPublicKey: publicKey,
  personality: 'Existing personality',
});

test('first deploy builds, migrates and initializes configuration through bound management arguments', async () => {
  const { calls, options } = harness();
  options.env.TAVILY_API_KEY = 'tavily-fixture';
  options.env.PINATA_JWT = 'pinata-fixture';
  assert.deepEqual(await runCommand('deploy', options), { deployed: true, configured: true });
  assert.deepEqual(
    calls.slice(0, 8).map((c) => c[0]),
    ['inspect', 'wallet', 'build', 'project', 'fetch', 'push', 'migrate', 'push'],
  );
  assert.deepEqual(calls[6], ['migrate', '--safe']);
  assert.ok(calls.some((c) => c[0] === 'initializeFeatures'));
  assert.deepEqual(calls.find((c) => c[0] === 'configureWeb')[1], {
    provider: 'tavily',
    apiKey: 'tavily-fixture',
  });
  assert.equal(calls.find((c) => c[0] === 'configure')[1].walletKey, secretKey);
  assert.equal(calls.find((c) => c[0] === 'updateAgentSettings')[1].expectedRevision, 7);
  assert.deepEqual(calls.find((c) => c[0] === 'updateAccessPolicy')[1].value, DEFAULT_ACCESS);
});

test('repeat deployment preserves settings and requires neither a wallet backup nor an inference key', async () => {
  const { calls, options } = harness(existingAgent());
  delete options.env.OPENROUTER_API_KEY;
  const result = await runCommand('deploy', options);
  assert.equal(result.configured, false);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['inspect', 'build', 'project', 'fetch', 'push', 'migrate', 'push'],
  );
});

test('explicit configure applies settings but never publishes code', async () => {
  const existing = existingAgent(),
    { calls, options } = harness(existing);
  const result = await runCommand('configure', options);
  assert.equal(result.configured, true);
  assert.equal(result.deployed, false);
  assert.equal(
    calls.some((c) => c[0] === 'push' || c[0] === 'migrate'),
    false,
  );
  assert.equal(calls.find((c) => c[0] === 'configure')[1].personality, existing.personality);
  assert.equal(Object.hasOwn(calls.find((c) => c[0] === 'configure')[1], 'toncenterKey'), false);
});

test('invalid input, failed authentication, identity mismatch and migration errors stop before further writes', async () => {
  for (const patch of [
    { ownerId: 0 },
    { model: 'missing-provider' },
    { network: 'testnet' },
    { unexpected: true },
    { access: { ...DEFAULT_ACCESS, tools: { missing_tool: { enabled: true } } } },
  ])
    assert.throws(() => validateConfig({ ...configuration(), ...patch }));
  const invalid = harness();
  invalid.options.config.ownerId = 0;
  await assert.rejects(runCommand('deploy', invalid.options), /ownerId/);
  assert.equal(invalid.calls.length, 0);
  const auth = harness();
  auth.options.cloud.inspect = async () => {
    throw new Error('Authentication failed');
  };
  await assert.rejects(runCommand('deploy', auth.options), /Authentication/);
  assert.equal(auth.calls.length, 0);
  const mismatch = harness({ ...existingAgent(), ownerId: 99 });
  await assert.rejects(runCommand('deploy', mismatch.options), /different owner/);
  assert.deepEqual(mismatch.calls, [['inspect']]);
  const missing = harness();
  delete missing.options.env.OPENROUTER_API_KEY;
  await assert.rejects(runCommand('deploy', missing.options), /OPENROUTER/);
  assert.deepEqual(missing.calls, [['inspect']]);
  const failed = harness(existingAgent());
  failed.options.run = (_node, args) => {
    failed.calls.push(args.slice(1));
    return { status: args.includes('migrate') ? 1 : 0 };
  };
  await assert.rejects(runCommand('deploy', failed.options), /migrate/);
  assert.deepEqual(
    failed.calls.map((c) => c[0]),
    ['inspect', 'build', 'project', 'fetch', 'push', 'migrate'],
  );
});

test('status reads the selected bot without applying local configuration or exposing personality', async () => {
  const { calls, options } = harness(existingAgent());
  delete options.config;
  delete options.env.OPENROUTER_API_KEY;
  const result = await runCommand('status', options);
  assert.equal(result.configured, true);
  assert.equal(result.webhook_in_sync, true);
  assert.equal(Object.hasOwn(result, 'personality'), false);
  assert.deepEqual(calls, [['inspect']]);
});

test('wallet bootstrap reuses backups and refuses missing, corrupt or mismatched existing wallets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-wallet-'));
  try {
    await assert.rejects(loadWallet(configuration(), existingAgent(), directory), /Restore/);
    assert.deepEqual(await readdir(directory), []);
    await writeFile(
      join(directory, 'wallet-mainnet.json'),
      JSON.stringify({ network: 'mainnet', publicKey, secretKey }),
    );
    const original = await readFile(join(directory, 'wallet-mainnet.json'), 'utf8');
    assert.equal(
      (await loadWallet(configuration(), existingAgent(), directory)).publicKey,
      publicKey,
    );
    await assert.rejects(
      loadWallet(
        configuration(),
        { ...existingAgent(), walletPublicKey: 'ff'.repeat(32) },
        directory,
      ),
      /does not match/,
    );
    assert.equal(await readFile(join(directory, 'wallet-mainnet.json'), 'utf8'), original);
    await writeFile(join(directory, 'wallet-mainnet.json'), 'invalid');
    await assert.rejects(loadWallet(configuration(), null, directory), /invalid/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('optional TON Center credential is preserved when omitted from reconfiguration', async () => {
  const f = await fixture();
  await f.store.setSecret('toncenter', 'retained-key');
  const app = createRuntime({
    db: f.db,
    api: f.api,
    now: f.now,
    fetcher: async () => {
      throw new Error('No network');
    },
    chainFactory: () => f.ton,
  });
  await app.configure({
    ownerId: runtimeConfig.ownerId,
    model: runtimeConfig.model,
    network: 'mainnet',
    openrouterKey: 'new-fixture-key',
    walletKey: secretKey,
  });
  assert.equal(await f.store.getSecret('toncenter'), 'retained-key');
});

test('environment precedence is process, .env.local, then .env', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-env-'));
  try {
    await writeFile(
      join(directory, '.env'),
      'TGCLOUD_TOKEN=base-fixture\nAGENT_FIXTURE_VALUE=base\nAGENT_BASE_ONLY=yes\n',
    );
    await writeFile(
      join(directory, '.env.local'),
      'TGCLOUD_TOKEN=local-fixture\nAGENT_FIXTURE_VALUE=local\n',
    );
    const module = pathToFileURL(resolve('agent.mjs')).href;
    const source = `import {loadEnvironment} from ${JSON.stringify(module)};loadEnvironment(process.argv[1]);console.log(JSON.stringify({token:process.env.TGCLOUD_TOKEN,value:process.env.AGENT_FIXTURE_VALUE,base:process.env.AGENT_BASE_ONLY}));`;
    const env = { ...process.env, TGCLOUD_TOKEN: 'environment-fixture' };
    delete env.AGENT_FIXTURE_VALUE;
    delete env.AGENT_BASE_ONLY;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', source, directory],
      { env, encoding: 'utf8' },
    );
    assert.deepEqual(JSON.parse(output), {
      token: 'environment-fixture',
      value: 'local',
      base: 'yes',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cloud failures do not echo credentials or remote exception content', async () => {
  const cloud = createCloudClient('app1:fixture', async () => ({
    ok: false,
    status: 403,
    json: async () => ({ ok: false, error: 'SECRET_SENTINEL' }),
  }));
  await assert.rejects(
    cloud.inspect(),
    (error) => /403/.test(error.message) && !error.message.includes('SECRET_SENTINEL'),
  );
});

test('partial loop changes are checked against saved settings before any configuration write', async () => {
  const previous = {
    ...existingAgent(),
    loopSettings: { revision: 3, defaults: { finalizationReserveMs: 5000 }, overrides: {} },
  };
  const valid = harness(previous);
  valid.options.config.loop = { defaults: { maxDurationMs: 10000 } };
  await runCommand('configure', valid.options);
  assert.ok(valid.calls.some((c) => c[0] === 'configure'));
  const invalid = harness({
    ...previous,
    loopSettings: { revision: 3, defaults: { finalizationReserveMs: 15000 }, overrides: {} },
  });
  invalid.options.config.loop = { defaults: { maxDurationMs: 10000 } };
  await assert.rejects(runCommand('configure', invalid.options), /Invalid agent settings/);
  assert.deepEqual(invalid.calls, [['inspect']]);
});

test('deployment anchors the official CLI to this checkout rather than an ancestor project', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-project-')),
    previous = process.cwd(),
    child = join(directory, 'checkout');
  try {
    await mkdir(join(directory, '.tgcloud'));
    await mkdir(child);
    const canonicalChild = await realpath(child);
    process.chdir(child);
    const { options } = harness(existingAgent());
    delete options.prepareProject;
    options.run = (_node, _args, opts) => {
      assert.equal(opts.cwd, canonicalChild);
      assert.equal(findProjectRoot(), canonicalChild);
      return { status: 0 };
    };
    await runCommand('deploy', options);
    assert.equal((await stat(join(child, '.tgcloud'))).isDirectory(), true);
  } finally {
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test('new-wallet preparation is local, private and reused rather than regenerated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-new-wallet-'));
  try {
    const first = await loadWallet(configuration(), null, directory);
    const second = await loadWallet(configuration(), null, directory);
    assert.equal(first.publicKey, second.publicKey);
    assert.equal(first.mnemonic.length, 24);
    assert.equal((await stat(join(directory, 'wallet-mainnet.json'))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
