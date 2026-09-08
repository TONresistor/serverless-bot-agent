import { AgentError } from '../../shared/errors.js';

export function createAgentSettingsRepository(db) {
  return {
    async read() {
      const row = await db.get("SELECT value FROM agent_settings WHERE key='loop_settings'");
      return row ? JSON.parse(row.value) : { revision: 0, defaults: {}, overrides: {} };
    },
    async compareAndSet(previous, next) {
      const changed =
        previous.revision === 0
          ? await db.run(
              "INSERT INTO agent_settings(key,value) VALUES('loop_settings',:value) ON CONFLICT(key) DO NOTHING",
              { ':value': JSON.stringify(next) },
            )
          : await db.run(
              "UPDATE agent_settings SET value=:value WHERE key='loop_settings' AND value=:old",
              { ':value': JSON.stringify(next), ':old': JSON.stringify(previous) },
            );
      if (changed.rowsAffected !== 1)
        throw new AgentError(
          'settings_conflict',
          'Settings changed concurrently. Read them again before updating.',
        );
    },
    async modelProfile(model) {
      const row = await db.get('SELECT value FROM agent_settings WHERE key=:key', {
        ':key': `model-profile:${model}`,
      });
      return row ? JSON.parse(row.value) : null;
    },
    async setModelProfile(model, profile) {
      await db.run(
        'INSERT INTO agent_settings(key,value) VALUES(:key,:value) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        { ':key': `model-profile:${model}`, ':value': JSON.stringify(profile) },
      );
    },
  };
}
