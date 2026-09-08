import { canonicalJSON } from '../shared/canonical.js';
import { digest } from '../shared/hash.js';

/** Read repetition is allowed until outcomes show no progress; writes invalidate read streaks. */
export function createProgressGuard(limit) {
  const streaks = new Map(),
    completedWrites = new Set();
  let revision = 0;
  return {
    before(call) {
      return (
        completedWrites.has(call.signature) ||
        (streaks.get(`${revision}:${call.signature}`)?.count || 0) >= limit
      );
    },
    after(call, result) {
      if (call.effect === 'external_write' && !result.error) completedWrites.add(call.signature);
      if (call.effect !== 'read' && !result.error) {
        revision++;
        streaks.clear();
        return;
      }
      const key = `${revision}:${call.signature}`;
      const hash = digest(canonicalJSON(result));
      const prior = streaks.get(key);
      streaks.set(key, { hash, count: prior?.hash === hash ? prior.count + 1 : 1 });
    },
  };
}
