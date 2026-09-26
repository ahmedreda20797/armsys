// ══════════════════════════════════════════════════════════════
//  Permissions Signature — pure, deterministic, dependency-free.
//
//  Used by the cache identity gate (cache-identity.tsx) to detect
//  effective-authorization changes (§34): role preset → position
//  template → per-user overrides resolve to one permissions object;
//  a change in its SHAPE (not reference) must invalidate the data
//  cache. Deterministic across rebuilds: object keys are sorted, so
//  the same authorization context always yields the same signature
//  regardless of object construction order.
// ══════════════════════════════════════════════════════════════

/** Deterministic signature of an effective-permissions object. */
export function permissionsSignature(permissions: unknown): string {
  if (permissions === null || permissions === undefined) return 'null';
  if (typeof permissions !== 'object') return String(permissions);
  return stableStringify(permissions as Record<string, unknown>);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
