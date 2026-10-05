// ══════════════════════════════════════════════════════════════
//  /api/master-data/[domain] — Master Data: SIMPLE BUSINESS LISTS
//
//  The SINGLE canonical API for the simple vocabulary domains
//  (followUpTypes | complaintTypes | requestTypes). Parameterized by
//  the whitelisted domain registry — NOT a second settings
//  architecture: same contracts, validation, audit and db helpers as
//  the reference /api/observation-categories family.
//
//  GET   — sorted list (ensure migration runs first — idempotent).
//          ?withUsage=1 attaches usageCount from the domain's
//          transactional table (one grouped read, never per-row).
//  POST  — create a record ('masterData' create).
//  PUT   — reorder: body { reorder: [id, …] } — the FULL ordered id
//          list; each position becomes sortOrder = index + 1.
//
//  AUTHORIZATION — the canonical 'masterData' permission key (the
//  Settings → Master Data administration grant). Existing grants are
//  untouched: quality observation categories keep their own
//  'observationCategories' key and API.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecord, updateRecords } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, unauthorizedError, forbiddenError,
  internalError, logServerFailure, notFoundError,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import {
  SIMPLE_MASTER_DATA_DOMAINS,
  MASTER_DATA_KEY_PATTERN,
  ensureSimpleMasterData,
} from '@/lib/master-data/simple-lists';
import { sortListItems } from '@/lib/master-data/simple-list-presentation';
import { isMasterDataSimpleDomain } from '@/types/master-data';
import type { MasterDataListItem } from '@/types/master-data';

function isFiniteNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  try {
    const { domain } = await params;
    if (!isMasterDataSimpleDomain(domain)) return notFoundError('نطاق بيانات مرجعية غير معروف');
    const def = SIMPLE_MASTER_DATA_DOMAINS[domain];

    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'masterData', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    // Idempotent master-data ensure (bootstrap / additive migration).
    await ensureSimpleMasterData(domain);

    const records = await getAll<MasterDataListItem>(def.table);

    // Management-UI usage counts — ONE grouped read of the domain's
    // transactional table, never per-row reads.
    const withUsage = new URL(request.url).searchParams.get('withUsage') === '1';
    let enriched: (MasterDataListItem & { usageCount?: number })[] = records;
    if (withUsage) {
      const usageRecords = await getAll<Record<string, unknown>>(def.usageTable);
      const usage = new Map<string, number>();
      for (const rec of usageRecords) {
        const key = rec[def.usageField];
        if (typeof key === 'string' && key) usage.set(key, (usage.get(key) ?? 0) + 1);
      }
      enriched = records.map((r) => ({ ...r, usageCount: usage.get(r.key) ?? 0 }));
    }

    return Response.json(sortListItems(enriched));
  } catch (error) {
    logServerFailure('master-data/[domain]', 'GET', error);
    return internalError();
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  try {
    const { domain } = await params;
    if (!isMasterDataSimpleDomain(domain)) return notFoundError('نطاق بيانات مرجعية غير معروف');
    const def = SIMPLE_MASTER_DATA_DOMAINS[domain];

    const permCheck = await verifyPermission(request, 'masterData', 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { name, nameEn } = body;
    const key = typeof body.key === 'string' ? body.key.trim().toLowerCase().replace(/\s+/g, '_') : '';

    if (!key || !name) {
      return validationError('المعرّف البرمجي والاسم العربي مطلوبان');
    }
    if (!MASTER_DATA_KEY_PATTERN.test(key)) {
      return validationError('المعرّف البرمجي يجب أن يكون بأحرف لاتينية صغيرة وأرقام فقط (2-64)');
    }
    const nameTrimmed = String(name).trim();
    const nameEnTrimmed = typeof nameEn === 'string' ? nameEn.trim() : '';
    if (!nameEnTrimmed) {
      return validationError('الاسم الإنجليزي مطلوب');
    }

    // §DUPLICATE-PREVENTION — canonical business identity:
    //  (1) the stable key is unique across ALL records;
    //  (2) no second ACTIVE record may carry the same Arabic name.
    const existing = await getAll<MasterDataListItem>(def.table);
    if (existing.some((r) => r.key === key)) {
      return validationError(`المعرّف البرمجي مستخدم بالفعل في ${def.entityLabel}`);
    }
    if (existing.some((r) => r.name.trim() === nameTrimmed && r.isActive !== false)) {
      return validationError(`يوجد ${def.entityLabel} نشط بنفس الاسم العربي`);
    }

    let effectiveSortOrder: number;
    if (body.sortOrder !== undefined) {
      const requested = Number(body.sortOrder);
      if (!isFiniteNonNegativeInt(requested)) {
        return validationError('ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب');
      }
      effectiveSortOrder = requested;
    } else {
      effectiveSortOrder = existing.reduce((max, r) => Math.max(max, Number(r.sortOrder ?? 0)), 0) + 1;
    }

    const actor = await resolveActor(permCheck.user?.id);

    const record = await createRecord<MasterDataListItem>(def.table, {
      schemaVersion: 1,
      key,
      name: nameTrimmed,
      nameEn: nameEnTrimmed,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      sortOrder: effectiveSortOrder,
      createdBy: actor.name,
      updatedBy: actor.name,
    });

    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'create',
      entityType: domain,
      entityId: record.id,
      monthKey: null,
      after: { ...record } as Record<string, unknown>,
      details: `إنشاء ${def.entityLabel}: ${record.name}`,
    });

    return Response.json(record, { status: 201 });
  } catch (error) {
    logServerFailure('master-data/[domain]', 'POST', error);
    return internalError();
  }
}

/**
 * PUT — reorder. Body: { reorder: [id, …] } — the FULL ordered list
 * of the domain's record ids. Each position becomes
 * sortOrder = index + 1. Audited as a single "reorder" mutation.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  try {
    const { domain } = await params;
    if (!isMasterDataSimpleDomain(domain)) return notFoundError('نطاق بيانات مرجعية غير معروف');
    const def = SIMPLE_MASTER_DATA_DOMAINS[domain];

    const permCheck = await verifyPermission(request, 'masterData', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const reorder: unknown = body?.reorder;
    if (!Array.isArray(reorder) || reorder.some((id) => typeof id !== 'string')) {
      return validationError('صيغة الترتيب غير صالحة');
    }

    const records = await getAll<MasterDataListItem>(def.table);
    const knownIds = new Set(records.map((r) => r.id));
    const requestedIds = reorder as string[];
    if (requestedIds.length !== records.length || requestedIds.some((id) => !knownIds.has(id))) {
      return validationError('قائمة الترتيب يجب أن تحتوي على جميع السجلات دون تكرار');
    }

    const updatesById: Record<string, Record<string, unknown>> = {};
    requestedIds.forEach((id, index) => {
      updatesById[id] = { sortOrder: index + 1 };
    });
    await updateRecords(def.table, updatesById);

    const actor = await resolveActor(permCheck.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'reorder',
      entityType: domain,
      entityId: 'collection',
      monthKey: null,
      after: { order: requestedIds },
      details: `إعادة ترتيب ${def.entityLabel}`,
    });

    return Response.json({ message: 'تم تحديث الترتيب' });
  } catch (error) {
    logServerFailure('master-data/[domain]', 'PUT', error);
    return internalError();
  }
}
