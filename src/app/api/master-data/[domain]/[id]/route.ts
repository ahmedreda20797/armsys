// ══════════════════════════════════════════════════════════════
//  /api/master-data/[domain]/[id] — Master Data item mutations
//
//  PUT    — update a simple-list record ('masterData' update).
//           isActive=false = deactivate: hidden from NEW-record
//           selectors only; historical records and reports untouched.
//  DELETE — delete a record ('masterData' delete).
//           §NO-HARD-DELETE — a record still referenced by the
//           domain's transactional table is REJECTED with its usage
//           count; the safe path is deactivation.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, getAll, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, notFoundError, validationError, internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import {
  SIMPLE_MASTER_DATA_DOMAINS,
  MASTER_DATA_KEY_PATTERN,
} from '@/lib/master-data/simple-lists';
import { isMasterDataSimpleDomain } from '@/types/master-data';
import type { MasterDataListItem } from '@/types/master-data';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string; id: string }> },
) {
  try {
    const { domain, id } = await params;
    if (!isMasterDataSimpleDomain(domain)) return notFoundError('نطاق بيانات مرجعية غير معروف');
    const def = SIMPLE_MASTER_DATA_DOMAINS[domain];

    const permCheck = await verifyPermission(request, 'masterData', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const existing = await getById<MasterDataListItem>(def.table, id);
    if (!existing) return notFoundError(`${def.entityLabel} غير موجود`);

    const body = await request.json();
    const actor = await resolveActor(permCheck.user?.id);

    const patch: Record<string, unknown> = {};
    const allowed = ['key', 'name', 'nameEn', 'isActive', 'sortOrder'];
    for (const field of allowed) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    // ── Validation (same contracts as the reference domain) ──
    if (patch.key !== undefined) {
      const key = String(patch.key).trim().toLowerCase().replace(/\s+/g, '_');
      if (!MASTER_DATA_KEY_PATTERN.test(key)) {
        return validationError('المعرّف البرمجي يجب أن يكون بأحرف لاتينية صغيرة وأرقام فقط (2-64)');
      }
      if (key !== existing.key) {
        const all = await getAll<MasterDataListItem>(def.table);
        if (all.some((r) => r.key === key && r.id !== id)) {
          return validationError('المعرّف البرمجي مستخدم بالفعل');
        }
      }
      patch.key = key;
    }
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) return validationError('الاسم العربي مطلوب');
      const willBeActive = patch.isActive !== undefined ? patch.isActive : existing.isActive !== false;
      if (willBeActive) {
        const all = await getAll<MasterDataListItem>(def.table);
        if (all.some((r) => r.id !== id && r.name.trim() === name && r.isActive !== false)) {
          return validationError(`يوجد ${def.entityLabel} نشط بنفس الاسم العربي`);
        }
      }
      patch.name = name;
    }
    if (patch.nameEn !== undefined) {
      const nameEn = String(patch.nameEn).trim();
      if (!nameEn) return validationError('الاسم الإنجليزي مطلوب');
      patch.nameEn = nameEn;
    }
    if (patch.isActive !== undefined && typeof patch.isActive !== 'boolean') {
      return validationError('قيمة التفعيل غير صالحة');
    }
    if (patch.sortOrder !== undefined) {
      const sortOrder = Number(patch.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        return validationError('ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب');
      }
      patch.sortOrder = sortOrder;
    }

    patch.updatedBy = actor.name;
    const updated = await updateRecord(def.table, id, patch);
    if (!updated) return notFoundError(`${def.entityLabel} غير موجود`);

    // ── Audit — deactivation / reactivation get explicit actions ──
    const deactivated = patch.isActive === false && existing.isActive !== false;
    const reactivated = patch.isActive === true && existing.isActive === false;
    const action = deactivated ? 'deactivate' : reactivated ? 'reactivate' : 'update';
    const details = deactivated
      ? `تعطيل ${def.entityLabel}: ${existing.name} — يمنع الاستخدام في السجلات الجديدة فقط`
      : reactivated
        ? `إعادة تفعيل ${def.entityLabel}: ${existing.name}`
        : `تعديل ${def.entityLabel}: ${existing.name}`;

    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action,
      entityType: domain,
      entityId: id,
      monthKey: null,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details,
    });

    return Response.json(updated);
  } catch (error) {
    logServerFailure('master-data/[domain]/[id]', 'PUT', error);
    return internalError();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string; id: string }> },
) {
  try {
    const { domain, id } = await params;
    if (!isMasterDataSimpleDomain(domain)) return notFoundError('نطاق بيانات مرجعية غير معروف');
    const def = SIMPLE_MASTER_DATA_DOMAINS[domain];

    const permCheck = await verifyPermission(request, 'masterData', 'delete');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const existing = await getById<MasterDataListItem>(def.table, id);
    if (!existing) return notFoundError(`${def.entityLabel} غير موجود`);

    // §NO-HARD-DELETE — referential guard over the canonical records.
    // A referenced vocabulary entry must be deactivated, never destroyed:
    // historical records keep their stored key and must remain resolvable.
    const usageRecords = await getAll<Record<string, unknown>>(def.usageTable);
    const usageCount = usageRecords.filter(
      (r) => r[def.usageField] === existing.key,
    ).length;
    if (usageCount > 0) {
      return validationError(
        `لا يمكن حذف هذا السجل: مستخدم في ${usageCount} سجل${usageCount === 1 ? '' : ''}. استخدم التعطيل بدلاً من الحذف — التعطيل يمنع الاستخدام الجديد فقط ولا يؤثر على السجلات التاريخية.`,
      );
    }

    await deleteRecord(def.table, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: domain,
      entityId: id,
      monthKey: null,
      before: { ...existing } as Record<string, unknown>,
      details: `حذف ${def.entityLabel}: ${existing.name}`,
    });

    return Response.json({ message: 'تم الحذف بنجاح' });
  } catch (error) {
    logServerFailure('master-data/[domain]/[id]', 'DELETE', error);
    return internalError();
  }
}
