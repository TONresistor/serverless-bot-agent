import { Buffer } from 'buffer';
import { AgentError } from '../shared/errors.js';

export async function requestJSON(fetcher, url, options = {}, maxBytes = 1_048_576) {
  let response;
  try {
    response = await fetcher(url, options);
  } catch {
    throw new AgentError(
      'network_unknown',
      'The remote service is not responding. The request outcome is uncertain.',
    );
  }
  if (!response.ok) {
    const code = response.status === 429 ? 'rate_limited' : `http_${response.status}`;
    throw new AgentError(
      code,
      response.status === 429
        ? 'The service is temporarily rate-limited. Try again shortly.'
        : `The remote service rejected the request (${response.status}).`,
    );
  }
  try {
    let text;
    if (response.body?.[Symbol.asyncIterator]) {
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes)
          throw new AgentError(
            'response_too_large',
            'The service response exceeds the allowed size limit.',
          );
        chunks.push(bytes);
      }
      text = Buffer.concat(chunks).toString('utf8');
    } else {
      text = await response.text();
      if (Buffer.byteLength(text) > maxBytes)
        throw new AgentError(
          'response_too_large',
          'The service response exceeds the allowed size limit.',
        );
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(
      'invalid_response',
      'The service returned an incomplete or invalid response.',
    );
  }
}
