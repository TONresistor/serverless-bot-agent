import { validateTelegramParameters } from '../../domain/telegram/parameters.js';
import { AgentError } from '../../shared/errors.js';

/** Owner-only capabilities: transport never accepts an arbitrary method name from a tool. */
export function createTelegramOperations({ telegram, connections, ownerId, scope = undefined }) {
  function capability(family) {
    function validate(method, input) {
      const params = validateTelegramParameters(family, method, input);
      if (
        family === 'admin' &&
        scope &&
        (!scope.owner || scope.group || scope.boundDestination) &&
        String(params.chat_id) !== String(scope.destination)
      )
        throw new AgentError(
          'forbidden_destination',
          'This turn can administer only its current chat.',
          { effectNotStarted: true },
        );
      return params;
    }
    return {
      validate: (args) => {
        validate(args.method, args.params);
      },
      async call(method, input) {
        const params = validate(method, input);
        if (family === 'business') {
          const stored = await connections.get();
          if (!stored?.id)
            throw new AgentError(
              'business_unavailable',
              'No owner Business connection is configured.',
              { effectNotStarted: true },
            );
          // Recheck the real connection for every action, including revocation and changed rights.
          const current = await telegram.call('getBusinessConnection', {
            business_connection_id: stored.id,
          });
          if (!current.is_enabled || String(current.user?.id) !== String(ownerId))
            throw new AgentError(
              'business_unavailable',
              'The owner Business connection is not active.',
              { effectNotStarted: true },
            );
          params.business_connection_id = current.id;
        }
        try {
          return { ok: true, method, result: await telegram.call(method, params) };
        } catch (error) {
          if ([400, 401, 403, 404, 429].includes(error?.code))
            throw new AgentError(
              'telegram_rejected',
              `Telegram rejected ${method} (${error.code}). Check the parameters and bot permissions.`,
              { effectNotStarted: true },
            );
          throw new AgentError(
            'telegram_unknown',
            'The Telegram operation outcome is uncertain. Do not repeat it.',
          );
        }
      },
    };
  }
  return {
    admin: capability('admin'),
    business: capability('business'),
    gifts: capability('gifts'),
  };
}
