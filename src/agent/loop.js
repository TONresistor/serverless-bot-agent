import { AgentError, errorCode, userError } from '../shared/errors.js';
import { canonicalJSON } from '../shared/canonical.js';
import { createContextManager } from './context.js';
import { createBudget } from './budget.js';
import { createProgressGuard } from './progress.js';
import { projectResult } from './results.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { SYSTEM_PROMPT } from './prompt.js';

export async function runAgent({
  input,
  history,
  tools,
  complete,
  execute,
  assertActive,
  report = (_error, _context) => {},
  systemPrompt = SYSTEM_PROMPT,
  allowEmpty = false,
  onProgress = async (_text) => {},
  settings = DEFAULT_SETTINGS,
  summary = null,
  saveSummary = async (_value) => {},
  checkpoint = async (_state) => {},
  now = () => Date.now(),
  startedAt = now(),
}) {
  const transcript = [{ role: 'user', content: input }],
    usages = [],
    deliveredTexts = new Set();
  const budget = createBudget(settings, now, startedAt),
    progress = createProgressGuard(settings.noProgressLimit);
  let delivered = false,
    pending = [],
    lastFailure = null,
    continuation = 0,
    fragments = '',
    recoveryCount = 0;
  let finalizeOnly = false,
    stopReason = null;
  const persist = () => checkpoint({ transcript, usages, pending, budget: budget.snapshot() });
  async function model(messages, options = {}) {
    await assertActive();
    budget.consumeModel();
    await onProgress(options.noTools ? 'Preparing the answer…' : 'Thinking…');
    const r = await complete(messages, options.noTools ? [] : tools, {
      maxOutputTokens: options.maxOutputTokens || settings.maxOutputTokens,
      noTools: Boolean(options.noTools),
    });
    usages.push({ request_id: r.requestId, ...r.usage });
    await assertActive();
    return r;
  }
  const context = createContextManager({
    history,
    summary,
    input,
    tools,
    systemPrompt,
    settings,
    saveSummary,
    summarize: async (messages) => {
      if (budget.shouldFinalize()) return null;
      const r = await model(messages, {
        noTools: true,
        maxOutputTokens: settings.summaryMaxTokens,
      });
      return r.finishReason === 'length' ||
        r.message?.tool_calls?.length ||
        !r.message?.content?.trim()
        ? null
        : r.message.content;
    },
  });
  function result(text, status = 'completed', reason = null) {
    return {
      text,
      status,
      reason,
      transcript,
      usages,
      deliveredAny: delivered,
      delivered: !text ? delivered : deliveredTexts.has(text.trim()),
      history: context.retainedHistory(),
      budget: budget.snapshot(),
    };
  }
  function finishText(text, status, reason) {
    if (text) transcript.push({ role: 'assistant', content: text });
    return result(text, status, reason);
  }
  const prepare = (call, id) =>
    execute.prepare
      ? execute.prepare(call.function.name, call.function.arguments, id)
      : {
          name: call.function.name,
          callId: id,
          operationId: id,
          signature: `${call.function.name}:${canonicalJSON(JSON.parse(call.function.arguments))}`,
          effect: 'read',
          parallelSafe: false,
        };
  const run = (prepared, call) =>
    execute.run
      ? execute.run(prepared)
      : execute(call.function.name, call.function.arguments, prepared.callId);
  await persist();
  try {
    while (budget.canModel()) {
      await assertActive();
      finalizeOnly ||= budget.shouldFinalize();
      const messages = await context.prepare(transcript, !finalizeOnly);
      finalizeOnly ||= budget.shouldFinalize();
      if (finalizeOnly && !fragments)
        messages.push({
          role: 'user',
          content:
            'Runtime limit reached. Give a concise final status using recorded results only. Do not request more tools or claim unverified work succeeded.',
        });
      let response;
      try {
        response = await model(messages, { noTools: finalizeOnly });
      } catch (error) {
        report(error, { phase: 'model' });
        if (
          ['turn_cancelled', 'lease_expired', 'turn_expired', 'turn_budget'].includes(
            errorCode(error),
          )
        )
          throw error;
        if (recoveryCount++ < settings.modelRecoveryAttempts && !budget.shouldFinalize()) {
          lastFailure = errorCode(error);
          continue;
        }
        throw error;
      }
      const message = response.message;
      if (!message || typeof message !== 'object')
        throw new AgentError('invalid_response', 'The model returned an invalid response.');
      const calls = message.tool_calls;
      if (response.finishReason === 'content_filter' || response.finishReason === 'error')
        throw new AgentError('inference_failed', 'The provider could not complete this response.');
      if (response.finishReason === 'length') {
        if (calls?.length) {
          if (recoveryCount++ < settings.modelRecoveryAttempts && !budget.shouldFinalize()) {
            lastFailure = 'truncated_tool_call';
            transcript.push({
              role: 'user',
              content:
                'Runtime notice: your previous tool-call response was incomplete and no actions from it were executed. Request a smaller complete batch.',
            });
            continue;
          }
          return finishText(
            'The model could not produce a complete action request. No incomplete action was executed.',
            'partial',
            'truncated_tool_call',
          );
        }
        const part = message.content || '';
        if (fragments && part && fragments.endsWith(part))
          return result(fragments, 'partial', 'repeated_continuation');
        fragments = part.startsWith(fragments) ? part : fragments + part;
        transcript.push({ role: 'assistant', content: message.content || '' });
        if (continuation++ < settings.textContinuationAttempts && budget.canModel()) {
          transcript.push({
            role: 'user',
            content:
              'Continue the truncated answer from its exact stopping point. Do not repeat previous text or request tools.',
          });
          finalizeOnly = true;
          await persist();
          continue;
        }
        return result(fragments, 'partial', 'output_limit');
      }
      if (calls == null || (Array.isArray(calls) && calls.length === 0)) {
        const part = typeof message.content === 'string' ? message.content : '';
        const text =
          fragments && part.startsWith(fragments)
            ? part
            : fragments && fragments.endsWith(part)
              ? fragments
              : fragments + part;
        if (!text.trim() && !delivered && !allowEmpty)
          throw new AgentError('empty_response', 'The model returned an empty response.');
        if (!fragments && text) transcript.push({ role: 'assistant', content: text });
        else if (fragments && message.content)
          transcript.push({ role: 'assistant', content: message.content });
        return result(
          text,
          stopReason || (finalizeOnly && !fragments) ? 'partial' : 'completed',
          stopReason || (finalizeOnly && !fragments ? 'budget' : null),
        );
      }
      if (finalizeOnly)
        return finishText(
          fragments || 'The turn ended before a complete answer was available.',
          'partial',
          stopReason || 'budget',
        );
      if (!Array.isArray(calls) || calls.length > 8)
        throw new AgentError(
          'invalid_tools',
          'The model requested too many actions or an invalid action.',
        );
      const ids = new Set();
      for (const call of calls) {
        if (
          typeof call.id !== 'string' ||
          call.id.length > 200 ||
          ids.has(call.id) ||
          call.type !== 'function' ||
          typeof call.function?.name !== 'string' ||
          typeof call.function?.arguments !== 'string'
        )
          throw new AgentError('invalid_tools', 'The model requested an invalid action.');
        ids.add(call.id);
      }
      const round = budget.modelCalls;
      const prepared = calls.map((call) => prepare(call, `${round}:${call.id}`));
      transcript.push({
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : null,
        tool_calls: calls,
        ...(message.reasoning_details ? { reasoning_details: message.reasoning_details } : {}),
      });
      pending = prepared.map((p, i) => ({
        callId: calls[i].id,
        operationId: p.operationId,
        name: p.name,
      }));
      await persist(); // Before any effect from this batch.
      const resultBytes = Math.min(
        settings.toolResultMaxBytes,
        Math.max(
          1024,
          Math.floor(
            ((settings.activeContextTokens - settings.maxOutputTokens) * 2) / calls.length,
          ),
        ),
      );
      async function one(index) {
        const p = prepared[index];
        if (stopReason)
          return { error: 'not_executed', message: 'The turn stopped before this action.' };
        if (!budget.consumeTool()) {
          stopReason = 'tool_budget';
          return { error: 'tool_budget' };
        }
        if (progress.before(p)) {
          stopReason = 'no_progress';
          return { error: 'no_progress', message: 'Repeated calls are not making progress.' };
        }
        await onProgress(`Using ${p.name.replace(/_/g, ' ')}…`);
        const value = await run(p, calls[index]);
        progress.after(p, value);
        if (value.operation_state === 'unknown') stopReason = 'operation_unknown';
        return value;
      }
      const results = [];
      for (let i = 0; i < calls.length;) {
        await assertActive();
        let end = i + 1;
        if (prepared[i].parallelSafe)
          while (
            end < calls.length &&
            end - i < settings.maxParallelReads &&
            prepared[end].parallelSafe &&
            !prepared.slice(i, end).some((p) => p.signature === prepared[end].signature)
          )
            end++;
        const settled = await Promise.allSettled(
          Array.from({ length: end - i }, (_, n) => one(i + n)),
        );
        const batch = settled.map((entry) => {
          if (entry.status === 'fulfilled') return entry.value;
          stopReason = errorCode(entry.reason);
          return {
            error: stopReason,
            operation_state: 'unknown',
            message: userError(entry.reason),
          };
        });
        results.push(...batch);
        i = end;
      }
      results.forEach((value, i) => {
        delivered ||= value.reply_delivered === true;
        if (value.reply_delivered && typeof value.sent_text === 'string')
          deliveredTexts.add(value.sent_text.trim());
        transcript.push({
          role: 'tool',
          tool_call_id: calls[i].id,
          content: projectResult(value, resultBytes),
        });
      });
      pending = [];
      await persist();
      if (stopReason) finalizeOnly = true;
    }
    return finishText(
      fragments ||
        'The turn budget was reached. Completed operations are recorded; ask for the next step to continue.',
      'partial',
      stopReason || lastFailure || 'budget',
    );
  } catch (error) {
    report(error, { phase: 'agent_loop' });
    const code = errorCode(error);
    if (code === 'invalid_tools') throw error; // Malformed protocol is never repaired by executing a partial batch.
    return result(
      code === 'turn_cancelled' || code === 'lease_expired' ? '' : userError(error),
      code === 'turn_cancelled'
        ? 'cancelled'
        : code === 'turn_expired' || code === 'turn_budget'
          ? 'partial'
          : 'failed',
      code,
    );
  } finally {
    await persist();
  }
}
