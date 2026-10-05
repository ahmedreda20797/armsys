// ══════════════════════════════════════════════════════════════
//  Master Data — SIMPLE BUSINESS LISTS (server-side provider)
//
//  The canonical provider for the vocabulary domains served by
//  /api/master-data/[domain]: follow-up types, complaint types,
//  request types. Each domain owns its OWN RTDB table and its ONE
//  migration entrypoint (ensureSimpleMasterData) — the exact
//  doctrine of the reference domain (lib/observation-categories):
//
//    • Fresh install  → seeds the full canonical vocabulary.
//    • Existing install → inserts missing seed entries by key and
//      backfills ONLY missing fields (nameEn / isActive / sortOrder);
//      NEVER renames, deactivates or deletes anything.
//    • Idempotent     → a converged run performs ZERO writes.
//
//  §6 STABLE IDENTITY — transactional records store the record KEY.
//  The seeds reproduce the exact keys the codebase has always used,
//  so every existing record, filter, KPI grouping, repetition rule
//  and report stays resolvable. Labels (name/nameEn) are
//  presentation and may evolve through the management UI.
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { getAll, createRecord, updateRecord } from '@/lib/db';
import type {
  MasterDataListItem,
  MasterDataSimpleDomain,
} from '@/types/master-data';

/** Stable internal code: 2-64 chars of lowercase latin, digits, underscore or dash. */
export const MASTER_DATA_KEY_PATTERN = /^[a-z0-9_-]{2,64}$/;

export interface SimpleMasterDataDomainDef {
  id: MasterDataSimpleDomain;
  /** The RTDB collection holding the vocabulary. */
  table: string;
  /** The transactional collection whose records reference `key`. */
  usageTable: string;
  /** The transactional field that carries the key. */
  usageField: string;
  /** Human entity name for audit details. */
  entityLabel: string;
}

export const SIMPLE_MASTER_DATA_DOMAINS: Record<MasterDataSimpleDomain, SimpleMasterDataDomainDef> = {
  followUpTypes: {
    id: 'followUpTypes',
    table: 'followUpTypes',
    usageTable: 'followUps',
    usageField: 'followUpType',
    entityLabel: 'نوع متابعة',
  },
  complaintTypes: {
    id: 'complaintTypes',
    table: 'complaintTypes',
    usageTable: 'complaints',
    usageField: 'complaintType',
    entityLabel: 'نوع شكوى',
  },
  requestTypes: {
    id: 'requestTypes',
    table: 'requestTypes',
    usageTable: 'requests',
    usageField: 'type',
    entityLabel: 'نوع طلب',
  },
};

interface Seed {
  key: string;
  name: string;
  nameEn: string;
}

/**
 * The canonical vocabularies — the EXACT keys and labels the current
 * hardcoded lists carry (FollowUpsPage.TYPE_OPTIONS, inline-forms,
 * ComplaintsPage.COMPLAINT_TYPES, RequestsPage options + the
 * read-side request labels from getRequestTypeLabel). New seeds are
 * ADDITIONS ONLY — a record renamed by the administrator is never
 * touched.
 */
export const SIMPLE_MASTER_DATA_SEEDS: Record<MasterDataSimpleDomain, Seed[]> = {
  followUpTypes: [
    { key: 'quality', name: 'مشكلة جودة', nameEn: 'Quality Issue' },
    { key: 'attendance', name: 'مشكلة حضور', nameEn: 'Attendance Issue' },
    { key: 'behavior', name: 'مشكلة سلوك', nameEn: 'Behavior Issue' },
    { key: 'productivity', name: 'مشكلة أداء', nameEn: 'Productivity Issue' },
    { key: 'training', name: 'تدريب', nameEn: 'Training' },
    { key: 'coaching', name: 'توجيه / Couching', nameEn: 'Coaching' },
    { key: 'complaint', name: 'شكوى عميل', nameEn: 'Customer Complaint' },
    { key: 'positive', name: 'ملاحظة إيجابية', nameEn: 'Positive Note' },
    { key: 'improvement', name: 'فرصة تحسين', nameEn: 'Improvement Opportunity' },
    { key: 'other', name: 'أخرى', nameEn: 'Other' },
  ],
  complaintTypes: [
    { key: 'service_quality', name: 'جودة الخدمة', nameEn: 'Service Quality' },
    { key: 'pricing_error', name: 'خطأ في التسعير', nameEn: 'Pricing Error' },
    { key: 'communication', name: 'تواصل', nameEn: 'Communication' },
    { key: 'delay', name: 'تأخير', nameEn: 'Delay' },
    { key: 'product_issue', name: 'مشكلة في المنتج', nameEn: 'Product Issue' },
    { key: 'other', name: 'أخرى', nameEn: 'Other' },
  ],
  requestTypes: [
    { key: 'leave', name: 'إجازة', nameEn: 'Leave' },
    { key: 'permission', name: 'استئذان', nameEn: 'Early Departure' },
    { key: 'excuse', name: 'غياب', nameEn: 'Absence' },
    { key: 'tardiness', name: 'تأخير', nameEn: 'Tardiness' },
    { key: 'remote', name: 'ريموتلي', nameEn: 'Remote' },
    { key: 'mission', name: 'مهمة عمل', nameEn: 'Work Mission' },
    { key: 'salary_advance', name: 'سلفة', nameEn: 'Salary Advance' },
  ],
};

type SeedRecord = Omit<MasterDataListItem, 'id' | 'createdAt' | 'updatedAt'>;

function seedRecord(seed: Seed, sortOrder: number): SeedRecord {
  return {
    schemaVersion: 1,
    key: seed.key,
    name: seed.name,
    nameEn: seed.nameEn,
    isActive: true,
    sortOrder,
  };
}

/**
 * Pure idempotency check for ONE stored record against its seed
 * position: returns the missing master-data fields (never overwrites
 * a configured value) or null when the record is converged.
 */
export function buildSimpleListPatch(
  record: Partial<MasterDataListItem>,
  seed: Seed | undefined,
  position: number,
): Partial<MasterDataListItem> | null {
  const patch: Partial<MasterDataListItem> = {};
  if (record.nameEn === undefined || record.nameEn === null || record.nameEn === '') {
    if (seed) patch.nameEn = seed.nameEn;
  }
  if (record.isActive === undefined) patch.isActive = true;
  if (record.sortOrder === undefined || record.sortOrder === null) patch.sortOrder = position;
  return Object.keys(patch).length > 0 ? patch : null;
}


/**
 * §INACTIVE-VALUE-GUARD — the deactivation contract enforced where the
 * vocabulary is CONSUMED. Returns an Arabic error message when `value`
 * matches a master-data record of this domain whose isActive === false
 * (a deactivated type must not be selected for NEW records); null when
 * the value is acceptable. Unknown values (legacy free text, keys the
 * list does not know) are ACCEPTED — this is a deactivation guard,
 * never a whitelist: these APIs have always accepted string values and
 * historical data must stay writable.
 */
export async function assertSimpleValueIsActive(
  domain: MasterDataSimpleDomain,
  value: unknown,
): Promise<string | null> {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const def = SIMPLE_MASTER_DATA_DOMAINS[domain];
  const records = await getAll<MasterDataListItem>(def.table);
  const record = records.find((r) => r.key === value);
  if (record && record.isActive === false) {
    return `${def.entityLabel} المعطّل غير مسموح به في السجلات الجديدة — أعد تفعيله من البيانات المرجعية`;
  }
  return null;
}

/**
 * The ONE write path for bootstrapping/migrating a simple-list
 * domain. Idempotent and additive-only (see module header).
 */
export async function ensureSimpleMasterData(domain: MasterDataSimpleDomain): Promise<void> {
  const def = SIMPLE_MASTER_DATA_DOMAINS[domain];
  const seeds = SIMPLE_MASTER_DATA_SEEDS[domain];

  const existing = await getAll<MasterDataListItem>(def.table);
  const byKey = new Map(existing.map((r) => [r.key, r]));

  if (existing.length === 0) {
    // Fresh install — the full vocabulary in canonical order.
    for (let i = 0; i < seeds.length; i++) {
      await createRecord<MasterDataListItem>(def.table, seedRecord(seeds[i], i + 1));
    }
    return;
  }

  // Existing install — insert missing seed entries by key AFTER the
  // max existing sortOrder so the user's ordering is never disturbed.
  let maxSortOrder = existing.reduce((max, r) => Math.max(max, Number(r.sortOrder ?? 0)), 0);
  for (const seed of seeds) {
    if (byKey.has(seed.key)) continue;
    maxSortOrder += 1;
    await createRecord<MasterDataListItem>(def.table, seedRecord(seed, maxSortOrder));
  }

  // Backfill missing fields on records that predate a field.
  for (let i = 0; i < existing.length; i++) {
    const record = existing[i];
    const seed = seeds.find((s) => s.key === record.key);
    const patch = buildSimpleListPatch(record, seed, i + 1);
    if (patch) {
      await updateRecord(def.table, record.id, patch);
    }
  }
}
