// ══════════════════════════════════════════════════════════════
//  GET/PUT /api/ai/provider-settings — admin provider control
//  foundation (Phase 6.4, §6/§7)
//
//  Admin-only (role === 'admin'). The PUT changes ONLY the non-secret
//  provider/model override; credentials remain env-level and are
//  NEVER stored here, never accepted here, and never returned to the
//  browser (§7). Every change is audited to the existing configAuditLog.
//
//  Provider/model must be explicit — there is no "auto" option and
//  no random selection (§1.7/§4/§5).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { getById } from '@/lib/db';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import {
  getAIProviderSettings,
  isAdminRole,
  updateAIProviderSettings,
} from '@/lib/ai/gateway/provider-settings';

const VALID_PROVIDERS = ['gemini', 'z-ai', 'openai-compatible'] as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();
    if (!isAdminRole(auth.role)) return forbiddenError('هذه الصلاحية للمدير النظامي فقط');

    const settings = await getAIProviderSettings();
    return Response.json({
      status: 'OK',
      settings: {
        provider: settings.provider,
        model: settings.model,
        updatedBy: settings.updatedBy,
        updatedByName: settings.updatedByName,
        updatedAt: settings.updatedAt,
      },
      note: 'بيانات الاعتماد تُدار من متغيرات البيئة على الخادم فقط ولا تُخزَّن هنا أبدًا.',
    });
  } catch (error) {
    logServerFailure('ai-provider-settings', 'GET', error);
    return internalError();
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();
    if (!isAdminRole(auth.role)) return forbiddenError('هذه الصلاحية للمدير النظامي فقط');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationError('جسم الطلب غير صالح');
    }
    const o = (body ?? {}) as Record<string, unknown>;

    // Strict allow-list — ONLY provider/model exist here (§7: no key
    // field at all; a submitted key is ignored by construction).
    const providerRaw = o.provider;
    const modelRaw = o.model;

    let provider: string | null = null;
    if (providerRaw !== null && providerRaw !== undefined && providerRaw !== '') {
      if (typeof providerRaw !== 'string' || !(VALID_PROVIDERS as readonly string[]).includes(providerRaw)) {
        return validationError('قيمة المزود غير مدعومة — المزود يجب أن يكون صريحًا');
      }
      provider = providerRaw;
    }

    let model: string | null = null;
    if (modelRaw !== null && modelRaw !== undefined && modelRaw !== '') {
      if (typeof modelRaw !== 'string' || modelRaw.trim().length < 2 || modelRaw.length > 120) {
        return validationError('معرف الموديل غير صالح');
      }
      model = modelRaw.trim();
    }

    // Actor display name for the audit snapshot (single rare admin action).
    let actorName = auth.userId;
    try {
      const user = await getById<{ name?: string }>('users', auth.userId);
      if (user?.name) actorName = user.name;
    } catch {
      // Name lookup is best-effort — the audit keeps the id either way.
    }

    const settings = await updateAIProviderSettings({
      actorId: auth.userId,
      actorName,
      provider: provider as 'gemini' | 'z-ai' | 'openai-compatible' | null,
      model,
    });

    return Response.json({
      status: 'OK',
      settings: {
        provider: settings.provider,
        model: settings.model,
        updatedAt: settings.updatedAt,
        updatedByName: settings.updatedByName,
      },
    });
  } catch (error) {
    logServerFailure('ai-provider-settings', 'PUT', error);
    return internalError();
  }
}
