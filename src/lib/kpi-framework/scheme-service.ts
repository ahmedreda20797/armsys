// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — Scheme Service (Phase 1)
//
//  DB-bound orchestration for KPI scheme documents, following the
//  repository's existing data-access patterns (db.ts helpers, TTL
//  cache, idempotent seed like kpi-settings).
//
//  RTDB layout (additive — no existing table is touched):
//    arm_erp/kpiSchemes/{schemeId}
//    arm_erp/kpiSchemeOverrides/{employeeId}
//
//  Lifecycle rules:
//    • create   → DRAFT (version auto-increments per scheme NAME, so
//                 re-creating "Sales Employee KPI — 2026" yields v2
//                 linked via previousSchemeId).
//    • update   → DRAFT: full structural edits.
//                 ACTIVE: ONLY effectiveTo (window adjustment) and
//                 status → 'ARCHIVED' (retire). Structural changes
//                 require a new version — finalized historical
//                 results keep their own embedded scheme data and
//                 are never affected.
//    • activate → DRAFT only; enforces the exact-100% weight total
//                 and fails safely on conflicting ACTIVE schemes.
// ══════════════════════════════════════════════════════════════

import { createId } from '@paralleldrive/cuid2';
import {
  getAll,
  getById,
  createRecordWithId,
  updateRecord,
  deleteRecord,
  TTL,
} from '@/lib/db';
import type {
  KpiScheme,
  KpiSchemeComponent,
  KpiSchemeOverride,
  KpiComponentOwner,
  KpiComponentCalculationType,
} from './types';
import { KPI_SCHEMES_TABLE, KPI_SCHEME_OVERRIDES_TABLE, DEFAULT_KPI_SCHEME_ID } from './types';
import {
  validateSchemeInput,
  validateSchemeWeightTotal,
  findConflictingActiveSchemes,
  stripUndefinedForRtdb,
} from './validation';

/** Actor snapshot for lifecycle operations (same shape as SnapshotActor). */
export interface KpiFrameworkActor {
  id: string;
  name: string;
}

/**
 * A RULE violation (validation, weight total, conflict, lifecycle) —
 * routes map these to 400/409 responses. Anything else is a genuine
 * internal failure and stays a 500.
 */
export class KpiFrameworkValidationError extends Error {}

// ─────────────────────────────────────────────────────────────
//  Normalization (RTDB strips stored nulls → reads may be undefined)
// ─────────────────────────────────────────────────────────────

/** Sanitize a component configuration bag to RTDB-safe primitives. */
function sanitizeConfiguration(
  value: unknown,
): Record<string, number | string | boolean | null> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number | string | boolean | null> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof v === 'number' && Number.isFinite(v) ||
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      v === null
    ) {
      out[key] = v;
    }
  }
  return out;
}

/** Normalize one raw component (client/body or stored) to the safe shape. */
function normalizeComponent(raw: Record<string, unknown>): KpiSchemeComponent {
  return {
    componentId: String(raw.componentId ?? '').trim(),
    name: String(raw.name ?? '').trim(),
    weight: typeof raw.weight === 'number' && Number.isFinite(raw.weight) ? raw.weight : 0,
    owner: (raw.owner as KpiComponentOwner) ?? 'other',
    calculationType: (raw.calculationType as KpiComponentCalculationType) ?? 'none',
    status: raw.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    configuration: sanitizeConfiguration(raw.configuration),
  };
}

/** Normalize a stored scheme document (undefined ↔ null hygiene). */
export function normalizeKpiScheme(raw: Record<string, unknown> | null, id?: string): KpiScheme | null {
  if (!raw) return null;
  const recordId = typeof raw.id === 'string' && raw.id ? raw.id : id;
  if (!recordId) return null;
  return {
    id: recordId,
    schemaVersion: 1,
    name: String(raw.name ?? ''),
    description: typeof raw.description === 'string' ? raw.description : null,
    status: raw.status === 'ACTIVE' || raw.status === 'ARCHIVED' ? raw.status : 'DRAFT',
    version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1,
    effectiveFrom: String(raw.effectiveFrom ?? ''),
    effectiveTo: typeof raw.effectiveTo === 'string' ? raw.effectiveTo : null,
    isDefault: raw.isDefault === true,
    applicableDepartments: Array.isArray(raw.applicableDepartments)
      ? (raw.applicableDepartments as unknown[]).filter(
          (d): d is string => typeof d === 'string',
        )
      : null,
    components: Array.isArray(raw.components)
      ? (raw.components as Record<string, unknown>[]).map(normalizeComponent)
      : [],
    previousSchemeId: typeof raw.previousSchemeId === 'string' ? raw.previousSchemeId : null,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : null,
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  };
}

// ─────────────────────────────────────────────────────────────
//  Idempotent default scheme seed (pattern of kpi-settings)
// ─────────────────────────────────────────────────────────────

/**
 * The current ARM company KPI structure as scheme DATA (never
 * hardcoded into the engine): Quality 15 / Direct Manager 15 /
 * HR 10 / Target 60. Only Quality carries an implemented
 * calculationType; the rest are config-only future components.
 */
export const DEFAULT_KPI_SCHEME_COMPONENTS: KpiSchemeComponent[] = [
  {
    componentId: 'quality',
    name: 'الجودة',
    weight: 15,
    owner: 'quality',
    calculationType: 'quality_engine',
    status: 'ACTIVE',
    configuration: null,
  },
  {
    componentId: 'direct_manager',
    name: 'المدير المباشر',
    weight: 15,
    owner: 'management',
    calculationType: 'none',
    status: 'ACTIVE',
    configuration: null,
  },
  {
    componentId: 'hr',
    name: 'الموارد البشرية',
    weight: 10,
    owner: 'hr',
    calculationType: 'none',
    status: 'ACTIVE',
    configuration: null,
  },
  {
    componentId: 'target',
    name: 'المستهدف',
    weight: 60,
    owner: 'management',
    calculationType: 'none',
    status: 'ACTIVE',
    configuration: null,
  },
];

/**
 * Idempotently seed the default ACTIVE scheme (fixed document id, so
 * concurrent first reads overwrite the SAME document instead of
 * minting competing defaults).
 */
export async function ensureDefaultKpiSchemeSeed(): Promise<void> {
  const existing = await getById<KpiScheme>(KPI_SCHEMES_TABLE, DEFAULT_KPI_SCHEME_ID);
  if (existing) return;

  const now = new Date().toISOString();
  const seed: KpiScheme = {
    id: DEFAULT_KPI_SCHEME_ID,
    schemaVersion: 1,
    name: 'نظام مؤشرات أداء الشركة — 2026',
    description:
      'النظام الافتراضي لهيكل مؤشرات الشركة الحالي: الجودة 15%، المدير المباشر 15%، الموارد البشرية 10%، المستهدف 60%. مكوّن الجودة فقط محسوب حالياً عبر محرك الجودة.',
    status: 'ACTIVE',
    version: 1,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    isDefault: true,
    applicableDepartments: null,
    components: DEFAULT_KPI_SCHEME_COMPONENTS,
    previousSchemeId: null,
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,
  };
  await createRecordWithId(
    KPI_SCHEMES_TABLE,
    DEFAULT_KPI_SCHEME_ID,
    stripUndefinedForRtdb(seed) as unknown as Record<string, unknown>,
  );
}

// ─────────────────────────────────────────────────────────────
//  Reads
// ─────────────────────────────────────────────────────────────

/** List all schemes (seeds the default on first read). Newest first. */
export async function listKpiSchemes(): Promise<KpiScheme[]> {
  await ensureDefaultKpiSchemeSeed();
  const raw = await getAll<Record<string, unknown>>(KPI_SCHEMES_TABLE, TTL.STATIC);
  return raw
    .map((r) => normalizeKpiScheme(r, r?.id as string | undefined))
    .filter((s): s is KpiScheme => s !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Get one scheme by id (no seed — callers handle absence). */
export async function getKpiSchemeById(id: string): Promise<KpiScheme | null> {
  const raw = await getById<Record<string, unknown>>(KPI_SCHEMES_TABLE, id);
  return normalizeKpiScheme(raw, id);
}

// ─────────────────────────────────────────────────────────────
//  Create / update / activate
// ─────────────────────────────────────────────────────────────

/** Build the safe component list from a validated input payload. */
function buildComponents(rawComponents: Record<string, unknown>[]): KpiSchemeComponent[] {
  return rawComponents.map(normalizeComponent);
}

/** Next version number for a scheme name (v1 when the name is new). */
function nextVersionForName(schemes: ReadonlyArray<KpiScheme>, name: string): {
  version: number;
  previous: KpiScheme | null;
} {
  const sameName = schemes.filter((s) => s.name === name);
  if (sameName.length === 0) return { version: 1, previous: null };
  const latest = sameName.reduce((a, b) => (b.version > a.version ? b : a));
  return { version: latest.version + 1, previous: latest };
}

export interface CreateKpiSchemeInput {
  name: unknown;
  description?: unknown;
  effectiveFrom: unknown;
  effectiveTo?: unknown;
  isDefault?: unknown;
  applicableDepartments?: unknown;
  components: unknown;
}

/**
 * Create a scheme (always DRAFT). Weight-total validity is NOT
 * required at creation — activation enforces it.
 *
 * @throws Error with an Arabic message when validation fails.
 */
export async function createKpiScheme(
  input: CreateKpiSchemeInput,
  actor: KpiFrameworkActor,
): Promise<KpiScheme> {
  const check = validateSchemeInput(input);
  if (!check.valid) throw new KpiFrameworkValidationError(check.error ?? 'بيانات نظام المؤشرات غير صحيحة');

  const name = (input.name as string).trim();
  const effectiveTo =
    typeof input.effectiveTo === 'string' && input.effectiveTo.trim()
      ? input.effectiveTo.trim()
      : null;

  const departments =
    Array.isArray(input.applicableDepartments) && input.applicableDepartments.length > 0
      ? Array.from(
          new Set(
            (input.applicableDepartments as unknown[])
              .filter((d): d is string => typeof d === 'string' && !!d.trim())
              .map((d) => d.trim()),
          ),
        )
      : null;

  const existing = await getAll<Record<string, unknown>>(KPI_SCHEMES_TABLE, TTL.DEFAULT);
  const existingSchemes = existing
    .map((r) => normalizeKpiScheme(r, r?.id as string | undefined))
    .filter((s): s is KpiScheme => s !== null);
  const { version, previous } = nextVersionForName(existingSchemes, name);

  const now = new Date().toISOString();
  const scheme: KpiScheme = {
    id: createId(),
    schemaVersion: 1,
    name,
    description: typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : null,
    status: 'DRAFT',
    version,
    effectiveFrom: input.effectiveFrom as string,
    effectiveTo,
    isDefault: input.isDefault === true,
    applicableDepartments: departments,
    components: buildComponents(input.components as Record<string, unknown>[]),
    previousSchemeId: previous?.id ?? null,
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
  };

  await createRecordWithId(
    KPI_SCHEMES_TABLE,
    scheme.id,
    stripUndefinedForRtdb(scheme) as unknown as Record<string, unknown>,
  );
  return scheme;
}

export interface UpdateKpiSchemePatch {
  name?: unknown;
  description?: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
  isDefault?: unknown;
  applicableDepartments?: unknown;
  components?: unknown;
  status?: unknown;
}

/**
 * Update a scheme.
 *   DRAFT    → structural fields editable.
 *   ACTIVE   → ONLY effectiveTo and status:'ARCHIVED' (retire).
 *   ARCHIVED → immutable.
 *
 * @throws Error with an Arabic message when the change is not allowed.
 */
export async function updateKpiScheme(
  id: string,
  patch: UpdateKpiSchemePatch,
  actor: KpiFrameworkActor,
): Promise<KpiScheme> {
  const current = await getKpiSchemeById(id);
  if (!current) throw new KpiFrameworkValidationError('نظام المؤشرات غير موجود');

  if (current.status === 'ARCHIVED') {
    throw new KpiFrameworkValidationError('لا يمكن تعديل نظام مؤشرات مؤرشف');
  }

  const now = new Date().toISOString();

  if (current.status === 'ACTIVE') {
    // Structural changes on an ACTIVE scheme are forbidden — a new
    // version (same name, auto-incremented) must be created instead.
    const structural = [
      'name', 'description', 'effectiveFrom', 'isDefault',
      'applicableDepartments', 'components',
    ].some((k) => patch[k as keyof UpdateKpiSchemePatch] !== undefined);
    if (structural) {
      throw new KpiFrameworkValidationError('تعديل نظام نشط يتطلب إنشاء إصدار جديد بنفس الاسم');
    }

    // Retiring an ACTIVE scheme is always allowed.
    if (patch.status === 'ARCHIVED') {
      const updated = await updateRecord(KPI_SCHEMES_TABLE, id, {
        status: 'ARCHIVED',
        updatedAt: now,
      });
      return normalizeKpiScheme(updated as Record<string, unknown>, id)!;
    }

    // Otherwise only effectiveTo may move (window adjustment).
    if (patch.effectiveTo === undefined) {
      throw new KpiFrameworkValidationError('لا توجد حقول مسموح بتعديلها في نظام نشط');
    }

    const effectiveTo =
      patch.effectiveTo === null || patch.effectiveTo === ''
        ? null
        : patch.effectiveTo;
    const candidate: KpiScheme = { ...current, effectiveTo: effectiveTo as string | null };
    const conflicts = findConflictingActiveSchemes(candidate, await listAllSchemesRaw());
    const conflictOutsideSelf = conflicts.filter((c) => c.id !== id);
    if (conflictOutsideSelf.length > 0) {
      throw new KpiFrameworkValidationError(
        `تعديل تاريخ السريان يتعارض مع ${conflictOutsideSelf.length} نظام نشط آخر — لا يمكن اختيار نظام بشكل عشوائي`,
      );
    }
    const updated = await updateRecord(KPI_SCHEMES_TABLE, id, {
      effectiveTo: effectiveTo,
      updatedAt: now,
    });
    return normalizeKpiScheme(updated as Record<string, unknown>, id)!;
  }

  // ── DRAFT: full structural update with validation ──
  const merged = {
    name: patch.name !== undefined ? patch.name : current.name,
    description: patch.description !== undefined ? patch.description : current.description,
    effectiveFrom: patch.effectiveFrom !== undefined ? patch.effectiveFrom : current.effectiveFrom,
    effectiveTo: patch.effectiveTo !== undefined ? patch.effectiveTo : current.effectiveTo,
    applicableDepartments:
      patch.applicableDepartments !== undefined
        ? patch.applicableDepartments
        : current.applicableDepartments,
    components: patch.components !== undefined ? patch.components : current.components,
  };
  const check = validateSchemeInput(merged);
  if (!check.valid) throw new KpiFrameworkValidationError(check.error ?? 'بيانات نظام المؤشرات غير صحيحة');

  const departments =
    Array.isArray(merged.applicableDepartments) && merged.applicableDepartments.length > 0
      ? Array.from(
          new Set(
            (merged.applicableDepartments as unknown[])
              .filter((d): d is string => typeof d === 'string' && !!d.trim())
              .map((d) => d.trim()),
          ),
        )
      : null;

  const data = stripUndefinedForRtdb({
    name: (merged.name as string).trim(),
    description:
      typeof merged.description === 'string' && merged.description.trim()
        ? merged.description.trim()
        : null,
    effectiveFrom: merged.effectiveFrom,
    effectiveTo:
      typeof merged.effectiveTo === 'string' && merged.effectiveTo.trim()
        ? merged.effectiveTo.trim()
        : null,
    isDefault: patch.isDefault !== undefined ? patch.isDefault === true : current.isDefault,
    applicableDepartments: departments,
    components: buildComponents(merged.components as Record<string, unknown>[]),
    updatedAt: now,
    updatedBy: actor.id,
  });

  const updated = await updateRecord(KPI_SCHEMES_TABLE, id, data as Record<string, unknown>);
  return normalizeKpiScheme(updated as Record<string, unknown>, id)!;
}

/** Raw read used for conflict checks (bypasses the seed). */
async function listAllSchemesRaw(): Promise<KpiScheme[]> {
  const raw = await getAll<Record<string, unknown>>(KPI_SCHEMES_TABLE, TTL.DEFAULT);
  return raw
    .map((r) => normalizeKpiScheme(r, r?.id as string | undefined))
    .filter((s): s is KpiScheme => s !== null);
}

/**
 * Activate a DRAFT scheme. Enforces:
 *   • ACTIVE component weights total EXACTLY 100 (the 100% rule).
 *   • No conflicting ACTIVE scheme (same window + same resolution
 *     level) — activation FAILS instead of creating ambiguity.
 *
 * @throws Error with an Arabic message when activation is invalid.
 */
export async function activateKpiScheme(
  id: string,
  actor: KpiFrameworkActor,
): Promise<KpiScheme> {
  const current = await getKpiSchemeById(id);
  if (!current) throw new KpiFrameworkValidationError('نظام المؤشرات غير موجود');
  if (current.status !== 'DRAFT') {
    throw new KpiFrameworkValidationError('يمكن تفعيل مسودات أنظمة المؤشرات فقط');
  }

  const weightCheck = validateSchemeWeightTotal(current.components);
  if (!weightCheck.valid) throw new KpiFrameworkValidationError(weightCheck.error ?? 'مجموع الأوزان غير صحيح');

  const conflicts = findConflictingActiveSchemes(current, await listAllSchemesRaw());
  if (conflicts.length > 0) {
    throw new KpiFrameworkValidationError(
      `تعارض مع ${conflicts.length} نظام نشط آخر في نفس نطاق السريان — عدّل تواريخ السريان أولاً`,
    );
  }

  const updated = await updateRecord(KPI_SCHEMES_TABLE, id, {
    status: 'ACTIVE',
    updatedAt: new Date().toISOString(),
    activatedBy: actor.id,
  });
  return normalizeKpiScheme(updated as Record<string, unknown>, id)!;
}

// ─────────────────────────────────────────────────────────────
//  Employee-specific overrides
// ─────────────────────────────────────────────────────────────

export async function getKpiSchemeOverride(employeeId: string): Promise<KpiSchemeOverride | null> {
  const raw = await getById<Record<string, unknown>>(KPI_SCHEME_OVERRIDES_TABLE, employeeId);
  if (!raw) return null;
  return {
    id: employeeId,
    employeeId: String(raw.employeeId ?? employeeId),
    schemeId: String(raw.schemeId ?? ''),
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
    updatedAt: String(raw.updatedAt ?? ''),
  };
}

/**
 * Set (schemeId) or clear (null) an employee's scheme override.
 * Setting requires the target scheme to exist (any status — an
 * override to a DRAFT scheme simply will not resolve until it is
 * active, which the resolver reports explicitly).
 */
export async function setKpiSchemeOverride(
  employeeId: string,
  schemeId: string | null,
  actor: KpiFrameworkActor,
): Promise<KpiSchemeOverride | null> {
  if (!schemeId) {
    await deleteRecord(KPI_SCHEME_OVERRIDES_TABLE, employeeId);
    return null;
  }

  const scheme = await getKpiSchemeById(schemeId);
  if (!scheme) throw new KpiFrameworkValidationError('نظام المؤشرات المحدد غير موجود');

  const override: KpiSchemeOverride = {
    id: employeeId,
    employeeId,
    schemeId,
    updatedBy: actor.id,
    updatedAt: new Date().toISOString(),
  };
  await createRecordWithId(
    KPI_SCHEME_OVERRIDES_TABLE,
    employeeId,
    stripUndefinedForRtdb(override) as unknown as Record<string, unknown>,
  );
  return override;
}
