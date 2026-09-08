import { requestJSON } from './http.js';
import { AgentError } from '../shared/errors.js';

export function createModelProfileReader(fetcher) {
  return async (model) => {
    const catalog = await requestJSON(
      fetcher,
      'https://openrouter.ai/api/v1/models',
      {},
      20_000_000,
    );
    const entry = catalog.data?.find((entry) => entry.id === model);
    const contextWindowTokens = entry?.top_provider?.context_length || entry?.context_length;
    const maxOutputTokens = entry?.top_provider?.max_completion_tokens;
    if (
      !Number.isSafeInteger(contextWindowTokens) ||
      contextWindowTokens < 4096 ||
      !Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens < 128
    )
      throw new AgentError('model_profile', 'The provider did not return usable model limits.');
    return { model, contextWindowTokens, maxOutputTokens, source: 'openrouter_catalog' };
  };
}
