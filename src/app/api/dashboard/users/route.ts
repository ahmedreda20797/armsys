import { getAll, createRecord, sortByDateField, findFirst, updateRecord } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getPermissionsForRole } from '@/config/permissions';
import { verifyPermission } from '@/lib/verify-permission';
import { hashPassword } from '@/lib/auth';

/** Safely parse permissions — handles both string (JSON) and object from Firebase */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

export async function GET(request: Request) {
  try {
    // Server-side permission check: only admin can list users
    const check = await verifyPermission(request, 'controlPanel', 'view');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    let users = await getAll('users');
    users = sortByDateField(users, 'createdAt', 'desc');

    const usersWithParsedPerms = users.map((u: any) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      permissions: safeParsePerms(u.permissions),
      isSuspended: u.isSuspended || false,
      suspendedAt: u.suspendedAt || null,
      createdAt: u.createdAt,
    }));

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
    const { email, name, password, role } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const existing = await findFirst('users', { email });
    if (existing) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const defaultPerms = getPermissionsForRole(role || 'user');

    // ─── Hash password with bcrypt (12 rounds) ───
    const hashedPassword = await hashPassword(password);

    const user = await createRecord('users', {
      email: email.trim().toLowerCase(),
      name: name || email.split('@')[0],
      password: hashedPassword,  // Store ONLY bcrypt hash
      role: role || 'user',
      permissions: JSON.stringify(defaultPerms),
      isSuspended: false,
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
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
