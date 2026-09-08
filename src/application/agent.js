import { allowsTool } from '../shared/access-policy.js';
import { createLiveProgress } from './live-progress.js';
import { resolveSettings } from '../agent/settings.js';
import { projectResult } from '../agent/results.js';
import { recoverTurns, repairTranscript, withTurnOutcome } from './turn-recovery.js';
import { conversationScope, conversationInput } from './conversation.js';
import { Buffer } from 'buffer';
import { AgentError, errorCode, userError } from '../shared/errors.js';
import { runAgent } from '../agent/loop.js';
import { buildSystemPrompt } from '../agent/prompt.js';
import { createDelivery } from './delivery.js';
import { createCommandHandler } from './commands.js';

/** Application workflow. All infrastructure is assembled outside this module. */
export function createAgentApplication({
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
  validateSurface = async (_scope) => {},
  handleFeatureCommand = async (_request) => null,
  now,
  log,
  report = (_error, _context) => {},
}) {
  const allowed = (config, actor, chat) =>
    actor &&
    !actor.isBot &&
    chat?.type === 'private' &&
    String(actor.id) === String(config.ownerId) &&
    String(chat.id) === String(config.ownerId);
  const sendOnce = createDelivery({ operations, telegram, log });
  const handleCommand = createCommandHandler({ conversations, operations, sendOnce, turns });
  return {
    async onMessage(incoming, internalScope = undefined) {
      const config = await configuration.getConfig();
      const policy = features ? (await features.access()).value : undefined;
      const scope = config && (internalScope || conversationScope(incoming, config, policy));
      if (!scope) return { ignored: true };
      await validateSurface(scope);
      const updateId = incoming.updateId;
      if (!internalScope && (!Number.isSafeInteger(updateId) || updateId < 0))
        return { ignored: true };
      const event = internalScope?.eventId || `update:${updateId}`;
      if (!(await operations.claim(event, 'update'))) return { duplicate: true };
      const chatId = scope.sessionId;
      const respond = (text, options = {}) =>
        scope.suppressFinal
          ? Promise.resolve({})
          : sendOnce(event, scope.destination, text, {
              replyTo: scope.replyTo,
              threadId: scope.threadId,
              businessConnectionId: scope.businessConnectionId,
              guestQueryId: scope.editRef ? undefined : scope.guestQueryId,
              editRef: scope.editRef,
              assertActive: () => validateSurface(scope),
              ...options,
            });
      if (/^\/stop(?:\s|$)/i.test(incoming.text || '')) {
        const stopped = await turns.requestStop(chatId, scope.actorId, scope.owner);
        await respond(
          stopped
            ? 'Stop requested. An operation already sent may still complete.'
            : 'No running turn that you can stop was found.',
        );
        await operations.transition(event, ['processing'], 'completed', { command: 'stop' });
        return { command: 'stop', stopped };
      }
      // Management commands have their own update claim; a long manual task must not
      // hold the owner conversation lease and prevent a later pause/stop command.
      if (
        !internalScope &&
        scope.owner &&
        scope.surface === 'dm' &&
        /^\/(access|workspace|soul|heartbeat|secretary|tasks)(?:\s|$)/i.test(incoming.text || '')
      ) {
        try {
          if (Buffer.byteLength(incoming.text) > 16000)
            throw new AgentError('message_too_large', 'This message is too long.');
          return await handleFeatureCommand({ input: incoming.text.trim(), event, respond });
        } catch (error) {
          await respond(userError(error));
          return { error: errorCode(error) };
        } finally {
          await operations.transition(event, ['processing'], 'completed', { command: 'features' });
        }
      }
      const document = await agentSettings.read();
      const settings = resolveSettings(
        document,
        scope.surface || (scope.group ? 'group' : 'dm'),
        await agentSettings.modelProfile(config.model),
      );
      if (!(await conversations.acquireChat(chatId, event, settings.maxDurationMs + 60000))) {
        if (!scope.editRef) await respond('A response is already in progress. Try again shortly.');
        await operations.transition(event, ['processing'], 'busy', {});
        return { busy: true };
      }
      const started = now();
      let startedTurn = false;
      let deliveryStarted = false;
      // Final status delivery may outlive the inference budget, but never the lease.
      const assertDeliveryActive = async () => {
        await conversations.assertChat(chatId, event);
        await validateSurface(scope);
        if (startedTurn && (await turns.get(event))?.cancel_requested)
          throw new AgentError('turn_cancelled', 'The turn was stopped.');
      };
      const assertActive = async () => {
        if (now() - started > settings.maxDurationMs)
          throw new AgentError('turn_expired', 'This turn has reached its time limit.');
        await assertDeliveryActive();
      };
      try {
        const input = conversationInput(incoming, scope);
        if (!input) {
          await respond('This version supports text messages only.');
          return { text_only: true };
        }
        if (Buffer.byteLength(input) > 16_000)
          throw new AgentError('message_too_large', 'This message is too long.');
        const recoveredHistory = await recoverTurns({
          turns,
          operations,
          conversations,
          sessionId: chatId,
          token: event,
          maxBytes: settings.toolResultMaxBytes,
        });
        const wallet = await getWallet(config, { scope, chatId, token: event, assertActive });
        const command =
          internalScope || ['guest', 'business'].includes(scope.surface)
            ? null
            : await handleCommand({ input, event, config, chatId, scope, respond, ...wallet });
        if (command) return command;
        if (
          !scope.owner &&
          !(await operations.allowReply(
            scope.destination,
            scope.actorId,
            event,
            policy?.rate.per_user_hour ?? 10,
          ))
        )
          return { rate_limited: true };
        scope.assertActive = assertActive;
        const onProgress = createLiveProgress({ telegram, scope, event, now, assertActive });
        if (!['guest', 'business', 'heartbeat', 'task'].includes(scope.surface))
          try {
            await telegram.sendChatAction({
              chat_id: scope.destination,
              ...(scope.threadId ? { message_thread_id: scope.threadId } : {}),
              action: 'typing',
            });
          } catch {
            /* Cosmetic only. */
          }
        const history = recoveredHistory;
        const soul = workspace
          ? await workspace
              .port()
              .read('SOUL.md')
              .catch(() => null)
          : null;
        const secretary =
          scope.surface === 'business' && workspace
            ? await workspace
                .port()
                .read('SECRETARY.md')
                .catch(() => null)
            : null;
        await turns.start(
          event,
          chatId,
          scope.actorId,
          { revision: document.revision, values: settings },
          event,
        );
        startedTurn = true;
        const { complete, execute, schemas, listing } = await createTurn(
          config,
          { chatId, token: event, assertActive, scope, settings },
          wallet,
        );
        const checkpoint = (value) => turns.checkpoint(event, chatId, event, value);
        let result;
        if (incoming.directTool) {
          const call = {
            id: 'button',
            type: 'function',
            function: {
              name: incoming.directTool.tool,
              arguments: JSON.stringify(incoming.directTool.args),
            },
          };
          const prepared = execute.prepare(call.function.name, call.function.arguments, 'button');
          const transcript = /** @type {Array<Record<string, any>>} */ ([
            { role: 'user', content: input },
            { role: 'assistant', content: null, tool_calls: [call] },
          ]);
          await checkpoint({
            transcript,
            pending: [{ callId: 'button', operationId: prepared.operationId, name: prepared.name }],
            usages: [],
          });
          const value = await execute.run(prepared);
          transcript.push({
            role: 'tool',
            tool_call_id: 'button',
            content: projectResult(value, settings.toolResultMaxBytes),
          });
          await checkpoint({ transcript, pending: [], usages: [] });
          result = {
            text: value.reply_delivered ? '' : JSON.stringify(value, null, 2),
            transcript,
            usages: [],
            history,
            delivered: Boolean(value.reply_delivered),
            status:
              value.operation_state === 'unknown'
                ? 'partial'
                : value.error
                  ? 'failed'
                  : 'completed',
            reason: value.error || null,
          };
        } else {
          result = await runAgent({
            report: (error, details) => report(error, { ...details, event }),
            input,
            history,
            tools: schemas,
            complete,
            execute,
            assertActive,
            settings,
            now,
            startedAt: started,
            checkpoint,
            onProgress,
            summary: await turns.summary(chatId),
            saveSummary: (value) => turns.saveSummary(chatId, event, value),
            allowEmpty: scope.group || scope.suppressFinal,
            systemPrompt: buildSystemPrompt(
              scope,
              config.network,
              [soul?.content ?? config.personality, secretary?.content]
                .filter(Boolean)
                .join('\n\n'),
              listing,
            ),
          });
        }
        await conversations.assertChat(chatId, event);
        const stored = await turns.get(event);
        const repaired = await repairTranscript(
          stored.checkpoint,
          operations,
          settings.toolResultMaxBytes,
        );
        // runAgent may return its final assistant text after its last explicit checkpoint.
        result.transcript = repaired;
        if (stored.cancel_requested) {
          result.status = 'cancelled';
          result.text = '';
        }
        result.transcript = withTurnOutcome(result.transcript, result.status, result.reason);
        await conversations.saveHistory(chatId, event, [
          ...result.history,
          { id: event, messages: result.transcript },
        ]);
        if (result.status !== 'cancelled') await assertDeliveryActive();
        if (
          !(
            result.delivered ||
            ((internalScope || scope.surface === 'guest') && result.deliveredAny)
          ) &&
          result.text
        ) {
          deliveryStarted = true;
          await respond(result.text, { format: 'rich', assertActive: assertDeliveryActive });
          await assertDeliveryActive();
        }
        await turns.finish(event, chatId, event, result.status, {
          ...stored.checkpoint,
          transcript: result.transcript,
          pending: [],
          status: result.status,
          reason: result.reason,
          budget: result.budget,
        });
        await operations.transition(event, ['processing'], result.status, {
          usage: result.usages,
          model: config.model,
          chat_id: scope.destination,
          topic: scope.threadId || 0,
          actor_id: scope.actorId,
          budget: result.budget,
          reason: result.reason,
        });
        log('turn_finished', {
          status: result.status,
          reason: result.reason || null,
          update_id: updateId,
          model: config.model,
          inference_calls: result.usages.length,
        });
        return {
          text: internalScope ? result.text : undefined,
          delivered: Boolean(result.deliveredAny || result.delivered),
          completed: result.status === 'completed',
          status: result.status,
          inference_calls: result.usages.length,
          ...(incoming.directTool ? { direct_tool: incoming.directTool.tool } : {}),
        };
      } catch (error) {
        if (startedTurn) {
          try {
            const row = await turns.get(event);
            if (row?.status === 'running') {
              const transcript = withTurnOutcome(
                await repairTranscript(row.checkpoint, operations, settings.toolResultMaxBytes),
                row.cancel_requested ? 'cancelled' : 'failed',
                errorCode(error),
              );
              const prior = await conversations.history(chatId);
              await conversations.saveHistory(
                chatId,
                event,
                prior.some((t) => t.id === event)
                  ? prior.map((t) => (t.id === event ? { ...t, messages: transcript } : t))
                  : [...prior, { id: event, messages: transcript }],
              );
              await turns.finish(
                event,
                chatId,
                event,
                row.cancel_requested ? 'cancelled' : 'failed',
                { ...row.checkpoint, transcript, pending: [], reason: errorCode(error) },
              );
            }
          } catch {
            /* A newer lease owns persistence and recovery. */
          }
        }
        report(error, { phase: deliveryStarted ? 'final_delivery' : 'conversation', event });
        log('turn_finished', {
          update_id: updateId,
          status: errorCode(error) === 'turn_cancelled' ? 'cancelled' : 'failed',
          reason: errorCode(error),
        });
        const status = errorCode(error) === 'turn_cancelled' ? 'cancelled' : 'failed';
        await operations.transition(event, ['processing'], status, { code: errorCode(error) });
        if (!deliveryStarted && status !== 'cancelled')
          try {
            await assertDeliveryActive();
            await respond(userError(error), { assertActive: assertDeliveryActive });
          } catch {
            /* Stale workers must not publish. */
          }
        return { error: errorCode(error), status };
      } finally {
        await operations.transition(event, ['processing'], 'completed', {});
        await conversations.releaseChat(chatId, event);
      }
    },
    async onCallback(incoming) {
      const config = await configuration.getConfig();
      if (!config || !allowed(config, incoming.actor, incoming.chat)) return { ignored: true };
      const updateId = incoming.updateId;
      if (!Number.isSafeInteger(updateId) || updateId < 0) return { ignored: true };
      const event = `update:${updateId}`;
      if (!(await operations.claim(event, 'callback'))) return { duplicate: true };
      try {
        await telegram.answerCallbackQuery({ callback_query_id: incoming.callbackId });
      } catch {
        /* Stale acknowledgement is harmless. */
      }
      let text;
      try {
        const { transfers, financial } = await getWallet(config);
        if (
          incoming.data?.startsWith('confirm:') &&
          features &&
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
          );
        text = await (incoming.data?.startsWith('action_') ? financial : transfers).decide({
          data: incoming.data,
          actorId: incoming.actor.id,
          messageId: incoming.messageId,
        });
      } catch (error) {
        text = userError(error);
        report(error, { phase: 'financial_callback', event });
      }
      await sendOnce(event, config.ownerId, text, {
        format: 'rich',
        ...(text.startsWith('TON transfers are disabled.')
          ? {}
          : { editRef: { chat_id: config.ownerId, message_id: incoming.messageId } }),
      });
      await operations.transition(event, ['processing'], 'completed', {});
      return { handled: true };
    },
  };
}
