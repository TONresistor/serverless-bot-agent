import { createSendMessageTool, schema as sendMessage } from '../../tools/telegram/send-message.js';
import { createTelegramAdminTool, schema as admin } from '../../tools/telegram/admin.js';
import { createTelegramBusinessTool, schema as business } from '../../tools/telegram/business.js';
import { createTelegramGiftsTool, schema as gifts } from '../../tools/telegram/gifts.js';
import {
  createRequestStarPaymentTool,
  schema as payments,
} from '../../tools/telegram/request-star-payment.js';
export const schemas = [sendMessage, admin, business, gifts, payments];
/** @param {import('../../contracts/capabilities.js').BuiltinPorts} ports */
export const createTools = ({ messenger, admin, business, gifts, payments }) => [
  createSendMessageTool(messenger),
  createTelegramAdminTool(admin),
  createTelegramBusinessTool(business),
  createTelegramGiftsTool(gifts),
  createRequestStarPaymentTool(payments),
];
