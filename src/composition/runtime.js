import { createDiagnosticReporter } from '../shared/diagnostics.js';
import { createChainCapabilities } from '../adapters/chain/index.js';
import { createMarketCapabilities } from '../adapters/market/provider.js';
import { createAssetPlanners } from '../adapters/assets/index.js';
import { createUranusCapabilities } from '../adapters/uranus/provider.js';
import { createSwapPlanner } from '../adapters/swaps/planner.js';
import { createFinancialOperations } from '../application/finance/operations.js';
import { createMediaService, createMetadataService } from '../application/media.js';
import { createTelegramMedia } from '../adapters/telegram/media.js';
import { createPinata } from '../adapters/ipfs.js';
import { createTonServicesAdmin } from '../application/ton-services.js';
import { createWebProvider } from '../adapters/web/provider.js';
import { createWebAdmin } from '../application/web.js';
import { createAutonomy } from '../application/autonomy/service.js';
import { createFeatureCommands } from '../application/feature-commands.js';
import { createFeatureAdmin } from '../application/features.js';
import { allowsTool, allowsConversation } from '../shared/access-policy.js';
import { AgentError } from '../shared/errors.js';
import { createSettingsAdmin } from '../application/settings.js';
import { createModelProfileReader } from '../adapters/model-profile.js';
import { createDiscovery } from '../tools/discovery/index.js';
import { createReceptionTrace } from '../application/reception.js';
import { errorCode } from '../shared/errors.js';
import { permittedRegistry } from '../tools/permissions.js';
import { createTelegramOperations } from '../application/telegram/operations.js';
import { createStarPayments } from '../application/telegram/payments.js';
import { createTelegramMessages } from '../application/telegram/messages.js';
import { createTelegramConnections } from '../adapters/sqlite/telegram.js';
import { createTelegramEvents } from '../application/telegram/events.js';
import { createDelivery } from '../application/delivery.js';
import { createRepositories } from '../adapters/sqlite/index.js';
import {
  createTelegramAdapter,
  normalizeMessage,
  normalizeCallback,
} from '../adapters/telegram.js';
import { createOpenRouter } from '../adapters/openrouter.js';
import { createTonClient } from '../adapters/ton-client.js';
import { formatTON, signTransfer, signContractMessage, walletAddress } from '../domain/wallet.js';
import { createTransfers } from '../application/transfers.js';
import { createAgentApplication } from '../application/agent.js';
import { createAdmin } from '../application/admin.js';
import { createBuiltinRegistry } from './tools.js';
import { createToolExecutor } from '../tools/executor.js';

/** Composition root: builds providers, repositories and scoped capabilities. */
export function createRuntime({
  db,
  api,
  fetcher,
  now = () => Date.now(),
  log = (_event, _fields) => {},
  modelFactory = createOpenRouter,
  chainFactory = createTonClient,
  makeFormData = undefined,
  makeFile = undefined,
}) {
  const {
    configuration,
    secrets,
    conversations,
    memory,
    scopedMemory,
    operations,
    agentSettings,
    turns,
    features,
    workspace,
    tasks,
  } = createRepositories(db, now);
  const report = createDiagnosticReporter(log);
  const telegram = createTelegramAdapter(api);
  const connections = createTelegramConnections(db);
  const deliver = createDelivery({ operations, telegram, log });
  const getChain = async (config) =>
    chainFactory(fetcher, config.network, (await secrets.getSecret('toncenter')) || '');
  async function getWallet(config, turn = {}) {
    const ton = await getChain(config);
    const transfers = createTransfers({
      report,
      operations,
      telegram: { sendMessage: telegram.sendMessage },
      ton,
      config,
      now,
      authorize: async () => {
        if (
          !allowsTool((await features.access()).value, 'ton_send', {
            owner: true,
            group: false,
            surface: 'dm',
            actorId: config.ownerId,
          })
        )
          throw new AgentError(
            'tool_forbidden',
            'TON transfers are disabled. You can still cancel the pending transfer.',
            { effectNotStarted: true },
          );
      },
      sign: async (request) =>
        signTransfer({
          ...request,
          publicKey: config.walletPublicKey,
          network: config.network,
          secretKey: await secrets.getSecret('wallet_key'),
        }),
    });
    const address = walletAddress(config.walletPublicKey, config.network);
    const market = createMarketCapabilities({
      fetcher,
      walletAddress: address,
      network: config.network,
      now,
    });
    const chainReads = createChainCapabilities({
      chain: ton,
      walletAddress: address,
      network: config.network,
    });
    const downloads = createTelegramMedia({
      getFileContent: (id) => api.getFileContent(id),
      getFileStream: async (id) => (await api.getFileStream(id)).body,
    });
    const workspacePort = workspace.port(
      'agent',
      turn.assertActive,
      turn.chatId ? { chatId: turn.chatId, token: turn.token } : undefined,
    );
    const metadata = createMetadataService({
      pinata: createPinata({
        fetcher,
        jwt: (await secrets.getSecret('pinata')) || '',
        makeFormData,
        makeFile,
      }),
      download: downloads.download,
      workspace: workspacePort,
      journal: operations,
      assertActive: turn.assertActive,
    });
    const uranus = createUranusCapabilities({
      chain: ton,
      market,
      walletAddress: address,
      network: config.network,
      metadata,
    });
    const swaps = createSwapPlanner({
      chain: ton,
      fetcher,
      walletAddress: address,
      network: config.network,
      now,
    });
    const financial = createFinancialOperations({
      report,
      operations,
      telegram,
      chain: ton,
      config: { ...config, walletAddress: address },
      planners: {
        ...createAssetPlanners({ chain: ton, walletAddress: address, network: config.network }),
        ...uranus.planners,
        ton_swap: swaps,
      },
      now,
      reconcileLegacy: transfers.reconcile,
      authorize: async (name) => {
        if (
          !allowsTool((await features.access()).value, name, {
            owner: true,
            group: false,
            surface: 'dm',
            actorId: config.ownerId,
          })
        )
          throw new AgentError('tool_forbidden', 'This financial tool is disabled.', {
            effectNotStarted: true,
          });
      },
      sign: async (request) =>
        signContractMessage({
          ...request,
          publicKey: config.walletPublicKey,
          network: config.network,
          secretKey: await secrets.getSecret('wallet_key'),
        }),
    });
    const combinedTransfers = {
      ...transfers,
      reconcile: async () => {
        await financial.reconcileRecent();
        return financial.reconcile();
      },
    };
    return {
      ton,
      transfers: combinedTransfers,
      financial,
      chainReads,
      market,
      uranus,
      swaps,
      downloads,
    };
  }
  async function validateSurface(scope) {
    const config = await configuration.getConfig();
    if (scope.surface === 'business') {
      const stored = await connections.get();
      if (
        !(await features.secretary()).value.enabled ||
        !stored?.enabled ||
        stored.id !== scope.businessConnectionId
      )
        throw new AgentError('business_disabled', 'Secretary Mode is paused or disconnected.', {
          effectNotStarted: true,
        });
      const live = await telegram.call('getBusinessConnection', {
        business_connection_id: stored.id,
      });
      if (
        !live.is_enabled ||
        String(live.user?.id) !== String(config.ownerId) ||
        !live.rights?.can_reply
      )
        throw new AgentError('business_disabled', 'The Business connection cannot reply.', {
          effectNotStarted: true,
        });
    } else if (
      !['task', 'heartbeat', 'guest'].includes(scope.surface) &&
      !allowsConversation(
        (await features.access()).value,
        {
          actor: { id: scope.actorId },
          chat: { id: scope.destination, type: scope.group ? 'group' : 'private' },
        },
        scope.owner,
      )
    ) {
      throw new AgentError('access_revoked', 'Conversation access was revoked.', {
        effectNotStarted: true,
      });
    }
    await scope.checkRun?.();
  }
  async function createTurn(
    config,
    { chatId, token, assertActive, scope, settings },
    { ton, transfers, financial, chainReads, market, uranus, swaps, downloads },
  ) {
    let registry, discovery;
    const webConfig = JSON.parse((await secrets.getSecret('web_provider')) || 'null');
    const messenger = createTelegramMessages({
      operations,
      deliver,
      ownerId: config.ownerId,
      now,
      scope,
      validateAction: (action) => {
        const target = discovery.resolve(action.tool, JSON.stringify(action.args));
        target.tool.prepare(target.raw);
      },
    });
    registry = permittedRegistry(
      createBuiltinRegistry({
        memory: scope.memoryScope
          ? scopedMemory.forScope(scope.memoryScope, chatId, token)
          : {
              set: (key, value, tags) => memory.setNote(chatId, token, key, value, tags),
              get: memory.getNote,
              search: memory.searchNotes,
            },
        messenger,
        web: webConfig
          ? createWebProvider(
              fetcher,
              webConfig,
              Math.min(
                settings.toolResultMaxBytes,
                Math.max(
                  1024,
                  Math.floor(((settings.activeContextTokens - settings.maxOutputTokens) * 2) / 8),
                ),
              ),
            )
          : undefined,
        workspace: workspace.port('agent', assertActive, { chatId, token }),
        chainReads,
        market,
        financial,
        uranus,
        swaps,
        media: createMediaService({
          download: downloads.download,
          workspace: workspace.port('agent', assertActive, { chatId, token }),
          assertActive,
        }),
        ...createTelegramOperations({ telegram, connections, ownerId: config.ownerId, scope }),
        payments: createStarPayments({ operations, telegram, ownerId: config.ownerId, now }),
        wallet: {
          identity: () => ({
            address: walletAddress(config.walletPublicKey, config.network),
            network: config.network,
          }),
          async balance() {
            const address = walletAddress(config.walletPublicKey, config.network);
            const state = await (ton || (await getChain(config))).state(address);
            return {
              address,
              network: config.network,
              balance_nano: state.balance,
              balance_ton: formatTON(state.balance),
            };
          },
        },
        // Preparation only: the tool cannot decide(), sign() or read a secret.
        transfers: { prepare: transfers?.prepare, validate: transfers?.validate },
      }),
      scope,
      (await features.access()).value,
    );
    discovery = createDiscovery(registry, settings);
    const complete = modelFactory(fetcher, {
      apiKey: await secrets.getSecret('openrouter'),
      model: config.model,
    });
    return {
      complete,
      schemas: discovery.schemas,
      listing: discovery.listing,
      execute: createToolExecutor({
        report,
        registry,
        journal: operations,
        token,
        assertActive,
        resolve: discovery.resolve,
        authorize: async (name, prepared) => {
          if (scope.draftApproval && prepared.effect === 'external_write')
            throw new AgentError(
              'approval_required',
              'Return draft text for owner approval; publishing actions are unavailable in this run.',
              { effectNotStarted: true },
            );
          if (name !== 'tool_search' && !allowsTool((await features.access()).value, name, scope))
            throw new AgentError('tool_forbidden', 'This tool is no longer permitted.', {
              effectNotStarted: true,
            });
        },
      }),
    };
  }
  const app = createAgentApplication({
    report,
    configuration,
    conversations,
    operations,
    agentSettings,
    turns,
    telegram,
    getWallet,
    createTurn,
    features,
    workspace,
    validateSurface,
    handleFeatureCommand: (request) => featureCommands(request),
    now,
    log,
  });
  const featureAdmin = createFeatureAdmin({ features, workspace, configuration });
  const autonomy = createAutonomy({
    tasks,
    workspace,
    configuration,
    operations,
    turns,
    app,
    deliver,
    now,
  });
  const featureCommands = createFeatureCommands({ features: featureAdmin, autonomy });
  const admin = createAdmin({
    configuration,
    secrets,
    telegram: { getMe: telegram.getMe },
    getChain,
    checkStorage: async () => (await db.get('SELECT 1 AS n')).n,
  });
  const traceReception = createReceptionTrace({ operations });
  const events = createTelegramEvents({
    configuration,
    connections,
    operations,
    telegram,
    deliver,
    app,
    now,
  });
  return Object.freeze({
    onBusinessConnection: events.onBusinessConnection,
    onGuestMessage: async (message, context) => {
      if (!(await telegram.getMe()).supports_guest_queries || !message.guest_query_id)
        return { ignored: true };
      return app.onMessage({
        ...normalizeMessage(message, context),
        surface: 'guest',
        mentioned: true,
      });
    },
    onBusinessMessage: async (message, context) => {
      const config = await configuration.getConfig(),
        connection = await connections.get();
      if (
        !config ||
        !connection?.enabled ||
        message.business_connection_id !== connection.id ||
        String(message.from?.id) === String(config.ownerId) ||
        !(await features.secretary()).value.enabled
      )
        return { ignored: true };
      return app.onMessage({ ...normalizeMessage(message, context), surface: 'business' });
    },
    onPreCheckout: events.onPreCheckout,
    onMessage: async (message, context) => {
      if (message.successful_payment) return events.onPayment(message);
      let incoming = normalizeMessage(message, context);
      const details = {
        entity_types: (message.entities || message.caption_entities || []).map(
          (entity) => entity.type,
        ),
        update_keys: Object.keys(context?.update || {}),
      };
      await traceReception(incoming, 'received', details);
      try {
        const identity =
          ['group', 'supergroup'].includes(message.chat?.type) || /^\/\w+@/.test(message.text || '')
            ? await telegram.getMe()
            : {};
        incoming = normalizeMessage(message, context, identity);
        await traceReception(incoming, 'normalized', details);
        const result = await app.onMessage(incoming);
        await traceReception(incoming, 'handled', { ...details, result });
        return result;
      } catch (error) {
        await traceReception(incoming, 'failed', { ...details, code: errorCode(error) });
        throw error;
      }
    },
    onCallback: (callback, context) =>
      callback.data?.startsWith('button:')
        ? events.onButton(normalizeCallback(callback, context))
        : app.onCallback(normalizeCallback(callback, context)),
    ...admin,
    ...createTonServicesAdmin({ secrets }),
    ...createWebAdmin({ secrets }),
    ...featureAdmin,
    ...autonomy,
    initializeFeatures: async (options = {}) => {
      const result = await featureAdmin.initializeFeatures(options);
      if (!(await autonomy.getHeartbeat()))
        await autonomy.updateHeartbeat({ expectedRevision: 0, enabled: false });
      return result;
    },
    ...createSettingsAdmin({
      configuration,
      agentSettings,
      fetchProfile: createModelProfileReader(fetcher),
    }),
  });
}
