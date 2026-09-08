const decode = (row) => row && { ...row, data: JSON.parse(row.data_json) };

/** @param {import('../../contracts/persistence.js').Database} db
 * @param {import('../../contracts/runtime.js').Clock} now
 * @returns {import('../../contracts/persistence.js').OperationsRepository} */
export function createOperationsRepository(db, now) {
  return Object.freeze({
    pendingDrafts: async () =>
      (
        await db.all(
          "SELECT * FROM agent_operations WHERE kind='task_draft' AND state='pending' ORDER BY created_at DESC LIMIT 30",
        )
      ).map(decode),
    async allowReply(chatId, actorId, eventId, limit) {
      if (limit === 0) return true;
      const changed = await db.run(
        `INSERT INTO agent_operations(id,kind,state,data_json,created_at,updated_at,expires_at)
        SELECT :id,'reply_quota_event',:scope,'{}',:now,:now,:expiry
        WHERE (SELECT COUNT(*) FROM agent_operations WHERE kind='reply_quota_event' AND state=:scope AND created_at>:cutoff)<:limit
        ON CONFLICT(id) DO NOTHING`,
        {
          ':id': `quota:${eventId}`,
          ':scope': `${chatId}:${actorId}`,
          ':now': now(),
          ':expiry': now() + 3600000,
          ':cutoff': now() - 3600000,
          ':limit': limit,
        },
      );
      return changed.rowsAffected === 1;
    },
    async consumeButton(id, cardId) {
      const changed = await db.run(
        `UPDATE agent_operations SET state='consumed',updated_at=:now WHERE id=:id AND state='pending'
        AND NOT EXISTS(SELECT 1 FROM agent_operations WHERE kind='telegram_button' AND state='consumed' AND json_extract(data_json,'$.cardId')=:card)`,
        { ':id': id, ':card': cardId || id, ':now': now() },
      );
      return changed.rowsAffected === 1;
    },
    async operation(id) {
      return decode(await db.get('SELECT * FROM agent_operations WHERE id=:id', { ':id': id }));
    },
    async claim(id, kind, state = 'processing', data = {}, expiresAt = 0) {
      const time = now();
      const result = await db.run(
        `INSERT INTO agent_operations(id,kind,state,data_json,created_at,updated_at,expires_at)
        VALUES(:id,:kind,:state,:data,:now,:now,:expires) ON CONFLICT(id) DO NOTHING`,
        {
          ':id': id,
          ':kind': kind,
          ':state': state,
          ':data': JSON.stringify(data),
          ':now': time,
          ':expires': expiresAt,
        },
      );
      return result.rowsAffected === 1;
    },
    async transition(id, from, state, data) {
      const params = { ':id': id, ':state': state, ':data': JSON.stringify(data), ':now': now() };
      const states = from.map((s, i) => {
        params[`:f${i}`] = s;
        return `:f${i}`;
      });
      const result = await db.run(
        `UPDATE agent_operations SET state=:state,data_json=:data,updated_at=:now WHERE id=:id AND state IN (${states.join(',')})`,
        params,
      );
      return result.rowsAffected === 1;
    },
    async transitionFromSnapshot(snapshot, state, data) {
      const result = await db.run(
        'UPDATE agent_operations SET state=:state,data_json=:data,updated_at=:now WHERE id=:id AND state=:old_state AND data_json=:old_data AND updated_at=:old_time',
        {
          ':id': snapshot.id,
          ':state': state,
          ':data': JSON.stringify(data),
          ':now': now(),
          ':old_state': snapshot.state,
          ':old_data': snapshot.data_json,
          ':old_time': snapshot.updated_at,
        },
      );
      return result.rowsAffected === 1;
    },
    async acquireWallet(operationId) {
      const time = now();
      const result = await db.run(
        `INSERT INTO agent_operations(id,kind,state,data_json,created_at,updated_at,expires_at)
        VALUES('lock:wallet','lock','held',:op,:now,:now,0)
        ON CONFLICT(id) DO UPDATE SET state='held',data_json=:op,updated_at=:now WHERE agent_operations.state='released'`,
        { ':op': JSON.stringify(operationId), ':now': time },
      );
      return result.rowsAffected === 1;
    },
    async releaseWallet(operationId) {
      await db.run(
        `UPDATE agent_operations SET state='released',updated_at=:now WHERE id='lock:wallet' AND data_json=:op`,
        { ':op': JSON.stringify(operationId), ':now': now() },
      );
    },
    async prepareBroadcast(id, data) {
      const result = await db.run(
        `UPDATE agent_operations SET state='in_flight',data_json=:data,updated_at=:now
        WHERE id=:id AND state='preparing' AND expires_at>:now
        AND EXISTS(SELECT 1 FROM agent_operations WHERE id='lock:wallet' AND state='held' AND data_json=:op)`,
        { ':id': id, ':data': JSON.stringify(data), ':now': now(), ':op': JSON.stringify(id) },
      );
      return result.rowsAffected === 1;
    },
    recentContractActions: async () =>
      (
        await db.all(
          "SELECT * FROM agent_operations WHERE kind='contract_action' AND state IN ('in_flight','submitted','unknown') ORDER BY created_at DESC LIMIT 5",
        )
      ).map(decode),
    async recentTransfers() {
      return (
        await db.all(
          `SELECT * FROM agent_operations WHERE kind IN ('transfer','contract_action') ORDER BY created_at DESC LIMIT 5`,
        )
      ).map(decode);
    },
  });
}
