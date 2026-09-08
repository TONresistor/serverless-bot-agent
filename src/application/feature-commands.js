import { AgentError } from '../shared/errors.js';

/** Owner-DM controls. The composition never exposes management credentials. */
export function createFeatureCommands({ features, autonomy }) {
  return async ({ input, event, respond }) => {
    const match = /^\/(access|workspace|soul|heartbeat|secretary|tasks)(?:\s+([\s\S]*))?$/i.exec(
      input,
    );
    if (!match) return null;
    const command = match[1].toLowerCase(),
      rest = (match[2] || '').trim();
    let result;
    const parse = (value) => {
      try {
        return JSON.parse(value);
      } catch {
        throw new AgentError('invalid_arguments', 'Provide a valid JSON object.');
      }
    };
    if (command === 'access')
      result = rest
        ? await features.updateAccessPolicy(parse(rest))
        : await features.getAccessPolicy();
    if (command === 'secretary') {
      if (!rest) result = await features.getSecretarySettings();
      else if (['on', 'off'].includes(rest))
        result = await features.updateSecretarySettings({
          expectedRevision: (await features.getSecretarySettings()).revision,
          enabled: rest === 'on',
        });
      else throw new AgentError('invalid_arguments', 'Use /secretary on or /secretary off.');
    }
    if (command === 'soul') {
      const current = await features.readWorkspace({ path: 'SOUL.md' });
      result = rest
        ? await features.writeWorkspace({
            path: 'SOUL.md',
            content: rest,
            expectedRevision: current.revision,
          })
        : current;
    }
    if (command === 'workspace') {
      const [action, ...args] = rest.split(' ');
      result =
        !action || action === 'list'
          ? await features.listWorkspace()
          : action === 'read'
            ? await features.readWorkspace({ path: args.join(' ') })
            : action === 'write'
              ? await features.writeWorkspace(parse(args.join(' ')))
              : {
                  help: '/workspace list | read PATH | write {"path":"...","content":"...","expectedRevision":1}',
                };
    }
    if (command === 'heartbeat') {
      const current = await autonomy.getHeartbeat();
      result = !rest
        ? current || { enabled: false, everySeconds: 3600, revision: 0 }
        : rest === 'run'
          ? await autonomy.runTaskNow({ id: 'heartbeat', requestId: event })
          : await autonomy.updateHeartbeat({
              expectedRevision: current?.revision || 0,
              ...parse(rest),
            });
    }
    if (command === 'tasks') {
      const [action, ...args] = rest.split(' '),
        id = args[0];
      if (!action || action === 'list')
        result = (await autonomy.listTasks()).map((task) => ({
          id: task.id,
          revision: task.revision,
          title: task.definition.title,
          enabled: Boolean(task.enabled),
          nextRunAt: task.next_run_at,
          kind: task.definition.kind,
          mode: task.definition.mode,
        }));
      else if (action === 'save') result = await autonomy.saveTask(parse(args.join(' ')));
      else if (action === 'show') result = await autonomy.getTask({ id });
      else if (action === 'history')
        result = (await autonomy.taskHistory({ id })).map((run) => ({
          id: run.id,
          status: run.status,
          scheduledAt: run.scheduled_at,
          result: run.result,
        }));
      else if (action === 'drafts')
        result = (await autonomy.listTaskDrafts()).map((draft) => ({
          id: draft.id,
          ...draft.data,
        }));
      else if (action === 'approve' || action === 'reject')
        result = await autonomy.decideTaskDraft({ id, approve: action === 'approve' });
      else if (action === 'pause' || action === 'resume')
        result = await autonomy.setTaskEnabled({
          id,
          expectedRevision: (await autonomy.getTask({ id })).revision,
          enabled: action === 'resume',
        });
      else if (action === 'stop') result = await autonomy.stopTask({ id });
      else if (action === 'run') result = await autonomy.runTaskNow({ id, requestId: event });
      else
        result = {
          help: '/tasks list | show ID | save JSON | pause ID | resume ID | run ID | stop ID | history ID | drafts | approve DRAFT_ID | reject DRAFT_ID',
        };
    }
    await respond(JSON.stringify(result, null, 2));
    return { command };
  };
}
