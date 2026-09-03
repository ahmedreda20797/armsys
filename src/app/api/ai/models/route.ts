// ══════════════════════════════════════════════════════════════
//  GET /api/ai/models — REAL supported Gemini models (Phase 6.5-A, §3)
//
//  Admin-only. Queries the configured Gemini account/endpoint and
//  returns the SAFE list of model ids that actually support
//  generateContent — so the administrator can EXPLICITLY pick
//  AI_MODEL from reality instead of documentation guesses.
//
//  NEVER: selects a model, auto-configures anything, exposes the
//  API key, or propagates a raw provider error body.
//  Models that do NOT support generateContent are still listed
//  (flagged) for transparency — but flagged as unusable by ARM.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { forbiddenError, internalError, logServerFailure, unauthorizedError } from '@/lib/api-error';
import { readAISafeDiagnostics } from '@/lib/ai/provider/config';
import { discoverGeminiModels } from '@/lib/ai/provider/models';
import { isAdminRole } from '@/lib/ai/gateway/provider-settings';
import { checkAIRateLimit } from '@/lib/ai/gateway/rate-limit';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();
    if (!isAdminRole(auth.role)) return forbiddenError('هذه الصلاحية للمدير النظامي فقط');

    // Discovery hits the real provider endpoint — rate-limited (§15/§23).
    if (!checkAIRateLimit(auth.userId, 'health')) {
      return Response.json(
        { status: 'RATE_LIMITED', message: 'طلبات فحص كثيرة — انتظر لحظة ثم أعد المحاولة.' },
        { status: 429 },
      );
    }

    const diagnostics = readAISafeDiagnostics();
    const discovery = await discoverGeminiModels();

    const usable = discovery.models
      .filter((m) => m.supportsGenerate)
      .map((m) => ({ id: m.id, displayName: m.displayName }));
    const flagged = discovery.models
      .filter((m) => !m.supportsGenerate)
      .map((m) => ({ id: m.id, displayName: m.displayName }));

    return Response.json({
      status: 'OK',
      discovery: {
        attempted: discovery.attempted,
        reachable: discovery.reachable,
        authenticated: discovery.authenticated,
        discoveryStatus: discovery.status,
        errorCategory: discovery.errorCategory,
        latencyMs: discovery.latencyMs,
        currentProvider: diagnostics.providerId,
        currentModelConfigured: diagnostics.modelConfigured,
      },
      // SAFE ids/names ONLY — the admin chooses EXPLICITLY (§3):
      // set AI_MODEL=<one of usable[].id> — the system never does it.
      usableModels: usable,
      nonGenerativeModels: flagged,
      note: 'اختر الموديل صراحةً عبر AI_MODEL — النظام لا يختار تلقائيًا أبدًا. القائمة تعرض ما يدعمه حسابك فعليًا الآن.',
    });
  } catch (error) {
    logServerFailure('ai-models', 'GET', error);
    return internalError();
  }
}
