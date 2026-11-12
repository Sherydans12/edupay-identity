import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256CanonicalJson } from './canonical-json.js';

describe('canonical JSON', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: 'x' }, a: [2, 1] })).toBe(
      '{"a":[2,1],"nested":{"a":"x","b":true},"z":1}',
    );
  });

  it('produces the same hash for equivalent object-key order', () => {
    expect(sha256CanonicalJson({ b: 'two', a: 'one' })).toBe(sha256CanonicalJson({ a: 'one', b: 'two' }));
  });
});
