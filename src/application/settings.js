import { DEFAULT_SETTINGS, resolveSettings, updateSettingsDocument } from '../agent/settings.js';
import { AgentError } from '../shared/errors.js';

export function createSettingsAdmin({ configuration, agentSettings, fetchProfile }) {
  async function getAgentSettings() {
    const config = await configuration.getConfig(),
      document = await agentSettings.read();
    const profile = config && (await agentSettings.modelProfile(config.model));
    return {
      revision: document.revision,
      defaults: { ...DEFAULT_SETTINGS, ...document.defaults },
      overrides: document.overrides,
      effective: Object.fromEntries(
        ['dm', 'group', 'guest', 'business', 'task', 'heartbeat'].map((surface) => [
          surface,
          resolveSettings(document, surface, profile),
        ]),
      ),
      model_profile: profile || {
        source: 'conservative_fallback',
        contextWindowTokens: 32768,
        maxOutputTokens: 2048,
      },
    };
  }
  async function refreshAgentModelProfile() {
    const config = await configuration.getConfig();
    if (!config) throw new AgentError('not_configured', 'Configure the agent first.');
    const profile = await fetchProfile(config.model);
    await agentSettings.setModelProfile(config.model, profile);
    return getAgentSettings();
  }
  return {
    getAgentSettings,
    refreshAgentModelProfile,
    async updateAgentSettings(input) {
      const previous = await agentSettings.read();
      if (
        !Number.isSafeInteger(input?.expectedRevision) ||
        previous.revision !== input.expectedRevision
      )
        throw new AgentError(
          'settings_conflict',
          'Read settings and provide the current expectedRevision.',
        );
      const next = updateSettingsDocument(previous, input);
      const config = await configuration.getConfig();
      const profile = config && (await agentSettings.modelProfile(config.model));
      for (const surface of ['dm', 'group', 'guest', 'business', 'task', 'heartbeat'])
        resolveSettings(next, surface, profile);
      await agentSettings.compareAndSet(previous, next);
      return getAgentSettings();
    },
  };
}
