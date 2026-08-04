// ══════════════════════════════════════════════════════════════
//  Consistent API error responses (Observability rule)
//
//  Single factory for the standard error object shape used across all
//  new API routes:
//
//    { error: { code: string, message: string, details?: unknown, validation?: boolean } }
//
//  Validation failures (client input) use 4xx + validation:true.
//  Runtime failures use 5xx + validation:false.
//  This keeps them distinguishable for clients and structured logs.
// ══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

/** Stable, machine-readable error codes. */
export const ErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  LOCKED: 'LOCKED', // e.g. month closed / immutable snapshot
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  code: ErrorCodeValue;
  message: string;
  details?: unknown;
  /** true = client input problem (4xx); false/absent = server problem. */
  validation?: boolean;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

/** Build a JSON error response with the canonical shape. */
export function apiError(
  status: number,
  code: ErrorCodeValue,
  message: string,
  options?: { details?: unknown; validation?: boolean },
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = {
    error: {
      code,
      message,
      details: options?.details,
      validation: options?.validation,
    },
  };
  return NextResponse.json(body, { status });
}

/** Convenience: 400 validation error. */
export function validationError(message: string, details?: unknown): NextResponse<ApiErrorResponse> {
  return apiError(400, ErrorCode.VALIDATION, message, { details, validation: true });
}

/** Convenience: 401 unauthorized. */
export function unauthorizedError(message = 'لم يتم المصادقة على المستخدم'): NextResponse<ApiErrorResponse> {
  return apiError(401, ErrorCode.UNAUTHORIZED, message);
}

/** Convenience: 403 forbidden. */
export function forbiddenError(message = 'صلاحية غير كافية'): NextResponse<ApiErrorResponse> {
  return apiError(403, ErrorCode.FORBIDDEN, message);
}

/** Convenience: 404 not found. */
export function notFoundError(message = 'السجل غير موجود'): NextResponse<ApiErrorResponse> {
  return apiError(404, ErrorCode.NOT_FOUND, message);
}

/** Convenience: 409 conflict (e.g. duplicate). */
export function conflictError(message: string, details?: unknown): NextResponse<ApiErrorResponse> {
  return apiError(409, ErrorCode.CONFLICT, message, { details, validation: true });
}

/** Convenience: 423 locked (immutable closed month). */
export function lockedError(message = 'الشهر مغلق ولا يمكن تعديله'): NextResponse<ApiErrorResponse> {
  return apiError(423, ErrorCode.LOCKED, message);
}

/** Convenience: 500 internal error — never leaks internals to the client. */
export function internalError(message = 'حدث خطأ داخلي في الخادم'): NextResponse<ApiErrorResponse> {
  return apiError(500, ErrorCode.INTERNAL, message);
}

/**
 * Structured server logger for unexpected failures. Emits a single
 * parseable object to stderr so logs can be aggregated and queried.
 * Never throws; safe inside catch blocks.
 */
export function logServerFailure(module: string, op: string, error: unknown, context?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    level: 'error',
    module,
    op,
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Unknown',
  };
  if (context && Object.keys(context).length > 0) {
    payload.context = context;
  }
  if (error instanceof Error && error.stack) {
    payload.stack = error.stack;
  }
  console.error(JSON.stringify(payload));
}
