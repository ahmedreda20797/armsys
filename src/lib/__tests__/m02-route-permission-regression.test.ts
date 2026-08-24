// ══════════════════════════════════════════════════════════════
//  M0.2 regression guards — static analysis of API route files
//
//  Guard 3 (M0.2 gate pin): each M0.2-aligned route must keep its
//  verifyPermission gate with the agreed page key — the gate cannot
//  be silently dropped or pointed at a different (broader) key.
//
//  Guard 4 (no invented permission keys): every page key passed to
//  verifyPermission in ANY route must be a key defined in the
//  central permission definitions (APP_PAGES) — permission strings
//  may not be scattered across route files.
//
//  Guard 5 (single permission resolver): only
//  src/config/permissions.ts may define resolveEffectivePermissions
//  / getPermissionsForRole — no second resolver may appear.
//
//  Guard 6 (no caller-supplied role trust): no route file may make
//  an authorization decision by comparing a request-body role (or
//  assigning a body userId into an actor identity) — authorization
//  uses the authenticated server-side identity only.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { APP_PAGES } from '@/config/permissions';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const API_ROOT = join(PROJECT_ROOT, 'src', 'app', 'api');
const SRC_ROOT = join(PROJECT_ROOT, 'src');

function collect(dir: string, filter: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, filter, out);
    else if (filter(entry.name)) out.push(path);
  }
  return out;
}

const routeFiles = collect(API_ROOT, (n) => n === 'route.ts');
const srcTsFiles = collect(SRC_ROOT, (n) => /\.(ts|tsx)$/.test(n));

function toPosix(absPath: string): string {
  return relative(PROJECT_ROOT, absPath).split(sep).join('/');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ── Guard 3: the M0.2 gate pin ──────────────────────────────────
const M02_GATES: Record<string, string> = {
  'src/app/api/kpi-dashboard/route.ts': 'kpiDashboard',
  'src/app/api/month-snapshots/route.ts': 'kpiDashboard',
  'src/app/api/month-snapshots/[id]/route.ts': 'kpiDashboard',
  'src/app/api/risk-center/route.ts': 'riskCenter',
  'src/app/api/rule-logs/route.ts': 'rulesEngine',
  'src/app/api/employees/route.ts': 'employees',
  'src/app/api/firebase/sync/route.ts': 'firebase',
  'src/app/api/rules/route.ts': 'rulesEngine',
  'src/app/api/deduction-rules/route.ts': 'rules',
};

describe('regression guard — M0.2 permission gates stay pinned', () => {
  it('every M0.2 route keeps verifyPermission with its agreed page key', () => {
    const drifted: string[] = [];
    for (const [relPath, key] of Object.entries(M02_GATES)) {
      const abs = join(PROJECT_ROOT, relPath);
      if (!existsSync(abs)) {
        drifted.push(`${relPath}: route file is gone — update the M0.2 pin`);
        continue;
      }
      const src = stripComments(readFileSync(abs, 'utf8'));
      const gate = new RegExp(
        `verifyPermission\\(\\s*[a-zA-Z_$][\\w$]*\\s*,\\s*'${key}'\\s*,\\s*'view'`
      );
      if (!gate.test(src)) {
        drifted.push(`${relPath}: missing verifyPermission(request, '${key}', 'view')`);
      }
    }
    assert.deepEqual(
      drifted,
      [],
      'M0.2 permission gates must not be dropped or repointed:\n' + drifted.join('\n')
    );
  });
});

// ── Guard 4: permission keys are centrally defined ──────────────
describe('regression guard — no invented permission keys in routes', () => {
  it("every verifyPermission page key exists in APP_PAGES permissionKeys", () => {
    const known = new Set(APP_PAGES.map((p) => p.permissionKey));
    const callRegex = /verifyPermission\(\s*[a-zA-Z_$][\w$]*\s*,\s*'([^']+)'/g;
    const unknown = new Set<string>();

    for (const absPath of routeFiles) {
      const src = stripComments(readFileSync(absPath, 'utf8'));
      callRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = callRegex.exec(src))) {
        if (!known.has(match[1])) unknown.add(`${toPosix(absPath)}: '${match[1]}'`);
      }
    }
    assert.deepEqual(
      [...unknown],
      [],
      'Page keys passed to verifyPermission must be defined in src/config/permissions.ts (APP_PAGES):\n' +
        [...unknown].join('\n')
    );
  });
});

// ── Guard 5: single permission resolver ─────────────────────────
describe('regression guard — single permission resolver', () => {
  it('only src/config/permissions.ts defines resolveEffectivePermissions / getPermissionsForRole', () => {
    const offenders: string[] = [];
    for (const absPath of srcTsFiles) {
      const rel = toPosix(absPath);
      if (rel === 'src/config/permissions.ts') continue;
      if (rel.includes('__tests__')) continue;
      const src = stripComments(readFileSync(absPath, 'utf8'));
      if (/function\s+(resolveEffectivePermissions|getPermissionsForRole)\s*\(/.test(src)) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'A second permission resolver would fork frontend/backend semantics:\n' + offenders.join('\n')
    );
  });
});

// ── Guard 6: no caller-supplied identity for authorization ──────
describe('regression guard — no caller-supplied role/userId trust', () => {
  it('no route compares a request-body role or adopts a body userId as actor', () => {
    const offenders: string[] = [];
    // body(...).role === 'admin' (either operand order) — authorization
    // must never derive from a caller-ASSERTED role. (Comparisons on a
    // db-fetched record's role or the token-authenticated caller's role
    // are legitimate and intentionally not flagged.)
    const roleCompare = /body\??\.role\b\s*===?\s*['"]admin['"]|['"]admin['"]\s*===?\s*body\??\.role\b/;
    // actor-ish identifiers assigned FROM body userId — the authenticated
    // caller (verifyPermission user) is the only valid actor source.
    const actorFromBody = /(?:actor(?:Id|Name)?|createdBy(?:Id|Name)?|performedBy(?:Name)?)\s*[:=]\s*(?:[^;\n]{0,40}?body[^;\n]{0,40}?userId|body\??\.userId)/;

    for (const absPath of routeFiles) {
      const src = stripComments(readFileSync(absPath, 'utf8'));
      if (roleCompare.test(src)) offenders.push(`${toPosix(absPath)}: body role comparison`);
      if (actorFromBody.test(src)) offenders.push(`${toPosix(absPath)}: actor identity from body userId`);
    }
    assert.deepEqual(
      offenders,
      [],
      'Authorization decisions must use the authenticated server-side identity:\n' + offenders.join('\n')
    );
  });
});
