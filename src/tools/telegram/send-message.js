/**
 * @typedef {object} Args
 * @property {string} [chat_id]
 * @property {number} [reply_to_message_id]
 * @property {RichButton[]} [rich_buttons]
 * @property {string} text
 */
/**
 * @typedef {object} RichButton
 * @property {string} label
 * @property {"url" | "copy" | "callback" | "disabled"} type
 * @property {string} [value]
 * @property {"primary" | "success" | "danger" | "link"} [style]
 * @property {"auto" | "inline" | "bottom"} [placement]
 * @property {number} [row]
 * @property {{tool: string, args: Record<string, unknown>}} [execute]
 */
import { defineTool } from '../define.js';
import { defineSchema, string } from '../schema.js';

export const schema = defineSchema({
  name: 'telegram_send_message',
  description:
    'Send a Rich Message to a known chat, with optional native buttons. Only the original authorized caller can use action buttons. Do not repeat the same message afterward.',
  properties: {
    chat_id: string(
      'Known numeric destination chat ID. Defaults to the current conversation; restricted contexts cannot redirect it.',
      30,
    ),
    reply_to_message_id: { type: 'integer', minimum: 1, maximum: 2147483647 },
    rich_buttons: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        maxProperties: 8,
        additionalProperties: false,
        required: ['label', 'type'],
        properties: {
          label: string('Button label.', 64),
          type: { ...string('Button action.', 20), enum: ['url', 'copy', 'callback', 'disabled'] },
          value: string('URL, copied text or conversation instruction.', 1000),
          style: { ...string('Button style.', 20), enum: ['primary', 'success', 'danger', 'link'] },
          placement: { ...string('Button position.', 20), enum: ['auto', 'inline', 'bottom'] },
          row: { type: 'integer', minimum: 0, maximum: 15 },
          execute: {
            type: 'object',
            maxProperties: 2,
            additionalProperties: false,
            required: ['tool', 'args'],
            properties: {
              tool: string('Tool to execute once on the authorized caller click.', 80),
              args: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: true,
                maxProperties: 40,
              },
            },
          },
        },
      },
    },
    text: string(
      'Telegram Rich Markdown message: headings, tables, lists, links and code blocks.',
      12000,
    ),
  },
  required: ['text'],
});

/** @param {import('../../contracts/tools.js').MessagePort} messenger */
export function createSendMessageTool({ send, validate }) {
  return defineTool(
    /** @satisfies {import('../../contracts/tools.js').ToolSpecification<Args>} */ ({
      schema,
      metadata: { family: 'telegram', exposure: 'direct', keywords: [] },
      effect: 'external_write',
      validate,
      async execute(args, invocation) {
        const message = await send(args.text, invocation, args);
        return {
          ...(message.message_id ? { message_id: message.message_id } : {}),
          ...(message.inline_message_id ? { inline_message_id: message.inline_message_id } : {}),
          reply_delivered: message.reply_delivered !== false,
          sent_text: args.text,
        };
      },
    }),
  );
}
