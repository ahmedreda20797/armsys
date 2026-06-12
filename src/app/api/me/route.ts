// src/app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getById } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await getById('users', userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      rank: user.rank,
      permissions: JSON.parse(user.permissions || '{}'),
      isSuspended: user.isSuspended || false,
      suspendedAt: user.suspendedAt || null,
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}