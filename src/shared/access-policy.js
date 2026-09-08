import { AgentError } from './errors.js';

export const DEFAULT_ACCESS = Object.freeze({
  version: 1,
  dm: { mode: 'off' },
  group: { mode: 'off', groups: [] },
  rate: { per_user_hour: 10 },
  trusted: [],
  tools: {},
});
const all = ['dm', 'group', 'heartbeat'];
export const TOOL_DEFAULTS = {
  ton_tx_history: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_address_info: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_dns_resolve: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_dns_info: { enabled: false, owner: all, trusted: [], anyone: [] },
  ton_token_search: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_price: { enabled: true, owner: all, trusted: [], anyone: [] },
  jetton_info: { enabled: true, owner: all, trusted: [], anyone: [] },
  jetton_balance: { enabled: true, owner: all, trusted: [], anyone: [] },
  jetton_price: { enabled: true, owner: all, trusted: [], anyone: [] },
  jetton_portfolio: { enabled: false, owner: all, trusted: [], anyone: [] },
  nft_info: { enabled: false, owner: all, trusted: [], anyone: [] },
  nft_collection_info: { enabled: false, owner: all, trusted: [], anyone: [] },
  uranus_token_search: { enabled: false, owner: all, trusted: [], anyone: [] },
  uranus_my_tokens: { enabled: false, owner: all, trusted: [], anyone: [] },
  uranus_info: { enabled: false, owner: all, trusted: [], anyone: [] },
  token_market: { enabled: false, owner: all, trusted: [], anyone: [] },
  save_media: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_swap_quote: { enabled: false, owner: all, trusted: [], anyone: [] },
  jetton_send: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },
  nft_send: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },
  ton_swap: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },
  uranus_buy: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },
  uranus_sell: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },
  uranus_deploy: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },
  uranus_claim_fees: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },

  web_search: { enabled: true, owner: all, trusted: [], anyone: all },
  web_fetch: { enabled: true, owner: all, trusted: [], anyone: all },
  memory_set: { enabled: true, owner: all, trusted: [], anyone: [] },
  memory_get: { enabled: true, owner: all, trusted: [], anyone: all },
  memory_search: { enabled: true, owner: all, trusted: [], anyone: all },
  workspace_list: { enabled: true, owner: all, trusted: [], anyone: all },
  workspace_read: { enabled: true, owner: all, trusted: [], anyone: all },
  workspace_write: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_get_address: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_get_balance: { enabled: true, owner: all, trusted: [], anyone: [] },
  ton_send: { enabled: false, owner: ['dm'], trusted: [], anyone: [] },
  telegram_send_message: { enabled: true, owner: all, trusted: [], anyone: ['group'] },
  telegram_admin: { enabled: false, owner: ['dm', 'group'], trusted: [], anyone: [] },
  telegram_chat_automation: { enabled: false, owner: ['dm', 'group'], trusted: [], anyone: [] },
  telegram_gifts: { enabled: false, owner: ['dm', 'group'], trusted: [], anyone: [] },
  request_star_payment: { enabled: false, owner: ['dm', 'group'], trusted: [], anyone: [] },
};
export const COMPAT_ACCESS = {
  ...DEFAULT_ACCESS,
  group: { mode: 'all', groups: [] },
  tools: Object.fromEntries(
    [
      'ton_send',
      'telegram_admin',
      'telegram_chat_automation',
      'telegram_gifts',
      'request_star_payment',
    ].map((name) => [name, { enabled: true }]),
  ),
};
export function allowsConversation(policy, incoming, owner) {
  if (owner || incoming.surface === 'guest' || incoming.surface === 'business') return true;
  const group = ['group', 'supergroup'].includes(incoming.chat?.type);
  if (group && policy.group.groups.length && !policy.group.groups.includes(incoming.chat.id))
    return false;
  const mode = group ? policy.group.mode : policy.dm.mode;
  return mode === 'all' || (mode === 'allowlist' && policy.trusted.includes(incoming.actor?.id));
}
export function allowsTool(policy, name, scope) {
  const defaults = TOOL_DEFAULTS[name] || { enabled: false, owner: [], trusted: [], anyone: [] };
  const grant = { ...defaults, ...(policy.tools[name] || {}) };
  if (!grant.enabled) return false;
  const surface =
    scope.surface === 'heartbeat'
      ? 'heartbeat'
      : scope.group || scope.surface === 'guest'
        ? 'group'
        : 'dm';
  const account = [
    'ton_send',
    'jetton_send',
    'nft_send',
    'ton_swap',
    'uranus_buy',
    'uranus_sell',
    'uranus_deploy',
    'uranus_claim_fees',
    'telegram_chat_automation',
    'telegram_gifts',
    'request_star_payment',
  ].includes(name);
  if (
    account &&
    (!scope.owner || scope.group || ['guest', 'business', 'heartbeat'].includes(scope.surface))
  )
    return false;
  const rights = scope.owner
    ? grant.owner
    : [...grant.anyone, ...(policy.trusted.includes(scope.actorId) ? grant.trusted : [])];
  return rights.includes(surface);
}
export function validateAccess(value) {
  const invalid = () => {
    throw new AgentError('invalid_policy', 'Invalid access policy.');
  };
  if (
    !value ||
    value.version !== 1 ||
    Object.keys(value).some(
      (k) => !['version', 'dm', 'group', 'rate', 'trusted', 'tools'].includes(k),
    )
  )
    invalid();
  for (const surface of ['dm', 'group'])
    if (
      !value[surface] ||
      !['off', 'allowlist', 'all'].includes(value[surface].mode) ||
      Object.keys(value[surface]).some(
        (k) => !['mode', ...(surface === 'group' ? ['groups'] : [])].includes(k),
      )
    )
      invalid();
  if (
    !Array.isArray(value.group.groups) ||
    value.group.groups.some((n) => !Number.isSafeInteger(n) || n >= 0)
  )
    invalid();
  if (
    !Array.isArray(value.trusted) ||
    value.trusted.some((n) => !Number.isSafeInteger(n) || n <= 0)
  )
    invalid();
  if (
    !value.rate ||
    Object.keys(value.rate).some((k) => k !== 'per_user_hour') ||
    !Number.isInteger(value.rate.per_user_hour) ||
    value.rate.per_user_hour < 0 ||
    value.rate.per_user_hour > 1000
  )
    invalid();
  if (!value.tools || typeof value.tools !== 'object' || Array.isArray(value.tools)) invalid();
  for (const [name, override] of Object.entries(value.tools)) {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(name) ||
      !override ||
      typeof override !== 'object' ||
      Array.isArray(override) ||
      Object.keys(override).some((k) => !['enabled', 'owner', 'trusted', 'anyone'].includes(k))
    )
      invalid();
    if (override.enabled !== undefined && typeof override.enabled !== 'boolean') invalid();
    for (const role of ['owner', 'trusted', 'anyone'])
      if (
        override[role] !== undefined &&
        (!Array.isArray(override[role]) || override[role].some((s) => !all.includes(s)))
      )
        invalid();
  }
  return JSON.parse(JSON.stringify(value));
}
