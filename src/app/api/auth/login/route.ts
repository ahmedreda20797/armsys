import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmail, updateRecord, getById } from '@/lib/db';
import { FirebaseConfigError } from '@/lib/firebase-server';
import { POSITIONS_TABLE, parsePositionTemplate, type Position } from '@/lib/organization';
import { verifyPassword, hashPassword, signToken, storeRefreshToken } from '@/lib/auth';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '@/lib/rate-limiter';
import {
  LOGIN_ERROR_CODES,
  LOGIN_ERROR_MESSAGES,
  isValidEmailFormat,
  type LoginErrorCode,
} from '@/lib/login-errors';

/** Safely parse permissions — handles both string (JSON) and object from Firebase */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

/**
 * Structured, safe login error payload.
 * `errorKey` is the machine code the frontend maps to a field-specific
 * Arabic message; `error` is a ready-to-display fallback. Technical
 * details NEVER go in this payload — they stay in the server console.
 */
function loginErrorResponse(
  status: number,
  code: LoginErrorCode,
  options?: { field?: 'email' | 'password'; message?: string; extra?: Record<string, unknown> },
) {
  return NextResponse.json(
    {
      error: options?.message ?? LOGIN_ERROR_MESSAGES[code],
      errorKey: code,
      ...(options?.field ? { field: options.field } : {}),
      ...(options?.extra ?? {}),
    },
    { status }
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  // 45s matches the client-side budget (AuthContext.LOGIN_TIMEOUT_MS) and
  // comfortably covers a COLD login in this environment (~17–20s = Firebase
  // Admin OAuth token fetch + first RTDB round-trip). Warm logins are ~1s.
  // The previous 10s guard falsely aborted a valid-but-slow request.
  timeoutMs = 45_000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(`[Login Timeout] ${label} exceeded ${timeoutMs}ms`)
      );
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export async function POST(request: NextRequest) {
  // Dev-only stage timing — when a login is slow, the server console
  // pinpoints exactly which stage ate the time. Durations only, no data.
  const loginT0 = performance.now();
  let stageStart = loginT0;
  const stageTimings: Record<string, number> = {};
  const markStage = (name: string) => {
    if (process.env.NODE_ENV === 'production') return;
    const now = performance.now();
    stageTimings[name] = Math.round(now - stageStart);
    stageStart = now;
  };

  try {
    // ─── Parse body safely (malformed JSON → validation error) ───
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return loginErrorResponse(400, LOGIN_ERROR_CODES.VALIDATION_ERROR);
    }

    const email = typeof (body as any)?.email === 'string' ? (body as any).email.trim().toLowerCase() : '';
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';

    // ─── Server-side field validation (defense in depth — the client
    //     validates first, but the API never trusts that) ──────────
    if (!email) {
      return loginErrorResponse(400, LOGIN_ERROR_CODES.VALIDATION_ERROR, {
        field: 'email',
        message: 'يرجى إدخال البريد الإلكتروني',
      });
    }
    if (!isValidEmailFormat(email)) {
      return loginErrorResponse(400, LOGIN_ERROR_CODES.INVALID_EMAIL, { field: 'email' });
    }
    if (!password) {
      return loginErrorResponse(400, LOGIN_ERROR_CODES.VALIDATION_ERROR, {
        field: 'password',
        message: 'يرجى إدخال كلمة المرور',
      });
    }

    // ─── Rate Limiting ──────────────────────────────────
    const rateCheck = checkRateLimit(email);
    if (!rateCheck.allowed) {
      return loginErrorResponse(429, LOGIN_ERROR_CODES.ACCOUNT_LOCKED, {
        extra: { retryAfterSeconds: rateCheck.retryAfterSeconds },
      });
    }

    // Targeted indexed query — fetches only the matching user instead of
    // downloading the whole users table (see findUserByEmail in lib/db).
    console.log('[Login] Starting findUser...');

    const user = await withTimeout(
      findUserByEmail(email),
      'findUser',
      45_000
    );

markStage('findUser');

console.log(
  '[Login] findUser finished:',
  stageTimings.findUser,
  'ms'
);

    if (!user) {
      const rateResult = recordFailedAttempt(email);
      return loginErrorResponse(401, LOGIN_ERROR_CODES.EMAIL_NOT_FOUND, {
        field: 'email',
        extra: { remainingAttempts: rateResult.remainingAttempts },
      });
    }

    // Check if account is suspended
    if (user.isSuspended) {
      return loginErrorResponse(403, LOGIN_ERROR_CODES.ACCOUNT_SUSPENDED);
    }

    // ─── Password Verification ───────────────────────
    console.log('[Login] Starting verifyPassword...');

    const pwResult = await withTimeout(
      verifyPassword(password, user.password),
      'verifyPassword',
      45_000
    );

    markStage('verifyPassword');

    console.log(
      '[Login] verifyPassword finished:',
      stageTimings.verifyPassword,
      'ms'
    );

    if (!pwResult.valid) {
      const rateResult = recordFailedAttempt(email);
      return loginErrorResponse(401, LOGIN_ERROR_CODES.INVALID_PASSWORD, {
        field: 'password',
        extra: { remainingAttempts: rateResult.remainingAttempts },
      });
    }

    // ─── Migrate plaintext password to bcrypt ──────
    if (pwResult.needsRehash) {
      const hashedPassword = await hashPassword(password);
      await updateRecord('users', user.id, { password: hashedPassword });
    }
    markStage('rehash');

    // Reset rate limit on successful login
    resetRateLimit(email);

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

    // Store refresh token in RTDB (persistent across restarts)
    console.log('[Login] Starting storeRefreshToken...');

    await withTimeout(
      storeRefreshToken(refreshToken, user.id),
      'storeRefreshToken',
      45_000
    );

    markStage('tokensAndStore');

    console.log(
      '[Login] tokensAndStore finished:',
      stageTimings.tokensAndStore,
      'ms'
    );

    // ─── Return tokens + minimal user data ──────────
    // Milestone 10 parity: position template for the client resolver
    // (see /api/auth/me — same fields, same rule).
    let positionPermissions: Record<string, any> | null = null;

    if (user.positionId) {
      console.log('[Login] Starting positionLookup...');

      const position = await withTimeout(
        getById<Position>(
          POSITIONS_TABLE,
          user.positionId
        ),
        'positionLookup',
        45_000
      );

      positionPermissions = position
        ? parsePositionTemplate(position.permissions)
        : null;
    }

    markStage('positionLookup');

    console.log(
      '[Login] positionLookup finished:',
      stageTimings.positionLookup,
      'ms'
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Login] stage timings (ms):', {
        total: Math.round(performance.now() - loginT0),
        ...stageTimings,
      });
    }

    return NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: safeParsePerms(user.permissions),
        positionId: user.positionId || null,
        positionPermissions,
        linkedEmployeeId: user.linkedEmployeeId || null,
        rank: user.rank,
        isSuspended: user.isSuspended || false,
        suspendedAt: user.suspendedAt || null,
        requiresPasswordChange: pwResult.needsRehash, // Force password change for migrated accounts
      },
    });
  } catch (error: any) {
    // Technical details for server-side debugging only — the response
    // carries just a safe code + message.
        console.error(
      '[Login] FAILED:',
      error?.message || error
    );

    console.error(
      '[Login] Stack:',
      error?.stack || 'No stack'
    );

    // Firebase configuration problems (placeholders / malformed key /
    // missing env). The UI shows the safe general message per the error
    // contract; the actionable operator instructions travel in `detail`
    // (no secrets — fix steps only) and are logged to the browser
    // console by AuthContext.
    if (
      error instanceof FirebaseConfigError ||
      error?.name === 'FirebaseConfigError'
    ) {
      console.error('[Login] Firebase configuration error:', error.message);
      return NextResponse.json(
        {
          error: LOGIN_ERROR_MESSAGES[LOGIN_ERROR_CODES.FIREBASE_CONFIG],
          errorKey: LOGIN_ERROR_CODES.FIREBASE_CONFIG,
          detail: error.message,
        },
        { status: 503 }
      );
    }

    return loginErrorResponse(500, LOGIN_ERROR_CODES.SERVER_ERROR);
  }
}
