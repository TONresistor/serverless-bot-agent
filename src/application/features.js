import {
  DEFAULT_SOUL,
  DEFAULT_HEARTBEAT,
  workspacePath,
  validateWorkspaceContent,
} from '../domain/workspace.js';
import { AgentError } from '../shared/errors.js';
import { TOOL_DEFAULTS } from '../shared/access-policy.js';
import { Buffer } from 'buffer';

/** Authenticated management only; Telegram messages cannot reach these methods. */
export function createFeatureAdmin({ features, workspace, configuration }) {
  return {
    async initializeFeatures({ migrateLegacy = false } = {}) {
      const config = await configuration.getConfig();
      if (!config) throw new AgentError('not_configured', 'Configure the agent first.');
      await features.initializeAccess(migrateLegacy === true);
      await workspace.seed('SOUL.md', config.personality || DEFAULT_SOUL);
      await workspace.seed('HEARTBEAT.md', DEFAULT_HEARTBEAT);
      await workspace.seed('SECRETARY.md', '');
      return { initialized: true };
    },
    getAccessPolicy: () => features.access(),
    updateAccessPolicy: ({ expectedRevision, value }) => {
      if (Object.keys(value?.tools || {}).some((name) => !Object.hasOwn(TOOL_DEFAULTS, name)))
        throw new AgentError('invalid_policy', 'Unknown tool name.');
      return features.setAccess(expectedRevision, value);
    },
    getSecretarySettings: () => features.secretary(),
    updateSecretarySettings: ({ expectedRevision, enabled }) =>
      features.setSecretary(expectedRevision, enabled),
    listWorkspace: () => workspace.port().list(),
    readWorkspace: ({ path }) => workspace.port().read(path),
    writeWorkspace: async ({ path, content, expectedRevision }) => {
      path = workspacePath(path);
      validateWorkspaceContent(content);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new AgentError(
          'workspace_conflict',
          'Read the file and provide its expectedRevision; use zero for a new file.',
        );
      if (
        (path === 'SOUL.md' && [...content].length > 8192) ||
        (path === 'HEARTBEAT.md' && Buffer.byteLength(content) > 32768) ||
        (path === 'SECRETARY.md' && Buffer.byteLength(content) > 8192)
      )
        throw new AgentError('workspace_size', 'The configuration file exceeds its editor limit.');
      return workspace.port().write(path, content, expectedRevision);
    },
  };
}
