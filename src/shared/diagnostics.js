import { AgentError } from './errors.js';

/** Diagnostics contain only controlled identifiers and code locations, never
 * exception messages, argument values, provider responses or the first stack line.
 */
/** @param {import('../contracts/runtime.js').Log} [log]
 * @returns {import('../contracts/runtime.js').ReportError} */
export function createDiagnosticReporter(log = (_event, _fields) => {}) {
  return (error, context = {}) => {
    try {
      const fields = /** @type {Record<string, unknown>} */ ({});
      for (const key of ['phase', 'tool', 'operationId', 'event']) {
        const value = context[key];
        if (typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)) fields[key] = value;
      }
      const code = error instanceof AgentError ? error.code : 'internal_error';
      fields.code =
        typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'internal_error';
      fields.type =
        error instanceof TypeError
          ? 'TypeError'
          : error instanceof ReferenceError
            ? 'ReferenceError'
            : error instanceof RangeError
              ? 'RangeError'
              : error instanceof SyntaxError
                ? 'SyntaxError'
                : error instanceof AgentError
                  ? 'AgentError'
                  : 'Error';
      fields.locations =
        error instanceof Error && typeof error.stack === 'string'
          ? error.stack
              .split('\n')
              .slice(1, 9)
              .flatMap((line) => {
                const match =
                  /(?:^|\/|\s)((?:src\/(?:agent|application|adapters|tools|domain|composition|shared)\/[a-z0-9/-]+\.js|lib\/runtime(?:\.js)?)):(\d+)(?::(\d+))?(?:\)|$)/.exec(
                    line,
                  );
                return match ? [`${match[1]}:${match[2]}${match[3] ? ':' + match[3] : ''}`] : [];
              })
          : [];
      log('diagnostic', fields);
    } catch {
      /* Diagnostics must never change an operation's outcome. */
    }
  };
}
