// ══════════════════════════════════════════════════════════════
//  /api/user-preferences — PERSONAL workspace configuration
//
//  GET    — the caller's own preferences (requireAuth)
//  PUT    — save (whitelisted shape only, sanitized)
//  DELETE — reset to defaults (Personal Workspace Recovery)
//
//  SECURITY / ISOLATION:
//    • The record key is ALWAYS the authenticated userId from the
//      JWT — a body-supplied userId is never trusted, so one user
//      can never read or write another user's workspace.
//    • Sidebar/dashboard preferences carry NO security meaning:
//      the client re-filters every saved order/visibility against
//      CURRENT permissions on every read (reconcile functions), and
//      the server strips them from API responses wherever pages
//      enforce visibility. Personalization is UX, never access.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord, createRecordWithId, deleteRecord } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import {
  validationError, unauthorizedError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import {
  USER_PREFERENCES_TABLE,
  sanitizeUserPreferencesInput,
  type UserPreferences,
} from '@/lib/personalization';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const record = await getById<UserPreferences>(USER_PREFERENCES_TABLE, auth.userId);
    return Response.json({
      userId: auth.userId,
      sidebar: record?.sidebar ?? {},
      dashboard: record?.dashboard ?? {},
      updatedAt: record?.updatedAt ?? null,
    });
  } catch (error) {
    logServerFailure('user-preferences', 'GET', error);
    return internalError();
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const body = await request.json().catch(() => null);
    const sanitized = sanitizeUserPreferencesInput(body);
    if (!sanitized) {
      return validationError('صيغة التفضيلات غير صالحة');
    }

    const existing = await getById<UserPreferences>(USER_PREFERENCES_TABLE, auth.userId);
    // Merge over the previous record so a partial PUT (sidebar only)
    // never wipes the dashboard preferences.
    const merged: UserPreferences = {
      sidebar: { ...(existing?.sidebar ?? {}), ...(sanitized.sidebar ?? {}) },
      dashboard: { ...(existing?.dashboard ?? {}), ...(sanitized.dashboard ?? {}) },
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await updateRecord(USER_PREFERENCES_TABLE, auth.userId, merged as unknown as Record<string, unknown>);
    } else {
      await createRecordWithId(USER_PREFERENCES_TABLE, auth.userId, {
        ...merged,
        userId: auth.userId,
      } as unknown as Record<string, unknown>);
    }

    return Response.json({ success: true, preferences: merged });
  } catch (error) {
    logServerFailure('user-preferences', 'PUT', error);
    return internalError();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    await deleteRecord(USER_PREFERENCES_TABLE, auth.userId);
    return Response.json({ success: true });
  } catch (error) {
    logServerFailure('user-preferences', 'DELETE', error);
    return internalError();
  }
}
