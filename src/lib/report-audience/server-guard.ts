// ══════════════════════════════════════════════════════════════
//  Report audience — SERVER enforcement helpers
//
//  The single guard every TECHNICAL (full-detail) reporting route
//  applies after its own permission check: resolve the caller's
//  report audience from the SAME effective permission map the route
//  already holds (no second permission system) and refuse non-
//  technical audiences BEFORE any data is read or serialized.
//  Technical data is never sent to an HR audience to be hidden in
//  the frontend — it never leaves the server.
// ══════════════════════════════════════════════════════════════

import { forbiddenError } from '@/lib/api-error';
import type { PermissionsMap } from '@/config/permissions';
import {
  audienceMayReceiveTechnicalReports,
  resolveReportAudience,
} from './profiles';

/** The audience-bearing slice of VerifyResult.user. */
export interface AudienceCapableUser {
  role: string | null | undefined;
  permissions: PermissionsMap | null | undefined;
}

/**
 * Guard for technical KPI report routes. Returns a 403 Response when
 * the caller's audience may not receive technical reports (HR /
 * TEAM_LEADER — they are directed to their own audience report), or
 * null when the caller may proceed.
 */
export function technicalReportAudienceGuard(user: AudienceCapableUser): Response | null {
  const audience = resolveReportAudience({
    role: user.role,
    permissions: user.permissions,
  });
  if (audienceMayReceiveTechnicalReports(audience)) return null;
  return forbiddenError(
    'هذا التقرير فني ومخصص لوظائف الجودة — استخدم تقرير الموارد البشرية لأداء الموظفين',
  );
}
