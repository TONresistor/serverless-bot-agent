export class AgentError extends Error {
  constructor(code, message, { effectNotStarted = false } = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.effectNotStarted = effectNotStarted;
  }
}

export function userError(error) {
  return error instanceof AgentError ? error.message : 'Something went wrong. Try again shortly.';
}

export function errorCode(error) {
  return error instanceof AgentError ? error.code : 'internal_error';
}
