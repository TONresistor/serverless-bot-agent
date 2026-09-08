import { AgentError } from '../../shared/errors.js';

/** @param {import('../../contracts/persistence.js').Database} db
 * @param {import('../../contracts/runtime.js').Clock} now
 * @returns {import('../../contracts/persistence.js').ConversationsRepository} */
export function createConversationsRepository(db, now) {
  return Object.freeze({
    async acquireChat(chatId, token, durationMs = 180_000) {
      const time = now();
      const result = await db.run(
        `INSERT INTO agent_operations(id,kind,state,data_json,created_at,updated_at,expires_at)
        VALUES(:id,'lock','held',:token,:now,:now,:expires)
        ON CONFLICT(id) DO UPDATE SET state='held',data_json=:token,updated_at=:now,expires_at=:expires
        WHERE agent_operations.state='released' OR agent_operations.expires_at <= :now`,
        {
          ':id': `lock:chat:${chatId}`,
          ':token': JSON.stringify(token),
          ':now': time,
          ':expires': time + durationMs,
        },
      );
      return result.rowsAffected === 1;
    },
    async assertChat(chatId, token) {
      const row = await db.get(
        `SELECT id FROM agent_operations WHERE id=:id AND state='held' AND data_json=:token AND expires_at>:now`,
        { ':id': `lock:chat:${chatId}`, ':token': JSON.stringify(token), ':now': now() },
      );
      if (!row)
        throw new AgentError(
          'lease_expired',
          'This turn has expired. Send a new message to continue.',
        );
    },
    async releaseChat(chatId, token) {
      await db.run(
        `UPDATE agent_operations SET state='released',updated_at=:now WHERE id=:id AND data_json=:token`,
        { ':id': `lock:chat:${chatId}`, ':token': JSON.stringify(token), ':now': now() },
      );
    },
    async history(chatId) {
      const row = await db.get('SELECT history_json FROM agent_conversations WHERE chat_id=:chat', {
        ':chat': String(chatId),
      });
      return row ? JSON.parse(row.history_json) : [];
    },
    async saveHistory(chatId, token, history) {
      const result = await db.run(
        `INSERT INTO agent_conversations(chat_id,history_json,updated_at)
        SELECT :chat,:history,:now WHERE EXISTS(SELECT 1 FROM agent_operations WHERE id=:lock AND state='held' AND data_json=:token AND expires_at>:now)
        ON CONFLICT(chat_id) DO UPDATE SET history_json=excluded.history_json,updated_at=excluded.updated_at`,
        {
          ':chat': String(chatId),
          ':history': JSON.stringify(history),
          ':now': now(),
          ':lock': `lock:chat:${chatId}`,
          ':token': JSON.stringify(token),
        },
      );
      if (result.rowsAffected !== 1)
        throw new AgentError('lease_expired', 'This turn has expired.');
    },
  });
}
