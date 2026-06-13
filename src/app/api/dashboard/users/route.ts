import { getAll, createRecord, sortByDateField, findFirst } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getPermissionsForRole } from '@/config/permissions';

/** Safely parse permissions — handles both string (JSON) and object from Firebase */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

export async function GET() {
  try {
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
    const body = await request.json();
    const { email, name, password, role } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const existing = await findFirst('users', { email });
    if (existing) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const defaultPerms = getPermissionsForRole(role || 'user');

    const user = await createRecord('users', {
      email,
      name: name || email.split('@')[0],
      password,
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