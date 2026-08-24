import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, withRelatedCounts } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import { resolvePageScope, stripRestrictedFields } from '@/config/permissions';
import { resolveEmployeeScope, filterEmployeesByScope } from '@/lib/scope';
import { asScopeViewer, hasUnrestrictedEmployeeScope } from '@/lib/scope/server';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // M0.2: the employee list requires the existing 'employees' page
    // permission (view = read or edit) — permission alignment. M0.3:
    // the scope rides on the SAME permission entry. Permission
    // answers "can you use this page"; scope answers "WHOSE rows do
    // you get". Every stock role preset already grants employees ≥
    // read, so existing consumers are unaffected at the permission
    // layer. Admin bypass unchanged.
    const permCheck = await verifyPermission(request, 'employees', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const includeCounts = searchParams.get('counts') === 'true';

    let employees = await getAll('employees');

    // ─── DATA SCOPE (Milestone 10 engine, ACTIVATED by M0.3) ───
    // The scope rides on the permission entry. The 'all' fast path
    // (no org-graph load, no filtering) now covers exactly the tiers
    // that resolve 'all': the admin bypass and the HR / quality
    // preset grants. The manager preset resolves 'subtree' (managed
    // org nodes ∪ own) and any unconfigured non-admin entry FAILS
    // CLOSED to 'own' — empty for viewers without the employee
    // linkage. The backend, never the UI, enforces it. Query
    // parameters can never widen this: the only one read here is
    // 'counts'; any client-side filtering happens on the ALREADY
    // scoped response.
    const scope = resolvePageScope(auth.permissions, 'employees', auth.role);
    if (scope !== 'all') {
      const orgNodes = await getAll<OrgNode>(ORG_NODES_TABLE);
      const scopeContext = resolveEmployeeScope(
        {
          userId: auth.userId,
          role: auth.role,
          linkedEmployeeId: auth.linkedEmployeeId ?? null,
        },
        'employees',
        auth.permissions,
        { orgNodes, employees: employees as Array<{ id: string; orgNodeId?: string | null }> },
      );
      employees = filterEmployeesByScope(
        employees as Array<{ id: string }>,
        scopeContext,
      ) as typeof employees;
    }

    // Sort by employee code numerically (1 → 100), supports "001", "EMP-01", plain numbers
    const extractCode = (code: any) => {
      const num = parseInt(String(code || '').replace(/\D/g, ''));
      return isNaN(num) ? Infinity : num;
    };
    employees.sort((a: any, b: any) => {
      const codeA = extractCode(a.code);
      const codeB = extractCode(b.code);
      if (codeA !== codeB) return codeA - codeB;
      // Same code or both empty: newest first
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    // Field-level access (Part J): sensitive employee fields (mobile)
    // are stripped server-side for users without edit access —
    // restricted data must never reach the browser.
    const stripForViewer = (e: Record<string, any>) =>
      stripRestrictedFields(e, 'employees', auth.permissions);

    // Only compute related counts when explicitly requested
    // This avoids 5 extra table scans on the default list view
    if (includeCounts) {
      const employeesWithCounts = await withRelatedCounts(employees as any[]);
      return NextResponse.json(employeesWithCounts.map(stripForViewer));
    }

    return NextResponse.json((employees as Record<string, any>[]).map(stripForViewer));
  } catch (error) {
    console.error('Fetch employees error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'employees'
    const permCheck = await verifyPermission(request, 'employees', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    // ── CREATE-SCOPE (M0.4) ──
    // There is no existing record to scope, so the rule is: the
    // created employee must land INSIDE the creator's scope. A new
    // employee is organization-unassigned (this route accepts no
    // orgNodeId), and an unassigned employee is outside every
    // restricted scope (team/department/subtree/own) — so creating
    // workforce records requires an UNRESTRICTED employee scope
    // (admin / HR 'all' by preset). Scoped viewers are denied
    // fail-closed; the scope is read from the authenticated
    // identity only, never from the body.
    const unrestricted = await hasUnrestrictedEmployeeScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
    );
    if (!unrestricted) {
      return NextResponse.json(
        { error: 'صلاحية غير كافية لإنشاء موظف خارج نطاق بياناتك' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { code, name, department, position, shiftStart, shiftEnd, hireDate, mobile, createdById } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Auto-generate sequential code if not provided
    let finalCode = code || null;
    if (!finalCode) {
      const allEmployees = await getAll('employees');
      // Find the last code to detect pattern (prefix + zero-padding)
      let maxCode = 0;
      let lastCodeStr = '';
      for (const emp of allEmployees as any[]) {
        const raw = String(emp.code || '').trim();
        const num = parseInt(raw.replace(/\D/g, ''));
        if (!isNaN(num) && num > maxCode) {
          maxCode = num;
          lastCodeStr = raw;
        }
      }
      if (lastCodeStr) {
        // Extract prefix and zero-padding from last code
        const match = lastCodeStr.match(/^(.*?)(\d+)$/);
        if (match) {
          const prefix = match[1]; // e.g. "EMP-"
          const digits = match[2].length; // e.g. 3
          finalCode = prefix + String(maxCode + 1).padStart(digits, '0');
        } else {
          finalCode = String(maxCode + 1);
        }
      } else {
        finalCode = '1';
      }
    }

    const employee = await createRecord('employees', {
      code: finalCode,
      name,
      department: department || null,
      position: position || null,
      shiftStart: shiftStart || null,
      shiftEnd: shiftEnd || null,
      hireDate: hireDate || null,
      mobile: mobile || null,
      createdById: createdById || null,
    });

    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    console.error('Create employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
