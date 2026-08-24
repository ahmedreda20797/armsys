// ══════════════════════════════════════════════════════════════
//  M0.2.1 regression guards — static analysis of API route files
//
//  Guard 7 (M0.2.1 gate pin): each M0.2.1-aligned route must keep
//  its verifyPermission gate with the agreed page key.
//
//  Guard 8 (CAPA actor pin): the capa-cases POST must derive its
//  authoritative actor (createdBy/createdByName/timeline performedBy)
//  from the authenticated caller — body.createdBy/createdByName must
//  not reappear as an actor source.
//
//  Guard 9 (no caller-supplied actor identity — broadened): no route
//  may assign an actor-ish identity field FROM any request-body
//  identity field. Extends the M0.2 guard (which covered only
//  body.userId) to body.createdBy / body.actorId / body.role.
//
//  (Guards 1–6 from M0.1/M0.2 — auth coverage, await discipline,
//  gate pins, APP_PAGES-only keys, single resolver, no body-role
//  comparisons — remain in their own files and stay in force.)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const API_ROOT = join(PROJECT_ROOT, 'src', 'app', 'api');

function collect(dir: string, filter: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, filter, out);
    else if (filter(entry.name)) out.push(path);
  }
  return out;
}

const routeFiles = collect(API_ROOT, (n) => n === 'route.ts');

function toPosix(absPath: string): string {
  return relative(PROJECT_ROOT, absPath).split(sep).join('/');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ── Guard 7: the M0.2.1 gate pin ───────────────────────────────
const M021_GATES: Record<string, string> = {
  'src/app/api/quality-observations/route.ts': 'observations',
  'src/app/api/observation-categories/route.ts': 'observationCategories',
  'src/app/api/kpi-settings/route.ts': 'kpiSettings',
};

describe('regression guard — M0.2.1 permission gates stay pinned', () => {
  it('every M0.2.1 route keeps verifyPermission with its agreed page key', () => {
    const drifted: string[] = [];
    for (const [relPath, key] of Object.entries(M021_GATES)) {
      const abs = join(PROJECT_ROOT, relPath);
      if (!existsSync(abs)) {
        drifted.push(`${relPath}: route file is gone — update the M0.2.1 pin`);
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
      'M0.2.1 permission gates must not be dropped or repointed:\n' + drifted.join('\n')
    );
  });
});

// ── Guard 8: CAPA POST actor comes from the authenticated caller ─
describe('regression guard — CAPA POST actor identity stays authenticated', () => {
  const CAPA_ROUTE = 'src/app/api/capa-cases/route.ts';

  it('the capa-cases route never adopts body.createdBy as the actor and resolves the actor from the token identity', () => {
    const abs = join(PROJECT_ROOT, CAPA_ROUTE);
    assert.ok(existsSync(abs), `${CAPA_ROUTE} is gone — update the M0.2.1 pin`);
    const src = stripComments(readFileSync(abs, 'utf8'));

    // Request-body identity must not be an actor source anywhere in the
    // route (this covers the record fields AND the timeline events).
    const bodyActor = /(?:createdBy(?:Id|Name)?|performedBy(?:Name)?|actor(?:Id|Name)?)\s*[:=]\s*[^;\n]{0,40}body(?:\?\.\w+|\.createdBy\w*|\.actorId|\.userId)/;
    assert.ok(
      !bodyActor.test(src),
      'capa-cases route derives an actor field from a request-body identity — the authenticated caller must be the only actor source'
    );

    // The authenticated-actor resolution (M0.1 PUT / M0.2.1 POST pattern)
    // must remain present.
    assert.ok(
      /permCheck\.user/.test(src),
      'capa-cases route must resolve the actor from permCheck.user (the token-authenticated identity)'
    );
  });
});

// ── Guard 9: no caller-supplied actor identity in ANY route ────
describe('regression guard — no actor identity from request-body identity fields', () => {
  it('no route assigns actor/createdBy/performedBy fields from body identity fields', () => {
    const offenders: string[] = [];
    // An actor-ish field assigned from ANY request-body identity field.
    // (M0.2's guard covered body.userId only; M0.2.1 extends the class
    // to body.createdBy / body.actorId / body.role, closing the gap the
    // capa-cases POST slipped through.)
    const actorFromBody = /(?:actor(?:Id|Name)?|createdBy(?:Id|Name)?|performedBy(?:Name)?)\s*[:=]\s*[^;\n]{0,40}?body\??\.(?:createdBy\w*|actorId|userId|role)\b/;

    for (const absPath of routeFiles) {
      const src = stripComments(readFileSync(absPath, 'utf8'));
      if (actorFromBody.test(src)) offenders.push(`${toPosix(absPath)}: actor identity from request body`);
    }
    assert.deepEqual(
      offenders,
      [],
      'Actor identity must come from the authenticated server-side identity only:\n' + offenders.join('\n')
    );
  });
});
