// ══════════════════════════════════════════════════════════════
//  AI Tool layer — enforcement runtime (Phase 6.4, spec §12/§13)
//
//  The ONLY way any AI feature may execute a tool. Order of guards
//  (fail-closed, each independent):
//    1. TOOL_UNKNOWN     — name not in the registry
//    2. TOOL_DISABLED    — category not enabled (writes today, §13)
//    3. PERMISSION_DENIED — caller lacks the EXISTING ARM permission
//                           (admin bypass follows the same doctrine
//                           as verifyPermission, §11/§6)
//    4. INVALID_ARGS     — strict argument validation (untrusted input)
//    5. OUT_OF_SCOPE     — employee-targeting args outside the caller's
//                          resolved scope (fail-closed, §11)
//    6. EXECUTION_ERROR  — tool failures are contained, never thrown
//
//  The runtime NEVER returns secrets and NEVER bypasses deterministic
//  calculations (§1/§12).
// ══════════════════════════════════════════════════════════════

import { verifyPermissionForUser } from './permission-check';
import type {
  AIToolArgsValidation,
  AIToolCaller,
  AIToolDefinition,
  AIToolExecutionOutcome,
} from './types';
import { ENABLED_TOOL_CATEGORIES } from './types';
import { getAITool } from './registry';

/** Employee-targeting tools declare which arg holds the employeeId so
 *  the runtime can enforce scope BEFORE the tool body runs. */
export interface EmployeeScopedArgs {
  employeeId?: unknown;
}

function isEmployeeScopedDefinition(tool: AIToolDefinition<never, never>): boolean {
  return tool.name === 'getEmployeeProfile' || tool.name === 'getQualityObservations';
}

export async function executeAITool(
  name: string,
  args: unknown,
  caller: AIToolCaller,
): Promise<AIToolExecutionOutcome> {
  // 1) Registry lookup
  const tool = getAITool(name);
  if (!tool) {
    return { ok: false, reason: 'TOOL_UNKNOWN', error: `الأداة غير مسجلة: ${name}` };
  }

  // 2) Governance category gate (§13 — READ_ONLY only in this phase)
  if (!ENABLED_TOOL_CATEGORIES.includes(tool.category)) {
    return {
      ok: false,
      reason: 'TOOL_DISABLED',
      error: `أداة من فئة ${tool.category} غير مفعلة حاليًا`,
    };
  }

  // 3) Existing-permission gate (§11 — the authorization layer wins)
  if (tool.requiredPermission) {
    const check = verifyPermissionForUser(
      caller.permissions,
      caller.role,
      tool.requiredPermission.pageId,
      tool.requiredPermission.action,
    );
    if (!check.allowed) {
      return { ok: false, reason: 'PERMISSION_DENIED', error: check.error ?? 'صلاحية غير كافية' };
    }
  }

  // 4) Strict argument validation (the model's args are untrusted)
  let validated: AIToolArgsValidation<unknown>;
  try {
    validated = tool.validateArgs(args);
  } catch {
    return { ok: false, reason: 'INVALID_ARGS', error: 'تعذر التحقق من معاملات الأداة' };
  }
  if (!validated.ok) {
    return { ok: false, reason: 'INVALID_ARGS', error: validated.error };
  }

  // 5) Employee-scope enforcement BEFORE any tool body runs (§11)
  if (isEmployeeScopedDefinition(tool)) {
    const employeeId = (validated.value as EmployeeScopedArgs).employeeId;
    if (typeof employeeId === 'string' && employeeId && !caller.scope.includes(employeeId)) {
      // Anti-enumeration: a generic denial, never "exists elsewhere".
      return { ok: false, reason: 'OUT_OF_SCOPE', error: 'السجل خارج نطاق صلاحياتك' };
    }
  }

  // 6) Contained execution
  try {
    const result = await ((tool.execute as unknown) as (a: unknown, c: AIToolCaller) => Promise<unknown>)(
      validated.value,
      caller,
    );
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      reason: 'EXECUTION_ERROR',
      error: error instanceof Error ? `فشل تنفيذ الأداة (${error.name})` : 'فشل تنفيذ الأداة',
    };
  }
}
