import { AgentError } from '../../shared/errors.js';

export function createMemoryRepository(db, now) {
  return Object.freeze({
    async getNote(key) {
      const row = await db.get(
        'SELECT key,value,tags_json,updated_at FROM agent_notes WHERE key=:key',
        { ':key': key },
      );
      return row
        ? {
            key: row.key,
            value: row.value,
            tags: JSON.parse(row.tags_json),
            updated_at: row.updated_at,
          }
        : null;
    },
    async setNote(chatId, token, key, value, tags) {
      const result = await db.run(
        `INSERT INTO agent_notes(key,value,tags_json,updated_at)
        SELECT :key,:value,:tags,:now WHERE EXISTS(SELECT 1 FROM agent_operations WHERE id=:lock AND state='held' AND data_json=:token AND expires_at>:now)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,tags_json=excluded.tags_json,updated_at=excluded.updated_at`,
        {
          ':key': key,
          ':value': value,
          ':tags': JSON.stringify(tags),
          ':now': now(),
          ':lock': `lock:chat:${chatId}`,
          ':token': JSON.stringify(token),
        },
      );
      if (result.rowsAffected !== 1)
        throw new AgentError('lease_expired', 'This turn has expired.');
    },
    async searchNotes(query, limit) {
      const rows = await db.all(
        `SELECT key,value,tags_json,updated_at FROM agent_notes
        WHERE instr(lower(key),lower(:q))>0 OR instr(lower(value),lower(:q))>0 OR instr(lower(tags_json),lower(:q))>0
        ORDER BY updated_at DESC,key ASC LIMIT :limit`,
        { ':q': query, ':limit': limit },
      );
      return rows.map((r) => ({
        key: r.key,
        value: r.value,
        tags: JSON.parse(r.tags_json),
        updated_at: r.updated_at,
      }));
    },
  });
}
