import { createHash } from 'node:crypto';

/**
 * JSON.stringify is not a stable security primitive: object insertion order
 * can differ across writers.  Manifests and audit-adjacent file lists use this
 * deliberately narrow canonical JSON representation before hashing.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not permit non-finite numbers.');
      return JSON.stringify(value);
    case 'bigint':
    case 'undefined':
    case 'function':
    case 'symbol':
      throw new TypeError(`Canonical JSON does not permit ${typeof value} values.`);
    case 'object':
      break;
    default:
      throw new TypeError('Canonical JSON received an unsupported value.');
  }
  if (ancestors.has(value)) throw new TypeError('Canonical JSON does not permit cycles.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry, ancestors)).join(',')}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError('Canonical JSON only permits plain objects.');
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
