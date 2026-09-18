import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhere, createRecord, getById, sortByDateField, withEmployeeFull } from '@/lib/db';
import { verifyPermission, requireAuth, type AuthenticatedCaller } from '@/lib/verify-permission';
import { maySeeAuditIdentity, stripAuditIdentity } from '@/lib/audit/audit-identity';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { writeAudit } from '@/lib/audit';
import { isMonthClosed } from '@/lib/month-lock';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';
import { notifyQualityDiscountPending } from '@/lib/notifications/quality-approval-events';
import {
  QUALITY_DEDUCTIONS_TABLE, deductionTypeLabel,
} from '@/lib/quality-deductions/domain';

/** Global quality audit trail table (same store observations use). */
export const AUDIT_LOG_TABLE = 'qualityAuditLog';

/**
 * §AUDIT-VISIBILITY (§2) — who may see who created/updated a discount:
 * the canonical audit-identity rule shared with the observations route
 * (src/lib/audit/audit-identity.ts — 'qualityAuditLog' page permission
 * + System Owner bypass). Everyone else gets the record WITHOUT its
 * audit metadata — hiding in the UI is not enough, the fields never
 * leave the server. (No role strings, no hardcoded emails: the
 * centralized permission map encodes the bypass.)
 */
function viewerMaySeeAudit(user: AuthenticatedCaller): boolean {
  return maySeeAuditIdentity(user.role, user.permissions);
}

function stripAuditMetadata<T extends Record<string, any>>(record: T): T {
  return stripAuditIdentity(record as unknown as Record<string, unknown>) as T;
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

    // §ARCHIVE — archived deductions never appear in the ACTIVE list.
    // Historical views opt in explicitly with ?includeArchived=1
    // (records keep their archived flag so the UI can badge them).
    const includeArchived = searchParams.get('includeArchived') === '1';
    if (!includeArchived) {
      records = records.filter((r: any) => r.archived !== true);
    }

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

    // §WORKFLOW (UNIFORM APPROVAL) — EVERY quality discount enters the
    // workflow as PENDING, regardless of who created it. The decision
    // authority (approve/reject) is exercised through the dedicated
    // approve/reject routes gated by the 'approve' action — creation
    // and approval are deliberately separate authorities, so reports
    // and KPIs only ever see REVIEWED discounts. The System Owner and
    // any granted Quality Manager approve from the pending list (or
    // the bell notification) immediately after creating.
    const submitEvent = makeApprovalEvent({
      action: 'submit',
      actorId: actor.id,
      actorName: actor.name,
      notes: 'إنشاء خصم جودة',
    });
    const approvalHistory = [submitEvent];

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
      details: `إضافة خصم ${deductionTypeLabel(type)} — الحالة: قيد الاعتماد`,
    });
    void dispatchAutomationEvent('record_created', 'quality', {
      employeeId,
      status: qualityDeduction.approvalStatus,
      category: type,
      sourceRecordId: qualityDeduction.id,
      extra: { month, deductionDays: deductionDays || 0 },
    });

    // §APPROVAL-NOTIFY — every PENDING discount notifies the users who
    // hold the quality approve/reject authority (permission-routed,
    // never the creator themself). Bell badge increments via the
    // existing real-time notification feed; opening the notification
    // lands on the quality page focused on this record.
    void (async () => {
      try {
        const employee = await getById<{ name?: string }>('employees', employeeId);
        await notifyQualityDiscountPending({
          recordId: qualityDeduction.id,
          employeeName: employee?.name ?? null,
          employeeId,
          typeLabel: deductionTypeLabel(type),
          deductionDays: deductionDays || 0,
          deductionAmount: deductionAmount || 0,
          actorId: actor.id,
          creatorName: actor.name,
        });
      } catch { /* never break the primary operation */ }
    })();

    return NextResponse.json(qualityDeduction, { status: 201 });
  } catch (error) {
    console.error('Create quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
