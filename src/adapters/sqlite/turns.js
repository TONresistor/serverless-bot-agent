import { AgentError } from '../../shared/errors.js';

export function createTurnsRepository(db, now) {
  const decode = (r) =>
    r && { ...r, checkpoint: JSON.parse(r.checkpoint_json), settings: JSON.parse(r.settings_json) };
  const fence =
    "EXISTS(SELECT 1 FROM agent_operations WHERE id=:lock AND state='held' AND data_json=:token AND expires_at>:now)";
  const params = (sessionId, token) => ({
    ':lock': `lock:chat:${sessionId}`,
    ':token': JSON.stringify(token),
    ':now': now(),
  });
  function requireWrite(result) {
    if (result.rowsAffected !== 1)
      throw new AgentError('lease_expired', 'This turn no longer owns its conversation.');
  }
  return {
    async archiveHistory(sessionId, token, history) {
      for (const turn of history) {
        await db.run(
          `INSERT INTO agent_turns(id,session_id,actor_id,status,settings_json,checkpoint_json,cancel_requested,created_at,updated_at)
          SELECT :id,:session,'legacy','completed','{}',:checkpoint,0,:now,:now WHERE ${fence} ON CONFLICT(id) DO NOTHING`,
          {
            ...params(sessionId, token),
            ':id': turn.id,
            ':session': sessionId,
            ':checkpoint': JSON.stringify({ transcript: turn.messages, pending: [], legacy: true }),
          },
        );
      }
    },
    async start(id, sessionId, actorId, settings, token) {
      requireWrite(
        await db.run(
          `INSERT INTO agent_turns(id,session_id,actor_id,status,settings_json,checkpoint_json,cancel_requested,created_at,updated_at)
        SELECT :id,:session,:actor,'running',:settings,'{}',0,:now,:now WHERE ${fence}`,
          {
            ...params(sessionId, token),
            ':id': id,
            ':session': sessionId,
            ':actor': String(actorId),
            ':settings': JSON.stringify(settings),
          },
        ),
      );
    },
    async get(id) {
      return decode(await db.get('SELECT * FROM agent_turns WHERE id=:id', { ':id': id }));
    },
    async unfinished(sessionId) {
      return (
        await db.all(
          "SELECT * FROM agent_turns WHERE session_id=:session AND status='running' ORDER BY created_at",
          { ':session': sessionId },
        )
      ).map(decode);
    },
    async checkpoint(id, sessionId, token, checkpoint) {
      requireWrite(
        await db.run(
          `UPDATE agent_turns SET checkpoint_json=:checkpoint,updated_at=:now WHERE id=:id AND session_id=:session AND status='running' AND ${fence}`,
          {
            ...params(sessionId, token),
            ':id': id,
            ':session': sessionId,
            ':checkpoint': JSON.stringify(checkpoint),
          },
        ),
      );
    },
    async finish(id, sessionId, token, status, checkpoint) {
      requireWrite(
        await db.run(
          `UPDATE agent_turns SET status=:status,checkpoint_json=:checkpoint,updated_at=:now WHERE id=:id AND session_id=:session AND status='running' AND ${fence}`,
          {
            ...params(sessionId, token),
            ':id': id,
            ':session': sessionId,
            ':status': status,
            ':checkpoint': JSON.stringify(checkpoint),
          },
        ),
      );
    },
    async requestStop(sessionId, actorId, owner) {
      const changed = await db.run(
        "UPDATE agent_turns SET cancel_requested=1 WHERE session_id=:session AND status='running' AND (actor_id=:actor OR :owner=1)",
        { ':session': sessionId, ':actor': String(actorId), ':owner': owner ? 1 : 0 },
      );
      return changed.rowsAffected > 0;
    },
    async summary(sessionId) {
      const row = await db.get('SELECT value FROM agent_summaries WHERE session_id=:session', {
        ':session': sessionId,
      });
      return row ? JSON.parse(row.value) : null;
    },
    async saveSummary(sessionId, token, value) {
      requireWrite(
        await db.run(
          `INSERT INTO agent_summaries(session_id,value,updated_at) SELECT :session,:value,:now WHERE ${fence}
        ON CONFLICT(session_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
          { ...params(sessionId, token), ':session': sessionId, ':value': JSON.stringify(value) },
        ),
      );
    },
    async clearSummary(sessionId, token) {
      await this.saveSummary(sessionId, token, null);
    },
  };
}
