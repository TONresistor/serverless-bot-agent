/** @typedef {{ to: string; amount: string; comment?: string }} Args */
import { Buffer } from 'buffer';
import { AgentError } from '../../shared/errors.js';
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'ton_send',
  description:
    'Prepare a TON transfer. The owner must confirm using the Telegram buttons before anything is signed.',
  properties: {
    to: string('Recipient TON address.', 100),
    amount: string('TON amount as a decimal string, for example 0.01.', 24),
    comment: string('Optional comment.', 120),
  },
  required: ['to', 'amount'],
});

/** @param {import('../../contracts/tools.js').TransferPreparationPort} transfers */
export function createSendTonTool({ prepare, validate }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'ton', exposure: 'search', keywords: ['transfer', 'send', 'wallet'] },
      effect: 'external_write',
      validate(args) {
        validate?.(args);
        if (Buffer.byteLength(args.comment || '') > 120)
          throw new AgentError('invalid_arguments', 'The comment exceeds 120 bytes.');
      },
      execute(args, { operationId }) {
        return prepare(args, operationId);
      },
    }),
  );
}
