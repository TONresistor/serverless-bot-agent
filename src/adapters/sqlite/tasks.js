import { AgentError } from '../../shared/errors.js';
import { digest } from '../../shared/hash.js';
import { nextOccurrence } from '../../domain/tasks.js';

const decode = (row) => {
  if (!row) return null;
  const { definition_json, ...fields } = row;
  return {
    ...fields,
    definition: {
      ...JSON.parse(definition_json),
      enabled: Boolean(row.enabled),
      runAt: row.next_run_at,
    },
  };
};
const runDecode = (row) => {
  if (!row) return null;
  const { snapshot_json, result_json, ...fields } = row;
  const snapshot = JSON.parse(snapshot_json);
  delete snapshot.definition_json;
  return { ...fields, snapshot, result: JSON.parse(result_json) };
};
export function createTasksRepository(db, now) {
  const get = async (id) =>
    decode(await db.get('SELECT * FROM agent_tasks WHERE id=:id', { ':id': id }));
  const getRun = async (id) =>
    runDecode(await db.get('SELECT * FROM agent_task_runs WHERE id=:id', { ':id': id }));
  async function finish(task, runId, status, result, trigger) {
    await db.run(
      "UPDATE agent_task_runs SET status=:status,result_json=:result,updated_at=:now WHERE id=:id AND status='running'",
      { ':status': status, ':result': JSON.stringify(result), ':now': now(), ':id': runId },
    );
    const recurring = task.definition.kind === 'recurring';
    const consume =
      trigger === 'scheduled' ||
      (!recurring &&
        (status === 'completed' ||
          result?.effects === 'unknown' ||
          result?.reason === 'operation_unknown'));
    const next =
      recurring && consume
        ? nextOccurrence(task.next_run_at, task.definition.everySeconds, now())
        : task.next_run_at;
    await db.run(
      `UPDATE agent_tasks SET lease_token='',lease_until=0,enabled=CASE WHEN revision=:revision AND :consume=1 AND :recurring=0 THEN 0 ELSE enabled END,
      next_run_at=CASE WHEN revision=:revision THEN :next ELSE next_run_at END,updated_at=:now WHERE id=:id AND lease_token=:token`,
      {
        ':id': task.id,
        ':token': runId,
        ':revision': task.revision,
        ':consume': consume ? 1 : 0,
        ':recurring': recurring ? 1 : 0,
        ':next': next,
        ':now': now(),
      },
    );
    await db.run(
      "DELETE FROM agent_task_runs WHERE task_id=:task AND status<>'running' AND id NOT IN (SELECT id FROM agent_task_runs WHERE task_id=:task ORDER BY created_at DESC,id DESC LIMIT 50)",
      { ':task': task.id },
    );
  }
  return {
    get,
    getRun,
    finish,
    list: async () =>
      (await db.all('SELECT * FROM agent_tasks ORDER BY created_at,id LIMIT 100')).map(decode),
    history: async (id) =>
      (
        await db.all(
          'SELECT * FROM agent_task_runs WHERE task_id=:id ORDER BY created_at DESC,id DESC LIMIT 30',
          { ':id': id },
        )
      ).map(runDecode),
    due: async () =>
      (
        await db.all(
          "SELECT * FROM agent_tasks WHERE enabled=1 AND next_run_at<=:now AND lease_token='' ORDER BY next_run_at,id LIMIT 50",
          { ':now': now() },
        )
      ).map(decode),
    async save(id, expectedRevision, definition) {
      const current = await get(id);
      if ((current?.revision || 0) !== expectedRevision)
        throw new AgentError('task_conflict', 'Read the current task revision first.');
      const args = {
        ':id': id,
        ':definition': JSON.stringify(definition),
        ':enabled': definition.enabled ? 1 : 0,
        ':due': definition.runAt,
        ':now': now(),
      };
      const cap =
        "(:enabled=0 OR :id='heartbeat' OR (SELECT COUNT(*) FROM agent_tasks WHERE enabled=1 AND id<>'heartbeat' AND id<>:id)<10)";
      const changed = current
        ? await db.run(
            `UPDATE agent_tasks SET revision=revision+1,definition_json=:definition,enabled=:enabled,next_run_at=:due,updated_at=:now WHERE id=:id AND revision=:revision AND ${cap}`,
            { ...args, ':revision': expectedRevision },
          )
        : await db.run(
            `INSERT INTO agent_tasks(id,revision,definition_json,enabled,next_run_at,lease_token,lease_until,created_at,updated_at) SELECT :id,1,:definition,:enabled,:due,'',0,:now,:now WHERE ${cap} ON CONFLICT(id) DO NOTHING`,
            args,
          );
      if (changed.rowsAffected !== 1)
        throw new AgentError(
          'task_conflict',
          'Task changed concurrently or the ten active task limit was reached.',
        );
      return get(id);
    },
    async claim(task, trigger, requestId = '') {
      const runId = `task-run:${digest(`${task.id}:${task.revision}:${trigger}:${trigger === 'scheduled' ? task.next_run_at : requestId}`)}`;
      if (await getRun(runId)) return null;
      const changed = await db.run(
        `UPDATE agent_tasks SET lease_token=:token,lease_until=:expiry WHERE id=:id AND revision=:revision AND lease_token='' AND NOT EXISTS(SELECT 1 FROM agent_task_runs WHERE id=:token) AND (:manual=1 OR enabled=1 AND next_run_at=:due AND next_run_at<=:now)`,
        {
          ':id': task.id,
          ':revision': task.revision,
          ':token': runId,
          ':expiry': now() + 660000,
          ':manual': trigger === 'manual' ? 1 : 0,
          ':due': task.next_run_at,
          ':now': now(),
        },
      );
      if (changed.rowsAffected !== 1) return null;
      await db.run(
        "INSERT INTO agent_task_runs(id,task_id,task_revision,scheduled_at,trigger,status,snapshot_json,result_json,created_at,updated_at) VALUES(:id,:task,:revision,:due,:trigger,'running',:snapshot,'{}',:now,:now) ON CONFLICT(id) DO NOTHING",
        {
          ':id': runId,
          ':task': task.id,
          ':revision': task.revision,
          ':due': task.next_run_at,
          ':trigger': trigger,
          ':snapshot': JSON.stringify(task),
          ':now': now(),
        },
      );
      return runId;
    },
    async assertRun(task, runId) {
      const live = await get(task.id);
      if (
        !live ||
        live.revision !== task.revision ||
        live.lease_token !== runId ||
        live.lease_until <= now()
      )
        throw new AgentError(
          'task_revoked',
          'The task was changed, stopped, or its lease expired.',
          { effectNotStarted: true },
        );
    },
    async recoverExpired() {
      const rows = (
        await db.all("SELECT * FROM agent_tasks WHERE lease_token<>'' AND lease_until<=:now", {
          ':now': now(),
        })
      ).map(decode);
      for (const task of rows) {
        const run = await getRun(task.lease_token);
        if (!run) {
          // The run record is written before invoking the app. A missing record proves
          // the worker never started; preserve even a future manual once schedule.
          await db.run(
            "UPDATE agent_tasks SET lease_token='',lease_until=0 WHERE id=:id AND lease_token=:token AND lease_until<=:now",
            { ':id': task.id, ':token': task.lease_token, ':now': now() },
          );
          continue;
        }
        // Expired running workers may have made effects; recorded terminal outcomes win.
        await finish(
          run.snapshot,
          task.lease_token,
          run.status === 'running' ? 'interrupted' : run.status,
          run.status === 'running' ? { reason: 'lease_expired', effects: 'unknown' } : run.result,
          run.trigger,
        );
      }
      return rows.length;
    },
  };
}
