import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';
import { closedAtForStatusTransition } from '@/lib/deal-dates';
import { isValidDisplayDate } from '@/lib/date-utils';
import { projectLegacyServiceFields, sanitizeBookingItems } from '@/lib/booking-items';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'travel', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // The trip's STORED employeeId is the authorization target; a
    // body.employeeId reassignment additionally requires the NEW
    // target to be in scope. Out-of-scope → 404 identical to the
    // missing-trip path (anti-enumeration).
    const existing = await getById('travelDeals', id);
    if (!existing) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }
    const viewer = asScopeViewer(permCheck.user!);
    const storedOk = await employeeInScope(viewer, permCheck.user!.permissions, existing.employeeId);
    const reassignTarget = body && typeof body === 'object' && typeof body.employeeId === 'string'
      ? body.employeeId
      : null;
    const targetOk = !reassignTarget || reassignTarget === existing.employeeId
      ? true
      : await employeeInScope(viewer, permCheck.user!.permissions, reassignTarget);
    if (!storedOk || !targetOk) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }

    // ── §DEAL-DATES — closedAt is a SERVER-side closure ledger ──
    // The client's closedAt (if any) is never trusted: the stamp is
    // derived from the observed status transition (entering
    // 'completed' = now; leaving it = cleared; staying = verbatim).
    // createdAt / id are technical/system fields — never client-writable.
    const updates: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    delete updates.closedAt;
    delete updates.createdAt;
    delete updates.id;

    // ── §DEAL-DATES (DEAL_CLOSED) — تاريخ تقفيل الديل is a client-
    // editable BUSINESS date for authorized editors (this PUT already
    // requires travel:update), but it must remain a REAL display date —
    // never a free-form value smuggled through the payload.
    if (updates.dealClosedAt !== undefined) {
      if (updates.dealClosedAt === null) {
        // The field is required — clearing it would break the canonical
        // metric; fall back to the stored value (no-op) rather than a
        // silent data loss.
        delete updates.dealClosedAt;
      } else if (typeof updates.dealClosedAt !== 'string' || !isValidDisplayDate(updates.dealClosedAt)) {
        return NextResponse.json({ error: 'تاريخ تقفيل الديل غير صالح — الصيغة DD/MM/YYYY' }, { status: 400 });
      }
    }

    // ── §BOOKING-ITEMS — canonical dynamic bookings (§16 field auth:
    // this whole handler already requires travel:update; payload is
    // validated server-side, never trusted). The legacy fixed fields
    // are re-projected from the canonical items so every existing
    // reader of those fields stays correct.
    if (updates.bookingItems !== undefined) {
      const sanitized = sanitizeBookingItems(updates.bookingItems);
      if (!sanitized.ok) {
        return NextResponse.json({ error: sanitized.error }, { status: 400 });
      }
      updates.bookingItems = sanitized.items;
      Object.assign(updates, projectLegacyServiceFields(sanitized.items));
    }

    if (typeof updates.status === 'string' && updates.status !== existing.status) {
      updates.closedAt = closedAtForStatusTransition({
        previousStatus: existing.status,
        nextStatus: updates.status as string,
        existingClosedAt: existing.closedAt ?? null,
      });
    }

    const trip = await updateRecord('travelDeals', id, updates);

    return NextResponse.json(trip);
  } catch (error) {
    console.error('Update travel error:', error);
    return NextResponse.json({ error: 'فشل في تعديل الرحلة' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(_request, 'travel', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the stored trip's employee BEFORE deleting;
    // out-of-scope → 404 identical to the missing path.
    const existing = await getById('travelDeals', id);
    if (!existing) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }

    await deleteRecord('travelDeals', id);
    return NextResponse.json({ message: 'تم حذف الرحلة بنجاح' });
  } catch (error) {
    console.error('Delete travel error:', error);
    return NextResponse.json({ error: 'فشل في حذف الرحلة' }, { status: 500 });
  }
}
