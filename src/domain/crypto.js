// Browser-safe implementation of the small @ton/crypto surface used by TON cells.
import { Buffer } from 'buffer';
import { sha256Bytes } from '../shared/hash.js';
import { ed25519 } from '@noble/curves/ed25519';

export const sha256_sync = (bytes) => sha256Bytes(bytes);
export const sign = (bytes, secretKey) =>
  Buffer.from(ed25519.sign(bytes, secretKey.subarray(0, 32)));
export const signVerify = (bytes, signature, publicKey) =>
  ed25519.verify(signature, bytes, publicKey, { zip215: false });
export const publicKeyFromSeed = (seed) => Buffer.from(ed25519.getPublicKey(seed));
