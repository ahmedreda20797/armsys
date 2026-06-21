import { NextRequest, NextResponse } from 'next/server';
import { getById } from '@/lib/db';
import { authenticateRequestAsync } from '@/lib/auth';

/** Safely parse permissions — handles both string (JSON) and object from Firebase */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

export async function GET(request: NextRequest) {
  try {
    // ─── JWT Authentication ──────────────────────────
    const payload = await authenticateRequestAsync(request);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getById('users', payload.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if account was suspended after token was issued
    if (user.isSuspended) {
      return NextResponse.json(
        { error: 'هذا الحساب موقوف مؤقتاً. تواصل مع مدير النظام.', errorKey: 'ACCOUNT_SUSPENDED' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      rank: user.rank,
      permissions: safeParsePerms(user.permissions),
      isSuspended: user.isSuspended || false,
      suspendedAt: user.suspendedAt || null,
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
