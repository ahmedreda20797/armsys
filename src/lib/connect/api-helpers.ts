// src/lib/connect/api-helpers.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — API ROUTE HELPERS
//
//  Thin glue between route handlers and the domain services.
//
//  AUTH GATE: every route calls the CANONICAL authorizeRequest entry
//  directly (page 'connect', action 'view') — the same authenticate+
//  authorize primitive all other modules use, request-memoized.
//  (An earlier draft hid this behind a connectCaller wrapper; the
//  route-auth regression guard rightly wants the canonical marker
//  visible IN each route file — see route-auth-regression.test.ts.)
//
//  The error mapper maps AccessDeniedError kinds to 404/403/410
//  (enumeration-safe), MessageValidationError → 400, everything
//  unexpected → 500 with structured logging. Route handlers stay
//  THIN (§SPEC-4): parse input → call service → return JSON.
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { NextResponse } from 'next/server';
import { apiError, ErrorCode, logServerFailure } from '@/lib/api-error';
import { AccessDeniedError } from '@/lib/connect/membership';
import { MessageValidationError } from '@/lib/connect/message-service';

/** Status map for the membership primitive's denial kinds. */
export function accessDeniedStatus(kind: AccessDeniedError['kind']): number {
  switch (kind) {
    case 'not_found': return 404;
    case 'forbidden': return 403;
    case 'gone': return 410;
  }
}

/**
 * Map ANY Connect service failure to the canonical API error shape.
 * Never leaks internals for 500s.
 */
export function connectErrorResponse(error: unknown, route: string): NextResponse {
  if (error instanceof AccessDeniedError) {
    return apiError(accessDeniedStatus(error.kind), ErrorCode.NOT_FOUND, error.message);
  }
  if (error instanceof MessageValidationError) {
    return apiError(400, ErrorCode.VALIDATION, error.message, { validation: true });
  }
  // Domain guards thrown as typed Error codes (service contracts).
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('USERS_NOT_FOUND:')) {
    return apiError(400, ErrorCode.VALIDATION, 'بعض المستخدمين المحددين غير موجودين', { validation: true });
  }
  if (message === 'DIRECT_SELF_FORBIDDEN') {
    return apiError(400, ErrorCode.VALIDATION, 'لا يمكن إنشاء محادثة مباشرة مع نفسك', { validation: true });
  }
  if (message.startsWith('GROUP_TOO_LARGE')) {
    return apiError(400, ErrorCode.VALIDATION, message, { validation: true });
  }
  if (message === 'MEMBER_NOT_ACTIVE') {
    return apiError(404, ErrorCode.NOT_FOUND, 'العضو غير موجود أو لم يعد عضواً');
  }
  if (message === 'OWNER_IRREMOVABLE') {
    return apiError(409, ErrorCode.CONFLICT, 'لا يمكن إزالة مالك المجموعة — انقل الملكية أولاً');
  }
  if (message === 'OWNER_MUST_TRANSFER') {
    return apiError(409, ErrorCode.CONFLICT, 'مالك المجموعة يجب أن ينقل الملكية قبل المغادرة');
  }
  if (message === 'SELF_ROLE_CHANGE_FORBIDDEN') {
    return apiError(400, ErrorCode.VALIDATION, 'لا يمكن تغيير دورك الخاص');
  }
  if (message === 'DIRECT_CREATE_RACE') {
    return apiError(500, ErrorCode.INTERNAL, 'تعارض مؤقت أثناء إنشاء المحادثة — أعد المحاولة');
  }

  logServerFailure('connect/api', route, error);
  return apiError(500, ErrorCode.INTERNAL, 'حدث خطأ داخلي في الخادم');
}
