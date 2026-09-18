'use client';

// ══════════════════════════════════════════════════════════════
//  Evidence Preview (Phase 5.2, spec §29-§36)
//
//  Clicking "فتح المصدر" / "عرض الدليل" opens THIS preview first —
//  the actual source record rendered with Arabic labels — instead
//  of showing a raw id (spec §29/§30). Only fields that actually
//  exist on the record are shown (the server projection guarantees
//  it), and the raw record id is ALWAYS secondary (§29).
//
//  Navigation (§33/§36 + Phase 5.3 §30 honest labels):
//    • exact strategies (highlight / detailParam) show
//      "فتح السجل في المصدر" → navigateTo(page, recordId, params) —
//      the target page locates/opens/scrolls/highlights the record
//    • generic strategy shows "الانتقال إلى الصفحة" → navigateTo(page)
//    The two are visually labeled differently so the user always
//    knows whether exact-record navigation will happen, and the
//    navigation buttons only render when the preview access is
//    granted (§32 — no pretending when the source is inaccessible).
//
//  Permission handling (§37): forbidden / not-found states render
//  an explicit message with NO record contents.
// ══════════════════════════════════════════════════════════════

import { FileText, Lock, ShieldQuestion, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  EVIDENCE_COLLECTIONS,
  type EvidenceCollection,
} from '@/lib/evidence/evidence-collections';
import type { ProjectedRecord } from '@/lib/evidence/record-projection';
import {
  EVIDENCE_FORBIDDEN_MESSAGE,
  EVIDENCE_NOT_FOUND_MESSAGE,
  type EvidenceAccess,
} from '@/lib/evidence/evidence-summaries';

export interface EvidencePreviewRequestState {
  collection: EvidenceCollection;
  recordId: string;
  /** Pre-loaded projection (from the group summaries fetch) if any. */
  projected?: ProjectedRecord | null;
  access?: EvidenceAccess;
  isLoading?: boolean;
}

export function EvidencePreviewModal({
  state,
  onOpenChange,
  onNavigate,
}: {
  state: EvidencePreviewRequestState | null;
  onOpenChange: (open: boolean) => void;
  onNavigate: (collection: EvidenceCollection, recordId: string) => void;
}) {
  const descriptor = state ? EVIDENCE_COLLECTIONS[state.collection] : null;
  const access: EvidenceAccess = state?.access ?? 'granted';
  const record = state?.projected ?? null;
  const loading = state?.isLoading === true;
  const granted = access === 'granted' && !!record;

  return (
    <Dialog open={!!state} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-slate-900 border-slate-700/60 text-slate-200 max-w-md no-print"
       
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right text-slate-100">
            <FileText className="h-4 w-4 text-emerald-400" />
            {descriptor?.title ?? 'دليل'}
          </DialogTitle>
          <DialogDescription className="text-right text-[11px] text-slate-500">
            معاينة السجل المصدر — البيانات من المصدر الكنسي نفسه دون أي نسخ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto arm-scroll pl-1" data-testid="evidence-preview-body">
          {loading && (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-5 w-2/3 bg-slate-800/40" />
              <Skeleton className="h-4 w-full bg-slate-800/40" />
              <Skeleton className="h-4 w-4/5 bg-slate-800/40" />
            </div>
          )}

          {!loading && access === 'forbidden' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-200">{EVIDENCE_FORBIDDEN_MESSAGE}</p>
            </div>
          )}

          {!loading && access === 'not_found' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-slate-500/20 bg-slate-500/5 p-4">
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <p className="text-sm text-slate-300">{EVIDENCE_NOT_FOUND_MESSAGE}</p>
            </div>
          )}

          {!loading && granted && record && (
            <dl className="space-y-2.5">
              {record.fields.length === 0 && (
                <p className="text-xs text-slate-500">لا توجد حقول عرض لهذا السجل.</p>
              )}
              {record.fields.map((field) => (
                <div
                  key={field.label}
                  className="grid grid-cols-[110px_1fr] items-start gap-2 text-[12px]"
                  data-testid="evidence-preview-field"
                >
                  <dt className="text-slate-500">{field.label}</dt>
                  <dd className={cn(
                    'text-slate-200 whitespace-pre-wrap break-words',
                    field.label === 'معرف السجل' && 'font-mono text-[10px] text-slate-500',
                  )}>
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-slate-800/60 pt-3">
          <span
            className="font-mono text-[10px] text-slate-600 truncate"
            dir="ltr"
            title={state?.recordId}
            data-testid="evidence-preview-record-id"
          >
            {state?.recordId}
          </span>
          {descriptor && state && access === 'granted' && (
            descriptor.navStrategy === 'generic' ? (
              <Button
                size="sm"
                variant="outline"
                className="no-print border-slate-700/60 text-slate-300 hover:bg-slate-800/60"
                data-testid="evidence-generic-nav"
                onClick={() => onNavigate(state.collection, state.recordId)}
              >
                <ExternalLink className="h-3.5 w-3.5 ml-1" />
                {/* §30: honest label — this page supports page navigation only */}
                الانتقال إلى الصفحة
              </Button>
            ) : (
              <Button
                size="sm"
                className="no-print bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="evidence-exact-nav"
                onClick={() => onNavigate(state.collection, state.recordId)}
              >
                <ExternalLink className="h-3.5 w-3.5 ml-1" />
                {/* §30: exact record navigation — locate/scroll/highlight */}
                فتح السجل في المصدر
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
