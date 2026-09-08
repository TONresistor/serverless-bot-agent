/** @typedef {{ query: string; count?: number; topic?: "general" | "news" | "finance" }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'web_search',
  description:
    'Search the live web for current facts, news or market information. Returns source titles, URLs, snippets and an optional answer. Base factual claims on the returned evidence and cite its source URLs. Use web_fetch when a specific page needs closer reading.',
  properties: {
    query: string('Search query in plain English.', 2000),
    count: {
      type: 'integer',
      description: 'Number of results (1..10, default 5).',
      minimum: 1,
      maximum: 10,
    },
    topic: {
      ...string('Use news for recent events, finance for markets, otherwise general.', 10),
      enum: ['general', 'news', 'finance'],
    },
  },
  required: ['query'],
});

/** @param {import('../../contracts/tools.js').WebSearchPort} web */
export function createWebSearchTool({ search }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      effect: 'read',
      parallelSafe: true,
      metadata: {
        family: 'web',
        exposure: 'search',
        keywords: ['search', 'internet', 'news', 'research', 'current', 'sources'],
      },
      validate: (args) => {
        if (!args.query.trim())
          throw new AgentError('invalid_arguments', 'A search query is required.');
      },
      execute: (args) =>
        search({
          query: args.query.trim(),
          count: args.count ?? 5,
          topic: args.topic || 'general',
        }),
    }),
  );
}
