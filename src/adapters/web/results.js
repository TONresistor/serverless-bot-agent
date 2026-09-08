import { publicWebURL } from '../../shared/web-url.js';
import { clipWebText, fitWebResult } from '../../shared/web-results.js';
import { AgentError } from '../../shared/errors.js';

export function searchResult(raw, input, maxBytes) {
  if (!raw || !Array.isArray(raw.results))
    throw new AgentError('invalid_response', 'The web service returned invalid search results.');
  const results = [];
  let truncated = false;
  for (const row of raw.results) {
    if (
      !row ||
      typeof row.url !== 'string' ||
      typeof row.content !== 'string' ||
      typeof row.title !== 'string'
    )
      continue;
    let url;
    try {
      url = publicWebURL(row.url);
    } catch {
      continue;
    }
    const content = clipWebText(row.content, 2000),
      title = clipWebText(row.title, 512);
    truncated ||= content !== row.content || title !== row.title;
    results.push({
      title,
      url,
      content,
      score: typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : 0,
    });
    if (results.length >= input.count) break;
  }
  const answer = clipWebText(typeof raw.answer === 'string' ? raw.answer : '', 2000);
  return fitWebResult(
    {
      query: input.query,
      answer,
      results,
      ...(truncated || answer !== (raw.answer || '') ? { truncated: true } : {}),
    },
    maxBytes,
  );
}
export function fetchResult(raw, maxBytes) {
  if (!raw || typeof raw.url !== 'string' || typeof raw.text !== 'string' || !raw.text.trim())
    throw new AgentError(
      'web_extract_failed',
      'The page did not return readable text. It may be unavailable or require a browser.',
    );
  const text = clipWebText(raw.text, 12000);
  const result = {
    url: publicWebURL(raw.url),
    text,
    ...(text !== raw.text ? { truncated: true } : {}),
  };
  for (const key of ['title', 'site', 'author', 'published'])
    if (typeof raw[key] === 'string' && raw[key]) result[key] = clipWebText(raw[key], 512);
  return fitWebResult(result, maxBytes);
}
