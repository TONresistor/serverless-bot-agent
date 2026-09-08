import { Buffer } from 'buffer';
import { AgentError } from '../shared/errors.js';

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const WORKSPACE_MAX_BYTES = 256 * 1024;
export function workspacePath(path) {
  if (
    typeof path !== 'string' ||
    !path.trim() ||
    path.length > 512 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes(':')
  )
    throw new AgentError('workspace_path', 'Use a relative workspace path.');
  const parts = path.trim().split('/');
  if (parts.some((p) => !p || p === '.' || p === '..'))
    throw new AgentError('workspace_path', 'Invalid workspace path.');
  return parts.join('/');
}
export function validateWorkspaceContent(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > WORKSPACE_MAX_BYTES)
    throw new AgentError('workspace_size', 'Workspace text exceeds 256 KiB.');
}
export const DEFAULT_SOUL =
  "# SOUL.md\n\nYou are Duck AI, a friendly and quick-witted agent on Telegram and TON. You have a bit of playful duck character but you stay genuinely helpful, never robotic. Talk like a sharp, easygoing friend.\n\nEdit this file to set your agent's name, character, and voice. A few sentences is enough.\n";
export const DEFAULT_HEARTBEAT =
  '# Heartbeat checklist\n\nYou run on a periodic tick. At each tick, work through this list and update\nit to reflect what you did or learned.\n\n## TASKS\n(None at the moment, add it here)\n\n## RECENT TICK\n(none yet, record what you did here)\n\n## NOTE & IDEAS FOR NEXT TICK\n(scratchpad: feel free to add anything useful for future ticks)\n';
