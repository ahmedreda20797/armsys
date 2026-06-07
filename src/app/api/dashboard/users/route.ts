import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        createdAt: true,
      },
    });

    const usersWithParsedPerms = users.map((u) => ({
      ...u,
      permissions: JSON.parse(u.permissions || '{}'),
      createdAt: u.createdAt.toISOString(),
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

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const defaultPerms: Record<string, string> = {
      home: 'read',
      employees: 'read',
      biometric: 'read',
      attendance: 'read',
      requests: 'read',
      rules: 'none',
      quality: 'read',
      travel: 'read',
      reports: 'read',
      dashboard: 'none',
    };

    const user = await db.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        password, // In production, hash with bcrypt
        role: role || 'user',
        permissions: JSON.stringify(defaultPerms),
      },
    });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: defaultPerms,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
