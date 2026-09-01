// ══════════════════════════════════════════════════════════════
//  Arabic month labels — pure, isomorphic display helper (Phase 6.2)
//
//  Used by server-side AI messages (spec §68: an empty period must
//  be NAMED — "لا توجد بيانات مسجلة في سبتمبر 2026.") and by client
//  period chips. Display ONLY — never a calculation, never stored.
// ══════════════════════════════════════════════════════════════

export const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
] as const;

/** '2026-09' → 'سبتمبر 2026' (falls back to the raw key when malformed). */
export function formatMonthLabelAr(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return monthKey;
  return `${MONTHS_AR[monthIndex]} ${match[1]}`;
}
