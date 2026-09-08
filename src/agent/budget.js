import { AgentError } from '../shared/errors.js';

export function createBudget(settings, now = () => Date.now(), startedAt = now()) {
  const started = startedAt;
  let modelCalls = 0,
    toolCalls = 0;
  return {
    get modelCalls() {
      return modelCalls;
    },
    get toolCalls() {
      return toolCalls;
    },
    get elapsedMs() {
      return now() - started;
    },
    canModel() {
      return modelCalls < settings.maxModelCalls && now() - started < settings.maxDurationMs;
    },
    shouldFinalize() {
      return (
        modelCalls >= settings.maxModelCalls - 1 ||
        now() - started >= settings.maxDurationMs - settings.finalizationReserveMs ||
        toolCalls >= settings.maxToolCalls
      );
    },
    consumeModel() {
      if (!this.canModel())
        throw new AgentError('turn_budget', 'The turn budget has been reached.');
      modelCalls++;
    },
    consumeTool() {
      if (toolCalls >= settings.maxToolCalls) return false;
      toolCalls++;
      return true;
    },
    snapshot() {
      return { model_calls: modelCalls, tool_calls: toolCalls, elapsed_ms: now() - started };
    },
  };
}
