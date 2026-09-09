'use client';

// ══════════════════════════════════════════════════════════════
//  PeriodComparisonDialog — the ONE universal comparison feature (§17)
//
//  Reusable overlay opened from any suitable context (⋮ next to an
//  employee row in KPI reports, employee panel, …). The consumer
//  supplies WHO (employeeId) and the anchor month; the dialog lets
//  the user pick Period A / Period B and reads BOTH periods through
//  the EXISTING /api/kpi-reports/employee service — permissions,
//  scope and value-basis labeling are enforced by that service, no
//  comparison-specific data path exists.
//
//  Pure comparison math lives in buildComponentComparison (exported
//  for unit tests): rows per KPI component + totals, with a signed
//  delta and a ↑/↓/→ trend direction.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiFetch } from '@/lib/query-provider';
import { buildMonthOptions, formatMonth, formatScore } from '@/components/pages/quality-kpi/kpi-reports-shared';
import { useMonthSnapshots } from '@/hooks/use-kpi-queries';
import { cn } from '@/lib/utils';

/** Minimal structural view of the employee KPI report payload. */
interface ComparisonReportPayload {
  outcomeStatus?: string;
  message?: string | null;
  employee?: { name?: string };
  components?: Array<{
    componentId: string;
    name: string;
    rawScore: number | null;
    weight: number;
    weightedContribution: number | null;
  }>;
  availableWeight?: number | null;
  weightedTotal?: number | null;
  overallStatus?: string | null;
}

export interface ComparisonRow {
  key: string;
  label: string;
  /** 'percent' rows show scores; 'points' rows show contributions. */
  kind: 'percent' | 'points' | 'status';
  a: number | string | null;
  b: number | string | null;
  delta: number | null;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Pure comparison builder — one row per component (matched by
 * componentId, union of both periods) plus the totals row. Missing
 * values never fabricate a delta (null delta, flat arrow).
 */
export function buildComponentComparison(
  a: ComparisonReportPayload | null | undefined,
  b: ComparisonReportPayload | null | undefined,
): ComparisonRow[] {
  const componentOf = (p: ComparisonReportPayload | null | undefined) =>
    new Map((p?.components ?? []).map((c) => [c.componentId, c]));

  const mapA = componentOf(a);
  const mapB = componentOf(b);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const c of [...(a?.components ?? []), ...(b?.components ?? [])]) {
    if (!seen.has(c.componentId)) { seen.add(c.componentId); ids.push(c.componentId); }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const deltaOf = (va: number | null | undefined, vb: number | null | undefined): number | null => {
    if (va === null || va === undefined || vb === null || vb === undefined) return null;
    return round(va - vb);
  };
  const dirOf = (d: number | null): 'up' | 'down' | 'flat' =>
    d === null ? 'flat' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat';

  const rows: ComparisonRow[] = ids.map((id) => {
    const ca = mapA.get(id);
    const cb = mapB.get(id);
    const label = ca?.name ?? cb?.name ?? id;
    const rawDelta = deltaOf(ca?.rawScore, cb?.rawScore);
    return {
      key: id,
      label,
      kind: 'percent' as const,
      a: ca?.rawScore ?? null,
      b: cb?.rawScore ?? null,
      delta: rawDelta,
      direction: dirOf(rawDelta),
    };
  });

  const totalDelta = deltaOf(a?.weightedTotal, b?.weightedTotal);
  rows.push({
    key: '__weightedTotal__',
    label: 'الإجمالي الموزون',
    kind: 'points',
    a: a?.weightedTotal ?? null,
    b: b?.weightedTotal ?? null,
    delta: totalDelta,
    direction: dirOf(totalDelta),
  });

  return rows;
}

// ─────────────────────────────────────────────────────────────

function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function DeltaMark({ delta, direction }: { delta: number | null; direction: 'up' | 'down' | 'flat' }) {
  if (delta === null) return <span className="text-slate-600 text-[11px]">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums',
        direction === 'up' && 'text-red-400',
        direction === 'down' && 'text-emerald-400',
        direction === 'flat' && 'text-slate-500',
      )}
    >
      {direction === 'up' && <ArrowUpRight className="size-3" />}
      {direction === 'down' && <ArrowDownRight className="size-3" />}
      {direction === 'flat' && <ArrowRight className="size-3" />}
      {delta > 0 ? `+${delta}` : `${delta}`}
    </span>
  );
}

export interface PeriodComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string | null;
  employeeName?: string;
  /** The report's anchor month — defaults Period A. */
  defaultMonth: string;
}

export function PeriodComparisonDialog({
  open, onOpenChange, employeeId, employeeName, defaultMonth,
}: PeriodComparisonDialogProps) {
  const [monthA, setMonthA] = useState<string>(defaultMonth);
  const [monthB, setMonthB] = useState<string>(previousMonthKey(defaultMonth));

  // Reset periods when a different employee/month opens the dialog.
  const [lastKey, setLastKey] = useState('');
  const openKey = `${employeeId ?? ''}:${defaultMonth}`;
  if (open && lastKey !== openKey) {
    setLastKey(openKey);
    setMonthA(defaultMonth);
    setMonthB(previousMonthKey(defaultMonth));
  }

  const snapshotsQuery = useMonthSnapshots();
  const monthOptions = useMemo(
    () => buildMonthOptions(snapshotsQuery.data as Array<{ monthKey: string; status: 'open' | 'closed' }> | undefined),
    [snapshotsQuery.data],
  );

  const enabled = open && !!employeeId && !!monthA && !!monthB;
  const queryA = useQuery({
    queryKey: ['comparison', employeeId, monthA],
    queryFn: () => apiFetch<ComparisonReportPayload>(`/api/kpi-reports/employee?employeeId=${employeeId}&month=${monthA}`),
    enabled,
    staleTime: 15_000,
  });
  const queryB = useQuery({
    queryKey: ['comparison', employeeId, monthB],
    queryFn: () => apiFetch<ComparisonReportPayload>(`/api/kpi-reports/employee?employeeId=${employeeId}&month=${monthB}`),
    enabled,
    staleTime: 15_000,
  });

  const rows = useMemo(
    () => (enabled ? buildComponentComparison(queryA.data, queryB.data) : []),
    [enabled, queryA.data, queryB.data],
  );

  const loading = queryA.isLoading || queryB.isLoading || queryA.isFetching || queryB.isFetching;
  const notAvailable = (payload: ComparisonReportPayload | undefined) =>
    payload && payload.outcomeStatus && payload.outcomeStatus !== 'RESOLVED' && payload.outcomeStatus !== 'FROZEN_RESULT';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-slate-900 border-slate-700/60 max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="text-right shrink-0">
          <DialogTitle className="text-white text-base flex items-center gap-2">
            <ArrowLeftRight className="size-4 text-violet-400" />
            مقارنة الأداء{employeeName ? ` — ${employeeName}` : ''}
          </DialogTitle>
          <DialogDescription className="text-slate-500 text-xs">
            اختر فترتين لمقارنة درجات مكونات الأداء — تُقرأ كلتا الفترتين من خدمة تقارير KPI الحالية.
          </DialogDescription>
        </DialogHeader>

        {/* Period pickers */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-400 font-semibold">الفترة A</p>
            <Select value={monthA} onValueChange={setMonthA}>
              <SelectTrigger className="h-9 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-400 font-semibold">الفترة B</p>
            <Select value={monthB} onValueChange={setMonthB}>
              <SelectTrigger className="h-9 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Comparison body — the only scrollable region */}
        <ScrollArea className="flex-1 min-h-0 mt-3">
          {!enabled || loading ? (
            <div className="flex items-center justify-center py-14 text-slate-400 text-sm gap-2">
              <Loader2 className="size-4 animate-spin" />
              جاري تحميل الفترتين...
            </div>
          ) : notAvailable(queryA.data) || notAvailable(queryB.data) ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-slate-400 text-sm">
                {notAvailable(queryA.data) ? queryA.data?.message : queryB.data?.message}
              </p>
              <p className="text-slate-600 text-xs mt-1">
                لا توجد نتيجة قابلة للمقارنة لإحدى الفترتين.
              </p>
            </div>
          ) : (
            <table className="w-full text-xs" dir="rtl">
              <thead>
                <tr className="text-slate-500 border-b border-slate-700/60">
                  <th className="text-right font-medium py-2">المكوّن</th>
                  <th className="text-center font-medium py-2">{formatMonth(monthA)}</th>
                  <th className="text-center font-medium py-2">{formatMonth(monthB)}</th>
                  <th className="text-center font-medium py-2">الفرق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rows.map((row) => (
                  <tr key={row.key} className={cn(row.key === '__weightedTotal__' && 'bg-slate-800/40')}>
                    <td className="py-2 text-slate-200 font-medium text-right">
                      {row.label}
                      {row.key === '__weightedTotal__' && (
                        <span className="block text-[10px] text-slate-500 font-normal">
                          {queryA.data?.overallStatus ?? '—'} ← {queryB.data?.overallStatus ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-center font-mono text-slate-100">
                      {row.kind === 'points' ? (row.a ?? '—') : formatScore(row.a as number | null)}
                    </td>
                    <td className="py-2 text-center font-mono text-slate-100">
                      {row.kind === 'points' ? (row.b ?? '—') : formatScore(row.b as number | null)}
                    </td>
                    <td className="py-2 text-center"><DeltaMark delta={row.delta} direction={row.direction} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
