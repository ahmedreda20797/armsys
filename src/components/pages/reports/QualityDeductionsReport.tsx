'use client';

// ══════════════════════════════════════════════════════════════
//  Quality Deductions Report — Milestone 8 REFERENCE report page
//
//  Demonstrates the reporting architecture end-to-end:
//    ReportDefinition (registry) → /api/reports/run (permission +
//    scope enforced server-side) → ReportView primitives → export.
//
//  The page contains NO calculation logic and NO KPI values: it
//  mounts the generic ReportView for 'quality-deductions' and only
//  customizes cell presentation (day-first coloring, CAPA badge).
// ══════════════════════════════════════════════════════════════

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ReportView } from '@/components/shared/reports/ReportView';
import type { ReportColumnSpec } from '@/lib/reports/types';

export default function QualityDeductionsReport() {
  return (
    <ReportView
      reportId="quality-deductions"
      renderCell={renderDeductionCell}
    />
  );
}

/** Presentation-only customization — day deductions highlighted
 *  (primary impact), optional monetary amount shown independently. */
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
