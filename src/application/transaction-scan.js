// Bounded traversal over the injected chain port; no HTTP/provider dependency.
export async function scanTransactions(ton, address, inspect, cursor = null, beforeLt = '0') {
  for (let page = 0; page < 3; page++) {
    const rows = await ton.transactions(address, cursor);
    const result = inspect(rows);
    if (!['unknown', 'submitted'].includes(result.state)) return { result, cursor: null };
    const last = rows.at(-1)?.transaction_id;
    if (rows.length < 100 || !last || BigInt(last.lt) <= BigInt(beforeLt) || last.lt === cursor?.lt)
      return { result, cursor: null };
    cursor = { lt: last.lt, hash: last.hash };
  }
  return { result: { state: 'unknown' }, cursor };
}
