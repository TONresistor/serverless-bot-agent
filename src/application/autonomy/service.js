import { AgentError, errorCode } from '../../shared/errors.js';
import { validateTask, taskInstructions } from '../../domain/tasks.js';
import { digest } from '../../shared/hash.js';

/** Durable schedules dispatch into the existing agent application, using fresh sessions. */
export function createAutonomy({
  tasks,
  workspace,
  configuration,
  operations,
  turns,
  app,
  deliver,
  now,
}) {
  async function execute(task, trigger, requestId = '') {
    const runId = await tasks.claim(task, trigger, requestId);
    if (!runId) return { skipped: true, reason: 'duplicate_or_busy' };
    let result,
      status = 'failed';
    try {
      const config = await configuration.getConfig(),
        definition = task.definition;
      const path = task.id === 'heartbeat' ? 'HEARTBEAT.md' : `automations/${task.id}.md`;
      if (definition.behavior === 'evolving' && task.id !== 'heartbeat')
        await workspace.seed(
          path,
          `# Objective\n${definition.prompt}\n\n# Current state\nNot started.\n\n# Next actions\nWork toward the objective.\n`,
        );
      const silent = task.id === 'heartbeat' || definition.behavior === 'evolving';
      const group = definition.targetChatId < 0;
      const scope = {
        owner: true,
        group,
        actorId: config.ownerId,
        destination: definition.targetChatId,
        threadId: definition.targetThreadId || undefined,
        surface: silent ? 'heartbeat' : 'task',
        sessionId: runId,
        eventId: runId,
        memoryScope: group
          ? `group:${definition.targetChatId}:${definition.targetThreadId || 0}`
          : null,
        suppressFinal: true,
        draftApproval: definition.mode === 'draft_approve',
        boundDestination: true,
        checkRun: () => tasks.assertRun(task, runId),
        instructions: silent
          ? 'This is an autonomous turn. Final text is internal; send only meaningful reports using the messaging tool.'
          : 'This is an autonomous turn. Return the result; the runtime handles its delivery.',
      };
      result = await app.onMessage({ text: taskInstructions(definition, task.id, path) }, scope);
      status = result.status || (result.error ? 'failed' : 'interrupted');
      if (status === 'completed' && !silent && !result.delivered && result.text) {
        await tasks.assertRun(task, runId);
        if (definition.mode === 'draft_approve') {
          const draftId = `draft:${digest(runId)}`;
          await operations.claim(draftId, 'task_draft', 'pending', {
            taskId: task.id,
            taskRevision: task.revision,
            runId,
            target: definition.targetChatId,
            threadId: definition.targetThreadId,
            text: result.text,
          });
          result.draftId = draftId;
          await deliver(
            `${runId}:draft-notice`,
            config.ownerId,
            `A draft is ready for review — ${definition.title || task.id}.\nUse /tasks approve ${draftId} or /tasks reject ${draftId}.`,
            { assertActive: () => tasks.assertRun(task, runId) },
          );
        } else {
          await deliver(`${runId}:report`, definition.targetChatId, result.text, {
            format: 'rich',
            threadId: definition.targetThreadId || undefined,
            assertActive: () => tasks.assertRun(task, runId),
          });
          result.delivered = true;
        }
      }
    } catch (error) {
      result = {
        ...result,
        error: errorCode(error),
        ...(status === 'completed' ? { effects: 'unknown' } : {}),
      };
      status = 'failed';
    }
    await tasks.finish(task, runId, status, result, trigger);
    return { ...result, runId, status };
  }
  async function getTask(id) {
    const task = await tasks.get(id);
    if (!task) throw new AgentError('task_not_found', 'Task not found.');
    return task;
  }
  return {
    listTasks: () => tasks.list(),
    getTask: ({ id }) => getTask(id),
    taskHistory: ({ id }) => tasks.history(id),
    async saveTask({ id, expectedRevision, definition }) {
      if (
        typeof id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        id === 'heartbeat' ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0
      )
        throw new AgentError(
          'invalid_task',
          'Provide an id and expectedRevision (zero for a new task).',
        );
      const config = await configuration.getConfig();
      return tasks.save(id, expectedRevision, validateTask(definition, config.ownerId));
    },
    async setTaskEnabled({ id, expectedRevision, enabled }) {
      if (typeof enabled !== 'boolean')
        throw new AgentError('invalid_task', 'enabled must be a boolean.');
      const task = await getTask(id);
      return tasks.save(id, expectedRevision, {
        ...task.definition,
        enabled,
        runAt: task.next_run_at,
      });
    },
    async runTaskNow({ id, requestId }) {
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(requestId))
        throw new AgentError(
          'invalid_task',
          'A stable requestId is required for manual-run deduplication.',
        );
      await tasks.recoverExpired();
      return execute(await getTask(id), 'manual', requestId);
    },
    async stopTask({ id }) {
      const task = await getTask(id),
        config = await configuration.getConfig();
      return {
        stopped: task.lease_token
          ? await turns.requestStop(task.lease_token, config.ownerId, true)
          : false,
      };
    },
    getHeartbeat: () => tasks.get('heartbeat'),
    async updateHeartbeat({ expectedRevision, enabled, everySeconds = 3600 }) {
      const config = await configuration.getConfig();
      return tasks.save(
        'heartbeat',
        expectedRevision,
        validateTask(
          {
            title: 'Heartbeat',
            prompt: 'Work through HEARTBEAT.md.',
            behavior: 'evolving',
            kind: 'recurring',
            mode: 'deliver_dm',
            enabled,
            everySeconds,
            runAt: now() + everySeconds * 1000,
          },
          config.ownerId,
          true,
        ),
      );
    },
    async listDueTasks() {
      const recovered = await tasks.recoverExpired();
      return { recovered, ids: (await tasks.due()).map((t) => t.id) };
    },
    async runScheduledTask({ id }) {
      return execute(await getTask(id), 'scheduled');
    },
    async schedulerTick() {
      const recovered = await tasks.recoverExpired();
      const due = await tasks.due();
      // Claim/run each independently. The wake-up process is disposable; leases live in Telegram.
      const results = [];
      for (let i = 0; i < due.length; i += 8)
        results.push(
          ...(await Promise.all(due.slice(i, i + 8).map((task) => execute(task, 'scheduled')))),
        );
      return { recovered, due: due.length, results };
    },
    async decideTaskDraft({ id, approve }) {
      if (typeof approve !== 'boolean')
        throw new AgentError('invalid_draft', 'approve must be a boolean.');
      const draft = await operations.operation(id);
      if (!draft || draft.kind !== 'task_draft' || draft.state !== 'pending')
        throw new AgentError('draft_unavailable', 'This draft is unavailable or already handled.');
      if (
        !(await operations.transition(
          id,
          ['pending'],
          approve ? 'publishing' : 'rejected',
          draft.data,
        ))
      )
        return { duplicate: true };
      if (!approve) return { rejected: true };
      try {
        const receipt = await deliver(id, draft.data.target, draft.data.text, {
          format: 'rich',
          threadId: draft.data.threadId || undefined,
        });
        await operations.transition(id, ['publishing'], 'published', { ...draft.data, receipt });
        return { published: true, receipt };
      } catch (error) {
        await operations.transition(id, ['publishing'], 'unknown', draft.data);
        throw error;
      }
    },
    listTaskDrafts: () => operations.pendingDrafts(),
  };
}
