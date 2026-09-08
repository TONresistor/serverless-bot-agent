import { fitCatalogResult } from '../shared/catalog-result.js';
import { AgentError } from '../shared/errors.js';

const tokens = (s) =>
  String(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.map((v) => (v.length > 4 ? v.replace(/(?:ing|ed|s)$/, '') : v)) || [];
export function createCatalog(registry, settings) {
  const entries = registry.names
    .flatMap((name) => {
      const tool = registry.get(name),
        meta = tool.metadata;
      const base = {
        id: name,
        name,
        family: meta.family,
        description: tool.schema.function.description,
        required: tool.schema.function.parameters.required,
        direct: meta.exposure === 'direct',
      };
      return [
        base,
        ...Object.entries(meta.methods || {}).map(([method, fields]) => ({
          ...base,
          id: `${name}.${method}`,
          method,
          description: `${meta.family} ${method.replace(/([a-z])([A-Z])/g, '$1 $2')}`,
          required: Object.entries(fields)
            .filter(([n, f]) => n !== 'business_connection_id' && f.required)
            .map(([n]) => n),
        })),
      ];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const docs = entries.map((e) =>
    tokens(
      `${e.id} ${e.id} ${e.family} ${registry.get(e.name).metadata.keywords.join(' ')} ${e.description}`,
    ),
  );
  const average = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);
  const frequencies = new Map();
  for (const doc of docs)
    for (const word of new Set(doc)) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  function resolve(name) {
    const entry = entries.find((e) => e.id === name);
    if (!entry) throw new AgentError('unknown_tool', 'Unknown or unavailable tool.');
    return entry;
  }
  function contract(entry) {
    const tool = registry.get(entry.name);
    return entry.method
      ? {
          ...entry,
          parameters: Object.fromEntries(
            Object.entries(tool.metadata.methods[entry.method]).filter(
              ([key]) => key !== 'business_connection_id',
            ),
          ),
        }
      : { ...entry, schema: tool.schema.function.parameters };
  }
  return {
    entries,
    listing() {
      const groups = new Map();
      for (const e of entries.filter((e) => !e.direct)) {
        if (!groups.has(e.family)) groups.set(e.family, []);
        groups.get(e.family).push(e.name);
      }
      const lines = [...groups].map(
        ([family, names]) => `${family}: ${[...new Set(names)].join(', ')}`,
      );
      const text = lines.join('\n');
      if (text.length <= settings.catalogListingMaxTokens * 3) return text;
      return [...groups]
        .map(([family, names]) => `${family}: ${new Set(names).size} tools`)
        .join('\n')
        .slice(0, settings.catalogListingMaxTokens * 3);
    },
    search(query, limit = settings.searchDefaultLimit) {
      const queryTokens = [...new Set(tokens(query))];
      const exact = entries.find((entry) => entry.id.toLowerCase() === query.trim().toLowerCase());
      const ranked = exact
        ? [{ entry: exact, score: 100 }]
        : entries
            .map((entry, i) => {
              let score = entry.id.toLowerCase() === query.toLowerCase().trim() ? 100 : 0;
              for (const word of queryTokens) {
                const tf = docs[i].filter((v) => v === word).length;
                if (!tf) continue;
                const df = frequencies.get(word) || 0;
                score +=
                  (Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)) * tf * 2.2) /
                  (tf + 1.2 * (0.25 + (0.75 * docs[i].length) / average));
              }
              return { entry, score };
            })
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
      const matches = ranked
        .slice(0, Math.min(limit, settings.searchMaxLimit))
        .map(({ entry }) => contract(entry));
      return fitCatalogResult(
        {
          matches,
          ...(!ranked.length
            ? { available_families: [...new Set(entries.map((e) => e.family))].slice(0, 30) }
            : {}),
        },
        settings.toolResultMaxBytes,
      );
    },
    resolve,
  };
}
