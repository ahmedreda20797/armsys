'use client';

// ══════════════════════════════════════════════════════════════
//  ComparisonReport — §18 dedicated comparison mode
//
//  Entities of ANY mix (employee ↔ employee, employee ↔ team, team ↔
//  department, department ↔ department) over the canonical
//  dimensions. Only dimensions with valid canonical data render —
//  missing data is '—', never a fabricated 0.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KpiInsightsReport } from '@/lib/kpi-reporting';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber } from '@/lib/i18n/format';
import { StatusBadge, formatScore } from '../kpi-reports-shared';
import { pick } from './insights-labels';
import {
  buildComparisonGrid,
  comparableEntities,
  type ComparisonEntity,
  type ComparisonEntityKind,
} from './comparison';
import { QualityDeltaChip } from './PerformanceOverview';

const KIND_LABELS: Record<ComparisonEntityKind, [string, string]> = {
  employee: ['موظف', 'Employee'],
  team: ['فريق', 'Team'],
  department: ['قسم', 'Department'],
};

const KIND_STYLES: Record<ComparisonEntityKind, string> = {
  employee: 'border-slate-600/50 bg-slate-700/30 text-slate-200',
  team: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  department: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
};

export function ComparisonReport({
  report,
  initialEntityIds,
}: {
  report: KpiInsightsReport;
  /** Entities pre-selected from the current scope (employee ids / unit labels). */
  initialEntityIds?: ReadonlyArray<string>;
}) {
  const { locale } = useLanguage();
  const all = useMemo(() => comparableEntities(report), [report]);

  const [selected, setSelected] = useState<ComparisonEntity[]>(() => {
    if (!initialEntityIds || initialEntityIds.length === 0) return all.slice(0, 2);
    const byId = new Map(all.map((e) => [e.id, e]));
    const picked = initialEntityIds
      .map((id) => byId.get(id))
      .filter((e): e is ComparisonEntity => !!e);
    return picked.length >= 2 ? picked.slice(0, 5) : all.slice(0, 2);
  });

  const selectedIds = new Set(selected.map((e) => e.id));
  const available = all.filter((e) => !selectedIds.has(e.id));
  const grid = useMemo(
    () => (selected.length >= 2 ? buildComparisonGrid(report, selected) : []),
    [report, selected],
  );

  return (
    <div className="space-y-3">
      {/* Selected entity columns */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((entity) => (
          <span
            key={`${entity.kind}:${entity.id}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
              KIND_STYLES[entity.kind],
            )}
          >
            <span className="opacity-70">{pick(locale, KIND_LABELS[entity.kind])}</span>
            <span className="font-medium">{entity.label}</span>
            <button
              type="button"
              aria-label={locale === 'en' ? 'Remove' : 'إزالة'}
              onClick={() => setSelected((s) => s.filter((e) => e !== entity))}
              className="rounded-full p-0.5 hover:bg-white/10"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {selected.length < 2 && (
          <span className="text-[11px] text-slate-500">
            <T>اختر كيانين على الأقل للمقارنة</T>
          </span>
        )}
      </div>

      {/* Entity picker */}
      <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-2">
        <p className="mb-1 text-[10px] text-slate-500">
          <T>أضف إلى المقارنة</T>
        </p>
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {available.map((entity) => (
            <button
              key={`${entity.kind}:${entity.id}`}
              type="button"
              onClick={() => setSelected((s) => [...s, entity].slice(0, 5))}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] hover:brightness-125',
                KIND_STYLES[entity.kind],
              )}
            >
              {entity.label}
            </button>
          ))}
          {available.length === 0 && (
            <span className="text-[11px] text-slate-600"><T>لا توجد كيانات أخرى في النطاق</T></span>
          )}
        </div>
      </div>

      {/* Dimension grid */}
      {grid.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-700/40 bg-slate-800/20">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/50 text-[11px] text-slate-500">
                <th className="px-3 py-2 text-start font-medium"><T>البُعد</T></th>
                {selected.map((entity) => (
                  <th key={`${entity.kind}:${entity.id}`} className="px-3 py-2 text-start font-medium">
                    <span className="block text-slate-200">{entity.label}</span>
                    <span className="block text-[10px] opacity-70">{pick(locale, KIND_LABELS[entity.kind])}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((dimension) => (
                <tr key={dimension.key} className="border-b border-slate-800/60">
                  <td className="px-3 py-2 text-slate-400">{pick(locale, dimension.label)}</td>
                  {dimension.values.map((cell, index) => {
                    const entity = selected[index];
                    if (!cell) {
                      return (
                        <td key={`${dimension.key}:${entity?.id ?? index}`} className="px-3 py-2 text-slate-600">—</td>
                      );
                    }
                    return (
                      <td key={`${dimension.key}:${entity?.id ?? index}`} className="px-3 py-2">
                        {cell.kind === 'pct' && (
                          <span className="font-mono tabular-nums text-slate-100">
                            {formatScore(typeof cell.value === 'number' ? cell.value : null, locale)}
                          </span>
                        )}
                        {cell.kind === 'points' && (
                          typeof cell.value === 'number'
                            ? <QualityDeltaChip delta={cell.value} />
                            : <span className="text-slate-600">—</span>
                        )}
                        {cell.kind === 'count' && (
                          <span className="font-mono tabular-nums text-slate-300">
                            {typeof cell.value === 'number' ? formatNumber(cell.value, { locale }) : '—'}
                          </span>
                        )}
                        {cell.kind === 'text' && (
                          typeof cell.value === 'string' && entity?.kind === 'employee' ? (
                            <StatusBadge status={cell.value} />
                          ) : (
                            <span className="text-slate-300">{String(cell.value)}</span>
                          )
                        )}
                        {cell.note && (
                          <span className="ms-1 text-[10px] text-slate-500" dir="ltr">({cell.note})</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-6 text-center text-xs text-slate-400">
          <T>لا توجد بيانات كافية للمقارنة في هذا النطاق.</T>
        </p>
      )}
    </div>
  );
}
