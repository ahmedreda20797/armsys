import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhere, createRecord, getById, sortByDateField, withEmployeeFull } from '@/lib/db';
import { verifyPermission, requireAuth, type AuthenticatedCaller } from '@/lib/verify-permission';
import { migratePermission } from '@/config/permissions';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { writeAudit } from '@/lib/audit';
import { isMonthClosed } from '@/lib/month-lock';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';
import {
  QUALITY_DEDUCTIONS_TABLE, deductionTypeLabel,
} from '@/lib/quality-deductions/domain';

/** Global quality audit trail table (same store observations use). */
export const AUDIT_LOG_TABLE = 'qualityAuditLog';

/** Audit fields that must NEVER reach a viewer without audit permission. */
const AUDIT_FIELDS = [
  'createdById', 'createdByUserId', 'createdByName', 'createdByEmail',
  'updatedBy', 'updatedByName',
] as const;

/**
 * §AUDIT-VISIBILITY — who may see who created/updated a discount:
 * any user granted the explicit audit permission (the qualityAuditLog
 * page — the System Owner's admin preset grants it automatically).
 * Everyone else gets the record WITHOUT its audit metadata — hiding
 * in the UI is not enough, the fields never leave the server.
 * (No role string checks here: the canonical permission map already
 * encodes the admin bypass — see resolveEffectivePermissions.)
 */
function viewerMaySeeAudit(user: AuthenticatedCaller): boolean {
  return migratePermission(user.permissions?.['qualityAuditLog']).level !== 'none';
}

function stripAuditMetadata<T extends Record<string, any>>(record: T): T {
  const out: Record<string, any> = { ...record };
  for (const field of AUDIT_FIELDS) delete out[field];
  // The approval history carries actor names (who approved) — same
  // audit sensitivity. The fast-query approvalStatus stays visible.
  if ('approvalHistory' in out) delete out.approvalHistory;
  return out as T;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM format

    let records = month
      ? await findWhere(QUALITY_DEDUCTIONS_TABLE, { month })
      : await getAll(QUALITY_DEDUCTIONS_TABLE);

    // ── READ SCOPE (M0.5) ──
    // Quality deductions are employee-linked; scope runs at the
    // retrieval boundary (after the month fetch, before sort and
    // enrichment). Scoring/points/deduction business values are
    // untouched — this changes WHICH rows are visible, never their
    // computation.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx);

    records = sortByDateField(records, 'createdAt', 'desc');
    const recordsWithEmployee = await withEmployeeFull(records as any[]);

    // §AUDIT-PRIVACY — strip creator/updater metadata + approval actor
    // names from the response unless the viewer holds explicit audit
    // permission. Legacy records keep working: approvalStatus stays
    // (projected), only the WHO fields are removed.
    const maySeeAudit = viewerMaySeeAudit(auth);
    const payload = maySeeAudit
      ? recordsWithEmployee
      : (recordsWithEmployee as any[]).map(stripAuditMetadata);

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Fetch quality deductions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'quality'
    const permCheck = await verifyPermission(request, 'quality', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, date, type, description, deductionDays, deductionAmount, evidence, month, relatedCapaId } = body;

    if (!employeeId || !date || !type || !month) {
      return NextResponse.json({ error: 'Employee ID, date, type, and month are required' }, { status: 400 });
    }

    // §WORKFLOW — closed months are immutable (same doctrine as the
    // quality observations engine).
    if (await isMonthClosed(month)) {
      return NextResponse.json({ error: `الشهر ${month} مغلق ولا يمكن إضافة خصومات إليه` }, { status: 423 });
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // Quality deductions are employee-linked records; the deduction
    // BUSINESS RULES are untouched — this is authorization only.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
    }

    // Validate employee exists and is active
    const { validateEmployeeId } = await import('@/lib/validate-employee');
    const empValidation = await validateEmployeeId(employeeId, true);
    if (!empValidation.valid) {
      return NextResponse.json({ error: empValidation.error }, { status: 400 });
    }

    // §AUDIT — full hidden audit metadata resolved SERVER-SIDE from
    // the authenticated caller (never client-supplied). The display
    // name resolves from the USERS table (resolveActor) so a user
    // without an employee record is still attributed correctly —
    // never "النظام" by accident, and never "غير مسجل" on new rows.
    const actor = await resolveActor(permCheck.user?.id);
    const userRecord = permCheck.user?.id
      ? await getById<{ name?: string; email?: string }>('users', permCheck.user.id)
      : null;

    // §WORKFLOW — a creator WITHOUT the approve permission produces a
    // PENDING discount that affects nothing until approved. A creator
    // WITH the permission (Quality Manager / System Owner) self-
    // approves with an explicit approval event — the history stays
    // truthful. The check goes through the canonical verifyPermission
    // gate (which owns the System Owner bypass) — no role strings,
    // no hardcoded emails.
    const approveCheck = await verifyPermission(request, 'quality', 'approve');
    const canApprove = approveCheck.allowed;

    const submitEvent = makeApprovalEvent({
      action: 'submit',
      actorId: actor.id,
      actorName: actor.name,
      notes: 'إنشاء خصم جودة',
    });
    const approvalHistory = canApprove
      ? appendApprovalEvent([submitEvent], makeApprovalEvent({
          action: 'approve',
          actorId: actor.id,
          actorName: actor.name,
          notes: 'اعتماد تلقائي — المنشئ يملك صلاحية الاعتماد',
        }))
      : [submitEvent];

    const qualityDeduction = await createRecord(QUALITY_DEDUCTIONS_TABLE, {
      employeeId,
      date,
      type,
      description: description || '',
      deductionDays: deductionDays || 0,
      deductionAmount: deductionAmount || 0,
      evidence: evidence || null,
      month,
      relatedCapaId: relatedCapaId || null,
      // ── hidden audit metadata (stripped from responses for
      // non-audit viewers — see GET) ──
      createdById: actor.id,
      createdByUserId: actor.id,
      createdByName: actor.name,
      createdByEmail: userRecord?.email || null,
      // ── approval workflow ──
      approvalStatus: projectLatestApprovalStatus(approvalHistory),
      approvalHistory,
    });

    // Fire-and-forget audit trail + automation event.
    void writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'create',
      entityType: 'qualityDeduction',
      entityId: qualityDeduction.id,
      monthKey: month,
      before: null,
      after: {
        employeeId, date, type, description: description || '',
        deductionDays: deductionDays || 0, deductionAmount: deductionAmount || 0,
        approvalStatus: qualityDeduction.approvalStatus,
      },
      details: `إضافة خصم ${deductionTypeLabel(type)} — الحالة: ${qualityDeduction.approvalStatus === 'pending' ? 'قيد الاعتماد' : 'معتمد'}`,
    });
    void dispatchAutomationEvent('record_created', 'quality', {
      employeeId,
      status: qualityDeduction.approvalStatus,
      category: type,
      sourceRecordId: qualityDeduction.id,
      extra: { month, deductionDays: deductionDays || 0 },
    });

    return NextResponse.json(qualityDeduction, { status: 201 });
  } catch (error) {
    console.error('Create quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
