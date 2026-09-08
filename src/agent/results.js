import { fitCatalogResult } from '../shared/catalog-result.js';
import { Buffer } from 'buffer';

export function projectResult(result, maxBytes) {
  if (result.result_kind === 'tool_catalog' && Array.isArray(result.matches)) {
    // An explicit oversized-contract error must survive further projection unchanged.
    if (result.error) return JSON.stringify(result);
    return JSON.stringify(fitCatalogResult(result, maxBytes));
  }
  const raw = JSON.stringify(result);
  if (Buffer.byteLength(raw) <= maxBytes) return raw;
  if (result.result_kind === 'schema')
    return JSON.stringify({
      error: 'schema_too_large',
      message:
        'The complete schema exceeds the result budget. Search a specific method or raise the result budget.',
    });
  const kept = { truncated: true };
  for (const key of [
    'error',
    'message',
    'state',
    'status',
    'ok',
    'operation_state',
    'message_id',
    'message_ids',
    'reply_delivered',
    'invoice_id',
    'transfer_id',
  ]) {
    if (Object.hasOwn(result, key) && Buffer.byteLength(JSON.stringify(result[key])) < maxBytes / 4)
      kept[key] = result[key];
  }
  const room = Math.max(
    0,
    Math.floor((maxBytes - Buffer.byteLength(JSON.stringify(kept)) - 100) / 6),
  );
  kept.preview = [...raw].slice(0, room).join('');
  return JSON.stringify(kept);
}
