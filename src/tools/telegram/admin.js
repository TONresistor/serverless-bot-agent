/** @typedef {{ method: keyof typeof TELEGRAM_METHODS.admin; params: Record<string, unknown> }} Args */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';
import { TELEGRAM_METHODS } from '../../shared/telegram-methods.js';

export const schema = defineSchema({
  name: 'telegram_admin',
  description:
    'Run a curated Telegram admin operation on behalf of the owner. params uses the named Bot API method fields. Business identity is supplied by the runtime, never by the model. External writes must follow the owner request.',
  properties: {
    method: { ...string('Bot API method.', 80), enum: Object.keys(TELEGRAM_METHODS.admin) },
    params: {
      type: 'object',
      description:
        'Named Bot API parameters for the selected method. No credentials or business_connection_id.',
      properties: {},
      required: [],
      additionalProperties: true,
      maxProperties: 40,
    },
  },
  required: ['method', 'params'],
});

/** @param {import('../../contracts/capabilities.js').TelegramMethodPort} capabilities */
export function createTelegramAdminTool({ call, validate }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: {
        family: 'telegram',
        exposure: 'direct',
        keywords: ['admin'],
        methods: TELEGRAM_METHODS.admin,
      },
      effectFor: (args) => (String(args.method).startsWith('get') ? 'read' : 'external_write'),
      parallelSafe: true,
      effect: 'external_write',
      validate,
      execute: (args, invocation) => call(args.method, args.params, invocation),
    }),
  );
}
