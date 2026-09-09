import { readFile, readdir, mkdir, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { publicKeyFromSeed } from './src/domain/crypto.js';
import { walletAddress } from './src/domain/wallet.js';
import { validateAccess, TOOL_DEFAULTS } from './src/shared/access-policy.js';
import { updateSettingsDocument, resolveSettings } from './src/agent/settings.js';
import { buildAgent } from './build.mjs';

export function loadEnvironment(directory = process.cwd()) {
  // Existing environment > private local overrides > .env.
  for (const name of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(resolve(directory, name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function validateConfig(input) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object' ||
    Object.keys(input).some(
      (key) => !['ownerId', 'model', 'network', 'loop', 'access'].includes(key),
    )
  )
    throw new Error('Invalid agent.config.json fields.');
  if (!Number.isSafeInteger(input.ownerId) || input.ownerId <= 0)
    throw new Error('Set ownerId to your numeric Telegram user ID in agent.config.json.');
  if (input.network !== 'mainnet') throw new Error('Set network to mainnet in agent.config.json.');
  if (typeof input.model !== 'string' || !/^[a-z0-9_-]+\/[a-z0-9._:-]+$/i.test(input.model))
    throw new Error('Set a valid OpenRouter model in agent.config.json.');
  if (input.loop !== undefined) {
    if (
      !input.loop ||
      Array.isArray(input.loop) ||
      typeof input.loop !== 'object' ||
      Object.keys(input.loop).some((key) => !['defaults', 'overrides'].includes(key))
    )
      throw new Error('loop accepts defaults and overrides.');
  }
  if (input.access !== undefined) {
    validateAccess(input.access);
    if (Object.keys(input.access.tools).some((name) => !Object.hasOwn(TOOL_DEFAULTS, name)))
      throw new Error('Unknown tool in agent.config.json access.tools.');
  }
  return input;
}

export async function readConfig(path = 'agent.config.json') {
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Cannot read valid JSON from agent.config.json.');
  }
  return validateConfig(value);
}

function validateKeys(env, configure = false) {
  if (!/^app\d+:[A-Za-z0-9_-]+$/.test(env.TGCLOUD_TOKEN || ''))
    throw new Error('Set TGCLOUD_TOKEN in .env to your Serverless CLI access token.');
  if (configure && !env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY in .env.');
  for (const name of ['OPENROUTER_API_KEY', 'TONCENTER_API_KEY', 'TAVILY_API_KEY', 'PINATA_JWT']) {
    if (env[name] && (env[name].length > 8192 || /\s/.test(env[name])))
      throw new Error('Invalid credential format: ' + name);
  }
  if (env.TAVILY_API_KEY?.length > 512)
    throw new Error('Invalid credential format: TAVILY_API_KEY');
}

async function modules() {
  const sources = { schema: await readFile('schema.js', 'utf8') };
  async function collect(directory) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${file.name}`;
      if (file.isDirectory()) await collect(path);
      else if (file.name.endsWith('.js')) sources[path.slice(0, -3)] = await readFile(path, 'utf8');
    }
  }
  await collect('lib');
  await collect('handlers');
  return sources;
}

export function createCloudClient(token, fetcher = fetch) {
  async function request(path, body) {
    const response = await fetcher(
      `https://cloud.telegram.org/${token.split(':')[0]}/manage${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      throw new Error(`Serverless request failed (${response.status}).`);
    }
    if (!response.ok || !envelope.ok)
      throw new Error(`Serverless request failed (${response.status}).`);
    return envelope.result;
  }
  async function run(sources, args = {}) {
    const response = await request('/run', { module: 'handlers/message', sources, args, ctx: {} });
    if (response.error || response.exception || !Object.hasOwn(response, 'result'))
      throw new Error('Serverless management invocation failed.');
    return response.result;
  }
  return {
    async inspect(model) {
      await request('/get'); // Authenticate before any local wallet creation or deployment.
      return run(
        {
          'handlers/message': `import { db } from 'sdk';
export default async function ({model}) {
  if (!await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_settings'")) return null;
  const row=await db.get("SELECT value FROM agent_settings WHERE key='config'");
  if (!row) return null;
  const c=JSON.parse(row.value);
  const settings=await db.get("SELECT value FROM agent_settings WHERE key='loop_settings'");
  const profile=model?await db.get("SELECT value FROM agent_settings WHERE key=:key",{':key':'model-profile:'+model}):null;
  return {ownerId:c.ownerId,model:c.model,network:c.network,walletPublicKey:c.walletPublicKey,personality:c.personality||'',loopSettings:settings?JSON.parse(settings.value):{revision:0,defaults:{},overrides:{}},modelProfile:profile?JSON.parse(profile.value):null};
}`,
        },
        { model },
      );
    },
    async invoke(name, args = {}) {
      if (!/^[a-zA-Z]+$/.test(name)) throw new Error('Invalid management method.');
      return run(
        {
          ...(await modules()),
          'handlers/message': `import { ${name} } from 'lib/runtime'; export default ${name};`,
        },
        args,
      );
    },
    webhook: () => request('/webhook'),
  };
}

function sameIdentity(config, existing) {
  if (
    existing &&
    (existing.ownerId !== config.ownerId ||
      existing.network !== config.network ||
      !/^[a-f0-9]{64}$/i.test(existing.walletPublicKey || ''))
  )
    throw new Error(
      'The selected bot has a different owner or network. Configuration was not changed.',
    );
}

export async function loadWallet(config, existing, directory = '.local') {
  const path = resolve(directory, `wallet-${config.network}.json`);
  let wallet;
  try {
    wallet = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('The wallet backup is invalid. Restore it before configuring the agent.');
    if (existing)
      throw new Error('Restore .local/wallet-mainnet.json before configuring this existing agent.');
    const mnemonic = await mnemonicNew(24),
      key = await mnemonicToPrivateKey(mnemonic);
    wallet = {
      network: config.network,
      mnemonic,
      publicKey: key.publicKey.toString('hex'),
      secretKey: key.secretKey.toString('hex'),
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(path, JSON.stringify(wallet, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (
    wallet.network !== config.network ||
    !/^[a-f0-9]{128}$/i.test(wallet.secretKey || '') ||
    !/^[a-f0-9]{64}$/i.test(wallet.publicKey || '')
  )
    throw new Error('The wallet backup is invalid.');
  const publicKey = publicKeyFromSeed(
    Buffer.from(wallet.secretKey, 'hex').subarray(0, 32),
  ).toString('hex');
  if (
    publicKey !== wallet.publicKey ||
    wallet.secretKey.slice(64).toLowerCase() !== publicKey ||
    (existing && existing.walletPublicKey !== publicKey)
  )
    throw new Error('The wallet backup does not match this agent.');
  await chmod(path, 0o600);
  return wallet;
}

async function configureAgent(config, env, wallet, existing, cloud) {
  await cloud.invoke('configure', {
    ownerId: config.ownerId,
    model: config.model,
    network: config.network,
    walletKey: wallet.secretKey,
    openrouterKey: env.OPENROUTER_API_KEY,
    ...(env.TONCENTER_API_KEY ? { toncenterKey: env.TONCENTER_API_KEY } : {}),
    personality: existing?.personality || '',
  });
  await cloud.invoke('initializeFeatures');
  if (env.TAVILY_API_KEY)
    await cloud.invoke('configureWeb', { provider: 'tavily', apiKey: env.TAVILY_API_KEY });
  const services = {
    ...(env.TONCENTER_API_KEY ? { toncenterKey: env.TONCENTER_API_KEY } : {}),
    ...(env.PINATA_JWT ? { pinataKey: env.PINATA_JWT } : {}),
  };
  if (Object.keys(services).length) await cloud.invoke('configureTonServices', services);
  if (config.loop !== undefined) {
    const current = await cloud.invoke('getAgentSettings');
    await cloud.invoke('updateAgentSettings', {
      ...config.loop,
      expectedRevision: current.revision,
    });
  }
  if (config.access !== undefined) {
    const current = await cloud.invoke('getAccessPolicy');
    await cloud.invoke('updateAccessPolicy', {
      expectedRevision: current.revision,
      value: config.access,
    });
  }
}

/** Deployment only publishes code on existing agents. Configuration is explicit. */
export async function runCommand(
  command,
  {
    env = process.env,
    config,
    cloud,
    build = buildAgent,
    run = spawnSync,
    wallet = loadWallet,
    prepareProject = () => mkdir(resolve('.tgcloud'), { recursive: true, mode: 0o700 }),
  } = {},
) {
  if (!['deploy', 'configure', 'status'].includes(command))
    throw new Error('Use npm run deploy, npm run configure, or npm run status.');
  validateKeys(env);
  if (command !== 'status') config = validateConfig(config || (await readConfig()));
  cloud ||= createCloudClient(env.TGCLOUD_TOKEN);
  const existing = await cloud.inspect(config?.model);
  if (command !== 'status') sameIdentity(config, existing);
  if (command === 'status') {
    const hook = await cloud.webhook();
    return {
      configured: Boolean(existing),
      ...(existing
        ? {
            ownerId: existing.ownerId,
            model: existing.model,
            network: existing.network,
            address: walletAddress(existing.walletPublicKey, existing.network),
          }
        : {}),
      webhook_in_sync: Boolean(hook.in_sync),
      pending_updates: hook.pending_update_count ?? 0,
    };
  }
  if (command === 'configure' && !existing)
    throw new Error('Run npm run deploy first to initialize this agent.');
  const apply = command === 'configure' || !existing;
  let backup;
  if (apply) {
    validateKeys(env, true);
    if (config.loop !== undefined) {
      const next = updateSettingsDocument(
        existing?.loopSettings || { revision: 0, defaults: {}, overrides: {} },
        config.loop,
      );
      for (const surface of ['dm', 'group', 'guest', 'business', 'task', 'heartbeat'])
        resolveSettings(next, surface, existing?.modelProfile || null);
    }
    backup = await wallet(config, existing);
  }
  await build();
  if (command === 'deploy') {
    // Create only the project marker. The official CLI owns every state file inside it.
    await prepareProject();
    for (const args of [['fetch'], ['push', 'schema.js'], ['migrate', '--safe'], ['push']]) {
      const result = run(process.execPath, ['node_modules/@tgcloud/cli/bin/tgcloud.js', ...args], {
        stdio: 'inherit',
        env,
        cwd: process.cwd(),
      });
      if (result.status !== 0) throw new Error('Deployment stopped at: tgcloud ' + args.join(' '));
    }
  }
  if (apply) await configureAgent(config, env, backup, existing, cloud);
  return {
    deployed: command === 'deploy',
    configured: apply,
    ...(command === 'deploy' && existing
      ? { note: 'Existing settings preserved. Use npm run configure to apply local settings.' }
      : {}),
  };
}

if (process.argv[1] === resolve('agent.mjs')) {
  loadEnvironment();
  try {
    console.log(JSON.stringify(await runCommand(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
