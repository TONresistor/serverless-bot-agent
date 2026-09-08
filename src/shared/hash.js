import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha256';

export const sha256Bytes = (bytes) => Buffer.from(sha256(bytes));
export const digest = (text) => sha256Bytes(Buffer.from(text, 'utf8')).toString('hex');
