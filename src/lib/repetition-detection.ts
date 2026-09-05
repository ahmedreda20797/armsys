// ══════════════════════════════════════════════════════════════
//  Repetition Detection — deterministic rules (Milestone 7 §8)
//
//  "If the same employee repeatedly has substantially the same
//   problem, identify the repetition and surface a CAPA workflow."
//
//  DETERMINISM DOCTRINE:
//    • No AI/LLM. Grouping uses EXISTING stored fields only — the
//      same basis performance-intelligence documents for its
//      RepeatedIssuesFacts (category/type per domain taxonomy).
//    • Domains are grouped SEPARATELY: complaintType, followUpType
//      and observation categoryId are DIFFERENT taxonomies — a
//      cross-source key match would fabricate similarity.
//    • Thresholds are CONFIGURABLE and default to the two values
//      already established in this codebase:
//        minOccurrences = DEFAULT_MIN_OCCURRENCES (2) —
//            performance-intelligence/quality-analysis
//        windowDays     = 30 — the risk-center rule documented in
//            metrics/riskMetrics ("same follow-up type within 30 days")
//    • Every alert carries its source records — explainable and
//      auditable; nothing is merged or deleted.
// ══════════════════════════════════════════════════════════════

import { DEFAULT_MIN_OCCURRENCES } from '@/lib/performance-intelligence/quality-analysis';

/** One operational record participating in repetition detection. */
export interface RepetitionRecord {
  id: string;
  employeeId: string | null;
  /** Grouping key — the domain's OWN stored taxonomy field verbatim. */
  issueKey: string;
  /** Display label (categoryName / type) as stored. */
  issueLabel: string;
  /** Day the record is attributed to (YYYY-MM-DD slice of stored date). */
  day: string;
  source: 'followUp' | 'complaint' | 'observation';
}

/** Configurable rule — no embedded magic numbers. */
export interface RepetitionRuleConfig {
  /** Distinct occurrences within the window that trigger the alert. */
  minOccurrences: number;
  /** Rolling window in days (records older than now−windowDays are excluded). */
  windowDays: number;
}

/** Defaults derived from the codebase's OWN established constants. */
export const DEFAULT_REPETITION_RULE: RepetitionRuleConfig = {
  minOccurrences: DEFAULT_MIN_OCCURRENCES,
  windowDays: 30,
};

/** One detected repetition (same employee + same issue key, in window). */
export interface RepetitionAlert {
  employeeId: string;
  issueKey: string;
  issueLabel: string;
  source: RepetitionRecord['source'];
  /** Records INSIDE the window that triggered the alert (evidence). */
  occurrenceCount: number;
  firstDay: string;
  lastDay: string;
  records: RepetitionRecord[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the record's day falls inside the rolling window. */
function withinWindow(day: string, now: Date, windowDays: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(day)) return false;
  const recordMs = new Date(`${day}T12:00:00.000Z`).getTime();
  if (Number.isNaN(recordMs)) return false;
  // Midday anchors avoid DST/UTC calendar drift on both boundaries.
  const startMs = now.getTime() - windowDays * DAY_MS;
  return recordMs >= startMs && recordMs <= now.getTime() + DAY_MS;
}

/**
 * Detect repetitions across the supplied (already permission- and
 * scope-filtered) records. Pure — injectable clock for tests.
 *
 * A group triggers when the SAME (employeeId, source, issueKey) has
 * ≥ minOccurrences records inside the rolling window. Output is
 * deterministic: sorted by occurrence count desc, then employeeId,
 * then issueKey.
 */
export function detectRepetitions(
  records: ReadonlyArray<RepetitionRecord>,
  now: Date = new Date(),
  config: RepetitionRuleConfig = DEFAULT_REPETITION_RULE,
): RepetitionAlert[] {
  const groups = new Map<string, RepetitionRecord[]>();
  for (const record of records) {
    if (!record.employeeId || !record.issueKey) continue;
    if (!withinWindow(record.day, now, config.windowDays)) continue;
    const key = `${record.employeeId}::${record.source}::${record.issueKey}`;
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  const alerts: RepetitionAlert[] = [];
  for (const [key, list] of groups) {
    if (list.length < config.minOccurrences) continue;
    const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
    const [employeeId, source, issueKey] = key.split('::');
    alerts.push({
      employeeId,
      issueKey,
      issueLabel: sorted[0].issueLabel,
      source: source as RepetitionRecord['source'],
      occurrenceCount: sorted.length,
      firstDay: sorted[0].day,
      lastDay: sorted[sorted.length - 1].day,
      records: sorted,
    });
  }

  return alerts.sort(
    (a, b) =>
      b.occurrenceCount - a.occurrenceCount ||
      a.employeeId.localeCompare(b.employeeId) ||
      a.issueKey.localeCompare(b.issueKey),
  );
}

/**
 * CAPA pre-fill payload for one alert — feeds the EXISTING CAPA
 * create workflow (the exact defaultValues contract consumed by
 * CAPAQuickCreate). The latest record becomes the canonical single
 * link (relatedFollowUpId / relatedComplaintId — the fields the CAPA
 * model stores; observations have no single-link field today, their
 * ids stay in the description); the full evidence list lives in the
 * description. Traceable, nothing merged.
 */
export function buildCapaPrefillFromAlert(
  alert: RepetitionAlert,
  employeeName: string | null,
): Record<string, string> {
  const sourceLabel =
    alert.source === 'followUp' ? 'متابعة' : alert.source === 'complaint' ? 'شكوى' : 'ملاحظة جودة';
  const latestId = alert.records[alert.records.length - 1].id;
  const link: Record<string, string> = {};
  if (alert.source === 'followUp') link.relatedFollowUpId = latestId;
  else if (alert.source === 'complaint') link.relatedComplaintId = latestId;

  return {
    title: `مشكلة متكررة — ${alert.issueLabel}`,
    employeeId: alert.employeeId,
    priority: 'medium',
    problemDescription:
      `تكرار «${alert.issueLabel}» ${alert.occurrenceCount} مرات خلال آخر 30 يوماً` +
      ` (${alert.firstDay} → ${alert.lastDay}).` +
      (employeeName ? ` الموظف: ${employeeName}.` : '') +
      ` السجلات (${sourceLabel}): ${alert.records.map((r) => r.id).join('، ')}`,
    source: 'repetition',
    ...link,
  };
}
