import { DEFAULT_ACCESS, validateAccess, COMPAT_ACCESS } from '../../shared/access-policy.js';
import { AgentError } from '../../shared/errors.js';

export function createFeatureRepository(db) {
  async function read(key, fallback) {
    const row = await db.get('SELECT value FROM agent_settings WHERE key=:key', { ':key': key });
    return row ? JSON.parse(row.value) : { revision: 0, value: fallback };
  }
  async function update(key, revision, value, fallback) {
    const current = await read(key, fallback);
    if (current.revision !== revision)
      throw new AgentError(
        'settings_conflict',
        'Settings changed. Read the current revision first.',
      );
    const next = { revision: revision + 1, value };
    const changed =
      revision === 0
        ? await db.run(
            'INSERT INTO agent_settings(key,value) VALUES(:key,:next) ON CONFLICT(key) DO NOTHING',
            { ':key': key, ':next': JSON.stringify(next) },
          )
        : await db.run('UPDATE agent_settings SET value=:next WHERE key=:key AND value=:old', {
            ':key': key,
            ':next': JSON.stringify(next),
            ':old': JSON.stringify(current),
          });
    if (changed.rowsAffected !== 1)
      throw new AgentError('settings_conflict', 'Settings changed concurrently.');
    return next;
  }
  return {
    access: () => read('access_policy', DEFAULT_ACCESS),
    setAccess: (revision, value) =>
      update('access_policy', revision, validateAccess(value), DEFAULT_ACCESS),
    async initializeAccess(migrateLegacy = false) {
      const row = await read('access_policy', DEFAULT_ACCESS);
      return row.revision
        ? row
        : update(
            'access_policy',
            0,
            migrateLegacy ? COMPAT_ACCESS : DEFAULT_ACCESS,
            DEFAULT_ACCESS,
          );
    },
    secretary: () => read('secretary_settings', { enabled: true }),
    setSecretary: (revision, enabled) => {
      if (typeof enabled !== 'boolean')
        throw new AgentError('invalid_settings', 'enabled must be a boolean.');
      return update('secretary_settings', revision, { enabled }, { enabled: true });
    },
  };
}
