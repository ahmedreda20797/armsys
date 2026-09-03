// ══════════════════════════════════════════════════════════════
//  AI Tool layer — contract (Phase 6.4, spec §12/§13)
//
//  The AI interacts with ARM through CONTROLLED TOOLS, never raw
//  database access. Every tool:
//    • authenticates the user (identity is server-derived, §30)
//    • authorizes the user against the EXISTING permission map (§11)
//    • validates arguments (strict allow-list)
//    • enforces the caller's employee scope (fail-closed, §11)
//    • returns MINIMAL data (§9) — never secrets, never RESTRICTED
//    • never bypasses deterministic calculations (§1)
//
//  GOVERNANCE CATEGORIES (§13):
//    READ_ONLY         — enabled in this phase
//    SAFE_WRITE        — registered-but-disabled (future, explicit
//                        human confirmation + existing authorization)
//    SENSITIVE_WRITE   — registered-but-disabled (never autonomous)
//    ADMIN_ONLY        — registered-but-disabled
// ══════════════════════════════════════════════════════════════

import type { PermissionsMap } from '@/config/permissions';
import type { EmployeeScopeContext } from '@/lib/scope';

export type AIToolCategory = 'READ_ONLY' | 'SAFE_WRITE' | 'SENSITIVE_WRITE' | 'ADMIN_ONLY';

/** Phase 6.4 enables READ_ONLY ONLY (spec §13). Future phases may
 *  widen this AFTER explicit human-confirmation flows exist. */
export const ENABLED_TOOL_CATEGORIES: readonly AIToolCategory[] = ['READ_ONLY'];

export interface AIToolCaller {
  /** Server-derived identity (from the authenticated session — §30). */
  userId: string;
  userName: string;
  role: string;
  permissions: PermissionsMap;
  linkedEmployeeId?: string | null;
  /** Employee scope resolved ONCE per request by the caller route. */
  scope: EmployeeScopeContext;
}

export interface AIToolPermissionRequirement {
  /** Existing APP_PAGES page id or permissionKey — NO parallel system (§6). */
  pageId: string;
  /** Existing action vocabulary: 'view' | 'edit' | ActionKey. */
  action: 'view' | 'edit' | 'create' | 'update' | 'delete' | 'export' | 'approve' | 'upload' | 'override';
}

export type AIToolArgsValidation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface AIToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  category: AIToolCategory;
  /** One-line Arabic description for the future planner (Phase 6.6). */
  description: string;
  /** Existing permission the CALLER must already hold (§11). */
  requiredPermission: AIToolPermissionRequirement | null;
  /** Strict argument validation — the model's arguments are untrusted. */
  validateArgs: (args: unknown) => AIToolArgsValidation<TArgs>;
  /** The execution body. Receives the validated args + caller context. */
  execute: (args: TArgs, caller: AIToolCaller) => Promise<TResult>;
}

export type AIToolExecutionOutcome<TResult = unknown> =
  | { ok: true; result: TResult }
  | {
      ok: false;
      reason:
        | 'TOOL_UNKNOWN'
        | 'TOOL_DISABLED'
        | 'PERMISSION_DENIED'
        | 'INVALID_ARGS'
        | 'OUT_OF_SCOPE'
        | 'EXECUTION_ERROR';
      error: string;
    };
