import { NextRequest, NextResponse } from 'next/server';
import { getById, getAll, updateRecord, deleteRecord, deleteWhere, findWhere, createRecordWithId } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  asScopeViewer,
  employeeInScope,
} from '@/lib/scope/server';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import {
  isValidEmployeeStatus,
  normalizeEmployeeStatus,
  stripEmployeeLifecycleFields,
  buildEmployeeArchivePatch,
  buildEmployeeRestorePatch,
  EMPLOYMENT_EVENTS_TABLE,
  buildEmploymentEvent,
  type EmployeeStatus,
} from '@/lib/organization';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'employees', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    let body = await request.json();

    // ── TARGET RESOURCE + DATA SCOPE (M0.4 write-scope) ──
    // Resolve the employee BEFORE mutating. Permission answers
    // "may you update employees"; the scope answers "THIS employee?".
    // An out-of-scope id resolves as NOT FOUND — identical body to
    // the missing-employee path (anti-enumeration, same doctrine as
    // the M0.3 employee-360 guard).
    const existing = await getById('employees', id);
    if (!existing) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      id,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    // ── ORGANIZATIONAL ASSIGNMENT SEPARATION (M0.4) ──
    // orgNodeId feeds the scope engine itself: letting a generic
    // employee edit MOVE an employee between org nodes would let a
    // scoped editor redraw authorization boundaries. Organizational
    // reassignment is a SEPARATE privileged operation with its own
    // route (/api/organization/employees/move), page permission
    // ('organization' — admin-only by stock preset), audit trail and
    // manager notifications. A no-op assignment (same value) is
    // ignored; any CHANGE via this route is refused.
    if (body && typeof body === 'object' && 'orgNodeId' in body) {
      if ((body.orgNodeId ?? null) !== (existing.orgNodeId ?? null)) {
        return NextResponse.json(
          { error: 'تغيير الإسناد التنظيمي يتم من صفحة الهيكل التنظيمي فقط' },
          { status: 403 },
        );
      }
      delete body.orgNodeId;
    }

    // ── M0.6-A + ADDENDUM LIFECYCLE ──
    // Reserved lifecycle fields are STRIPPED from the request body —
    // archivedAt/archivedBy/previousStatus/restoredAt/restoredBy are
    // server-derived only, so a client can never spoof archive
    // metadata. archiveReason is read as INPUT, then stripped too.
    if (body && typeof body === 'object') {
      const requestedArchiveReason =
        typeof (body as Record<string, unknown>).archiveReason === 'string'
          ? ((body as Record<string, unknown>).archiveReason as string)
          : undefined;
      const sanitized = stripEmployeeLifecycleFields(body as Record<string, unknown>);
      body = { ...sanitized } as Record<string, unknown>;
      if (requestedArchiveReason !== undefined) {
        (body as Record<string, unknown>).archiveReason = requestedArchiveReason;
      }
    }

    let previousStatus: EmployeeStatus | null = null;
    if (body && typeof body === 'object' && 'status' in body) {
      if (!isValidEmployeeStatus(body.status)) {
        return NextResponse.json({ error: 'حالة الموظف غير صالحة' }, { status: 400 });
      }
      previousStatus = normalizeEmployeeStatus((existing as { status?: unknown }).status);
      const next = body.status as EmployeeStatus;

      // A real transition is applied + audited; an identical value stays a plain edit.
      if (next !== previousStatus) {
        const actor = await resolveActor(permCheck.user?.id);
        let lifecyclePatch: Record<string, unknown> = { status: next };
        let lifecycleAction = 'update';
        let lifecycleEventKind: 'archived' | 'restored' | null = null;

        if (next === 'archived') {
          // ── ARCHIVE (addendum §1-§8): a lifecycle state, never a
          // delete. Same record, same stable id, zero cascade.
          lifecyclePatch = {
            ...buildEmployeeArchivePatch({
              currentStatus: previousStatus,
              archivedBy: actor.id,
              archiveReason: (body as Record<string, unknown>).archiveReason,
            }),
          };
          lifecycleAction = 'archive';
          lifecycleEventKind = 'archived';
        } else if (next === 'active' && previousStatus === 'archived') {
          // ── RESTORE (addendum §5-§6): same employee id, new
          // employment period; the archived period stays identifiable.
          lifecyclePatch = {
            ...buildEmployeeRestorePatch({
              currentStatus: previousStatus,
              restoredBy: actor.id,
            }),
          };
          lifecycleAction = 'restore';
          lifecycleEventKind = 'restored';
        }

        const { archiveReason: _reason, ...editableFields } = body as Record<string, unknown>;
        await updateRecord('employees', id, { ...editableFields, ...lifecyclePatch });

        // Append-only employment ledger (non-blocking — a ledger
        // failure never undoes the lifecycle write).
        if (lifecycleEventKind) {
          try {
            const event = buildEmploymentEvent({
              employeeId: id,
              kind: lifecycleEventKind,
              actorUserId: actor.id,
              reason:
                (lifecyclePatch as { archiveReason?: string | null }).archiveReason ?? null,
            });
            await createRecordWithId(EMPLOYMENT_EVENTS_TABLE, event.id, event);
          } catch (ledgerError) {
            console.error('employmentEvents append failed:', ledgerError);
          }
        }

        try {
          await writeConfigAudit({
            actorId: actor.id,
            actorName: actor.name,
            action: lifecycleAction,
            entityType: 'employeeLifecycle',
            entityId: id,
            monthKey: null,
            before: { status: previousStatus },
            after: { status: next },
            details:
              lifecycleAction === 'archive'
                ? `أرشفة الموظف ${existing.name ?? id}${
                    (lifecyclePatch as { archiveReason?: string | null }).archiveReason
                      ? ` — السبب: ${(lifecyclePatch as { archiveReason?: string | null }).archiveReason}`
                      : ''
                  }`
                : lifecycleAction === 'restore'
                  ? `استعادة الموظف ${existing.name ?? id} بنفس الهوية`
                  : `تغيير حالة الموظف ${existing.name ?? id} إلى ${
                      next === 'active' ? 'نشط' : 'غير نشط'
                    }`,
          });
        } catch (auditError) {
          console.error('Employee lifecycle audit failed:', auditError);
        }
        return NextResponse.json(await getById('employees', id));
      }
      delete (body as Record<string, unknown>).status;
    }

    const updated = await updateRecord('employees', id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Update employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'employees', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    // ── PERMANENT DELETE IS RESTRICTED (M0.6-A addendum §16) ──
    // The normal departure workflow is ARCHIVE (lifecycle state —
    // recoverable, history intact, no cascade). This endpoint is the
    // exceptional, potentially irreversible administrative deletion.
    // It cascades into employee-linked tables (documented below) and
    // is therefore limited to:
    //   • the admin role, or
    //   • an EXPLICIT stored employees 'delete' action grant
    //     (a per-user override — preset-derived delete alone, e.g.
    //     the HR default, does NOT authorize identity destruction).
    // The data-scope guard above still runs FIRST, so out-of-scope
    // ids keep returning the anti-enumeration 404 for every caller.
    if (permCheck.user?.role !== 'admin') {
      const userRecord = await getById<{ permissions: unknown }>('users', permCheck.user!.id);
      const stored = (() => {
        const raw = userRecord?.permissions;
        if (!raw) return {} as Record<string, unknown>;
        if (typeof raw === 'object') return raw as Record<string, unknown>;
        try { return JSON.parse(String(raw)) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; }
      })();
      const employeesEntry = stored.employees as
        | { actions?: Record<string, unknown> }
        | string
        | undefined;
      const hasExplicitDeleteGrant =
        typeof employeesEntry === 'object' &&
        employeesEntry !== null &&
        employeesEntry.actions?.delete === true;
      if (!hasExplicitDeleteGrant) {
        return NextResponse.json(
          { error: 'الحذف النهائي إجراء استثنائي — لمغادرة الموظف استخدم الأرشفة (يمكن استعادتها لاحقاً بنفس الهوية)' },
          { status: 403 },
        );
      }
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4 write-scope) ──
    // Deletion of an employee cascades into every linked table —
    // the scope check MUST run before any of it. Out-of-scope id →
    // 404 identical to the missing-employee path.
    const existing = await getById('employees', id);
    if (!existing) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      id,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    // Delete all related records first
    await deleteWhere('attendance', { employeeId: id });
    await deleteWhere('requests', { employeeId: id });
    await deleteWhere('qualityDeductions', { employeeId: id });
    await deleteWhere('biometrics', { employeeId: id });
    await deleteWhere('travelDeals', { employeeId: id });
    await deleteWhere('followUps', { employeeId: id });
    await deleteWhere('hrDeductions', { employeeId: id });
    await deleteWhere('complaints', { employeeId: id });

    // Handle CAPA records — remove employee from relatedEmployeeIds (don't delete CAPA cases)
    const allCapa = await getAll('capaCases');
    for (const capa of allCapa) {
      const relatedIds: string[] = Array.isArray(capa.relatedEmployeeIds) ? capa.relatedEmployeeIds : [];
      if (relatedIds.includes(id)) {
        const updatedIds = relatedIds.filter((eid: string) => eid !== id);
        await updateRecord('capaCases', capa.id, {
          relatedEmployeeIds: updatedIds,
          employeeId: capa.employeeId === id ? null : capa.employeeId,
          employeeName: capa.employeeId === id ? 'موظف محذوف' : capa.employeeName,
        });
      }
    }

    await deleteRecord('employees', id);

    // ── M0.6-A LINK HYGIENE ──
    // Deleting an employee must not leave users.linkedEmployeeId
    // pointing at a ghost identity (fail-closed scope still protects
    // access, but a dangling anchor is an inconsistent relationship).
    // Unlink affected accounts; user records themselves are preserved.
    const linkHolders = await findWhere('users', { linkedEmployeeId: id });
    for (const holder of linkHolders as Array<{ id: string }>) {
      await updateRecord('users', holder.id, { linkedEmployeeId: null });
    }

    return NextResponse.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
