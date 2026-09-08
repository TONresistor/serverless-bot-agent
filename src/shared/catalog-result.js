import { Buffer } from 'buffer';

/** Retain whole ranked contracts. Never turn a tool schema into a text preview. */
export function fitCatalogResult(result, maxBytes) {
  const matches = [...result.matches];
  const families = result.available_families ? [...result.available_families] : undefined;
  let truncated = Boolean(result.truncated);
  const envelope = () => ({
    result_kind: 'tool_catalog',
    matches,
    ...(truncated ? { truncated: true } : {}),
    ...(families ? { available_families: families } : {}),
  });
  while (matches.length && Buffer.byteLength(JSON.stringify(envelope())) > maxBytes) {
    matches.pop();
    truncated = true;
  }
  if (!matches.length && result.matches.length)
    return {
      result_kind: 'tool_catalog',
      matches: [],
      error: 'schema_too_large',
      name: result.matches[0].id,
      required_bytes: Buffer.byteLength(
        JSON.stringify({
          result_kind: 'tool_catalog',
          matches: [result.matches[0]],
          ...(truncated ? { truncated: true } : {}),
        }),
      ),
      message:
        'The best matching contract exceeds the result budget. Search a specific method or increase toolResultMaxBytes.',
    };
  while (families?.length && Buffer.byteLength(JSON.stringify(envelope())) > maxBytes) {
    families.pop();
    truncated = true;
  }
  return envelope();
}
