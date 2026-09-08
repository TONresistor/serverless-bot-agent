/** Validate the JSON boundary before results enter the journal or model context. */
export function assertToolResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Tool result must be an object');
  const ancestors = new Set();
  function visit(value, depth) {
    if (depth > 30) throw new Error('Tool result nesting limit exceeded');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || ancestors.has(value))
      throw new Error('Tool result must be finite acyclic JSON');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('Tool result must contain plain JSON objects');
    ancestors.add(value);
    Object.values(value).forEach((child) => visit(child, depth + 1));
    ancestors.delete(value);
  }
  visit(result, 0);
}
