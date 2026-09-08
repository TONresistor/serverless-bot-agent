import { publicWebURL } from '../shared/web-url.js';
import { AgentError } from '../shared/errors.js';

/** Management-only credential binding. Status never returns credentials or URL paths. */
export function createWebAdmin({ secrets }) {
  async function getWebSettings() {
    const config = JSON.parse((await secrets.getSecret('web_provider')) || 'null');
    return { configured: Boolean(config), provider: config?.provider || null };
  }
  return {
    getWebSettings,
    async configureWeb(input) {
      if (
        !input ||
        !['tavily', 'proxy'].includes(input.provider) ||
        Object.keys(input).some((k) => !['provider', 'apiKey', 'endpoint'].includes(k))
      )
        throw new AgentError('invalid_web_settings', 'Choose the tavily or proxy web provider.');
      let config;
      if (input.provider === 'tavily') {
        if (
          typeof input.apiKey !== 'string' ||
          !input.apiKey.trim() ||
          input.apiKey.length > 512 ||
          /\s/.test(input.apiKey) ||
          input.endpoint
        )
          throw new AgentError('invalid_web_settings', 'Provide a Tavily API key.');
        config = { provider: 'tavily', apiKey: input.apiKey };
      } else {
        const endpoint = publicWebURL(input.endpoint);
        if (
          !endpoint.startsWith('https://') ||
          endpoint.includes('?') ||
          (input.apiKey &&
            (typeof input.apiKey !== 'string' ||
              /\s/.test(input.apiKey) ||
              input.apiKey.length > 512))
        )
          throw new AgentError(
            'invalid_web_settings',
            'Use an HTTPS web proxy endpoint and an optional bearer key.',
          );
        config = {
          provider: 'proxy',
          endpoint: endpoint.replace(/\/$/, ''),
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        };
      }
      await secrets.setSecret('web_provider', JSON.stringify(config));
      return getWebSettings();
    },
  };
}
