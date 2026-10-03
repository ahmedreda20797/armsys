// ══════════════════════════════════════════════════════════════
//  §COMPLAINT-STATUS — THE canonical complaint status layer
//
//  The canonical vocabulary is the CustomerComplaint type's own:
//    open | under_investigation | pending_resolution | resolved | closed
//
//  HISTORICAL INCONSISTENCY (fixed here, once): the Complaints page
//  select used to write the off-canonical value 'investigating', so
//  stored rows carried BOTH variants while server-side aggregators
//  counted only one of them — an 'investigating' row vanished from
//  the open counts (operations-analysis / risk-center / employee-360)
//  and an 'under_investigation' row vanished from the page's own
//  stats. This module is the single normalization point:
//
//    • normalizeComplaintStatus — maps legacy aliases onto the
//      canonical vocabulary (write paths persist canonical values;
//      read paths display/aggregate canonically).
//    • isOpenComplaintStatus / isClosedComplaintStatus — the ONE
//      open/terminal predicates every consumer shares. UNRECOGNIZED
//      values are fail-safe: not proven closed → counted open for
//      risk, never counted resolved.
// ══════════════════════════════════════════════════════════════

import type { CustomerComplaint } from '@/types';

/** The canonical status vocabulary (verbatim from CustomerComplaint). */
export const COMPLAINT_STATUSES = [
  'open',
  'under_investigation',
  'pending_resolution',
  'resolved',
  'closed',
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Legacy spellings written by older UI versions → canonical value. */
const LEGACY_ALIASES: Readonly<Record<string, ComplaintStatus>> = {
  investigating: 'under_investigation',
};

function isCanonical(value: string): value is ComplaintStatus {
  return (COMPLAINT_STATUSES as readonly string[]).includes(value);
}

/**
 * Map ANY stored/client value onto the canonical vocabulary.
 * Returns null for unrecognized values (callers decide: writes
 * reject, reads keep the raw string for display).
 */
export function normalizeComplaintStatus(value: unknown): ComplaintStatus | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (isCanonical(trimmed)) return trimmed;
  return LEGACY_ALIASES[trimmed] ?? null;
}

const OPEN_SET: ReadonlySet<ComplaintStatus> = new Set([
  'open',
  'under_investigation',
  'pending_resolution',
]);

const CLOSED_SET: ReadonlySet<ComplaintStatus> = new Set(['resolved', 'closed']);

/**
 * THE open predicate — canonical statuses plus fail-safe handling of
 * unrecognized/legacy values: anything not proven terminal counts as
 * open (an unknown state must never lower a risk count).
 */
export function isOpenComplaintStatus(value: unknown): boolean {
  const normalized = normalizeComplaintStatus(value);
  if (normalized) return OPEN_SET.has(normalized);
  // Unrecognized → not proven closed → open (fail-safe).
  return typeof value === 'string' && value.trim().length > 0;
}

/** THE terminal predicate — only the two canonical terminal values. */
export function isClosedComplaintStatus(value: unknown): boolean {
  const normalized = normalizeComplaintStatus(value);
  return normalized !== null && CLOSED_SET.has(normalized);
}

/** Resolve a display/aggregation value: canonical status or null. */
export function complaintStatusOf(complaint: Pick<CustomerComplaint, 'status'>): ComplaintStatus | null {
  return normalizeComplaintStatus(complaint.status);
}
