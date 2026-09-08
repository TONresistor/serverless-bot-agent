import { AgentError } from '../shared/errors.js';

export const DEFAULT_SETTINGS = Object.freeze({
  maxModelCalls: 12,
  maxToolCalls: 32,
  maxDurationMs: 120000,
  finalizationReserveMs: 15000,
  maxOutputTokens: 2048,
  activeContextTokens: 32768,
  compactionThreshold: 0.75,
  summaryMaxTokens: 1024,
  modelRecoveryAttempts: 1,
  textContinuationAttempts: 1,
  maxParallelReads: 1,
  searchDefaultLimit: 5,
  searchMaxLimit: 10,
  catalogListingMaxTokens: 1000,
  toolResultMaxBytes: 8192,
  discoveryMode: 'search',
  noProgressLimit: 3,
});
const bounds = {
  maxModelCalls: [2, 100],
  maxToolCalls: [1, 256],
  maxDurationMs: [5000, 600000],
  finalizationReserveMs: [0, 60000],
  maxOutputTokens: [128, 32768],
  activeContextTokens: [4096, 262144],
  compactionThreshold: [0.25, 0.95],
  summaryMaxTokens: [128, 4096],
  modelRecoveryAttempts: [0, 3],
  textContinuationAttempts: [0, 3],
  maxParallelReads: [1, 8],
  searchDefaultLimit: [1, 20],
  searchMaxLimit: [1, 50],
  catalogListingMaxTokens: [100, 4000],
  toolResultMaxBytes: [1024, 32768],
  noProgressLimit: [2, 10],
};
const invalid = () => {
  throw new AgentError(
    'invalid_settings',
    'Invalid agent settings. Check field names, ranges and related limits.',
  );
};
function patch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  for (const [key, v] of Object.entries(value)) {
    if (key === 'discoveryMode') {
      if (!['search', 'direct'].includes(v)) invalid();
      continue;
    }
    if (!Object.hasOwn(bounds, key)) invalid();
    const [min, max] = bounds[key];
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (key !== 'compactionThreshold' && !Number.isInteger(v))
    )
      invalid();
  }
  return value;
}
function validate(settings) {
  if (
    settings.finalizationReserveMs >= settings.maxDurationMs ||
    settings.searchDefaultLimit > settings.searchMaxLimit ||
    settings.maxOutputTokens + settings.summaryMaxTokens >= settings.activeContextTokens
  )
    invalid();
  return settings;
}
export function resolveSettings(document = {}, surface = 'dm', profile = null) {
  const settings = validate({
    ...DEFAULT_SETTINGS,
    ...(surface === 'heartbeat' ? { maxDurationMs: 300000 } : {}),
    ...patch(document.defaults || {}),
    ...patch(document.overrides?.[surface] || {}),
  });
  const effective = { ...settings };
  profile ||= { contextWindowTokens: 32768, maxOutputTokens: 2048 };
  if (profile) {
    effective.activeContextTokens = Math.min(
      effective.activeContextTokens,
      profile.contextWindowTokens,
    );
    effective.maxOutputTokens = Math.min(effective.maxOutputTokens, profile.maxOutputTokens);
  }
  validate(effective);
  return Object.freeze(effective);
}
function mergeSettings(base, changes) {
  if (changes === null) return {};
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) invalid();
  const merged = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) invalid();
    if (value === null) delete merged[key];
    else {
      patch({ [key]: value });
      merged[key] = value;
    }
  }
  return merged;
}
export function updateSettingsDocument(previous, input) {
  if (
    !input ||
    Object.keys(input).some((k) => !['expectedRevision', 'defaults', 'overrides'].includes(k))
  )
    invalid();
  if (
    input.overrides &&
    (typeof input.overrides !== 'object' ||
      Array.isArray(input.overrides) ||
      Object.keys(input.overrides).some(
        (k) => !['dm', 'group', 'guest', 'business', 'task', 'heartbeat'].includes(k),
      ))
  )
    invalid();
  const next = {
    revision: (previous?.revision || 0) + 1,
    defaults: mergeSettings(
      previous?.defaults || {},
      input.defaults === undefined ? {} : input.defaults,
    ),
    overrides: Object.fromEntries(
      ['dm', 'group', 'guest', 'business', 'task', 'heartbeat'].map((surface) => [
        surface,
        mergeSettings(
          previous?.overrides?.[surface] || {},
          input.overrides?.[surface] === undefined ? {} : input.overrides[surface],
        ),
      ]),
    ),
  };
  for (const surface of ['dm', 'group', 'guest', 'business', 'task', 'heartbeat'])
    resolveSettings(next, surface);
  return next;
}
