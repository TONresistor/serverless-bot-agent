/** @typedef {{ domain: string }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { AgentError } from '../../shared/errors.js';

export const schema = defineSchema({
  name: 'ton_dns_info',
  description:
    'Inspect a .ton domain: NFT owner, linked wallet, ADNL site or TON Storage bag and collection. Read-only.',
  properties: { domain: string('TON DNS domain, e.g. foundation.ton or alice.', 126) },
  required: ['domain'],
});

/** @param {Pick<import('../../contracts/capabilities.js').ReadCapabilities, 'dnsInfo'>} capabilities */
export function createDnsInfoTool({ dnsInfo }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'ton', exposure: 'search', keywords: ['ton', 'dns', 'info'] },
      effect: 'read',
      parallelSafe: true,
      validate: (args) => {
        if (!args.domain.trim()) throw new AgentError('invalid_arguments', 'Domain is required.');
      },
      execute: ({ domain }) => dnsInfo({ domain: domain.trim() }),
    }),
  );
}
