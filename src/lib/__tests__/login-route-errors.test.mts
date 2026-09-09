// ══════════════════════════════════════════════════════════════
//  Login API — structured error contract tests
//
//  Verifies the distinguishable error codes the frontend maps to
//  field-specific Arabic messages (EMAIL_NOT_FOUND vs INVALID_PASSWORD
//  vs ACCOUNT_* vs SERVER_ERROR). Firebase RTDB, bcrypt and the rate
//  limiter are mocked — no real database or JWT secret is needed.
// ══════════════════════════════════════════════════════════════

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';

// Satisfies the startup guard inside the (unmocked) module graph in case
// anything still pulls lib/auth transitively.
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';

// ─── Controllable fakes ────────────────────────────────────────
const dbState: {
  user: Record<string, unknown> | null;
  throwFn: ((...args: unknown[]) => never) | null;
} = { user: null, throwFn: null };
const authState = { passwordOk: false };
const rateState = { allowed: true, remaining: 5, retryAfterSeconds: null as number | null };

mock.module('@/lib/db', {
  exports: {
    // The route now uses the targeted lookup; findFirst kept for parity.
    findUserByEmail: async () => {
      if (dbState.throwFn) return dbState.throwFn();
      return dbState.user;
    },
    findFirst: async () => {
      if (dbState.throwFn) return dbState.throwFn();
      return dbState.user;
    },
    updateRecord: async () => ({}),
    getById: async () => null,
  },
});

mock.module('@/lib/auth', {
  exports: {
    verifyPassword: async () => ({ valid: authState.passwordOk, needsRehash: false }),
    hashPassword: async () => 'hashed-password',
    signToken: async () => 'signed-token',
    storeRefreshToken: async () => {},
  },
});

mock.module('@/lib/rate-limiter', {
  exports: {
    checkRateLimit: () => ({
      allowed: rateState.allowed,
      remainingAttempts: rateState.remaining,
      lockedUntil: null,
      retryAfterSeconds: rateState.retryAfterSeconds,
    }),
    recordFailedAttempt: () => ({
      allowed: true,
      remainingAttempts: rateState.remaining,
      lockedUntil: null,
      retryAfterSeconds: null,
    }),
    resetRateLimit: () => {},
  },
});

class FakeFirebaseConfigError extends Error {
  name = 'FirebaseConfigError';
}
mock.module('@/lib/firebase-server', {
  exports: { FirebaseConfigError: FakeFirebaseConfigError },
});

// Import the route AFTER the mocks are registered (before() runs once
// all top-level mock.module calls have executed).
let POST: (req: unknown) => Promise<Response>;
let LOGIN_MESSAGES: Record<string, string>;

before(async () => {
  ({ POST } = await import('@/app/api/auth/login/route'));
  ({ LOGIN_MESSAGES } = await import('@/lib/login-errors'));
});

function makeRequest(body: unknown): any {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function resetMocks() {
  dbState.user = null;
  dbState.throwFn = null;
  authState.passwordOk = false;
  rateState.allowed = true;
  rateState.remaining = 5;
  rateState.retryAfterSeconds = null;
}

describe('Login API — structured error contract', () => {
  it('401 EMAIL_NOT_FOUND (field: email) when no user matches', async () => {
    resetMocks();
    const res = await POST(makeRequest({ email: 'ghost@arm.com', password: 'whatever123' }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.errorKey, 'EMAIL_NOT_FOUND');
    assert.equal(body.field, 'email');
    assert.equal(body.error, LOGIN_MESSAGES.EMAIL_NOT_FOUND);
  });

  it('401 INVALID_PASSWORD (field: password) when the email exists but the password is wrong', async () => {
    resetMocks();
    dbState.user = { id: 'u1', email: 'user@arm.com', password: 'hash', role: 'admin' };
    const res = await POST(makeRequest({ email: 'user@arm.com', password: 'wrong-pass' }));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.errorKey, 'INVALID_PASSWORD');
    assert.equal(body.field, 'password');
    assert.equal(body.error, LOGIN_MESSAGES.INVALID_PASSWORD);
  });

  it('400 INVALID_EMAIL (field: email) for a malformed address', async () => {
    resetMocks();
    const res = await POST(makeRequest({ email: 'not-an-email', password: 'x'.repeat(8) }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.errorKey, 'INVALID_EMAIL');
    assert.equal(body.field, 'email');
  });

  it('400 VALIDATION_ERROR (field: email) for an empty email', async () => {
    resetMocks();
    const res = await POST(makeRequest({ email: '   ', password: 'x'.repeat(8) }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.errorKey, 'VALIDATION_ERROR');
    assert.equal(body.field, 'email');
  });

  it('400 VALIDATION_ERROR (field: password) for an empty password', async () => {
    resetMocks();
    const res = await POST(makeRequest({ email: 'user@arm.com', password: '' }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.errorKey, 'VALIDATION_ERROR');
    assert.equal(body.field, 'password');
  });

  it('403 ACCOUNT_SUSPENDED for a suspended account', async () => {
    resetMocks();
    dbState.user = { id: 'u2', email: 'suspended@arm.com', password: 'hash', role: 'hr', isSuspended: true };
    const res = await POST(makeRequest({ email: 'suspended@arm.com', password: 'pw123456' }));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.errorKey, 'ACCOUNT_SUSPENDED');
  });

  it('429 ACCOUNT_LOCKED carries retryAfterSeconds when rate limited', async () => {
    resetMocks();
    rateState.allowed = false;
    rateState.retryAfterSeconds = 1800;
    const res = await POST(makeRequest({ email: 'locked@arm.com', password: 'pw123456' }));
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.errorKey, 'ACCOUNT_LOCKED');
    assert.equal(body.retryAfterSeconds, 1800);
  });

  it('200 success returns tokens + user payload without any secret material', async () => {
    resetMocks();
    dbState.user = {
      id: 'u3',
      email: 'admin@arm.com',
      name: 'Admin',
      role: 'admin',
      password: 'super-secret-hash',
      permissions: { employees: true },
    };
    authState.passwordOk = true;
    const res = await POST(makeRequest({ email: 'Admin@ARM.com', password: 'correct' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accessToken, 'signed-token');
    assert.equal(body.refreshToken, 'signed-token');
    assert.equal(body.user.email, 'admin@arm.com');
    // Security: no password / hash ever leaves the server
    assert.ok(!('password' in body.user));
    assert.ok(!JSON.stringify(body).includes('super-secret-hash'));
  });

  it('503 FIREBASE_CONFIG returns the safe general message with console-only detail', async () => {
    resetMocks();
    dbState.throwFn = () => {
      throw new FakeFirebaseConfigError('[FIREBASE_CONFIG] ضع المفتاح الحقيقي في .env.local');
    };
    const res = await POST(makeRequest({ email: 'any@arm.com', password: 'pw123456' }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.errorKey, 'FIREBASE_CONFIG');
    assert.equal(body.error, LOGIN_MESSAGES.GENERAL_ERROR);
    assert.ok(typeof body.detail === 'string' && body.detail.length > 0);
    // No secret material in the detail — configuration guidance only
    assert.ok(!body.detail.includes('secret-value'));
  });

  it('500 SERVER_ERROR for unexpected failures — no stack or internals leaked', async () => {
    resetMocks();
    dbState.throwFn = () => {
      throw new Error('RTDB internal: connection ECONNREFUSED with secret-value\n    at handle (/app/db.ts:42:9)');
    };
    const res = await POST(makeRequest({ email: 'any@arm.com', password: 'pw123456' }));
    assert.equal(res.status, 500);
    const raw = JSON.stringify(await res.json());
    assert.ok(raw.includes('SERVER_ERROR'));
    assert.ok(!raw.includes('ECONNREFUSED'));
    assert.ok(!raw.includes('secret-value'));
    assert.ok(!raw.includes('/app/db.ts'));
  });
});
