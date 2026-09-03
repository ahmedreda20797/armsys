// ══════════════════════════════════════════════════════════════
//  POST /api/ai/quality-analysis — Smart Quality AI (Phase 6.2)
//
//  THE ONLY AI entry point. The browser can NEVER reach a provider
//  directly (spec §7) — everything behind this thin, read-only shell:
//
//    requireAuth → kpiReports:view → body validation
//      → employee scope (fail-closed 404, anti-enumeration)
//      → rate protection (§34)
//      → getEmployeePerformanceDataset (the SAME verified dataset
//        as Performance Intelligence / Analytics — no second path)
//      → runQualityAIAnalysis (analytics → input builder →
//        sufficiency gate → provider → strict validation)
//
//  AUTHORIZATION (spec §8): the AI never sees content the caller
//  cannot see — the dataset is fetched ONLY after permission +
//  scope, exactly like the existing analytics/PI routes.
//
//  Business outcomes are 200 envelopes (NO_DATA / AI_UNAVAILABLE /
//  ...); auth and validation follow the existing HTTP doctrine.
//  READ-ONLY — this route performs no writes anywhere (§3/§12).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  notFoundError,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { monthKeyOf } from '@/lib/kpi-reporting/period-basis';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import {
  getEmployeePerformanceDataset,
  DEFAULT_WINDOW_MONTHS,
  MAX_WINDOW_MONTHS,
  MIN_WINDOW_MONTHS,
} from '@/lib/performance-intelligence';
import { runQualityAIAnalysis } from '@/lib/ai/quality/service';
import { checkQualityAIRateLimit } from '@/lib/ai/quality/cache';
import { getAIProviderSettings, type AIProviderSettings } from '@/lib/ai/gateway/provider-settings';

// Phase 6.5-A §14: real analysis latency measured at ~30s (glm-4.6).
// Vercel functions default to a 10s limit — this declares the intent
// explicitly (the platform clamps it to the plan's real maximum).
// AI_TIMEOUT_MS MUST stay below this value.
export const maxDuration = 60;

interface ParsedAiBody {
  employeeId: string;
  month: string;
  windowMonths: number;
  minOccurrences: number;
}

function parseAiQualityBody(body: unknown): { ok: true; value: ParsedAiBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'جسم الطلب غير صالح' };
  }
  const o = body as Record<string, unknown>;

  // ONLY these fields exist — the client can never send permission,
  // scope or provider parameters (spec §7/§8).
  const employeeId = typeof o.employeeId === 'string' ? o.employeeId.trim() : '';
  if (!employeeId) return { ok: false, error: 'employeeId مطلوب' };

  const month = typeof o.month === 'string' && o.month.trim() ? o.month.trim() : monthKeyOf(new Date());
  const monthError = validateMonthKey(month);
  if (monthError) return { ok: false, error: monthError };

  const windowParam = Number(o.windowMonths);
  const windowMonths = Number.isFinite(windowParam) && windowParam >= 1
    ? Math.min(Math.floor(windowParam), MAX_WINDOW_MONTHS)
    : DEFAULT_WINDOW_MONTHS;
  if (Number.isFinite(windowParam) && windowParam >= 1 &&
      (windowMonths < MIN_WINDOW_MONTHS || windowMonths > MAX_WINDOW_MONTHS)) {
    return { ok: false, error: `windowMonths يجب أن يكون بين ${MIN_WINDOW_MONTHS} و ${MAX_WINDOW_MONTHS}` };
  }

  const minOccParam = Number(o.minOccurrences);
  const minOccurrences = Number.isFinite(minOccParam) && minOccParam >= 2
    ? Math.floor(minOccParam)
    : 2;

  return { ok: true, value: { employeeId, month, windowMonths, minOccurrences } };
}

export async function POST(request: NextRequest) {
  try {
    // ── Authentication (JWT Bearer — existing doctrine) ──
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // ── Permission: the SAME key as KPI Reports / Smart Quality Report ──
    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    // ── Body validation (strict allow-list) ──
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationError('جسم الطلب غير صالح');
    }
    const parsed = parseAiQualityBody(body);
    if (!parsed.ok) return validationError(parsed.error);
    const { employeeId, month, windowMonths, minOccurrences } = parsed.value;

    // ── Employee scope on the TARGET (fail-closed 404, anti-enumeration) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user), undefined, permCheck.user.permissions,
    );
    if (!scopeCtx.isUnrestricted && !scopeCtx.includes(employeeId)) {
      return notFoundError('الموظف غير موجود');
    }

    // ── Rate protection (§34 — per user, sliding window) ──
    if (!checkQualityAIRateLimit(permCheck.user.id)) {
      return Response.json({
        status: 'AI_RATE_LIMITED',
        message: 'عدد كبير من طلبات التحليل الذكي — انتظر قليلاً ثم أعد المحاولة.',
      });
    }

    // ── ONE verified dataset from the existing service (spec §9) ──
    const dataset = await getEmployeePerformanceDataset({
      employeeId,
      monthKey: month,
      windowMonths,
      minOccurrences,
    });
    if (!dataset) return notFoundError('الموظف غير موجود');

    // ── Admin provider-settings override (non-secret; Phase 6.4 §6) ──
    // Fetched HERE (inside the route's DB context) and injected into
    // the gateway resolution — the gateway core itself stays DB-free.
    let settings: AIProviderSettings | null = null;
    try {
      settings = await getAIProviderSettings();
    } catch {
      settings = null; // store unavailable → env-only resolution
    }

    // ── AI pipeline (never throws — explicit statuses, §53) ──
    const response = await runQualityAIAnalysis({ dataset, userId: permCheck.user.id, settings });
    return Response.json(response);
  } catch (error) {
    logServerFailure('ai-quality-analysis', 'POST', error);
    return internalError();
  }
}
