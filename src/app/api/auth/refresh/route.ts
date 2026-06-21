import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, signToken, storeRefreshToken, validateRefreshToken, revokeRefreshToken } from '@/lib/auth';
import { getById } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { refreshToken: incomingRefreshToken } = await request.json();

    if (!incomingRefreshToken) {
      return NextResponse.json({ error: 'Refresh token is required' }, { status: 400 });
    }

    // Verify the JWT is valid and is a refresh token type
    const payload = await verifyToken(incomingRefreshToken);
    if (!payload || payload.type !== 'refresh') {
      return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
    }

    // Verify the refresh token exists in our store
    const userId = validateRefreshToken(incomingRefreshToken);
    if (!userId) {
      return NextResponse.json({ error: 'Refresh token expired or revoked' }, { status: 401 });
    }

    // Verify user still exists and is not suspended
    const user = await getById('users', userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (user.isSuspended) {
      return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
    }

    // Revoke the old refresh token (single-use rotation)
    revokeRefreshToken(incomingRefreshToken);

    // Generate new tokens
    const newAccessToken = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    }, 'access');

    const newRefreshToken = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    }, 'refresh');

    storeRefreshToken(newRefreshToken, user.id);

    return NextResponse.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
