import { createToolRegistry } from './registry.js';
import { allowsTool, COMPAT_ACCESS } from '../shared/access-policy.js';

/** The same policy filters discovery and execution. Unknown tools fail closed. */
export function permittedRegistry(registry, scope, policy = COMPAT_ACCESS) {
  return createToolRegistry(
    registry.names
      .filter((name) => allowsTool(policy, name, scope))
      .map((name) => registry.get(name)),
  );
}
