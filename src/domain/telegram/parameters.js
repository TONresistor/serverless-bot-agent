import { TELEGRAM_METHODS } from '../../shared/telegram-methods.js';
import { AgentError } from '../../shared/errors.js';

export function validateTelegramParameters(family, method, params) {
  const methods = TELEGRAM_METHODS[family];
  if (!methods || !Object.hasOwn(methods, method))
    throw new AgentError('invalid_arguments', 'Telegram method not allowed.');
  if (!params || typeof params !== 'object' || Array.isArray(params))
    throw new AgentError('invalid_arguments', 'Telegram params must be an object.');
  if (Object.hasOwn(params, 'business_connection_id'))
    throw new AgentError('invalid_arguments', 'Business identity is runtime-managed.');
  const fields = methods[method];
  for (const [name, field] of Object.entries(fields)) {
    if (name !== 'business_connection_id' && field.required && !Object.hasOwn(params, name))
      throw new AgentError('invalid_arguments', `Missing Telegram parameter: ${name}.`);
  }
  for (const [name, value] of Object.entries(params)) {
    if (!Object.hasOwn(fields, name))
      throw new AgentError('invalid_arguments', `Telegram parameter not allowed: ${name}.`);
    const type = fields[name].type;
    const valid =
      type === 'Integer'
        ? Number.isSafeInteger(value)
        : type === 'Boolean'
          ? typeof value === 'boolean'
          : type === 'String'
            ? typeof value === 'string'
            : type === 'Integer or String'
              ? Number.isSafeInteger(value) || typeof value === 'string'
              : type === 'Float' || type === 'Float number'
                ? typeof value === 'number' && Number.isFinite(value)
                : type.startsWith('Array of')
                  ? Array.isArray(value)
                  : (typeof value === 'object' && value !== null) || typeof value === 'string';
    if (!valid)
      throw new AgentError('invalid_arguments', `Invalid Telegram parameter type: ${name}.`);
  }
  return { ...params };
}
