import { AgentError } from '../../shared/errors.js';

/** Decimal strings stay exact until presentation; never round balances through Number. */
export function decimal(value, { empty = false, signed = false } = {}) {
  if (value == null || value === '') {
    if (empty) return '';
    throw new AgentError('invalid_response', 'The market provider omitted a numeric value.');
  }
  if (typeof value !== 'string' || value.length > 512)
    throw new AgentError('invalid_response', 'The market provider returned an invalid decimal.');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(value.trim());
  if (!match || (!signed && match[1] === '-'))
    throw new AgentError('invalid_response', 'The market provider returned an invalid decimal.');
  const exponent = Number(match[4] || 0),
    fraction = match[3] || '';
  if (Math.abs(exponent) > 256)
    throw new AgentError(
      'invalid_response',
      'The market provider returned an out-of-range decimal.',
    );
  let digits = match[2] + fraction,
    scale = fraction.length - exponent;
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  digits = digits.padStart(scale + 1, '0');
  const whole = (scale ? digits.slice(0, -scale) : digits).replace(/^0+(?=\d)/, '');
  const tail = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  const result = whole + (tail ? `.${tail}` : '');
  return match[1] === '-' && result !== '0' ? `-${result}` : result;
}

function units(value) {
  const normalized = decimal(value, { signed: true });
  const [whole, fraction = ''] = normalized.split('.');
  return { value: BigInt(whole + fraction), scale: fraction.length };
}

export function compareDecimal(a, b) {
  const left = units(a || '0'),
    right = units(b || '0');
  const scale = Math.max(left.scale, right.scale);
  const x = left.value * 10n ** BigInt(scale - left.scale),
    y = right.value * 10n ** BigInt(scale - right.scale);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function sumFixed(values, places = 4) {
  const parsed = values.filter(Boolean).map(units);
  const scale = Math.max(places, ...parsed.map((v) => v.scale));
  const total = parsed.reduce((sum, v) => sum + v.value * 10n ** BigInt(scale - v.scale), 0n);
  const divisor = 10n ** BigInt(scale - places);
  const rounded = (total + divisor / 2n) / divisor;
  const digits = rounded.toString().padStart(places + 1, '0');
  return places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
}

/** STON.fi display prices use ten significant digits, matching the reference. */
export function cleanPrice(value) {
  const normalized = decimal(value, { empty: true });
  if (!normalized || normalized === '0') return normalized;
  const [whole, fraction = ''] = normalized.split('.');
  const significant = (whole + fraction).replace(/^0+/, '');
  if (significant.length <= 10) return normalized;
  const omitted = significant.length - 10;
  const rounded = (BigInt(significant) + 5n * 10n ** BigInt(omitted - 1)) / 10n ** BigInt(omitted);
  return decimal(`${rounded}e${omitted - fraction.length}`);
}

export function ratioPercent(numerator, denominator) {
  const n = decimal(numerator || '0'),
    d = decimal(denominator || '0');
  if (d === '0') return '0';
  const left = units(n),
    right = units(d);
  const divisor = right.value * 10n ** BigInt(left.scale);
  const scaled = (left.value * 10n ** BigInt(right.scale) * 1000n + divisor / 2n) / divisor;
  return `${scaled / 10n}.${scaled % 10n}`;
}
