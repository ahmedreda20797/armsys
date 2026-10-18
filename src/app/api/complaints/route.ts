import { NextRequest, NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { normalizeComplaintStatus } from '@/lib/complaints/complaint-status';
import { getAll, withEmployee, sortByDateField, createRecordWithId } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';
import { assertSimpleValueIsActive } from '@/lib/master-data/simple-lists';
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

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const severity = searchParams.get('severity');
    const complaintType = searchParams.get('complaintType');

    let records = await getAll('complaints');

    // ── READ SCOPE (M0.5, optional-link rule) ──
    // Complaints are OPTIONALLY employee-linked: an unlinked
    // complaint is organizational and stays visible, while a linked
    // one requires its STORED employeeId inside the caller's scope
    // (same rule as the M0.4 write path). Applied BEFORE filters —
    // employeeId/status/severity/type can only narrow.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(
      records as Array<{ employeeId?: string | null }>,
      scopeCtx,
      { optionalLink: true },
    );

    if (employeeId) {
      records = records.filter((r: any) => r.employeeId === employeeId);
    }
    if (status) {
      records = records.filter((r: any) => r.status === status);
    }
    if (severity) {
      records = records.filter((r: any) => r.severity === severity);
    }
    if (complaintType) {
      records = records.filter((r: any) => r.complaintType === complaintType);
    }

    records = sortByDateField(records, 'createdAt', 'desc');

    // Enrich records that have employeeId with employee name
    const recordsWithEmployee = await withEmployee(
      records.filter((r: any) => r.employeeId) as any[]
    );

    // Merge enriched records back
    const enrichedMap = new Map(recordsWithEmployee.map((r: any) => [r.id, r]));
    const merged = records.map((r: any) => enrichedMap.get(r.id) || r);

    return NextResponse.json(merged);
  } catch (error) {
    console.error('Fetch complaints error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'complaints', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const {
      customerName,
      customerContact,
      dealId,
      employeeId,
      complaintType,
      description,
      severity,
      status,
      resolution,
      responsiblePerson,
      compensationProvided,
      relatedCapaIds,
      evidenceItems,
      // Milestone 7 §7 — additive source trace (Travel → Complaint):
      // optional, length-capped so the payload cannot bloat storage.
      sourcePage,
      sourceRecordId,
    } = body;

    if (!customerName || !complaintType || !description) {
      return NextResponse.json(
        { error: 'Customer name, complaint type, and description are required' },
        { status: 400 }
      );
    }

    // ── §MASTER-DATA deactivation guard — a complaint type deactivated
    // in the Settings Center cannot be selected for NEW complaints
    // (unknown/legacy values stay accepted; guard, not a whitelist).
    const typeGuard = await assertSimpleValueIsActive('complaintTypes', complaintType);
    if (typeGuard) {
      return NextResponse.json({ error: typeGuard }, { status: 400 });
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // The employee link is OPTIONAL: an unlinked complaint is
    // permission-gated only, but a complaint LINKED to an employee
    // requires that employee to be inside the caller's scope —
    // checked before the existence validation.
    if (employeeId) {
      const inScope = await employeeInScope(
        asScopeViewer(permCheck.user!),
        permCheck.user!.permissions,
        employeeId,
      );
      if (!inScope) {
        return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
      }
    }

    // Validate employee exists if provided (optional field)
    if (employeeId) {
      const { validateEmployeeId } = await import('@/lib/validate-employee');
      const empValidation = await validateEmployeeId(employeeId, false);
      if (!empValidation.valid) {
        return NextResponse.json({ error: empValidation.error }, { status: 400 });
      }
    }

    // §COMPLAINT-STATUS — canonical vocabulary on write (legacy alias
    // 'investigating' maps to under_investigation; unknown → 400).
    const normalizedStatus = normalizeComplaintStatus(status) ?? (status ? null : 'open');
    if (!normalizedStatus) {
      return NextResponse.json({ error: 'حالة الشكوى غير صالحة' }, { status: 400 });
    }

    const { createRecord } = await import('@/lib/db');

    // ── §EVIDENCE-ITEMS — normalized multi-item evidence (net-new
    // field for complaints). Authoritative sanitize; staged images
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
        promotedItems = await promoteEvidenceImages('complaints', recordId, savedEvidenceItems);
      } catch (error) {
        if (error instanceof FirebaseConfigError) {
          return NextResponse.json({ error: error.message, errorKey: 'FIREBASE_CONFIG' }, { status: 503 });
        }
        console.error('Promote evidence images error:', error);
        return NextResponse.json({ error: 'فشل حفظ أدلة الصورة — حاول مرة أخرى' }, { status: 500 });
      }
    }

    let complaint: Record<string, unknown>;
    try {
      complaint = await createRecordWithId('complaints', recordId, {
        customerName,
        customerContact: customerContact || '',
        dealId: dealId || null,
        employeeId: employeeId || null,
        complaintType,
        description,
        severity: severity || 'medium',
        status: normalizedStatus,
        resolution: resolution || null,
        responsiblePerson: responsiblePerson || '',
        compensationProvided: compensationProvided || null,
        resolvedAt: null,
        relatedCapaIds: relatedCapaIds || [],
        evidenceItems: promotedItems ?? null,
        ...(typeof sourcePage === 'string' && sourcePage && sourcePage.length <= 50
          ? { sourcePage }
          : {}),
        ...(typeof sourceRecordId === 'string' && sourceRecordId && sourceRecordId.length <= 100
          ? { sourceRecordId }
          : {}),
      });
    } catch (error) {
      if (promotedItems) {
        void deleteEvidenceObjects(evidenceImageItems(promotedItems).map((i) => i.image!.storagePath));
      }
      throw error;
    }

    // §13: automation event — active complaints-module rules fire here.
    void dispatchAutomationEvent('record_created', 'complaints', {
      employeeId: employeeId || null,
      status: normalizedStatus,
      severity: severity || 'medium',
      category: complaintType,
      sourceRecordId: complaint.id,
      extra: { customerName: customerName || null },
    });

    return NextResponse.json(complaint, { status: 201 });
  } catch (error) {
    console.error('Create complaint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
