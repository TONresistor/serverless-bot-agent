/** @param {string} description @param {number} maxLength @returns {import('../contracts/tools.js').StringParameter} */
export const string = (description, maxLength) => ({ type: 'string', description, maxLength });

export function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function assertParameter(parameter) {
  const validBound = (value) => Number.isSafeInteger(value) && value > 0;
  const keys = {
    string: ['type', 'description', 'maxLength', 'enum'],
    boolean: ['type', 'description'],
    object: [
      'type',
      'description',
      'properties',
      'required',
      'additionalProperties',
      'maxProperties',
    ],
    integer: ['type', 'description', 'minimum', 'maximum'],
    array: ['type', 'description', 'items', 'maxItems'],
  };
  if (
    !parameter ||
    !Object.hasOwn(keys, parameter.type) ||
    Object.keys(parameter).some((key) => !keys[parameter.type].includes(key))
  )
    throw new Error('Unsupported tool schema keyword or type');
  if (parameter.type === 'string' && !validBound(parameter.maxLength))
    throw new Error('Tool string needs a finite maxLength');
  if (
    parameter.type === 'integer' &&
    (!Number.isSafeInteger(parameter.minimum) ||
      !Number.isSafeInteger(parameter.maximum) ||
      parameter.minimum > parameter.maximum)
  )
    throw new Error('Tool integer needs valid bounds');
  if (
    parameter.enum &&
    (!Array.isArray(parameter.enum) ||
      !parameter.enum.length ||
      parameter.enum.some((v) => typeof v !== 'string' || v.length > parameter.maxLength))
  )
    throw new Error('Invalid string enum');
  if (parameter.type === 'object') {
    if (
      !validBound(parameter.maxProperties) ||
      !parameter.properties ||
      !Array.isArray(parameter.required) ||
      typeof parameter.additionalProperties !== 'boolean' ||
      parameter.required.some((key) => !Object.hasOwn(parameter.properties, key))
    )
      throw new Error('Invalid object schema');
    Object.values(parameter.properties).forEach(assertParameter);
  }
  if (parameter.type === 'array') {
    if (!validBound(parameter.maxItems) || !parameter.items)
      throw new Error('Tool array needs bounded items');
    assertParameter(parameter.items);
  }
}

/**
 * Static, validated subset of JSON Schema used by this runtime. Unsupported
 * keywords fail at construction instead of silently skipping input validation.
 * @param {{name: string, description: string, properties: Record<string, import('../contracts/tools.js').Parameter>, required: string[]}} spec
 * @returns {import('../contracts/tools.js').ToolSchema}
 */
export function defineSchema({ name, description, properties, required }) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || !description.trim())
    throw new Error('Invalid tool identity');
  Object.values(properties).forEach(assertParameter);
  if (
    new Set(required).size !== required.length ||
    required.some((key) => !Object.hasOwn(properties, key))
  )
    throw new Error('Invalid required tool fields');
  return freeze({
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: JSON.parse(JSON.stringify(properties)),
        required: [...required],
        additionalProperties: false,
      },
    },
  });
}
