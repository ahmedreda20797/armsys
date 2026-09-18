// ══════════════════════════════════════════════════════════════
//  GET /api/reports/filter-options
//
//  Real filter vocabularies for report filter bars — the employee's
//  REAL organization assignment (org-tree authority), scoped to the
//  caller's authorized employee scope:
//    { departments: string[], teams: string[] }
//
//  A department/team Select built from this endpoint can never offer
//  a value that is not a real assignment of a REAL, in-scope
//  employee — and the run route re-applies the same scope, so the
//  options can never widen what the caller may see.
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { authScopeViewer, filterEmployeesInScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { loadEmployeeOrgRefs, uniqueDepartments, uniqueTeams } from '@/lib/reports/employee-org';
import { internalError, logServerFailure, unauthorizedError } from '@/lib/api-error';

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAuth(_request);
    if (!auth) return unauthorizedError('يجب تسجيل الدخول');

    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    const refs = await loadEmployeeOrgRefs();
    const scoped = filterEmployeesInScope(refs, scopeCtx);

    return NextResponse.json({
      departments: uniqueDepartments(scoped),
      teams: uniqueTeams(scoped),
    });
  } catch (error) {
    logServerFailure('reports-filter-options', 'GET', error);
    return internalError();
  }
}
