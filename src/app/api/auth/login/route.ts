import { NextRequest, NextResponse } from 'next/server';
import { findFirst, updateRecord } from '@/lib/db';
import { verifyPassword, hashPassword, signToken, storeRefreshToken } from '@/lib/auth';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '@/lib/rate-limiter';

/** Safely parse permissions — handles both string (JSON) and object from Firebase */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ─── Rate Limiting ──────────────────────────────────
    const rateCheck = checkRateLimit(normalizedEmail);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: 'تم تأمين الحساب مؤقتاً بسبب محاولات فاشلة متعددة',
          errorKey: 'ACCOUNT_LOCKED',
          retryAfterSeconds: rateCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const user = await findFirst('users', { email: normalizedEmail });

    if (!user) {
      const rateResult = recordFailedAttempt(normalizedEmail);
      return NextResponse.json(
        {
          error: 'Invalid email or password',
          errorKey: 'INVALID_CREDENTIALS',
          remainingAttempts: rateResult.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // Check if account is suspended
    if (user.isSuspended) {
      return NextResponse.json(
        { error: 'هذا الحساب موقوف مؤقتاً. تواصل مع مدير النظام.', errorKey: 'ACCOUNT_SUSPENDED' },
        { status: 403 }
      );
    }

    // ─── Password Verification ───────────────────────
    const pwResult = await verifyPassword(password, user.password);
    if (!pwResult.valid) {
      const rateResult = recordFailedAttempt(normalizedEmail);
      return NextResponse.json(
        {
          error: 'Invalid email or password',
          errorKey: 'INVALID_CREDENTIALS',
          remainingAttempts: rateResult.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // ─── Migrate plaintext password to bcrypt ──────
    if (pwResult.needsRehash) {
      const hashedPassword = await hashPassword(password);
      await updateRecord('users', user.id, { password: hashedPassword });
    }

    // Reset rate limit on successful login
    resetRateLimit(normalizedEmail);

    // ─── Generate JWT Tokens ────────────────────────
    const accessToken = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    }, 'access');

    const refreshToken = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    }, 'refresh');

    // Store refresh token
    storeRefreshToken(refreshToken, user.id);

    // ─── Return tokens + minimal user data ──────────
    return NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: safeParsePerms(user.permissions),
        rank: user.rank,
        isSuspended: user.isSuspended || false,
        suspendedAt: user.suspendedAt || null,
        requiresPasswordChange: pwResult.needsRehash, // Force password change for migrated accounts
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
