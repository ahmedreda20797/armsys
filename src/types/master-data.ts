// ══════════════════════════════════════════════════════════════
//  Master Data — simple business-list record type (§MASTER-DATA)
//
//  The canonical schema for the Master Data & System Lists domains
//  that are pure vocabularies (follow-up types, complaint types,
//  request types). ONE schema for the whole family — the same field
//  names the reference domain (ObservationCategory) already uses for
//  its master-data fields — never a second schema.
//
//  Records store a STABLE machine `key` plus bilingual labels
//  (name / nameEn). Transactional records (follow-ups, complaints,
//  requests) reference the key — presentation labels may change by
//  language, the stored business data never does (§6).
// ══════════════════════════════════════════════════════════════

export interface MasterDataListItem {
  id: string;
  schemaVersion: 1;
  /** Stable machine key — the value transactional records store. */
  key: string;
  /** Arabic label. */
  name: string;
  /** English label. */
  nameEn: string;
  /** Inactive = hidden from NEW-record selectors only; history untouched. */
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

/** A list item enriched with its transactional usage count (management UI). */
export type MasterDataListItemWithUsage = MasterDataListItem & { usageCount?: number };

/** The simple-list domain ids served by /api/master-data/[domain]. */
export type MasterDataSimpleDomain = 'followUpTypes' | 'complaintTypes' | 'requestTypes';

export const MASTER_DATA_SIMPLE_DOMAINS: readonly MasterDataSimpleDomain[] = [
  'followUpTypes',
  'complaintTypes',
  'requestTypes',
];

export function isMasterDataSimpleDomain(value: string): value is MasterDataSimpleDomain {
  return (MASTER_DATA_SIMPLE_DOMAINS as readonly string[]).includes(value);
}
