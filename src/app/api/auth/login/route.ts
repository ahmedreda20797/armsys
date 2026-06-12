import { NextRequest, NextResponse } from 'next/server';
import { findFirst } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await findFirst('users', { email });

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Check if account is suspended
    if (user.isSuspended) {
      return NextResponse.json(
        { error: 'هذا الحساب موقوف مؤقتاً. تواصل مع مدير النظام.' },
        { status: 403 }
      );
    }

    // Plain text comparison for demo purposes
    if (user.password !== password) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: JSON.parse(user.permissions || '{}'),
        rank: user.rank,
        isSuspended: user.isSuspended || false,
        suspendedAt: user.suspendedAt || null,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
