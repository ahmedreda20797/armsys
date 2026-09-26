// src/lib/date-utils.ts
// Shared date utility functions used across multiple pages

/**
 * Parse DD/MM/YYYY date string and calculate days remaining from today.
 *
 * §DEAL-DATES DST SAFETY — both dates are anchored to LOCAL NOON before
 * diffing (and rounded, not ceiled): a midnight-anchored millisecond
 * difference is 35d+1h across a fall-back DST boundary, so `Math.ceil`
 * produced a phantom extra day and every travel threshold (قريب/عاجل)
 * drifted for a whole DST season. Noon-anchoring absorbs the 1h clock
 * shift into the rounding — deltas stay exact calendar-day deltas.
 */
export function getDaysRemaining(dateStr: string): number {
  try {
    const parts = dateStr.split('/');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (!day || Number.isNaN(month) || !year) return 0;
    const target = new Date(year, month, day, 12, 0, 0, 0);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Check if a date is urgent (within 3 days from now).
 */
export function isUrgent(dateStr: string): boolean {
  const days = getDaysRemaining(dateStr);
  return days >= 0 && days < 3;
}

/**
 * Get Arabic label for a request type.
 */
export function getRequestTypeLabel(type: string): string {
  switch (type) {
    case 'leave': return 'إجازة';
    case 'permission': return 'استئذان';
    case 'excuse': return 'غياب';
    case 'tardiness': return 'تأخير';
    case 'remote': return 'ريموتلي';
    default: return type;
  }
}

/**
 * Get color class string for a request type badge.
 */
export function getRequestTypeColor(type: string): string {
  switch (type) {
    case 'leave': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20';
    case 'permission': return 'bg-brand-500/15 text-brand-400 border-brand-500/20';
    case 'excuse': return 'bg-rose-500/15 text-rose-400 border-rose-500/20';
    case 'tardiness': return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
    case 'remote': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/20';
  }
}

/**
 * Generate a list of month strings for filters.
 * Returns YYYY-MM format (e.g., "2025-01") or MM/YYYY format.
 */
export function generateMonthOptions(format: 'YYYY-MM' | 'MM/YYYY' = 'YYYY-MM'): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    if (format === 'YYYY-MM') {
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    } else {
      months.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    }
  }
  return months;
}

// ══════════════════════════════════════════════════════════════
//  Today helpers — Milestone 7 §5 (DEFAULT DATE = TODAY doctrine)
//
//  One shared pair replaces the per-page implementations (HrDeductions
//  getTodayDate / FollowUps getTodayStr): every creation form defaults
//  its date field to TODAY while the user keeps full manual override
//  for historical/delayed registration.
// ══════════════════════════════════════════════════════════════

/** Today as an ISO day key "YYYY-MM-DD" (input[type=date] value format). */
export function todayDayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Today in the app's display format "DD/MM/YYYY" (manual date inputs). */
export function todayDisplayDate(now: Date = new Date()): string {
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

/**
 * Strict validator for the app's display date contract "DD/MM/YYYY" —
 * a real calendar date (no 31/02, no garbage parts). Used by every
 * server write-path that accepts a display date from a client
 * (fail-closed: anything else is rejected).
 */
export function isValidDisplayDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/** Current calendar month as a period key "YYYY-MM" (period filters). */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Add N days to an ISO day key "YYYY-MM-DD" (input[type=date] format).
 * Shared by every follow-up form (page dialog + inline quick action) so
 * the "next follow-up" default (+7 days) has ONE implementation.
 * Returns "" for empty/invalid input — safe to feed straight into state.
 */
export function addDays(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
