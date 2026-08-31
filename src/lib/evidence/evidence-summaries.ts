// ══════════════════════════════════════════════════════════════
//  Evidence Preview — client-safe summary views (Phase 5.2 §32)
//
//  Evidence cards display HUMAN-READABLE summaries instead of raw
//  IDs. The raw record id is ALWAYS secondary (small monospace line
//  or the modal footer — never the primary presentation, §29/§32).
//
//  Pure functions over the projected record / API response — no
//  React, no server imports. Directly unit-testable.
// ══════════════════════════════════════════════════════════════

import type { ProjectedRecord } from './record-projection';

export type EvidenceAccess = 'granted' | 'forbidden' | 'not_found';

export interface EvidenceSummaryView {
  recordId: string;
  access: EvidenceAccess;
  /** Primary line — Arabic record title (spec §32), e.g. "ملاحظة جودة". */
  title: string;
  /** Secondary human-readable meta lines (date, type, status…). */
  metaLines: string[];
  /** Raw id — rendered SECONDARY only (small mono text). */
  rawId: string;
}

/** Arabic message shown when the viewer lacks source permission (§37). */
export const EVIDENCE_FORBIDDEN_MESSAGE = 'لا تملك صلاحية عرض هذا المصدر';
/** Arabic message shown when the record no longer exists. */
export const EVIDENCE_NOT_FOUND_MESSAGE = 'السجل غير موجود في مصدره';

/**
 * Build one evidence-card summary. When the record has not been
 * loaded (or is forbidden/not found), the summary degrades to the
 * collection title + the raw id kept secondary + an explicit state
 * line — it never fabricates record content.
 */
export function buildEvidenceSummary(
  collectionTitle: string,
  recordId: string,
  projected: ProjectedRecord | null | undefined,
  access: EvidenceAccess = 'granted',
): EvidenceSummaryView {
  if (access !== 'granted' || !projected) {
    const stateMessage = access === 'forbidden'
      ? EVIDENCE_FORBIDDEN_MESSAGE
      : access === 'not_found'
        ? EVIDENCE_NOT_FOUND_MESSAGE
        : 'يتم تحميل تفاصيل السجل…';
    return {
      recordId,
      access,
      title: collectionTitle,
      metaLines: [stateMessage],
      rawId: recordId,
    };
  }

  // Spec §32 example shows the summary lines as date / type / status.
  // Pick those PREFERENTIALLY (by Arabic label family), then fall back
  // to whatever exists, capped at three lines — values only.
  const dateLabels = ['التاريخ', 'الشهر'];
  const typeLabels = ['النوع', 'التصنيف', 'العنوان', 'الوجهة', 'رقم الحالة'];
  const statusLabels = ['الحالة', 'حالة الاعتماد', 'حالة الإجراء التصحيحي', 'حالة الإجراء الوقائي'];
  const pick = (labels: string[]): string | null => {
    const field = projected.fields.find((f) => labels.includes(f.label));
    return field ? field.value : null;
  };
  const candidates = [
    pick(dateLabels) ?? projected.fields[0]?.value ?? null,
    pick(typeLabels),
    pick(statusLabels),
  ].filter((v): v is string => typeof v === 'string' && v !== '');

  const metaLines = (candidates.length > 0
    ? candidates
    : projected.fields.slice(0, 3).map((f) => f.value)
  ).slice(0, 3);

  return {
    recordId,
    access,
    title: projected.title || collectionTitle,
    metaLines,
    rawId: recordId,
  };
}

/**
 * The primary presentation must never be a raw id (spec §29). This
 * helper is used by tests AND by the UI to assert the invariant:
 * the summary line shown large is human-readable, and the raw id
 * appears only in a dedicated secondary slot.
 */
export function summaryPrimaryText(summary: EvidenceSummaryView): string {
  return summary.metaLines.length > 0
    ? `${summary.title} — ${summary.metaLines.join(' · ')}`
    : summary.title;
}
