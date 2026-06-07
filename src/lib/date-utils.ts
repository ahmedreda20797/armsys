// src/lib/date-utils.ts
// Shared date utility functions used across multiple pages

/**
 * Parse DD/MM/YYYY date string and calculate days remaining from today.
 */
export function getDaysRemaining(dateStr: string): number {
  try {
    const parts = dateStr.split('/');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const target = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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
    case 'permission': return 'bg-violet-500/15 text-violet-400 border-violet-500/20';
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
