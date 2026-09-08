import { Buffer } from 'buffer';
import { Dictionary } from '@ton/core';
import { digest } from '../../shared/hash.js';
import { AgentError } from '../../shared/errors.js';

export function snakeBytes(cell, skipPrefix = false, maxBytes = 65536) {
  const chunks = [];
  let size = 0,
    next = cell,
    depth = 0;
  while (next) {
    if (++depth > 1024)
      throw new AgentError('metadata_invalid', 'Metadata cell depth exceeds the limit.');
    const slice = next.beginParse();
    if (skipPrefix) {
      if (slice.loadUint(8) !== 0) throw new Error('Unsupported metadata encoding');
      skipPrefix = false;
    }
    if (slice.remainingBits % 8 || slice.remainingRefs > 1)
      throw new Error('Invalid snake content');
    const bytes = slice.loadBuffer(slice.remainingBits / 8);
    size += bytes.length;
    if (size > maxBytes)
      throw new AgentError('metadata_too_large', 'Metadata exceeds the size limit.');
    chunks.push(bytes);
    next = slice.remainingRefs ? slice.loadRef() : null;
  }
  return Buffer.concat(chunks);
}

/** Decode display fields only; content never becomes trusted agent instructions. */
export function decodeMetadata(content) {
  const result = { name: '', description: '', image: '', uri: '' };
  if (!content) return result;
  let slice = content.beginParse();
  if (slice.remainingBits < 8) {
    if (!slice.remainingRefs) return result;
    content = slice.loadRef();
    slice = content.beginParse();
  }
  const prefix = slice.loadUint(8);
  if (prefix === 1) {
    result.uri = snakeBytes(slice.asCell()).toString('utf8');
  } else if (prefix === 0) {
    const dict = slice.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
    for (const key of ['name', 'description', 'image', 'uri']) {
      const cell = dict.get(BigInt('0x' + digest(key)));
      if (cell) result[key] = snakeBytes(cell, true).toString('utf8');
    }
  } else {
    // Some NFT items expose an unprefixed URI/suffix before collection expansion.
    result.uri = snakeBytes(content).toString('utf8');
  }
  for (const key of ['name', 'description', 'image', 'uri'])
    result[key] = result[key].slice(0, key === 'description' ? 8192 : 4096);
  return result;
}
