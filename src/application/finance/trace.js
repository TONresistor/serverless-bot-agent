import { AgentError } from '../../shared/errors.js';
import { findReceipt } from '../../domain/ton/contract-proof.js';
import { scanTransactions } from '../transaction-scan.js';

const keyOf = (m) => `${m.source}:${m.destination}:${m.createdLt}:${m.bodyHash}`;
/** Persist verified nodes and per-message pagination; no unbounded router scan or timer. */
export async function collectContractTrace(chain, message, previous = {}) {
  const nodes = new Map((previous?.nodes || []).map((n) => [keyOf(n.in), n]));
  const cursors = { ...(previous?.cursors || {}) },
    queue = [{ message, depth: 0 }],
    seen = new Set();
  let complete = true,
    reads = 0;
  const readErrors = [];
  while (queue.length && seen.size < 64) {
    const { message, depth } = queue.shift(),
      key = keyOf(message);
    if (seen.has(key)) continue;
    seen.add(key);
    if (depth > 6) {
      complete = false;
      continue;
    }
    let node = nodes.get(key);
    if (!node) {
      if (reads >= 8 || nodes.size >= 32) {
        complete = false;
        continue;
      }
      reads++;
      let scan;
      try {
        scan = await scanTransactions(
          chain,
          message.destination,
          (rows) => {
            const receipt = findReceipt(rows, message);
            return receipt ? { state: 'found', receipt } : { state: 'unknown' };
          },
          cursors[key] || null,
          message.createdLt,
        );
      } catch (error) {
        if (
          !(error instanceof AgentError) ||
          ![
            'rate_limited',
            'network_unknown',
            'ton_rpc',
            'http_502',
            'http_503',
            'http_504',
          ].includes(error.code)
        )
          throw error;
        complete = false;
        readErrors.push(error.code);
        continue;
      }
      if (scan.cursor) cursors[key] = scan.cursor;
      else delete cursors[key];
      if (scan.result.state !== 'found') {
        complete = false;
        continue;
      }
      node = scan.result.receipt;
      nodes.set(key, node);
    }
    if (node.success) queue.push(...node.out.map((message) => ({ message, depth: depth + 1 })));
  }
  if (queue.length) complete = false;
  return {
    complete,
    nodes: [...nodes.values()],
    cursors,
    ...(readErrors.length ? { readErrors: [...new Set(readErrors)] } : {}),
  };
}
