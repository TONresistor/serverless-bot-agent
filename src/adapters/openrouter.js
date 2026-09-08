import { AgentError } from '../shared/errors.js';
import { requestJSON } from './http.js';

export function createOpenRouter(fetcher, { apiKey, model, maxOutputTokens = 2048 }) {
  if (typeof apiKey !== 'string' || !apiKey || typeof model !== 'string' || !model.includes('/')) {
    throw new AgentError('not_configured', 'The OpenRouter API key and model must be configured.');
  }
  return async function complete(messages, tools, options = {}) {
    const body = {
      model,
      messages,
      ...(options.noTools || !tools.length
        ? { tool_choice: 'none' }
        : { tools, tool_choice: 'auto' }),
      max_tokens: options.maxOutputTokens || maxOutputTokens,
      stream: false,
      provider: { require_parameters: true },
    };
    const result = await requestJSON(fetcher, 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Telegram Serverless Agent',
      },
      body: JSON.stringify(body),
    });
    const choice = result.choices?.[0];
    if (!choice?.message || result.error)
      throw new AgentError('inference_failed', 'The model did not return a usable response.');
    if (choice.finish_reason === 'error')
      throw new AgentError('inference_failed', 'The model interrupted its response.');
    return {
      message: choice.message,
      finishReason: choice.finish_reason,
      usage: result.usage || {},
      requestId: result.id || null,
    };
  };
}
