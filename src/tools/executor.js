import { AgentError, errorCode, userError } from '../shared/errors.js';
import { digest } from '../shared/hash.js';
import { canonicalJSON } from '../shared/canonical.js';
import { assertToolResult } from './result.js';

/** Resolves bridges before validation, journaling and execution. */
export function createToolExecutor({
  registry,
  journal,
  token,
  assertActive,
  report = (_error, _context) => {},
  authorize = async (_name, _prepared) => {},
  resolve = (name, raw) => ({ tool: registry.get(name), raw }),
}) {
  function prepare(name, raw, callId) {
    const operationId = `tool:${digest(`${token}:${callId}`)}`;
    try {
      const target = resolve(name, raw),
        invoke = target.tool.prepare(target.raw);
      return {
        name: target.tool.name,
        operationId,
        callId,
        invoke,
        effect: invoke.effect,
        parallelSafe: invoke.parallelSafe,
        signature: digest(`${target.tool.name}:${canonicalJSON(invoke.args)}`),
      };
    } catch (error) {
      report(error, {
        phase: 'tool_prepare',
        tool: registry.names.includes(name) ? name : undefined,
        operationId,
      });
      return {
        name,
        operationId,
        callId,
        effect: 'read',
        parallelSafe: false,
        signature: digest(`${name}:${raw}`),
        error: { error: errorCode(error), message: userError(error) },
      };
    }
  }
  async function run(prepared) {
    if (prepared.error) return prepared.error;
    const { name, operationId, signature, effect } = prepared;
    await assertActive();
    const previous = await journal.operation(operationId);
    if (previous) {
      if (previous.data.signature && previous.data.signature !== signature)
        return {
          error: 'operation_mismatch',
          message: 'This call identifier belongs to a different operation.',
        };
      return previous.state === 'succeeded'
        ? previous.data.result
        : {
            error: 'operation_unknown',
            operation_state: 'unknown',
            message: 'This operation already started. Do not repeat it.',
          };
    }
    if (!(await journal.claim(operationId, 'tool', 'executing', { name, signature, effect })))
      return { error: 'operation_busy', operation_state: 'unknown' };
    let started = false;
    try {
      await assertActive();
      await authorize(name, prepared);
      started = true;
      const result = await prepared.invoke(Object.freeze({ operationId }));
      assertToolResult(result);
      if (
        !(await journal.transition(operationId, ['executing'], 'succeeded', {
          name,
          signature,
          effect,
          result,
        }))
      )
        throw new Error('Tool result could not be committed');
      return result;
    } catch (error) {
      report(error, { phase: 'tool_execute', tool: name, operationId });
      const state =
        started &&
        effect === 'external_write' &&
        !(error instanceof AgentError && error.effectNotStarted)
          ? 'unknown'
          : 'failed';
      const result = { error: errorCode(error), message: userError(error), operation_state: state };
      await journal.transition(operationId, ['executing'], state, {
        name,
        signature,
        effect,
        result,
      });
      return result;
    }
  }
  const execute = async (name, raw, callId) => run(prepare(name, raw, callId));
  return Object.assign(execute, { prepare, run });
}
