// ══════════════════════════════════════════════════════════════
//  §SETTINGS-SECTIONS — Settings Center section-state helpers.
//
//  Pure model helpers for the Settings Center's internal section
//  navigation (the section registries themselves live with the
//  Settings Center component — ONE settings architecture). These are
//  deliberately dependency-free so the fail-safe rules are unit-
//  testable without mounting React.
// ══════════════════════════════════════════════════════════════

/**
 * Resolve the active Settings section from a navigation-carried
 * candidate (navParams.section). The candidate may be absent, stale
 * (reload adoption of an old entry), or refer to a section the user
 * may no longer access — every non-allowed value fails safe to the
 * fallback section (§SETTINGS-TASK §16: permissions never widen).
 */
export function sanitizeSettingsSection<T extends string>(
  candidate: string | null | undefined,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  return candidate !== null && candidate !== undefined && allowed.has(candidate as T)
    ? (candidate as T)
    : fallback;
}
