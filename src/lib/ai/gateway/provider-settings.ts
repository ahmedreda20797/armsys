// ══════════════════════════════════════════════════════════════
//  AI Gateway — admin provider settings (Phase 6.4, spec §6/§7)
//
//  FOUNDATION for Settings → AI → Provider Management (full control
//  center arrives in Phase 6.10). What exists NOW:
//
//    • a NON-SECRET runtime override for provider + model, stored in
//      the additive RTDB node arm_erp/aiProviderSettings;
//    • RESOLUTION ORDER: settings override (when set) > env
//      AI_PROVIDER / AI_MODEL. The master kill-switch stays env-level
//      (AI_ENABLED) and credentials stay env-level (AI_API_KEY) —
//      §7: API keys are NEVER ordinary readable Firebase data, never
//      stored via this module, never returned to any browser;
//    • every change is written to the EXISTING configAuditLog
//      (reuse — no parallel audit architecture, §6);
//    • every entry point is admin-only (role === 'admin', the
//      existing ARM administrator definition — no parallel
//      permission architecture, §6).
//
//  What a PUT may change: provider id + model id ONLY. Nothing here
//  can disable ARM, touch business data, or elevate anyone.
// ══════════════════════════════════════════════════════════════

import { getAll, createRecord, createRecordWithId, updateRecord, invalidateCache } from '@/lib/db';
import { writeAudit } from '@/lib/audit/server-audit-logger';
import type { AIProviderKind } from '../provider/config';

export const AI_PROVIDER_SETTINGS_TABLE = 'aiProviderSettings';

export interface AIProviderSettings {
  /** null ⇒ use env AI_PROVIDER / AI_MODEL. */
  provider: AIProviderKind | null;
  model: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
}

const SETTINGS_ID = 'singleton';

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}

export async function getAIProviderSettings(): Promise<AIProviderSettings> {
  // NOTE: getAll (+ in-code filter) rather than findWhere — one fewer
  // module surface, identical semantics for a singleton row.
  const rows = await getAll<Record<string, unknown>>(AI_PROVIDER_SETTINGS_TABLE);
  const row = rows.find((r) => r && (r as { id?: string }).id === SETTINGS_ID) ?? rows[0] ?? null;
  if (!row) {
    return { provider: null, model: null, updatedBy: null, updatedByName: null, updatedAt: null };
  }
  const provider = typeof row.provider === 'string' && ['gemini', 'z-ai', 'openai-compatible'].includes(row.provider)
    ? (row.provider as AIProviderKind)
    : null;
  const model = typeof row.model === 'string' && row.model.trim() ? row.model.trim() : null;
  return {
    provider,
    model,
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : null,
    updatedByName: typeof row.updatedByName === 'string' ? row.updatedByName : null,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  };
}

export interface UpdateAIProviderSettingsInput {
  actorId: string;
  actorName: string;
  provider: AIProviderKind | null;
  model: string | null;
}

/** Admin-only activation of a provider/model. Writing null values
 *  clears the override (falls back to env). Audited to configAuditLog. */
export async function updateAIProviderSettings(input: UpdateAIProviderSettingsInput): Promise<AIProviderSettings> {
  const before = await getAIProviderSettings();
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : null;
  const provider = input.provider;

  const existing = await getAll<Record<string, unknown>>(AI_PROVIDER_SETTINGS_TABLE);
  const row = existing.find((r) => (r as { id?: string }).id === SETTINGS_ID) ?? null;

  const payload = {
    provider,
    model,
    updatedBy: input.actorId,
    updatedByName: input.actorName,
    updatedAt: new Date().toISOString(),
  };

  if (row) {
    await updateRecord(AI_PROVIDER_SETTINGS_TABLE, SETTINGS_ID, payload);
  } else {
    await createRecordWithId(AI_PROVIDER_SETTINGS_TABLE, SETTINGS_ID, payload);
  }
  invalidateCache(AI_PROVIDER_SETTINGS_TABLE);

  await writeAudit({
    collection: 'configAuditLog',
    actorId: input.actorId,
    actorName: input.actorName,
    action: 'ai-provider-settings-update',
    entityType: 'aiProviderSettings',
    entityId: SETTINGS_ID,
    monthKey: null,
    before: { provider: before.provider, model: before.model },
    after: { provider, model },
    details: `تحديث إعدادات مزود الذكاء الاصطناعي: provider=${provider ?? 'env-default'}, model=${model ?? 'env-default'}`,
  });

  return getAIProviderSettings();
}
