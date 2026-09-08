import { createValues } from './values.js';

export function createSecretsRepository(db) {
  const values = createValues(db, 'agent_secrets');
  return Object.freeze({
    getSecret: (key) => values.get(key),
    setSecret: (key, value) => values.set(key, value),
  });
}
