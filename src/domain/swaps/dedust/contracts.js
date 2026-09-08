import { Cell } from '@ton/core';
import { AgentError } from '../../../shared/errors.js';

// Official TON ABI registry, data/dedust/info.toml. CPMM hashes identify the
// two deployed library-reference revisions; unknown upgrades fail closed.
export const DEDUST_FACTORY = 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67';
export const DEDUST_CODE = Object.freeze({
  factory: ['e64d0059486e3cbe14bd70572295d06d79e847cb4017eac1aa65d82009eaa20c'],
  vaultPool: ['1275095b6da3911292406f4f4386f9e780099b854c6dee9ee2895ddce70927c1'],
  nativeVault: ['875fac5e08e5062f0f7c5c9f4c989607108e35a9ad88dc563e3e4fc7a3d3e75c'],
  jettonVault: ['a30f0486b813dfe55f549fa986272349a96335e1e44e7276d4878c870083306f'],
  cpmm: [
    '5851780d2386e989b9ab956da7cec5c69a667b9e525f628dcba5eb02c1ee0367',
    '3997a5c1ee8923e93cf3a6a98ea3ef9482c64dd8aea2ba8365689e14d99c760d',
  ],
});
/** @param {string} message
 * @returns {never} */
export function rejectDedust(message) {
  throw new AgentError('unsupported_dedust_route', message, { effectNotStarted: true });
}
export function codeHash(state) {
  if (state?.state !== 'active') rejectDedust('The DeDust contract is not active.');
  try {
    return Cell.fromBase64(state.code).hash().toString('hex');
  } catch {
    return rejectDedust('The DeDust contract code could not be verified.');
  }
}
export function verifyCode(state, kind) {
  const hash = codeHash(state);
  if (!DEDUST_CODE[kind].includes(hash))
    rejectDedust('This DeDust contract revision is not supported.');
  return hash;
}
