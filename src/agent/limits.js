import { DEFAULT_SETTINGS } from './settings.js';

// Compatibility exports; the runtime uses a per-turn settings snapshot.
export const MAX_ITERATIONS = DEFAULT_SETTINGS.maxModelCalls;
export const MAX_CONTEXT_BYTES = DEFAULT_SETTINGS.activeContextTokens * 8;
export const MAX_TOOL_BYTES = DEFAULT_SETTINGS.toolResultMaxBytes;
