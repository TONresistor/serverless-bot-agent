import { createValues } from './values.js';

export function createConfigurationRepository(db) {
  const values = createValues(db, 'agent_settings');
  return Object.freeze({
    getConfig: () => values.get('config'),
    setConfig: (config) => values.set('config', config),
  });
}
