import { createCatalog } from '../catalog.js';
import { createSearchTool } from './search.js';
import { createCallTool } from './call.js';

export function createDiscovery(registry, settings) {
  const catalog = createCatalog(registry, settings);
  const enabled =
    settings.discoveryMode === 'search' &&
    registry.names.some((n) => registry.get(n).metadata.exposure === 'search');
  const controls = [createSearchTool(catalog), createCallTool()];
  const byName = new Map(controls.map((t) => [t.name, t]));
  return {
    schemas: enabled
      ? [
          ...registry.names
            .filter((n) => registry.get(n).metadata.exposure === 'direct')
            .map((n) => registry.get(n).schema),
          ...controls.map((t) => t.schema),
        ]
      : registry.schemas,
    listing: enabled ? catalog.listing() : '',
    resolve(name, raw) {
      if (enabled && name === 'tool_call') {
        const args = byName.get(name).prepare(raw).args;
        const entry = catalog.resolve(args.name);
        return {
          tool: registry.get(entry.name),
          raw: JSON.stringify(
            entry.method ? { method: entry.method, params: args.arguments } : args.arguments,
          ),
        };
      }
      if (name.includes('.')) {
        const entry = catalog.resolve(name);
        return {
          tool: registry.get(entry.name),
          raw: JSON.stringify({ method: entry.method, params: JSON.parse(raw) }),
        };
      }
      return { tool: enabled && byName.has(name) ? byName.get(name) : registry.get(name), raw };
    },
  };
}
