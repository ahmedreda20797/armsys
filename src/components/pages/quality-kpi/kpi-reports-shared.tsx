'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports UI — shared helpers, badges & export (Phase 2)
//
//  CLIENT-SAFE ONLY: this file must never import the server-side
//  kpi-reporting barrel (it would pull the Firebase admin layer into
//  the client bundle). Report shapes are imported TYPE-ONLY — types
//  are erased at build time.
// ══════════════════════════════════════════════════════════════

import { authFetch } from '@/lib/api-fetch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { KpiValueBasis } from '@/lib/kpi-reporting';

// ─────────────────────────────────────────────────────────────
//  Month formatting (same convention as MonthClosePage)
// ─────────────────────────────────────────────────────────────

export const MONTH_LABELS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const idx = parseInt(m, 10) - 1;
  if (idx < 0 || idx > 11) return monthKey;
  return `${MONTH_LABELS_AR[idx]} ${y}`;
}

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export interface MonthOption {
  value: string;
  label: string;
  closed: boolean;
}

/**
 * Month dropdown options: the current calendar month plus every
 * month that has a snapshot document (closed or reopened), newest
 * first. Closed months carry a frozen marker (spec §8).
 */
export function buildMonthOptions(
  snapshots: Array<{ monthKey: string; status: 'open' | 'closed' }> | undefined,
): MonthOption[] {
  const current = currentMonthKey();
  const seen = new Map<string, boolean>();
  seen.set(current, seen.get(current) ?? false);
  for (const snap of snapshots ?? []) {
    if (!snap?.monthKey) continue;
    seen.set(snap.monthKey, seen.get(snap.monthKey) ?? snap.status === 'closed');
  }
  return [...seen.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 24)
    .map(([value, closed]) => ({
      value,
      label: `${formatMonth(value)}${closed ? ' 🔒' : ''}`,
      closed,
    }));
}

// ─────────────────────────────────────────────────────────────
//  §12  Status badges — every state visually distinguishable
// ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  FINALIZED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  AVAILABLE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  INCOMPLETE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  PENDING: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  ZERO: 'bg-red-500/15 text-red-300 border-red-500/30',
  NOT_ELIGIBLE: 'bg-slate-600/20 text-slate-400 border-slate-600/40',
  NO_SCHEME: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  AMBIGUOUS: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  OVERRIDE_NOT_RESOLVABLE: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  COMPLETE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const STATUS_LABELS_AR: Record<string, string> = {
  FINALIZED: 'مجمّد',
  AVAILABLE: 'متاح',
  INCOMPLETE: 'غير مكتمل',
  PENDING: 'معلّق',
  ZERO: 'صفر',
  NOT_ELIGIBLE: 'غير مؤهل',
  NO_SCHEME: 'لا يوجد مخطط',
  AMBIGUOUS: 'مخططات متعددة',
  OVERRIDE_NOT_RESOLVABLE: 'تجاوز غير قابل للتطبيق',
  COMPLETE: 'مكتمل',
};

export function StatusBadge({ status, className }: { status: string | null; className?: string }) {
  if (!status) return <span className="text-slate-500">—</span>;
  return (
    <Badge
      variant="outline"
      className={cn('font-mono text-[11px] whitespace-nowrap', STATUS_STYLES[status] ?? 'bg-slate-500/15 text-slate-300 border-slate-500/30', className)}
      title={STATUS_LABELS_AR[status] ?? status}
    >
      {status}
    </Badge>
  );
}

const BASIS_LABELS: Record<KpiValueBasis, string> = {
  MTD: 'MTD — حتى تاريخه',
  LIVE: 'حية (غير نهائية)',
  FINALIZED: 'مجمّدة نهائية',
};

const BASIS_STYLES: Record<KpiValueBasis, string> = {
  MTD: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  LIVE: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  FINALIZED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

export function ValueBasisBadge({ basis }: { basis: KpiValueBasis }) {
  return (
    <Badge variant="outline" className={cn('text-[11px] whitespace-nowrap', BASIS_STYLES[basis])}>
      {BASIS_LABELS[basis]}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────
//  Number formatting
// ─────────────────────────────────────────────────────────────

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}%`;
}

export function formatContribution(value: number | null | undefined, max: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const rounded = Math.round(value * 100) / 100;
  return max === null || max === undefined ? `${rounded}` : `${rounded} / ${max}`;
}

export function formatSignedPoints(value: number): string {
  if (value > 0) return `+${Math.round(value * 100) / 100}`;
  return `${Math.round(value * 100) / 100}`;
}

// ─────────────────────────────────────────────────────────────
//  §22  Excel export — SAME verified numbers as on screen
// ─────────────────────────────────────────────────────────────

/**
 * Download one of the registered KPI reports as Excel through the
 * unified /api/reports/run endpoint (definition-driven workbook).
 * The server re-applies permission + authorized scope — the client
 * can never widen the data.
 */
export async function downloadKpiReportExcel(
  reportId: 'kpi-monthly' | 'kpi-mtd' | 'kpi-historical',
  body: Record<string, unknown>,
  fileName: string,
): Promise<void> {
  const res = await authFetch('/api/reports/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportId, format: 'excel', ...body }),
  });
  if (!res.ok) {
    let message = 'فشل تصدير التقرير';
    try {
      const parsed = await res.json();
      message = parsed?.error?.message ?? message;
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
