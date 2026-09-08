export function createValues(db, table) {
  return {
    async get(key) {
      const row = await db.get(`SELECT value FROM ${table} WHERE key = :key`, { ':key': key });
      return row ? JSON.parse(row.value) : null;
    },
    async set(key, value) {
      await db.run(
        `INSERT INTO ${table}(key,value) VALUES(:key,:value) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        { ':key': key, ':value': JSON.stringify(value) },
      );
    },
  };
}
