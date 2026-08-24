// ══════════════════════════════════════════════════════════════
//  M0.1 regression guards — static analysis of API route files
//
//  Guard 1 (auth coverage): every route under src/app/api must
//  reference an authentication/authorization primitive, unless it is
//  EXPLICITLY allowlisted below as intentionally public. A newly added
//  route that forgets authentication fails this test. The guard checks
//  for known auth markers — it does NOT mandate a specific helper, so
//  legitimately different architectures are not punished.
//
//  Guard 2 (await discipline): requireAuth / verifyPermission /
//  authenticateRequestAsync return Promises — calling them without
//  await reproduces the reports/capa bug (a Promise is truthy, so the
//  check always "passes"). No route may call them un-awaited.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// src/lib/__tests__/ → project root is three levels up
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const API_ROOT = join(PROJECT_ROOT, 'src', 'app', 'api');

/** Routes that are intentionally reachable without a user token. */
const PUBLIC_ROUTE_ALLOWLIST: Record<string, string> = {
  'src/app/api/auth/login/route.ts': 'public by design — authenticates credentials and issues tokens',
  'src/app/api/auth/refresh/route.ts': 'public by design — rotates the refresh token presented in the body',
  'src/app/api/health/route.ts': 'public health probe — M0.1-hardened: no user data, single-record ping',
};

/** Auth primitives a route may use (any one satisfies the guard). */
const AUTH_MARKER = /requireAuth|verifyPermission|authenticateFromRequest|authenticateRequest|isCronRequest|getCronSecret/;

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRouteFiles(path));
    else if (entry.name === 'route.ts') out.push(path);
  }
  return out;
}

function toPosix(absPath: string): string {
  return relative(PROJECT_ROOT, absPath).split(sep).join('/');
}

/** Strip comments so commented-out auth code cannot satisfy the guards. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('regression guard — every API route authenticates', () => {
  it('all route files contain an auth primitive or are explicitly allowlisted', () => {
    const files = collectRouteFiles(API_ROOT).map(toPosix);
    assert.ok(files.length > 50, `route discovery looks wrong (found ${files.length})`);

    const unprotected = files.filter(
      (f) => !AUTH_MARKER.test(stripComments(readFileSync(join(PROJECT_ROOT, f), 'utf8'))) &&
        !(f in PUBLIC_ROUTE_ALLOWLIST)
    );
    assert.deepEqual(
      unprotected,
      [],
      'Routes without any authentication marker (add auth, or allowlist with a reason if intentionally public):\n' +
        unprotected.join('\n')
    );
  });

  it('the public allowlist has no stale entries', () => {
    for (const relPath of Object.keys(PUBLIC_ROUTE_ALLOWLIST)) {
      assert.ok(
        existsSync(join(PROJECT_ROOT, relPath)),
        `${relPath} is allowlisted but no longer exists — remove the stale entry`
      );
    }
  });
});

describe('regression guard — auth calls are awaited', () => {
  it('no route calls requireAuth/verifyPermission/authenticateRequest* without await', () => {
    const callRegex =
      /(requireAuth|verifyPermission|authenticateFromRequest|authenticateRequestAsync|authenticateRequest)\s*\(/g;
    const violations: string[] = [];

    for (const absPath of collectRouteFiles(API_ROOT)) {
      const src = stripComments(readFileSync(absPath, 'utf8'));
      callRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = callRegex.exec(src))) {
        const before = src.slice(Math.max(0, match.index - 30), match.index);
        if (!/await\s*$/.test(before)) {
          violations.push(`${toPosix(absPath)}: …${before.trim().split(/\s+/).pop()} ${match[1]}(…)`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      'Auth primitives return Promises — an un-awaited call is truthy and bypasses the check (reports/capa bug):\n' +
        violations.join('\n')
    );
  });
});
