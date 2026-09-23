import { createHash } from 'node:crypto';

/**
 * Serializes the small JSON values used by request/response receipts with a
 * stable object-key order. Arrays keep their order because array order is
 * meaningful unless the caller explicitly normalizes it first.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers.');
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError('Canonical JSON does not support undefined values.');
    case 'object':
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
        .join(',')}}`;
    default:
      throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
  }
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
