import { AgentError } from '../shared/errors.js';
export function createTonServicesAdmin({ secrets }) {
  const getTonServices = async () => ({
    toncenter_configured: Boolean(await secrets.getSecret('toncenter')),
    pinata_configured: Boolean(await secrets.getSecret('pinata')),
  });
  return {
    getTonServices,
    async configureTonServices(input) {
      if (!input || Object.keys(input).some((k) => !['toncenterKey', 'pinataKey'].includes(k)))
        throw new AgentError('invalid_configuration', 'Provide supported TON service keys.');
      for (const [field, key] of [
        ['toncenterKey', 'toncenter'],
        ['pinataKey', 'pinata'],
      ])
        if (Object.hasOwn(input, field)) {
          if (
            typeof input[field] !== 'string' ||
            input[field].length > 8192 ||
            /\s/.test(input[field])
          )
            throw new AgentError('invalid_configuration', 'Invalid provider credential.');
          await secrets.setSecret(key, input[field]);
        }
      return getTonServices();
    },
  };
}
