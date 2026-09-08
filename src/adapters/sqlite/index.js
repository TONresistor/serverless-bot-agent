import { createTasksRepository } from './tasks.js';
import { createFeatureRepository } from './features.js';
import { createWorkspaceRepository } from './workspace.js';
import { createAgentSettingsRepository } from './agent-settings.js';
import { createTurnsRepository } from './turns.js';
import { createScopedMemoryRepository } from './scoped-memory.js';
import { createConfigurationRepository } from './configuration.js';
import { createSecretsRepository } from './secrets.js';
import { createConversationsRepository } from './conversations.js';
import { createMemoryRepository } from './memory.js';
import { createOperationsRepository } from './operations.js';

export function createRepositories(db, now = () => Date.now()) {
  return Object.freeze({
    tasks: createTasksRepository(db, now),
    features: createFeatureRepository(db),
    workspace: createWorkspaceRepository(db, now),
    agentSettings: createAgentSettingsRepository(db),
    turns: createTurnsRepository(db, now),
    configuration: createConfigurationRepository(db),
    secrets: createSecretsRepository(db),
    conversations: createConversationsRepository(db, now),
    memory: createMemoryRepository(db, now),
    scopedMemory: createScopedMemoryRepository(db, now),
    operations: createOperationsRepository(db, now),
  });
}
