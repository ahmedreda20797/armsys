import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestAsync, revokeRefreshToken, revokeAllUserRefreshTokens } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const payload = await authenticateRequestAsync(request);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { refreshToken, revokeAll } = body;

    if (revokeAll) {
      // Revoke ALL sessions (used on password change)
      revokeAllUserRefreshTokens(payload.userId);
      return NextResponse.json({ message: 'All sessions revoked' });
    }

    // Revoke specific refresh token
    if (refreshToken) {
      revokeRefreshToken(refreshToken);
    }

    return NextResponse.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
