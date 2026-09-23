'use client';

// ══════════════════════════════════════════════════════════════
//  Quality Deductions Report — Milestone 8 REFERENCE report page
//
//  §11 EMPLOYEE-GROUPED VIEW (new default): one row per employee —
//  count · total days · total amount — with an EXPANDABLE detail
//  section listing that employee's deductions chronologically
//  (date · reason · details · days · amount · evidence · status ·
//  CAPA). The flat view remains available through the toggle. Both
//  views read the SAME verified runner data through the unified
//  /api/reports/run path — no second calculation anywhere.
//
//  §EXPANSION-UX: the WHOLE "تفاصيل الخصومات / اضغط للتوسيع" cell is
//  clickable (expandTriggerColumns) — the hint text and the chevron
//  toggle the same expansion, no dead click targets.
// ══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ReportView } from '@/components/shared/reports/ReportView';
import type { ReportColumnSpec } from '@/lib/reports/types';
import { Rows3, Layers, ChevronDown, ChevronLeft, Link as LinkIcon } from 'lucide-react';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { parseSafeHttpUrl } from '@/lib/quality-observations/evidence';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatNumber, formatInteger, displayLocale } from '@/lib/i18n/format';

type ViewMode = 'grouped' | 'flat';

export default function QualityDeductionsReport() {
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  // Subscribing keeps the render helpers' displayLocale() output fresh
  // when the user switches language (module helpers cannot use hooks).
  useLanguage();

  return (
    <div className="space-y-4">
      {/* §7 unified page identity */}
      <PageIdentity pageId="qualityDeductionsReport" className="mb-1" />
      {/* §11 view-mode switcher — grouped is the default reading mode */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-950/40 p-1 w-fit print:hidden">
        <button
          type="button"
          onClick={() => setViewMode('grouped')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            viewMode === 'grouped' ? 'bg-brand-500/20 text-brand-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="size-3.5" />
          <T>مجمّع حسب الموظف</T>
        </button>
        <button
          type="button"
          onClick={() => setViewMode('flat')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            viewMode === 'flat' ? 'bg-brand-500/20 text-brand-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Rows3 className="size-3.5" />
          <T>كل الخصومات</T>
        </button>
      </div>

      {viewMode === 'grouped' ? (
        <ReportView
          reportId="quality-deductions-grouped"
          renderCell={renderGroupedCell}
          renderExpanded={renderGroupedDetails}
          expandTriggerColumns={['reasons']}
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

/** Safe evidence link — same guard as the evidence system (http/https only). */
function EvidenceCellLink({ url }: { url: string }) {
  const { locale } = useLanguage();
  const safe = parseSafeHttpUrl(url);
  if (!safe) return <span className="text-slate-400 text-xs break-all">{url}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-[11px] bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20 max-w-56"
      title={translateUIText('فتح الدليل في تبويب جديد', locale)}
    >
      <LinkIcon className="size-2.5 shrink-0" />
      <span className="truncate" dir="ltr">{url}</span>
    </a>
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
            <span className="mr-2 text-[10px] text-slate-500 font-normal">({formatInteger(Number(row.deductionCount), displayLocale())} <T>خصم</T>)</span>
          )}
        </span>
      );
    }
    case 'deductionCount': {
      const count = Number(row.deductionCount) || 0;
      return <span className="font-bold tabular-nums text-slate-100">{formatInteger(count, displayLocale())}</span>;
    }
    case 'totalDeductionDays': {
      const days = Number(row.totalDeductionDays) || 0;
      if (days <= 0) return <span className="text-slate-500">{formatInteger(0, displayLocale())}</span>;
      return <span className="font-bold text-red-400 tabular-nums">{formatNumber(days, { locale: displayLocale() })}</span>;
    }
    case 'totalMonetaryAmount': {
      const amount = Number(row.totalMonetaryAmount) || 0;
      if (amount <= 0) return <span className="text-slate-500">—</span>;
      return <span className="text-amber-400 tabular-nums font-semibold">{formatNumber(amount, { locale: displayLocale() })} <T>ج.م</T></span>;
    }
    case 'reasons': {
      // §EXPANSION-UX — the WHOLE cell is a click target (the table
      // binds onClick for this column via expandTriggerColumns); the
      // hint states the action and the arrow mirrors the chevron.
      const count = Number(row.deductionCount) || 0;
      if (count <= 0) return <span className="text-slate-500">—</span>;
      return (
        <span className="text-[11px] text-cyan-400 inline-flex items-center gap-1">
          <T>اضغط للتوسيع — </T>{formatInteger(count, displayLocale())} {count === 1 ? <T>خصم</T> : <T>خصومات</T>} <T>مرتبة زمنياً</T>
          <ChevronLeft className="size-3" />
        </span>
      );
    }
    default:
      return undefined; // fall back to the generic formatter
  }
}

/** §11 expanded row: the employee's deductions, chronological, with
 *  EVERY detail visible — no truncation of reasons, details,
 *  evidence or status. */
function renderGroupedDetails(row: Record<string, unknown>): React.ReactNode {
  const details = Array.isArray(row.details)
    ? (row.details as Array<Record<string, unknown>>)
    : [];
  if (details.length === 0) {
    return <p className="text-xs text-slate-500"><T>لا توجد تفاصيل مسجلة.</T></p>;
  }
  const chronological = [...details].sort((a, b) =>
    String(a.date ?? '') < String(b.date ?? '') ? -1 : 1,
  );
  return (
    <div className="space-y-1.5 max-w-3xl">
      <p className="text-[11px] font-bold text-slate-400"><T>تفاصيل الخصومات (الأقدم أولاً):</T></p>
      {chronological.map((d, i) => {
        const evidence = typeof d.evidence === 'string' && d.evidence.trim() !== '' ? d.evidence : null;
        return (
          <div key={String(d.id ?? i)} className="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2 text-xs space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-slate-300" dir="ltr">{String(d.date ?? '—')}</span>
              <span className="font-semibold text-slate-100"><T>{String(d.category ?? '—')}</T></span>
              {typeof d.status === 'string' && d.status !== 'معتمد' && (
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]"><T>{d.status}</T></Badge>
              )}
              <span className="flex items-center gap-2 mr-auto">
                {Number(d.deductionDays) > 0 && (
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px]">{formatNumber(Number(d.deductionDays), { locale: displayLocale() })} <T>يوم</T></Badge>
                )}
                {Number(d.monetaryAmount) > 0 && (
                  <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px]">{formatNumber(Number(d.monetaryAmount), { locale: displayLocale() })} <T>ج.م</T></Badge>
                )}
                {d.relatedCapaId ? (
                  <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/25 text-[10px]"><T>كابا</T></Badge>
                ) : null}
              </span>
            </div>
            {/* Full reason/details — wrapped, never truncated */}
            {d.description ? (
              <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap break-words">{String(d.description)}</p>
            ) : null}
            {evidence ? <EvidenceCellLink url={evidence} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Flat view presentation — day deductions highlighted (primary
 *  impact), optional monetary amount shown independently, evidence
 *  clickable, approval status visible. */
function renderDeductionCell(column: ReportColumnSpec, row: Record<string, unknown>): React.ReactNode {
  switch (column.key) {
    case 'deductionDays': {
      const days = Number(row.deductionDays) || 0;
      if (days <= 0) return <span className="text-slate-500">{formatInteger(0, displayLocale())}</span>;
      return <span className="font-bold text-red-400 tabular-nums">{formatNumber(days, { locale: displayLocale() })}</span>;
    }
    case 'monetaryAmount': {
      const amount = Number(row.monetaryAmount) || 0;
      if (amount <= 0) return <span className="text-slate-500">—</span>;
      return <span className="text-amber-400 tabular-nums">{formatNumber(amount, { locale: displayLocale() })} <T>ج.م</T></span>;
    }
    case 'evidence': {
      const url = typeof row.evidence === 'string' ? row.evidence : '';
      if (!url) return <span className="text-slate-500">—</span>;
      return <EvidenceCellLink url={url} />;
    }
    case 'status': {
      const status = String(row.status ?? 'معتمد');
      const cls = status === 'معتمد'
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        : status === 'قيد الاعتماد'
          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          : 'bg-red-500/10 text-red-400 border-red-500/20';
      return <Badge className={`${cls} text-[10px]`}><T>{status}</T></Badge>;
    }
    case 'relatedCapaId': {
      const capaId = row.relatedCapaId;
      if (!capaId) return <span className="text-slate-500">—</span>;
      return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/25 text-[11px]"><T>كابا</T></Badge>;
    }
    default:
      return undefined; // fall back to the generic formatter
  }
}
