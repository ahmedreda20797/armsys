import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getAll, createRecordWithId, sortByDateField, withEmployee } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import {
  assertAttachableEvidenceImages,
  evidenceImageItems,
  sanitizeEvidenceItems,
  stampEvidenceItems,
} from '@/lib/evidence-items';
import { deleteEvidenceObjects, promoteEvidenceImages } from '@/lib/evidence-storage';
import { FirebaseConfigError } from '@/lib/firebase-server';
import type { EvidenceItem } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // §28 SECURITY — explicit page-permission gate on GET as well: the
    // employee-scope filter below remains the DATA boundary; this gate
    // keeps a viewer without the hrDeductions page from reading the
    // collection at all (server-side authorization, not UI hiding).
    const viewCheck = await verifyPermission(request, 'hrDeductions', 'view');
    if (!viewCheck.allowed) {
      return NextResponse.json({ error: viewCheck.error }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';

    let records = await getAll('hrDeductions');

    // ── READ SCOPE (M0.5) ──
    // HR deductions are employee-linked; scope runs at the retrieval
    // boundary, BEFORE the status filter (filters only narrow). HR
    // deduction business rules and their separation from attendance
    // deductions are untouched.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx);

    if (status) {
      records = records.filter((r: any) => r.status === status);
    }

    // §ARCHIVE — archived deductions never appear in the ACTIVE list.
    // Historical views opt in explicitly with ?includeArchived=1.
    const includeArchived = searchParams.get('includeArchived') === '1';
    if (!includeArchived) {
      records = records.filter((r: any) => r.archived !== true);
    }

    records = sortByDateField(records, 'createdAt', 'desc');
    const withEmp = await withEmployee(records as any[]);
    return NextResponse.json(withEmp);
  } catch (error) {
    console.error('Fetch HR deductions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'hrDeductions'
    const permCheck = await verifyPermission(request, 'hrDeductions', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, type, amount, unit, reason, month, relatedCapaId, evidenceItems } = body;

    if (!employeeId || !type || amount === undefined || !unit || !month) {
      return NextResponse.json(
        { error: 'employeeId, type, amount, unit, and month are required' },
        { status: 400 }
      );
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // HR deductions are employee-linked records: the target employee
    // (body.employeeId) must be inside the caller's employee scope
    // BEFORE validation and create. The HR deduction BUSINESS RULES
    // are unchanged — this is authorization only.
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

    // ── §EVIDENCE-ITEMS — normalized multi-item evidence (net-new
    // field for HR deductions). Authoritative sanitize; staged images
    // promote to parent-bound paths BEFORE the write; a failed write
    // rolls the promoted objects back (§21).
    let savedEvidenceItems: EvidenceItem[] | null = null;
    if (evidenceItems !== undefined) {
      const parsedEvidence = sanitizeEvidenceItems(evidenceItems);
      if (!parsedEvidence.ok) return NextResponse.json({ error: parsedEvidence.error }, { status: 400 });
      const attachError = assertAttachableEvidenceImages(parsedEvidence.items, null);
      if (attachError) return NextResponse.json({ error: attachError }, { status: 400 });
      savedEvidenceItems = stampEvidenceItems(
        parsedEvidence.items, new Date().toISOString(), permCheck.user?.id || 'system',
      );
    }

    const recordId = createId();
    let promotedItems = savedEvidenceItems;
    if (savedEvidenceItems && evidenceImageItems(savedEvidenceItems).length > 0) {
      try {
        promotedItems = await promoteEvidenceImages('hrDeductions', recordId, savedEvidenceItems);
      } catch (error) {
        if (error instanceof FirebaseConfigError) {
          return NextResponse.json({ error: error.message, errorKey: 'FIREBASE_CONFIG' }, { status: 503 });
        }
        console.error('Promote evidence images error:', error);
        return NextResponse.json({ error: 'فشل حفظ أدلة الصورة — حاول مرة أخرى' }, { status: 500 });
      }
    }

    let record: Record<string, unknown>;
    try {
      record = await createRecordWithId('hrDeductions', recordId, {
        employeeId,
        type,
        amount: Number(amount),
        unit,
        reason: reason || '',
        month,
        deductionDate: body.deductionDate || null,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        relatedCapaId: relatedCapaId || null,
        evidenceItems: promotedItems ?? null,
      });
    } catch (error) {
      if (promotedItems) {
        void deleteEvidenceObjects(evidenceImageItems(promotedItems).map((i) => i.image!.storagePath));
      }
      throw error;
    }

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('Create HR deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
