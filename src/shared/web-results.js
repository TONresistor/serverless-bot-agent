import { Buffer } from 'buffer';
import { AgentError } from './errors.js';

export function clipWebText(text, maxBytes) {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let bytes = 0,
    kept = '';
  for (const ch of text) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > maxBytes) break;
    kept += ch;
    bytes += size;
  }
  return kept;
}

/** Preserve structured results and complete source URLs under the loop's result budget. */
export function fitWebResult(value, maxBytes) {
  const result = JSON.parse(JSON.stringify(value));
  const size = () => Buffer.byteLength(JSON.stringify(result));
  if (size() <= maxBytes) return result;
  result.truncated = true;
  while (size() > maxBytes) {
    const fields = [
      [result, 'query'],
      [result, 'answer'],
      [result, 'text'],
      [result, 'title'],
      [result, 'site'],
      [result, 'author'],
      [result, 'published'],
      ...(result.results || []).flatMap((r) => [
        [r, 'content'],
        [r, 'title'],
      ]),
    ];
    const candidates = fields
      .filter(([o, k]) => typeof o[k] === 'string' && o[k].length)
      .sort(([a, x], [b, y]) => Buffer.byteLength(b[y]) - Buffer.byteLength(a[x]));
    if (!candidates.length) {
      if (result.results?.length) {
        result.results.pop();
        continue;
      }
      throw new AgentError(
        'web_result_too_large',
        'The source URL exceeds this turn’s result budget. Increase the result budget.',
      );
    }
    const [object, key] = candidates[0],
      bytes = Buffer.byteLength(object[key]);
    object[key] = clipWebText(
      object[key],
      Math.max(0, bytes - Math.max(size() - maxBytes, Math.ceil(bytes / 4))),
    );
  }
  return result;
}
