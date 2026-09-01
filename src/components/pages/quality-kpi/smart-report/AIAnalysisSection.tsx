'use client';

// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — AI Intelligence section (Phase 6.2)
//
//  Mounted in the reserved "التحليل الذكي" spot, AFTER the facts
//  sections and the deterministic Analytics section (spec §23).
//  The AI adds INTERPRETATION only — it never repeats the report's
//  numbers as its own (§54) and never blocks the report (§53).
//
//  ON-DEMAND (§25/§52): nothing loads with the page — the analysis
//  runs only when the user presses the button; requests are
//  abortable on unmount / employee / period change.
//
//  STATES (§24): IDLE / LOADING / READY / NO_DATA / INSUFFICIENT_DATA
//  / AI_UNAVAILABLE / AI_TIMEOUT / AI_ERROR / AI_INVALID_RESPONSE
//  / AI_RATE_LIMITED / NETWORK_ERROR — an AI failure degrades THIS
//  section alone; Facts + Analytics + Evidence stay visible (§24/§53).
//
//  EVIDENCE (§44/§45): every insight/recommendation evidence chip
//  opens the EXISTING EvidencePreviewModal (via the report's
//  onViewEvidence) → "فتح السجل في المصدر" / highlight — no new
//  evidence viewer, fully auditable AI.
// ══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  ClipboardCheck,
  Clock,
  FileText,
  Info,
  Lock,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/query-provider';
import type { QualityAIApiResponse, QualityAIAnalysisResult } from '@/lib/ai/quality/contracts';
import { fetchEvidencePreview } from '@/hooks/use-evidence';
import type { EvidenceDetailSelection } from './report-sections';
import { SectionCard } from './report-sections';
import {
  AI_CATEGORY_LABELS,
  AI_CONFIDENCE_LABELS,
  AI_IMPACT_LABELS,
  AI_INSIGHT_TYPE_LABELS,
  AI_PRIORITY_LABELS,
  AI_SEVERITY_LABELS,
  aiBadgeTone,
  aiFailureHeading,
  aiSufficiencyLabel,
} from './ai-view';
import { formatMonthLabelAr } from '@/lib/month-label';

type AiState =
  | { kind: 'IDLE' }
  | { kind: 'LOADING' }
  | { kind: 'READY'; result: QualityAIAnalysisResult; cached: boolean }
  | { kind: 'FAILED'; status: string; message: string };

export function AIAnalysisSection({
  employeeId,
  month,
  onViewEvidence,
}: {
  employeeId: string;
  month: string;
  onViewEvidence: (selection: EvidenceDetailSelection) => void;
}) {
  const [state, setState] = useState<AiState>({ kind: 'IDLE' });
  const abortRef = useRef<AbortController | null>(null);

  const runAnalysis = useCallback(async () => {
    if (!employeeId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: 'LOADING' });
    try {
      const response = await apiFetch<QualityAIApiResponse>('/api/ai/quality-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, month }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return; // aborted/unmounted — keep quiet
      if (response.status === 'OK') {
        setState({ kind: 'READY', result: response.result, cached: response.cached });
      } else {
        setState({ kind: 'FAILED', status: response.status, message: response.message });
      }
    } catch (error) {
      if (controller.signal.aborted) return; // superseded/unmounted — keep quiet
      setState({
        kind: 'FAILED',
        status: 'NETWORK_ERROR',
        message: error instanceof Error && error.message
          ? `تعذر الاتصال بخدمة التحليل الذكي (${error.message})`
          : 'تعذر الاتصال بخدمة التحليل الذكي',
      });
    }
  }, [employeeId, month]);

  // §25/§52: in-flight requests are aborted on unmount. Subject/period
  // changes remount the section via its `key` (parent) — a fresh IDLE
  // state with zero effect-timed setState, and the old request dies
  // with the old instance's cleanup.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const openEvidence = useCallback(
    async (collection: string, recordIds: string[]) => {
      const recordId = recordIds[0];
      if (!recordId) return;
      try {
        const preview = await fetchEvidencePreview(
          collection as Parameters<typeof fetchEvidencePreview>[0],
          [recordId],
        );
        const record = preview.records[0];
        if (!record) return;
        onViewEvidence({
          collection: preview.collection as Parameters<typeof onViewEvidence>[0]['collection'],
          recordId: record.recordId,
          projected: record.record ?? null,
          access: record.access,
        });
      } catch {
        // The preview modal owns the forbidden/not-found rendering when
        // the projection is unavailable — nothing to add here.
        onViewEvidence({
          collection: collection as Parameters<typeof onViewEvidence>[0]['collection'],
          recordId,
          projected: null,
          access: 'granted',
        });
      }
    },
    [onViewEvidence],
  );

  return (
    <SectionCard
      icon={Brain}
      title="التحليل الذكي (AI)"
      subtitle="تفسير مولّد بالذكاء الاصطناعي فوق الحقائق المتحقق منها والتحليل الحتمي — للمراجعة الإدارية، ولا ينفذ أي إجراء"
      actions={<AiGeneratedBadge />}
    >
      {state.kind === 'IDLE' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            اضغط الزر لتشغيل التحليل الذكي على بيانات الفترة الحالية. لا يعمل التحليل تلقائيًا مع تحميل الصفحة،
            ولا يُغيّر أي بيانات — مخرجاته مقترحات للمراجعة فقط، وكل استنتاج مرتبط بأدلته.
          </p>
          <Button
            size="sm"
            data-testid="ai-run-analysis"
            onClick={runAnalysis}
            className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
            disabled={!employeeId}
          >
            <Sparkles className="h-4 w-4" />
            تشغيل التحليل الذكي
          </Button>
        </div>
      )}

      {state.kind === 'LOADING' && (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-5 w-1/3 bg-slate-800/40" />
          <Skeleton className="h-16 w-full bg-slate-800/40" />
          <Skeleton className="h-12 w-full bg-slate-800/40" />
        </div>
      )}

      {state.kind === 'READY' && (
        <ReadyView result={state.result} cached={state.cached} onRerun={runAnalysis} onOpenEvidence={openEvidence} />
      )}

      {state.kind === 'FAILED' && (
        <FailureView status={state.status} message={state.message} onRetry={runAnalysis} />
      )}
    </SectionCard>
  );
}

// ── header badge (§23: clearly AI GENERATED) ────────────────────
function AiGeneratedBadge() {
  return (
    <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 font-normal text-[10px] text-violet-300">
      <Brain className="ml-1 h-3 w-3" />
      AI GENERATED
    </Badge>
  );
}

function ToneBadge({ level, label }: { level: string; label: string }) {
  const TONE: Record<string, string> = {
    neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/15 text-red-300 border-red-500/30',
    info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    accent: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  };
  return (
    <Badge variant="outline" className={cn('font-normal text-[10px]', TONE[aiBadgeTone(level)])}>
      {label}
    </Badge>
  );
}

// ── READY view (§54: confidence + data status + insights + recs) ──
function ReadyView({
  result,
  cached,
  onRerun,
  onOpenEvidence,
}: {
  result: QualityAIAnalysisResult;
  cached: boolean;
  onRerun: () => void;
  onOpenEvidence: (collection: string, recordIds: string[]) => void;
}) {
  const periodLabel = formatMonthLabelAr(result.period.from);
  return (
    <div className="space-y-5">
      {/* Meta row — §68: the period is ALWAYS visible, named */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <Badge variant="outline" className="border-slate-500/30 bg-slate-500/15 font-normal text-[11px] text-slate-300">
          الفترة: {periodLabel}
        </Badge>
        {result.period.mtd && (
          <Badge variant="outline" className="border-sky-500/30 bg-sky-500/15 font-normal text-[11px] text-sky-300">
            حتى تاريخه (MTD) — البيانات المتاحة الآن، ليست شهرًا نهائيًا
          </Badge>
        )}
        <Badge variant="outline" className="border-slate-500/30 bg-slate-500/15 font-normal text-[11px] text-slate-300">
          حالة البيانات: {aiSufficiencyLabel(result.dataSufficiency)}
        </Badge>
        <Badge variant="outline" className="border-slate-500/30 bg-slate-500/15 font-normal text-[11px] text-slate-300">
          مستوى الثقة: {AI_CONFIDENCE_LABELS[result.confidence]}
        </Badge>
        {cached && (
          <Badge variant="outline" className="border-slate-600/40 bg-slate-600/10 font-normal text-[10px] text-slate-400">
            نتيجة مخزّنة
          </Badge>
        )}
        <span className="font-mono text-[9px] text-slate-600" dir="ltr" title="AI provenance">
          {result.provider}/{result.model} · {result.promptVersion}
        </span>
      </div>

      {/* Level limitations — never hidden */}
      {result.limitations.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-amber-200">
            <Info className="h-3.5 w-3.5" />
            حدود هذا التحليل
          </h4>
          <ul className="space-y-1">
            {result.limitations.map((l, i) => (
              <li key={i} className="text-[11px] leading-5 text-amber-100/80">{l}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Insights — §11: FACTS vs INTERPRETATION visibly separated */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-200">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          أبرز الاستنتاجات
        </h4>
        {result.insights.length === 0 && (
          <p className="text-xs text-slate-500">لا توجد استنتاجات مدعومة بالأدلة لهذه الفترة.</p>
        )}
        {result.insights.map((insight, idx) => (
          <div
            key={insight.id}
            data-testid="ai-insight"
            className="rounded-lg border border-slate-700/40 bg-slate-900/20 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500 tabular-nums">①{idx + 1}</span>
              <ToneBadge level={insight.severity} label={AI_INSIGHT_TYPE_LABELS[insight.type]} />
              <ToneBadge level={insight.severity} label={AI_SEVERITY_LABELS[insight.severity]} />
              <ToneBadge level={insight.confidence} label={`ثقة ${AI_CONFIDENCE_LABELS[insight.confidence]}`} />
            </div>
            <p className="text-[13px] font-medium text-slate-100">{insight.title}</p>
            <p className="text-[12px] leading-6 text-slate-300">{insight.summary}</p>
            <div className="space-y-1 rounded-lg bg-slate-900/40 p-2.5">
              <p className="text-[11px] leading-5 text-slate-400">
                <span className="font-semibold text-emerald-300">الحقائق: </span>
                {insight.factBasis}
              </p>
              <p className="text-[11px] leading-5 text-slate-400">
                <span className="font-semibold text-violet-300">التفسير: </span>
                {insight.interpretation}
              </p>
            </div>
            <EvidenceChips evidence={insight.supportingEvidence} onOpen={onOpenEvidence} />
            {insight.limitations.length > 0 && (
              <ul className="space-y-0.5">
                {insight.limitations.map((l, i) => (
                  <li key={i} className="text-[10px] text-amber-200/70">— {l}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Recommendations — §15/§39: PROPOSED + "لماذا؟" always visible */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-200">
          <ClipboardCheck className="h-3.5 w-3.5 text-violet-400" />
          التوصيات المقترحة (لا تُنفَّذ آليًا)
        </h4>
        {result.recommendations.length === 0 && (
          <p className="text-xs text-slate-500">لا توجد توصيات مدعومة بالأدلة لهذه الفترة.</p>
        )}
        {result.recommendations.map((rec, idx) => (
          <div
            key={rec.id}
            data-testid="ai-recommendation"
            className="rounded-lg border border-slate-700/40 bg-slate-900/20 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500 tabular-nums">①{idx + 1}</span>
              <Badge variant="outline" className="border-slate-500/30 bg-slate-500/15 font-normal text-[10px] text-slate-300">
                {AI_CATEGORY_LABELS[rec.category]}
              </Badge>
              <ToneBadge level={rec.priority} label={`أولوية ${AI_PRIORITY_LABELS[rec.priority]}`} />
              <ToneBadge level={rec.confidence} label={`ثقة ${AI_CONFIDENCE_LABELS[rec.confidence]}`} />
              <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 font-normal text-[10px] text-violet-300">
                مقترحة — بانتظار قرار إداري
              </Badge>
            </div>
            <p className="text-[13px] font-medium text-slate-100">{rec.title}</p>
            <p className="text-[12px] leading-6 text-slate-300">{rec.recommendation}</p>
            <div className="space-y-1 rounded-lg bg-slate-900/40 p-2.5">
              <p className="text-[11px] leading-5 text-slate-400">
                <span className="font-semibold text-emerald-300">لماذا يقترح النظام هذا؟ </span>
                {rec.reason}
              </p>
              <p className="text-[11px] leading-5 text-slate-400">
                <span className="font-semibold text-violet-300">الأثر المتوقع: </span>
                {AI_IMPACT_LABELS[rec.expectedImpact.direction] ?? rec.expectedImpact.direction} — {rec.expectedImpact.description}
              </p>
            </div>
            <EvidenceChips evidence={rec.supportingEvidence} onOpen={onOpenEvidence} />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-800/60 pt-3">
        <p className="text-[10px] leading-5 text-slate-500">
          هذا القسم مولّد بالذكاء الاصطناعي (AI GENERATED) كطبقة تفسير فوق الحقائق والتحليل الحتمي — لا يعيد حساب
          أي رقم، ولا ينفذ أي إجراء، ولا يخزَّن كقرار. كل استنتاج يعرض أدلته ومستوى ثقته وحدوده للمراجعة الإدارية.
        </p>
        <Button
          variant="outline"
          size="sm"
          data-testid="ai-refresh-analysis"
          onClick={onRerun}
          className="no-print shrink-0 border-slate-700/50 text-slate-300 hover:bg-slate-800/60"
        >
          <RefreshCw className="h-3.5 w-3.5 ml-1" />
          تحديث التحليل
        </Button>
      </div>
    </div>
  );
}

// ── evidence chips → existing EvidencePreviewModal (§44/§45) ────
function EvidenceChips({
  evidence,
  onOpen,
}: {
  evidence: Array<{ collection: string; recordIds: string[]; completeRecordList: boolean }>;
  onOpen: (collection: string, recordIds: string[]) => void;
}) {
  if (evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[10px] text-slate-500">
        <FileText className="h-3 w-3" />
        الأدلة:
      </span>
      {evidence.map((ref, i) => (
        <button
          key={`${ref.collection}-${i}`}
          type="button"
          data-testid="ai-evidence-chip"
          onClick={() => onOpen(ref.collection, ref.recordIds)}
          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
          title="عرض السجل المصدر ثم الانتقال إليه"
        >
          {ref.collection === 'qualityObservations' ? 'ملاحظات الجودة' : ref.collection}
          {ref.recordIds.length > 1 ? ` (${ref.recordIds.length})` : ''}
        </button>
      ))}
    </div>
  );
}

// ── failure / empty states (§24/§69 — distinct, honest) ─────────
function FailureView({ status, message, onRetry }: { status: string; message: string; onRetry: () => void }) {
  const isInfo = status === 'NO_DATA' || status === 'INSUFFICIENT_DATA' || status === 'AI_UNAVAILABLE';
  const isTimeout = status === 'AI_TIMEOUT';
  const Icon = isInfo ? Info : isTimeout ? Clock : status === 'AI_RATE_LIMITED' ? Lock : AlertTriangle;
  const boxTone = isInfo
    ? 'border-sky-500/20 bg-sky-500/5'
    : isTimeout
      ? 'border-orange-500/20 bg-orange-500/5'
      : 'border-amber-500/20 bg-amber-500/5';
  const iconTone = isInfo ? 'text-sky-400' : isTimeout ? 'text-orange-400' : 'text-amber-400';
  const textTone = isInfo ? 'text-sky-200' : isTimeout ? 'text-orange-200' : 'text-amber-200';

  return (
    <div className={`space-y-2 rounded-xl border p-4 ${boxTone}`} data-testid={`ai-state-${status}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} />
        <div className="min-w-0 space-y-1">
          <p className={`text-sm font-semibold ${textTone}`}>{aiFailureHeading(status)}</p>
          <p className="text-[12px] leading-6 text-slate-300">{message}</p>
          {!isInfo && (
            <p className="text-[11px] text-slate-500">
              الحقائق والتحليل الإحصائي والأدلة في التقرير تبقى متاحة بشكل طبيعي — فشل التحليل الذكي لا يؤثر عليها.
            </p>
          )}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        data-testid="ai-retry"
        onClick={onRetry}
        className="no-print border-slate-700/50 text-slate-300 hover:bg-slate-800/60"
      >
        <RefreshCw className="h-3.5 w-3.5 ml-1" />
        إعادة المحاولة
      </Button>
    </div>
  );
}
