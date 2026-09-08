import { URL } from 'whatwg-url';
import { AgentError } from './errors.js';

/** WHATWG parsing also normalizes numeric, escaped and IPv6 host spellings. */
export function publicWebURL(input) {
  const invalid = () => {
    throw new AgentError(
      'invalid_web_url',
      'Use a public HTTP or HTTPS URL without embedded credentials.',
    );
  };
  if (
    typeof input !== 'string' ||
    input.length > 4096 ||
    [...input.trim()].some(
      (ch) => ch.charCodeAt(0) <= 32 || ch.charCodeAt(0) === 127 || ch === '\\',
    )
  )
    invalid();
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    invalid();
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    invalid();
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'metadata' ||
    host === 'metadata.aws' ||
    (!host.includes('.') && !host.startsWith('[')) ||
    /(?:^|\.)(?:localhost|local|internal|localdomain|home|lan|invalid|test)$/.test(host)
  )
    invalid();
  if (/^[\d.]+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
      invalid();
  }
  if (host.startsWith('[')) {
    // Public IPv6 unicast only; excludes local, mapped IPv4 and transition ranges.
    const first = parseInt(host.slice(1).split(':')[0], 16);
    if (
      !Number.isInteger(first) ||
      first < 0x2000 ||
      first > 0x3fff ||
      host.startsWith('[2002:') ||
      host.startsWith('[2001:0:')
    )
      invalid();
  }
  url.hash = '';
  return url.href;
}
