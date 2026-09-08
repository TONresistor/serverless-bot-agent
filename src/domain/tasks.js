import { AgentError } from '../shared/errors.js';

export function validateTask(value, ownerId, heartbeat = false) {
  const fail = () => {
    throw new AgentError(
      'invalid_task',
      'Invalid task definition. Use once/recurring, execution/evolving, and deliver_dm/post_direct/draft_approve.',
    );
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          'title',
          'prompt',
          'kind',
          'behavior',
          'mode',
          'targetChatId',
          'targetThreadId',
          'everySeconds',
          'runAt',
          'enabled',
        ].includes(k),
    )
  )
    fail();
  const task = {
    title: '',
    kind: 'once',
    behavior: 'execution',
    mode: 'deliver_dm',
    enabled: true,
    targetChatId: ownerId,
    targetThreadId: 0,
    ...value,
  };
  if (
    typeof task.title !== 'string' ||
    [...task.title].length > 80 ||
    typeof task.prompt !== 'string' ||
    !task.prompt.trim() ||
    [...task.prompt].length > 4096 ||
    typeof task.enabled !== 'boolean'
  )
    fail();
  if (
    !['once', 'recurring'].includes(task.kind) ||
    !['execution', 'evolving'].includes(task.behavior) ||
    !['deliver_dm', 'post_direct', 'draft_approve'].includes(task.mode)
  )
    fail();
  if (
    !Number.isSafeInteger(task.targetChatId) ||
    !task.targetChatId ||
    !Number.isSafeInteger(task.targetThreadId) ||
    task.targetThreadId < 0
  )
    fail();
  if (task.mode === 'deliver_dm') {
    task.targetChatId = ownerId;
    task.targetThreadId = 0;
  } else if (task.targetChatId >= 0) fail();
  if (
    task.kind === 'recurring' &&
    (!Number.isSafeInteger(task.everySeconds) ||
      task.everySeconds < (heartbeat || task.behavior === 'evolving' ? 3600 : 300) ||
      (heartbeat && task.everySeconds > 604800))
  )
    fail();
  if (!Number.isSafeInteger(task.runAt) || task.runAt < 0) fail();
  if (
    (task.kind === 'once' && task.everySeconds !== undefined) ||
    (task.behavior === 'evolving' && (task.kind !== 'recurring' || task.mode === 'draft_approve'))
  )
    fail();
  return task;
}

export function nextOccurrence(scheduledAt, everySeconds, now) {
  const interval = everySeconds * 1000;
  return scheduledAt + Math.max(1, Math.floor((now - scheduledAt) / interval) + 1) * interval;
}

export function taskInstructions(task, id, path) {
  if (id === 'heartbeat')
    return `Periodic heartbeat. Read HEARTBEAT.md, work through its checklist, and update it with what you did and learned. Report only noteworthy results through telegram_send_message to chat_id ${task.targetChatId}. Otherwise stay silent. End with a concise internal run summary.`;
  if (task.behavior === 'evolving')
    return `Evolving automation run; no human is watching live. Objective: ${task.prompt}\nYour durable state is ${path}. Read it first, work toward the objective, then update the same file with current state, changes, and next actions. Do not use normal chat history. Report only meaningful results, anomalies, or changes via telegram_send_message to chat_id ${task.targetChatId}. End with a concise internal run summary.`;
  return `Scheduled task; no human is watching live. Do the task and return ONLY the ${task.mode === 'deliver_dm' ? 'result' : 'post'} text. The runtime handles delivery${task.mode === 'draft_approve' ? ' after owner approval' : ''}. Do not send the result yourself.\nTask: ${task.prompt}`;
}
