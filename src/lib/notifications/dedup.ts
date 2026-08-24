// ══════════════════════════════════════════════════════════════
//  Notification deduplication predicates — Milestone 9
//
//  PURE functions (no db imports → unit-testable). Both existing
//  creation paths share this module instead of each rolling its
//  own duplicate scan:
//    • rules-engine.createSmartNotification  → findDuplicateByEntityKey
//    • notifications/quality-events          → findDuplicateByTitleOrRecord
//
//  Guards the Part D requirements: page refresh, repeated polling
//  and API retries must not create duplicate notifications.
// ══════════════════════════════════════════════════════════════

export interface DedupRecord {
  title?: string | null;
  employeeId?: string | null;
  sourceRecordId?: string | null;
  createdAt?: string | null;
}

export interface DedupCandidate {
  title: string;
  employeeId?: string | null;
  sourceRecordId?: string | null;
}

const norm = (v: string | null | undefined): string | null => (v ?? null);

/**
 * rules-engine key: title + employeeId + sourceRecordId (nulls
 * normalized). Caller should only invoke when the candidate carries
 * at least one entity key (employeeId or sourceRecordId).
 */
export function findDuplicateByEntityKey<T extends DedupRecord>(
  existing: T[],
  candidate: DedupCandidate,
  now: number,
  windowMs: number
): T | undefined {
  return existing.find((n) => {
    if (norm(n.title) !== candidate.title) return false;
    if (norm(n.employeeId) !== norm(candidate.employeeId)) return false;
    if (norm(n.sourceRecordId) !== norm(candidate.sourceRecordId)) return false;
    if (!n.createdAt) return false;
    return now - new Date(n.createdAt).getTime() < windowMs;
  });
}

/**
 * quality-events key: title + sourceRecordId when the notification
 * is entity-bound; title only otherwise (entity-less broadcasts such
 * as month close embed the distinguishing key in the title).
 */
export function findDuplicateByTitleOrRecord<T extends DedupRecord>(
  existing: T[],
  candidate: DedupCandidate,
  now: number,
  windowMs: number
): T | undefined {
  return existing.find((n) => {
    if (norm(n.title) !== candidate.title) return false;
    if (candidate.sourceRecordId && norm(n.sourceRecordId) !== norm(candidate.sourceRecordId)) {
      return false;
    }
    if (!n.createdAt) return false;
    return now - new Date(n.createdAt).getTime() < windowMs;
  });
}
