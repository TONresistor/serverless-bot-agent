import { requestJSON } from '../http.js';
import { AgentError } from '../../shared/errors.js';
import { publicWebURL } from '../../shared/web-url.js';
import { searchResult, fetchResult } from './results.js';

/** Provider addresses and credentials are bound here, never supplied by model arguments. */
export function createWebProvider(fetcher, configuration, maxResultBytes = 8192) {
  const maxBytes = Math.max(1024, Math.min(32768, maxResultBytes));
  async function post(action, payload) {
    if (!configuration)
      throw new AgentError(
        'web_not_configured',
        'Web tools are not configured. Ask the owner to configure the web provider.',
      );
    const tavily = configuration.provider === 'tavily';
    const base = tavily ? 'https://api.tavily.com' : configuration.endpoint;
    return requestJSON(
      fetcher,
      `${base}/${action}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(configuration.apiKey ? { Authorization: `Bearer ${configuration.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      },
      1048576,
    );
  }
  return Object.freeze({
    async search(input) {
      const payload =
        configuration?.provider === 'tavily'
          ? {
              query: input.query,
              max_results: input.count,
              topic: input.topic,
              search_depth: 'basic',
              include_answer: true,
            }
          : input;
      return searchResult(await post('search', payload), input, maxBytes);
    },
    async fetchPage(input) {
      const url = publicWebURL(input);
      if (configuration?.provider === 'tavily') {
        const response = await post('extract', {
          urls: [url],
          extract_depth: 'basic',
          format: 'markdown',
          timeout: 30,
        });
        const first = response?.results?.[0];
        return fetchResult(first ? { url: first.url, text: first.raw_content } : null, maxBytes);
      }
      return fetchResult(await post('fetch', { url }), maxBytes);
    },
  });
}
