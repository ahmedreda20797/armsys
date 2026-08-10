// ══════════════════════════════════════════════════════════════
//  /api/quality-migration
//
//  POST — migrate existing qualityDeductions into qualityObservations.
//
//  This is a one-time admin operation. Each qualityDeduction becomes
//  an approved observation with applyPointDeduction=true and an auto-
//  approved approval history (no manager approval needed for migrated
//  records — they represent historical data already applied).
//
//  IDEMPOTENT: tracks migrated source IDs to avoid duplicates.
//  Permission: admin only.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecord, findWhere, getEmployeeMap, TTL } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { makeAuditEvent, writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import type { QualityObservation, ApprovalEvent } from '@/types/quality-kpi';
import type { QualityDeduction } from '@/types';

const SOURCE_TABLE = 'qualityDeductions';
const TARGET_TABLE = 'qualityObservations';
const MIGRATION_MARKER = 'migration_source_id';

/** Derive a YYYY-MM month key from a DD/MM/YYYY or ISO date string. */
function deriveMonth(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'observations', 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const actor = await resolveActor(permCheck.user?.id);

    // Load all existing qualityDeductions.
    const deductions = await getAll<QualityDeduction>(SOURCE_TABLE, TTL.STATIC);
    if (deductions.length === 0) {
      return Response.json({ message: 'لا توجد خصومات جودة للترحيل', migrated: 0 });
    }

    // Check which ones have already been migrated (idempotent guard).
    const existingObs = await getAll<QualityObservation>(TARGET_TABLE, TTL.MEDIUM);
    const migratedIds = new Set<string>();
    for (const obs of existingObs) {
      // Check for migration marker in notes or a hidden field.
      // We use a convention: observations created by migration have
      // createdByName = 'system_migration' and we match by a map.
    }
    // Build a set of already-migrated source IDs by finding observations
    // whose notes contain the migration marker.
    for (const obs of existingObs) {
      if (obs.createdByName === '__system_migration__' && obs.notes) {
        const match = obs.notes.match(/\[source:([^\]]+)\]/);
        if (match) migratedIds.add(match[1]);
      }
    }

    const empMap = await getEmployeeMap();

    // Resolve a default category (use the first one or a known key).
    const categories = await getAll<{ id: string; name: string; weight: number; defaultPointValue: number }>('observationCategories', TTL.STATIC);
    const defaultCat = categories[0] || { id: 'migrated', name: 'خصم مرحل', weight: 1, defaultPointValue: 1 };

    let migratedCount = 0;
    let skippedCount = 0;

    for (const ded of deductions) {
      // Skip already-migrated records.
      if (migratedIds.has(ded.id)) {
        skippedCount++;
        continue;
      }

      const emp = empMap.get(ded.employeeId);
      const employeeName = emp?.name || 'غير معروف';
      const department = emp?.department || 'غير محدد';
      const positionSnapshot = emp?.position || '';

      // Build auto-approved history (historical data, no manager review needed).
      const approveEvent = makeApprovalEvent({
        action: 'approve',
        actorId: '__system_migration__',
        actorName: 'ترحيل تلقائي',
        notes: 'ترحيل تلقائي من خصومات الجودة القديمة',
      });
      const approvalHistory: ApprovalEvent[] = appendApprovalEvent([], approveEvent);

      const auditEvent = makeAuditEvent({
        action: 'create',
        actorId: actor.id,
        actorName: actor.name,
        details: `ترحيل خصم جودة: ${ded.description || ded.type}`,
      });

      // Use deductionDays as points (the old system tracked days, new tracks points).
      const points = ded.deductionDays || ded.deductionAmount || 1;
      const month = deriveMonth(ded.date);

      await createRecord<QualityObservation>(TARGET_TABLE, {
        schemaVersion: 1,
        employeeId: ded.employeeId,
        employeeName,
        department,
        positionSnapshot,
        observerId: actor.id,
        observerName: actor.name,
        observationDate: ded.date,
        month,
        type: ded.type,
        severity: 'medium',
        categoryId: defaultCat.id,
        categoryName: defaultCat.name,
        categoryWeight: defaultCat.weight,
        notes: `[source:${ded.id}] ${ded.description || ''}`.trim(),
        evidence: ded.evidence || '',
        status: 'closed',
        relatedCapaId: ded.relatedCapaId || null,
        correctiveAction: '',
        dueDate: null,
        resolvedDate: ded.createdAt,
        applyPointDeduction: true,
        points,
        isBonus: false,
        approvalStatus: projectLatestApprovalStatus(approvalHistory),
        approvalHistory,
        auditLog: [auditEvent],
        createdById: actor.id,
        createdByName: '__system_migration__',
        clientRequestId: null,
      });

      migratedCount++;
    }

    // Audit trail for the migration run.
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'migration',
      entityType: 'observation',
      entityId: 'batch_migration',
      monthKey: null,
      after: {
        totalSource: deductions.length,
        migrated: migratedCount,
        skipped: skippedCount,
      } as Record<string, unknown>,
      details: `ترحيل خصومات الجودة: ${migratedCount} تم ترحيلها، ${skippedCount} تم تخطيها`,
    });

    return Response.json({
      message: `تم ترحيل ${migratedCount} خصم جودة بنجاح`,
      totalSource: deductions.length,
      migrated: migratedCount,
      skipped: skippedCount,
    });
  } catch (error) {
    logServerFailure('quality-migration', 'POST', error);
    return internalError();
  }
}
