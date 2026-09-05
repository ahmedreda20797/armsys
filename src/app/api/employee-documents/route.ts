// ══════════════════════════════════════════════════════════════
//  /api/employee-documents — Employee Document metadata (M7 §17)
//
//  GET  ?employeeId= — list one employee's documents
//  POST              — create a document record
//
//  SECURITY (spec §31): every route enforces authentication, the
//  'employees' page permission (view for GET, update for POST) and
//  the TARGET employee's data scope (fail-closed 404 for out-of-
//  scope ids — anti-enumeration doctrine). Documents are NOT a
//  Global Search domain by design (§17).
//
//  METADATA-ONLY: title/type/expiry/optional URL — consistent with
//  the existing evidence-as-URL doctrine; no binary storage.
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { getAll, createRecord } from '@/lib/db';
import { asScopeViewer, employeeInScope, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { validateEmployeeId } from '@/lib/validate-employee';
import { resolveActorName } from '@/lib/auth/actor-resolver';
import { isKnownDocumentType } from '@/lib/employee-documents';

const DOC_TYPES = isKnownDocumentType;

function dayKeyIsValid(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const permCheck = await verifyPermission(request, 'employees', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user!),
      undefined,
      permCheck.user!.permissions,
    );

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const all = await getAll<Record<string, unknown>>('employeeDocuments');

    // Scope at the retrieval boundary; an employeeId filter narrows
    // WITHIN the scoped set (never widens it).
    const scoped = filterRowsByEmployeeScope(all as Array<{ employeeId?: string | null }>, scopeCtx);
    const rows = employeeId
      ? scoped.filter((d) => d.employeeId === employeeId)
      : scoped;
    return NextResponse.json(rows);
  } catch (error) {
    console.error('[employee-documents GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'employees', 'update');
    if (!permCheck.allowed || !permCheck.user) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, title, docType, url, expiryDate } = body;

    if (!employeeId || !title || !docType) {
      return NextResponse.json(
        { error: 'الموظف والعنوان والنوع حقول مطلوبة' },
        { status: 400 },
      );
    }
    if (typeof title !== 'string' || title.length > 200) {
      return NextResponse.json({ error: 'عنوان غير صالح' }, { status: 400 });
    }
    if (!DOC_TYPES(docType)) {
      return NextResponse.json({ error: 'نوع مستند غير معروف' }, { status: 400 });
    }
    if (expiryDate !== undefined && expiryDate !== null && !dayKeyIsValid(expiryDate)) {
      return NextResponse.json({ error: 'تاريخ الانتهاء غير صالح' }, { status: 400 });
    }
    if (url !== undefined && url !== null && url !== '') {
      if (typeof url !== 'string' || url.length > 2000 || !/^https?:\/\//i.test(url)) {
        return NextResponse.json({ error: 'رابط المستند غير صالح' }, { status: 400 });
      }
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4 write doctrine) ──
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user),
      permCheck.user.permissions,
      employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }
    const empValidation = await validateEmployeeId(employeeId, false);
    if (!empValidation.valid) {
      return NextResponse.json({ error: empValidation.error }, { status: 400 });
    }

    const now = new Date().toISOString();
    const document = await createRecord('employeeDocuments', {
      employeeId,
      title: title.trim(),
      docType,
      url: (url as string) || null,
      expiryDate: expiryDate || null,
      uploadedBy: permCheck.user.id,
      uploadedByName: await resolveActorName(permCheck.user.id),
      uploadedAt: now,
      updatedAt: now,
    });

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error('[employee-documents POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
