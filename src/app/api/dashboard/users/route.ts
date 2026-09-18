import { getAll, createRecord, sortByDateField, findFirst, findWhere, getById } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getPermissionsForRole } from '@/config/permissions';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { hashPassword } from '@/lib/auth';
import { isValidEmailFormat } from '@/lib/login-errors';
import { POSITIONS_TABLE, parsePositionTemplate, type Position } from '@/lib/organization';
import { resolveEmployeeOrgLabels, buildEmployeeOrgIndex } from '@/lib/reports/employee-org';
import type { OrgNode } from '@/lib/organization/types';
import type { Employee } from '@/types';

/** Safely parse permissions — handles both string (JSON) and object from Firebase */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

/** The role vocabulary of the permission system (§9 — never accept a free string). */
const VALID_ROLES = ['admin', 'hr', 'manager', 'quality', 'user'] as const;

/** Structured, safe validation error — Arabic operator message + field. */
function invalid(message: string, field: string) {
  return NextResponse.json({ error: message, field }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    // ── §PICKERS — ?basic=1: a MINIMAL directory (id/name/role) for
    // any authenticated user. Name pickers on operational pages
    // (assignments, responsible-person selectors) need names only;
    // no email, no permissions, no suspension state. ──
    if (url.searchParams.get('basic') === '1') {
      const auth = await requireAuth(request as unknown as Parameters<typeof requireAuth>[0]);
      if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const all = await getAll('users');
      return NextResponse.json(
        all
          .map((u: any) => ({ id: u.id, name: u.name ?? '', role: u.role ?? 'user' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      );
    }

    // Full directory — server-side permission check: only admin can list users
    const check = await verifyPermission(request, 'controlPanel', 'view');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    let users = await getAll('users');
    users = sortByDateField(users, 'createdAt', 'desc');

    // Positions (Milestone 10): resolve each user's optional position
    // template ONCE so the Control Panel editor starts from the same
    // effective truth the server resolver produces.
    const positions = await getAll<Position>(POSITIONS_TABLE);
    const positionById = new Map(positions.map((p) => [p.id, p]));

    // §USER-PROFILE — resolve each user's REAL organization identity
    // from the LINKED EMPLOYEE + org tree (single source of truth):
    // department / team / position. Derived — never duplicated onto
    // the user record, so an org move updates the user's org view
    // automatically.
    const [employees, orgNodes] = await Promise.all([
      getAll<Employee>('employees'),
      getAll<OrgNode>('orgNodes'),
    ]);
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const orgIndex = buildEmployeeOrgIndex(orgNodes);

    const usersWithParsedPerms = users.map((u: any) => {
      const position = u.positionId ? positionById.get(u.positionId) ?? null : null;
      const linked = u.linkedEmployeeId ? employeeById.get(u.linkedEmployeeId) ?? null : null;
      const orgLabels = linked ? resolveEmployeeOrgLabels(orgIndex, linked) : null;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        permissions: safeParsePerms(u.permissions),
        isSuspended: u.isSuspended || false,
        suspendedAt: u.suspendedAt || null,
        createdAt: u.createdAt,
        // §USER-PROFILE — stored operational identity
        photoURL: u.photoURL ?? null,
        jobTitle: u.jobTitle ?? null,
        mobile: u.mobile ?? null,
        responsibilities: u.responsibilities ?? null,
        // Milestone 10: position + optional employee linkage
        positionId: u.positionId || null,
        positionTitle: position?.title ?? null,
        positionPermissions: position ? parsePositionTemplate(position.permissions) : null,
        linkedEmployeeId: u.linkedEmployeeId || null,
        linkedEmployeeName: linked?.name ?? null,
        // Permission Manager console: override indicator + employee code
        hasOverrides: Object.keys(safeParsePerms(u.permissions)).length > 0,
        linkedEmployeeCode: linked?.code ?? null,
        // Org identity derived from the linked employee (org tree authority)
        department: orgLabels?.department ?? null,
        team: orgLabels?.team ?? null,
        employeePosition: linked?.position ?? null,
      };
    });

    return NextResponse.json(usersWithParsedPerms);
  } catch (error) {
    console.error('Fetch users error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Server-side permission check: only admin can create users
    const check = await verifyPermission(request, 'controlPanel', 'edit');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    const body = await request.json();
    const {
      email, name, password, role,
      jobTitle, mobile, responsibilities, photoURL,
      positionId, linkedEmployeeId, permissions,
    } = body ?? {};

    // ── §9 structured validation — every failure returns a MEANINGFUL
    // Arabic message + the offending field, never a bare 400. ──
    const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!trimmedEmail) return invalid('البريد الإلكتروني مطلوب', 'email');
    if (!isValidEmailFormat(trimmedEmail)) {
      return invalid('صيغة البريد الإلكتروني غير صحيحة', 'email');
    }
    if (!password || typeof password !== 'string') {
      return invalid('كلمة المرور مطلوبة', 'password');
    }
    if (password.length < 8) {
      return invalid('كلمة المرور يجب ألا تقل عن 8 أحرف', 'password');
    }
    const finalRole = role || 'user';
    if (!VALID_ROLES.includes(finalRole)) {
      return invalid('الدور الوظيفي غير صحيح', 'role');
    }

    const existing = await findFirst('users', { email: trimmedEmail });
    if (existing) {
      return NextResponse.json(
        { error: 'هذا البريد الإلكتروني مستخدم بالفعل', field: 'email' },
        { status: 409 },
      );
    }

    // §USER-PROFILE — link to an EXISTING employee (never auto-create).
    if (linkedEmployeeId) {
      const employee = await getById('employees', linkedEmployeeId);
      if (!employee) {
        return invalid('الموظف المحدد للربط غير موجود', 'linkedEmployeeId');
      }
      const otherHolder = await findWhere('users', { linkedEmployeeId });
      if (otherHolder.length > 0) {
        return NextResponse.json(
          { error: 'هذا الموظف مرتبط بمستخدم آخر بالفعل', field: 'linkedEmployeeId' },
          { status: 409 },
        );
      }
    }

    // Position template — validated (same rule as the update route).
    if (positionId) {
      const position = await getById(POSITIONS_TABLE, positionId);
      if (!position) {
        return invalid('الوظيفة (القالب الوظيفي) غير موجودة', 'positionId');
      }
    }

    const defaultPerms =
      permissions && typeof permissions === 'object' && !Array.isArray(permissions)
        ? permissions // §CLONE — an admin-provided permission map (clone flow)
        : getPermissionsForRole(finalRole);

    // ─── Hash password with bcrypt (12 rounds) ───
    const hashedPassword = await hashPassword(password);

    const user = await createRecord('users', {
      email: trimmedEmail,
      name: name || trimmedEmail.split('@')[0],
      password: hashedPassword,  // Store ONLY bcrypt hash
      role: finalRole,
      permissions: JSON.stringify(defaultPerms),
      isSuspended: false,
      // §USER-PROFILE — operational identity fields (optional)
      jobTitle: typeof jobTitle === 'string' && jobTitle.trim() ? jobTitle.trim() : null,
      mobile: typeof mobile === 'string' && mobile.trim() ? mobile.trim() : null,
      responsibilities: typeof responsibilities === 'string' && responsibilities.trim() ? responsibilities.trim() : null,
      photoURL: typeof photoURL === 'string' && (/^https?:\/\//.test(photoURL) || photoURL.startsWith('data:image/')) ? photoURL : null,
      positionId: positionId || null,
      linkedEmployeeId: linkedEmployeeId || null,
    });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: defaultPerms,
      isSuspended: false,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء المستخدم' }, { status: 500 });
  }
}
