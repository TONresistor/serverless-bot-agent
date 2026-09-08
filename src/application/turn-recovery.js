import { projectResult } from '../agent/results.js';

/** Reconstruct missing results from the journal; never invoke a tool while recovering. */
export async function repairTranscript(checkpoint, operations, maxBytes) {
  const messages = checkpoint?.transcript || [],
    pending = checkpoint?.pending || [],
    repaired = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    repaired.push(message);
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
    const found = new Map();
    while (messages[i + 1]?.role === 'tool') {
      i++;
      found.set(messages[i].tool_call_id, messages[i]);
    }
    for (const call of message.tool_calls) {
      if (found.has(call.id)) {
        repaired.push(found.get(call.id));
        continue;
      }
      const ref = pending.find((p) => p.callId === call.id);
      const op = ref && (await operations.operation(ref.operationId));
      const result =
        op?.state === 'succeeded'
          ? op.data.result
          : op?.data?.result || {
              error: op ? 'operation_unknown' : 'not_executed',
              operation_state: op ? 'unknown' : 'not_executed',
              message: op
                ? 'The previous turn ended before this outcome was known. Do not repeat this operation.'
                : 'The previous turn ended before this action was executed.',
            };
      repaired.push({
        role: 'tool',
        tool_call_id: call.id,
        content: projectResult(result, maxBytes),
      });
    }
  }
  return repaired;
}

export function withTurnOutcome(transcript, status, reason) {
  if (status === 'completed') return transcript;
  const text =
    status === 'cancelled'
      ? 'Runtime turn outcome: cancelled by the user. Do not resume unfinished actions unless the user explicitly asks again. Completed effects remain recorded.'
      : `Runtime turn outcome: ${status} (${reason || 'interrupted'}). The request was not completed. Use recorded results and never repeat an uncertain operation.`;
  if (transcript.at(-1)?.content === text) return transcript;
  return [...transcript, { role: 'user', content: text }];
}

export async function recoverTurns({
  turns,
  operations,
  conversations,
  sessionId,
  token,
  maxBytes,
}) {
  let history = await conversations.history(sessionId);
  await turns.archiveHistory(sessionId, token, history);
  for (const prior of await turns.unfinished(sessionId)) {
    if (prior.id === token) continue;
    const messages = withTurnOutcome(
      await repairTranscript(prior.checkpoint, operations, maxBytes),
      prior.cancel_requested ? 'cancelled' : 'partial',
      'interrupted',
    );
    const checkpoint = {
      ...prior.checkpoint,
      transcript: messages,
      pending: [],
      reason: 'interrupted',
    };
    if (messages.length) {
      history = history.some((t) => t.id === prior.id)
        ? history.map((t) => (t.id === prior.id ? { ...t, messages } : t))
        : [...history, { id: prior.id, messages }];
    }
    await conversations.saveHistory(sessionId, token, history);
    await turns.finish(
      prior.id,
      sessionId,
      token,
      prior.cancel_requested ? 'cancelled' : 'partial',
      checkpoint,
    );
  }
  await conversations.saveHistory(sessionId, token, history);
  return history;
}
