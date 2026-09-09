'use client';

// ══════════════════════════════════════════════════════════════
//  Quality Deductions Report — Milestone 8 REFERENCE report page
//
//  §11 EMPLOYEE-GROUPED VIEW (new default): one row per employee —
//  count · total days · total amount — with an EXPANDABLE detail
//  section listing that employee's deductions chronologically
//  (date · reason · days · amount · CAPA). The flat view remains
//  available through the toggle. Both views read the SAME verified
//  runner data through the unified /api/reports/run path — no
//  second calculation anywhere.
// ══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReportView } from '@/components/shared/reports/ReportView';
import type { ReportColumnSpec } from '@/lib/reports/types';
import { Rows3, Layers } from 'lucide-react';

type ViewMode = 'grouped' | 'flat';

export default function QualityDeductionsReport() {
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');

  return (
    <div className="space-y-4">
      {/* §11 view-mode switcher — grouped is the default reading mode */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-950/40 p-1 w-fit print:hidden">
        <button
          type="button"
          onClick={() => setViewMode('grouped')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            viewMode === 'grouped' ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="size-3.5" />
          مجمّع حسب الموظف
        </button>
        <button
          type="button"
          onClick={() => setViewMode('flat')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            viewMode === 'flat' ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Rows3 className="size-3.5" />
          كل الخصومات
        </button>
      </div>

      {viewMode === 'grouped' ? (
        <ReportView
          reportId="quality-deductions-grouped"
          renderCell={renderGroupedCell}
          renderExpanded={renderGroupedDetails}
        />
      ) : (
        <ReportView
          reportId="quality-deductions"
          renderCell={renderDeductionCell}
        />
      )}
    </div>
  );
}

/** Grouped row presentation — impact totals highlighted. */
function renderGroupedCell(column: ReportColumnSpec, row: Record<string, unknown>): React.ReactNode {
  switch (column.key) {
    case 'employeeName': {
      return (
        <span className="font-semibold text-slate-100">
          {String(row.employeeName ?? '—')}
          {Number(row.deductionCount) > 0 && (
            <span className="mr-2 text-[10px] text-slate-500 font-normal">({Number(row.deductionCount)} خصم)</span>
          )}
        </span>
      );
    }
    case 'deductionCount': {
      const count = Number(row.deductionCount) || 0;
      return <span className="font-bold tabular-nums text-slate-100">{count}</span>;
    }
    case 'totalDeductionDays': {
      const days = Number(row.totalDeductionDays) || 0;
      if (days <= 0) return <span className="text-slate-500">0</span>;
      return <span className="font-bold text-red-400 tabular-nums">{days}</span>;
    }
    case 'totalMonetaryAmount': {
      const amount = Number(row.totalMonetaryAmount) || 0;
      if (amount <= 0) return <span className="text-slate-500">—</span>;
      return <span className="text-amber-400 tabular-nums font-semibold">{amount} ج.م</span>;
    }
    case 'reasons': {
      // On-screen the reasons live in the EXPANDED section — the cell
      // shows only a hint; the Excel export renders the full cell.
      const count = Number(row.deductionCount) || 0;
      if (count <= 0) return <span className="text-slate-500">—</span>;
      return (
        <span className="text-[11px] text-cyan-400 inline-flex items-center gap-1">
          ▼ اضغط للتوسيع — {count} {count === 1 ? 'خصم' : 'خصومات'} مرتبة زمنياً
        </span>
      );
    }
    default:
      return undefined; // fall back to the generic formatter
  }
}

/** §11 expanded row: the employee's deductions, chronological. */
function renderGroupedDetails(row: Record<string, unknown>): React.ReactNode {
  const details = Array.isArray(row.details)
    ? (row.details as Array<Record<string, unknown>>)
    : [];
  if (details.length === 0) {
    return <p className="text-xs text-slate-500">لا توجد تفاصيل مسجلة.</p>;
  }
  const chronological = [...details].sort((a, b) =>
    String(a.date ?? '') < String(b.date ?? '') ? -1 : 1,
  );
  return (
    <div className="space-y-1.5 max-w-3xl">
      <p className="text-[11px] font-bold text-slate-400">تفاصيل الخصومات (الأقدم أولاً):</p>
      {chronological.map((d, i) => (
        <div key={String(d.id ?? i)} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2 text-xs">
          <span className="font-mono text-slate-300" dir="ltr">{String(d.date ?? '—')}</span>
          <span className="font-semibold text-slate-100">{String(d.category ?? '—')}</span>
          {d.description ? <span className="text-slate-500 truncate max-w-xs">{String(d.description)}</span> : null}
          <span className="flex items-center gap-2 mr-auto">
            {Number(d.deductionDays) > 0 && (
              <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">{Number(d.deductionDays)} يوم</Badge>
            )}
            {Number(d.monetaryAmount) > 0 && (
              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]">{Number(d.monetaryAmount)} ج.م</Badge>
            )}
            {d.relatedCapaId ? (
              <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/25 text-[10px]">كابا</Badge>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Flat view presentation — day deductions highlighted (primary
 *  impact), optional monetary amount shown independently. */
function renderDeductionCell(column: ReportColumnSpec, row: Record<string, unknown>): React.ReactNode {
  switch (column.key) {
    case 'deductionDays': {
      const days = Number(row.deductionDays) || 0;
      if (days <= 0) return <span className="text-slate-500">0</span>;
      return <span className="font-bold text-red-400 tabular-nums">{days}</span>;
    }
    case 'monetaryAmount': {
      const amount = Number(row.monetaryAmount) || 0;
      if (amount <= 0) return <span className="text-slate-500">—</span>;
      return <span className="text-amber-400 tabular-nums">{amount} ج.م</span>;
    }
    case 'relatedCapaId': {
      const capaId = row.relatedCapaId;
      if (!capaId) return <span className="text-slate-500">—</span>;
      return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/25 text-[11px]">كابا</Badge>;
    }
    default:
      return undefined; // fall back to the generic formatter
  }
}
