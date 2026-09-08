import { createValues } from './values.js';

export function createTelegramConnections(db) {
  const values = createValues(db, 'agent_settings');
  return Object.freeze({
    get: () => values.get('telegram_business_connection'),
    set: (value) => values.set('telegram_business_connection', value),
  });
}
