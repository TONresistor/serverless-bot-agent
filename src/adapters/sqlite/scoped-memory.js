import { digest } from '../../shared/hash.js';
import { AgentError } from '../../shared/errors.js';

const decode = (row) =>
  row && {
    key: row.key,
    value: row.value,
    tags: JSON.parse(row.tags_json),
    updated_at: row.updated_at,
  };
export function createScopedMemoryRepository(db, now) {
  return {
    forScope(scope, sessionId, token) {
      return {
        async get(key) {
          return decode(
            await db.get('SELECT * FROM agent_scoped_notes WHERE scope=:scope AND key=:key', {
              ':scope': scope,
              ':key': key,
            }),
          );
        },
        async search(query, limit) {
          const rows = await db.all(
            `SELECT * FROM agent_scoped_notes WHERE scope=:scope AND
            (instr(lower(key),lower(:q))>0 OR instr(lower(value),lower(:q))>0 OR instr(lower(tags_json),lower(:q))>0)
            ORDER BY updated_at DESC,key ASC LIMIT :limit`,
            { ':scope': scope, ':q': query, ':limit': limit },
          );
          return rows.map(decode);
        },
        async set(key, value, tags) {
          const changed = await db.run(
            `INSERT INTO agent_scoped_notes(id,scope,key,value,tags_json,updated_at)
            SELECT :id,:scope,:key,:value,:tags,:now WHERE EXISTS
            (SELECT 1 FROM agent_operations WHERE id=:lock AND state='held' AND data_json=:token AND expires_at>:now)
            ON CONFLICT(id) DO UPDATE SET value=excluded.value,tags_json=excluded.tags_json,updated_at=excluded.updated_at`,
            {
              ':id': digest(JSON.stringify([scope, key])),
              ':scope': scope,
              ':key': key,
              ':value': value,
              ':tags': JSON.stringify(tags),
              ':now': now(),
              ':lock': `lock:chat:${sessionId}`,
              ':token': JSON.stringify(token),
            },
          );
          if (changed.rowsAffected !== 1)
            throw new AgentError('lease_expired', 'This turn has expired.');
        },
      };
    },
  };
}
