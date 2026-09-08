import { Buffer } from 'buffer';
import { AgentError } from '../shared/errors.js';

/** @param {import('../contracts/tools.js').InputSchema} schema @param {string} raw @returns {Record<string, unknown>} */
export function validateArguments(schema, raw, maxBytes = 20_000) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > maxBytes)
    throw new AgentError('invalid_arguments', 'Arguments are too large.');
  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    throw new AgentError('invalid_arguments', 'Invalid JSON arguments.');
  }
  validateValue(schema, args, 0);
  return args;
}

function fail(message) {
  throw new AgentError('invalid_arguments', message);
}
function safeJSON(value, depth) {
  if (depth > 12) fail('Arguments are nested too deeply.');
  if (value && typeof value === 'object') {
    if (Object.keys(value).length > 100) fail('Too many object fields.');
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Argument not allowed.');
      safeJSON(child, depth + 1);
    }
  }
}
function validateValue(schema, value, depth) {
  safeJSON(value, depth);
  if (
    schema.type === 'string' &&
    (typeof value !== 'string' ||
      [...value].length > schema.maxLength ||
      (schema.enum && !schema.enum.includes(value)))
  )
    fail('Text is invalid or too long.');
  if (
    schema.type === 'integer' &&
    (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum)
  )
    fail('Number is out of bounds.');
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail('Invalid boolean.');
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) fail('Invalid list.');
    value.forEach((item) => validateValue(schema.items, item, depth + 1));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail('A JSON object is required.');
    if (Object.keys(value).length > (schema.maxProperties || 100)) fail('Too many object fields.');
    if (schema.required.some((key) => !Object.hasOwn(value, key)))
      fail('A required argument is missing.');
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) {
        if (!schema.additionalProperties) fail('Argument not allowed.');
      } else validateValue(schema.properties[key], child, depth + 1);
    }
  }
}
