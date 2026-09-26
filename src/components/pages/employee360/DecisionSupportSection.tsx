'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — HR Decision Support + Needs Attention (rebuild)
//
//  Decision support renders the CANONICAL deterministic projection
//  (lib/hr-decision) verbatim: status vocabulary STABLE →
//  MANAGEMENT_REVIEW, the fixed safety disclaimer, no termination
//  language, no independent judgment. Factor lines whose owning
//  section is denied were already stripped server-side.
//
//  Attention reuses the system's severity language; every row is
//  actionable via the canonical navigateTo drill.
// ══════════════════════════════════════════════════════════════

import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { T } from '@/lib/i18n/T';
import { executeDrill } from '@/lib/employee-360/navigation';
import { SectionShell, EmptyState } from '@/components/pages/employee360/ui';
import type { Employee360Data } from '@/lib/employee-360/client-types';

const STATUS_TONE: Record<string, string> = {
  STABLE: 'text-emerald-600 dark:text-emerald-400',
  IMPROVING: 'text-emerald-600 dark:text-emerald-400',
  NEEDS_COACHING: 'text-amber-600 dark:text-amber-400',
  PERFORMANCE_IMPROVEMENT_REVIEW: 'text-red-600 dark:text-red-400',
  MANAGEMENT_REVIEW: 'text-red-600 dark:text-red-400',
};

const FACTOR_SEVERITY_LABELS: Record<string, string> = {
  LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع',
};

export function DecisionSupportSection({ decision }: {
  decision: NonNullable<Employee360Data['decisionSupport']>;
}) {
  return (
    <SectionShell
      title={<T>دعم قرارات الموارد البشرية</T>}
      icon={<ShieldCheck className="size-4 text-brand-500" />}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Status */}
        <div className="min-w-48 shrink-0 rounded-xl border border-border/50 bg-muted/20 p-4">
          <p className="text-[11px] font-medium text-muted-foreground"><T>الحالة الحالية</T></p>
          <p className={`mt-1 text-lg font-bold leading-snug ${STATUS_TONE[decision.status] ?? 'text-foreground'}`}>
            {decision.statusLabelAr}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            <T>المخاطر</T>: <span className="font-semibold text-foreground" dir="ltr">{decision.riskScore}</span> · {decision.riskLevel}
          </p>
          {decision.momDeltaPoints !== null && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <T>التغير عن الشهر السابق</T>: <span dir="ltr">{decision.momDeltaPoints > 0 ? '+' : ''}{decision.momDeltaPoints}pt</span>
            </p>
          )}
          {decision.consecutiveKpiBelowTarget > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <T>أشهر متتالية تحت المستهدف</T>: {decision.consecutiveKpiBelowTarget}
            </p>
          )}
        </div>

        {/* Recommended action + factors */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
            <p className="text-[11px] font-medium text-muted-foreground"><T>الإجراء الموصى به (مراجعة)</T></p>
            <p className="mt-1 text-sm font-semibold text-foreground">{decision.action.actionAr}</p>
            <p className="mt-1 text-xs text-muted-foreground">{decision.action.rationaleAr}</p>
            <p className="mt-2 rounded-lg bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              {decision.action.disclaimerAr}
            </p>
          </div>

          {decision.factors.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground"><T>العوامل المقاسة (أدلة منظمة)</T></p>
              <ul className="space-y-1.5">
                {decision.factors.slice(0, 8).map((f, i) => (
                  <li key={`${f.ruleId}-${i}`} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 inline-flex shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                      f.kind === 'NEGATIVE'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {FACTOR_SEVERITY_LABELS[f.severity] ?? f.severity}
                    </span>
                    <span className="text-foreground">{f.signalAr}</span>
                    {f.comparisonAr && <span className="text-muted-foreground">({f.comparisonAr})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

/* ═══ Needs Attention ═══ */

const ATTENDANCE_SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-red-500/30 bg-red-500/5',
  urgent: 'border-orange-500/30 bg-orange-500/5',
  warning: 'border-amber-500/30 bg-amber-500/5',
  info: 'border-border/60 bg-muted/30',
};

export function AttentionSection({ items }: {
  items: NonNullable<Employee360Data['attention']>;
}) {
  return (
    <SectionShell title={<T>يحتاج انتباه</T>} icon={<AlertTriangle className="size-4 text-brand-500" />}>
      {items.length === 0 ? (
        <EmptyState text={<T>لا إشارات تتطلب انتباهاً — كل العناصر تحت السيطرة</T>} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => executeDrill(item.drill)}
                className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-start transition-colors hover:bg-muted/60 ${ATTENDANCE_SEVERITY_STYLES[item.severity] ?? ATTENDANCE_SEVERITY_STYLES.info}`}
              >
                <span className="mt-0.5 inline-flex shrink-0 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  {SEVERITY_LABEL[item.severity] ?? item.severity}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                  {item.detail && <span className="block text-xs text-muted-foreground">{item.detail}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'حرج', urgent: 'عاجل', warning: 'اليوم', info: 'معلومة',
};
