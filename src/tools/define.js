import { freeze } from './schema.js';
import { validateArguments } from './validation.js';

/**
 * Bind a typed implementation to its transport schema. The executor receives
 * only a validated invocation closure, never the tool's injected dependencies.
 * @template {Record<string, unknown>} Args
 * @param {import('../contracts/tools.js').ToolSpecification<Args>} spec
 * @returns {import('../contracts/tools.js').Tool}
 */
export function defineTool({
  schema,
  effect,
  validate,
  execute,
  metadata,
  effectFor,
  parallelSafe = false,
  maxArgumentBytes = 20_000,
}) {
  if (!['read', 'state_write', 'external_write'].includes(effect) || typeof execute !== 'function')
    throw new Error('Invalid tool implementation');
  if (
    metadata &&
    (!/^[a-z][a-z0-9_-]{0,63}$/.test(metadata.family) ||
      !['direct', 'search'].includes(metadata.exposure) ||
      !Array.isArray(metadata.keywords) ||
      metadata.keywords.some((v) => typeof v !== 'string' || v.length > 80))
  )
    throw new Error('Invalid tool metadata');
  return Object.freeze({
    name: schema.function.name,
    schema,
    effect,
    metadata: freeze(
      JSON.parse(JSON.stringify(metadata || { family: 'other', keywords: [], exposure: 'search' })),
    ),
    prepare(raw) {
      const args = /** @type {Args} */ (
        validateArguments(schema.function.parameters, raw, maxArgumentBytes)
      );
      validate?.(args);
      const resolvedEffect = effectFor ? effectFor(args) : effect;
      if (!['read', 'state_write', 'external_write'].includes(resolvedEffect))
        throw new Error('Invalid resolved tool effect');
      const invoke = async (invocation) => execute(args, invocation);
      return Object.freeze(
        Object.assign(invoke, {
          args,
          effect: resolvedEffect,
          parallelSafe: parallelSafe && resolvedEffect === 'read',
        }),
      );
    },
  });
}
