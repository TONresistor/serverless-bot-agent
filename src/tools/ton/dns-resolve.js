/** @typedef {{ domain: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'ton_dns_resolve',
  description:
    'Resolve a .ton domain to its linked wallet in non-bounceable and bounceable form. A bare label means label.ton. Read-only.',
  properties: { domain: string('TON DNS domain, e.g. foundation.ton or alice.', 126) },
  required: ['domain'],
});

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'dnsResolve'>} capabilities */
export function createDnsResolveTool({ dnsResolve }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'ton', exposure: 'search', keywords: ['ton', 'dns', 'resolve'] },
      effect: 'read',
      parallelSafe: true,
      validate: (args) => {
        if (!args.domain.trim()) throw new AgentError('invalid_arguments', 'Domain is required.');
      },
      execute: ({ domain }) => dnsResolve({ domain: domain.trim() }),
    }),
  );
}
