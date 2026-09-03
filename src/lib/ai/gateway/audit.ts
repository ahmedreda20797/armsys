// ══════════════════════════════════════════════════════════════
//  AI Gateway — audit records (Phase 6.4, spec §22)
//
//  Every AI request leaves ONE audit record describing WHO asked,
//  WHICH provider/model answered, WHAT category of data was in
//  scope, and WHAT happened — WITHOUT any of:
//    • API keys / credentials / tokens
//    • raw provider payloads (prompt or completion content)
//    • unrestricted raw employee data or unnecessary PII
//
//  Storage: the additive RTDB node arm_erp/aiAuditLog via the SAME
//  generic writeAudit doctrine (fire-and-forget, never throws).
//  Reads are admin-only (Phase 6.10 control center); the node is
//  additive — zero migration of existing data (§38).
// ══════════════════════════════════════════════════════════════

import { writeAudit } from '@/lib/audit/server-audit-logger';
import type { DataClassification } from './classification';
import type { AIStatus } from './status';

export const AI_AUDIT_COLLECTION = 'aiAuditLog';

export interface AIAuditInput {
  /** ARM user id (server-derived — NEVER a client-provided id, §30). */
  userId: string;
  /** Display name snapshot (same doctrine as the generic audit). */
  userName: string;
  /** Gateway feature ('quality-analysis', 'chat', 'health', …). */
  feature: string;
  /** Provider id + model id (names only). */
  provider: string | null;
  model: string | null;
  /** Tool names executed during the request (safe names only). */
  toolNames?: string[];
  /** Maximum data classification admitted into the context. */
  dataClassification: DataClassification;
  /** Gateway status (§25 taxonomy). */
  status: AIStatus;
  /** Stable error category when failed (AI_* code or problem code). */
  errorCategory?: string | null;
  durationMs: number;
  /** Conversation id when the feature is conversational (Phase 6.5+). */
  conversationId?: string | null;
  success: boolean;
}

/** Writes one AI audit record. Fire-and-forget: failures are logged
 *  by the audit layer but NEVER break the AI response path.
 *  The record is built from EXPLICIT safe fields only — there is no
 *  API by which a secret or a raw payload could enter it. */
export async function writeAIAudit(input: AIAuditInput): Promise<void> {
  await writeAudit({
    collection: AI_AUDIT_COLLECTION,
    actorId: input.userId,
    actorName: input.userName,
    action: input.success ? 'ai-request' : 'ai-request-failed',
    entityType: 'ai-request',
    entityId: `${input.feature}:${input.provider ?? 'none'}:${input.model ?? 'none'}`,
    monthKey: null,
    after: {
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      toolNames: input.toolNames ?? [],
      dataClassification: input.dataClassification,
      status: input.status,
      errorCategory: input.errorCategory ?? null,
      durationMs: input.durationMs,
      conversationId: input.conversationId ?? null,
    },
    details: `AI ${input.feature} → ${input.status}`,
  });
}
