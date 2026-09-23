'use client';

// ══════════════════════════════════════════════════════════════
//  HomeInsightDetailsDialog — §Home-CC §9 INSIGHT DETAILS
//
//  The intermediate surface between a Home metric and the exact
//  destination:
//      Metric → Insight Details → View Records → exact page
//      (filtered) → Qnalys global highlight on the exact record.
//  It EXPLAINS a number (definition, period, scope, rule, source,
//  freshness, breakdown) — it never computes one. All display values
//  arrive pre-resolved from the page; this dialog owns no logic.
// ══════════════════════════════════════════════════════════════

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatDateTime } from '@/lib/i18n/format';
import { ExternalLink, Info, Clock, Database, Filter, BookOpenText, Layers } from 'lucide-react';

export interface HomeMetricInsight {
  /** Stable metric key (e.g. 'pending-approvals'). */
  key: string;
  /** Display label (already localized by the page). */
  label: string;
  /** Display value (already formatted — may be '—' for unavailable). */
  value: string | number;
  /** Display period (e.g. «سبتمبر ٢٠٢٦» / "Today"). */
  period: string;
  /** Scope sentence (whose records the number describes). */
  scope: string;
  /** Business rule sentence (how the number is defined). */
  businessRule: string;
  /** Data source sentence (which records feed it). */
  source: string;
  /** Freshness ISO timestamp, or null → shown as unavailable. */
  freshness: string | null;
  /** Optional breakdown rows (by type / department / …). */
  breakdown?: Array<{ label: string; value: string | number }>;
  /** §10 — the exact deep navigation target. */
  navigateTo: {
    page: string;
    highlightId?: string;
    params?: Record<string, string>;
  };
}

interface HomeInsightDetailsDialogProps {
  insight: HomeMetricInsight | null;
  onClose: () => void;
}

export function HomeInsightDetailsDialog({ insight, onClose }: HomeInsightDetailsDialogProps) {
  const { t } = useLanguage();
  const navigateTo = useAppStore((s) => s.navigateTo);

  const handleViewRecords = () => {
    if (!insight) return;
    const target = insight.navigateTo;
    onClose();
    navigateTo(target.page, target.highlightId, target.params);
  };

  if (!insight) return null;

  const rows: Array<{ icon: React.ReactNode; label: string; body: React.ReactNode }> = [
    { icon: <BookOpenText className="size-3" />, label: t('home.businessRule'), body: insight.businessRule },
    { icon: <Filter className="size-3" />, label: t('home.scope'), body: insight.scope },
    { icon: <Database className="size-3" />, label: t('home.source'), body: <span className="font-mono text-[11px]">{insight.source}</span> },
    {
      icon: <Clock className="size-3" />,
      label: t('home.freshness'),
      body: insight.freshness
        ? `${t('home.lastUpdated')}: ${formatDateTime(insight.freshness)}`
        : <span className="text-amber-400">{t('home.unavailable')}</span>,
    },
  ];

  return (
    <Dialog open={!!insight} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <span className="flex items-center justify-center size-8 rounded-xl bg-brand-500/15 border border-brand-500/30 shrink-0">
              <Info className="size-4 text-brand-400" />
            </span>
            <span className="min-w-0 truncate">{insight.label}</span>
          </DialogTitle>
          <DialogDescription className="text-[11px] text-text-secondary">
            {t('home.insightDetails')} — {insight.period}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Value */}
          <div className="rounded-xl border border-slate-500/15 bg-slate-500/5 px-4 py-3">
            <span className="text-3xl font-bold tabular-nums text-foreground">{insight.value}</span>
          </div>

          {/* Explanation rows */}
          <div className="space-y-2.5">
            {rows.map((row, i) => (
              <div key={i} className="space-y-1">
                <p className="text-[10px] font-semibold text-text-muted flex items-center gap-1.5">
                  {row.icon} {row.label}
                </p>
                <p className="text-xs text-text-secondary bg-slate-500/5 border border-slate-500/10 rounded-lg px-3 py-2 leading-relaxed">
                  {row.body}
                </p>
              </div>
            ))}
          </div>

          {/* Breakdown */}
          {insight.breakdown && insight.breakdown.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-text-muted flex items-center gap-1.5">
                <Layers className="size-3" /> {t('home.breakdown')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {insight.breakdown.map((item, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-slate-500/5 border border-slate-500/10 px-3 py-1.5">
                    <span className="text-text-secondary text-[11px] truncate">{item.label}</span>
                    <span className="text-foreground font-semibold tabular-nums text-[11px]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between gap-2 border-t border-slate-500/15 pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('action.close')}
          </Button>
          <Button onClick={handleViewRecords} className="gap-2">
            <ExternalLink className="size-3.5" />
            {t('home.viewRecords')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default HomeInsightDetailsDialog;
