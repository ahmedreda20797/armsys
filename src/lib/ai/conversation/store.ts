// ══════════════════════════════════════════════════════════════
//  AI Conversation — ownership-enforcing store (Phase 6.4, §18)
//
//  Additive RTDB nodes arm_erp/aiConversations + arm_erp/aiMessages
//  via the EXISTING cached db layer (no migration, §38). Persistence
//  is INJECTABLE for Firebase-free unit tests.
//
//  OWNERSHIP ENFORCEMENT (§18/§36-B/§36-O):
//    • user functions ALWAYS filter by the server-derived userId —
//      a record owned by someone else is indistinguishable from a
//      missing record (anti-enumeration);
//    • archive/restore preserve ownership (the owner column never
//      changes — there is no API that could reassign it);
//    • admin listing exists ONLY as listConversationsForAdmin with
//      an explicit role === 'admin' gate (§33 — no surveillance by
//      default; access auditing arrives with Phase 6.10).
// ══════════════════════════════════════════════════════════════

import { createRecord, updateRecord, getAll, TTL } from '@/lib/db';
import type { AIConversation, AIConversationMessage, AIConversationRole } from './types';

export const AI_CONVERSATIONS_TABLE = 'aiConversations';
export const AI_MESSAGES_TABLE = 'aiMessages';

export interface ConversationPersistence {
  getAllConversations(): Promise<Record<string, unknown>[]>;
  getAllMessages(): Promise<Record<string, unknown>[]>;
  createConversation(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  createMessage(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateConversation(id: string, data: Record<string, unknown>): Promise<unknown>;
}

export const defaultConversationPersistence: ConversationPersistence = {
  getAllConversations: () => getAll<Record<string, unknown>>(AI_CONVERSATIONS_TABLE, TTL.MEDIUM),
  getAllMessages: () => getAll<Record<string, unknown>>(AI_MESSAGES_TABLE, TTL.MEDIUM),
  createConversation: (data) => createRecord(AI_CONVERSATIONS_TABLE, data),
  createMessage: (data) => createRecord(AI_MESSAGES_TABLE, data),
  updateConversation: (id, data) => updateRecord(AI_CONVERSATIONS_TABLE, id, data),
};

export type ConversationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'PERSISTENCE_ERROR'; error: string };

function normalizeConversation(row: Record<string, unknown>): AIConversation | null {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') return null;
  // Materialize conversationId from the physical row id — the store's
  // ownership/isolation logic always speaks conversationId.
  return { ...(row as unknown as AIConversation), conversationId: row.id };
}

function normalizeMessage(row: Record<string, unknown>): AIConversationMessage | null {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') return null;
  return {
    ...(row as unknown as AIConversationMessage),
    messageId: row.id,
    conversationId: typeof row.conversationId === 'string' ? row.conversationId : '',
  };
}

// ── create ──────────────────────────────────────────────────────

export interface CreateConversationInput {
  userId: string;
  title: string;
  provider?: string | null;
  model?: string | null;
  organizationId?: string;
}

export async function createConversation(
  input: CreateConversationInput,
  persistence: ConversationPersistence = defaultConversationPersistence,
): Promise<ConversationOutcome<AIConversation>> {
  if (!input.userId?.trim() || !input.title?.trim()) {
    return { ok: false, reason: 'INVALID_INPUT', error: 'المستخدم والعنوان مطلوبان' };
  }
  const now = new Date().toISOString();
  try {
    const created = await persistence.createConversation({
      schemaVersion: 1,
      userId: input.userId,
      title: input.title.trim().slice(0, 120),
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
      archived: false,
      provider: input.provider ?? null,
      model: input.model ?? null,
      summary: null,
      contextMetadata: null,
      organizationId: input.organizationId?.trim() || 'default',
    });
    const normalized = normalizeConversation(created);
    if (!normalized) {
      return { ok: false, reason: 'PERSISTENCE_ERROR', error: 'تعذر حفظ المحادثة' };
    }
    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      reason: 'PERSISTENCE_ERROR',
      error: error instanceof Error ? error.name : 'persistence failure',
    };
  }
}

// ── read (ownership-enforced, anti-enumeration) ────────────────

/** Owner-only read. Another user's conversation = NOT_FOUND (never
 *  FORBIDDEN — its existence is not disclosed, §18). */
export async function getConversationForUser(
  userId: string,
  conversationId: string,
  persistence: ConversationPersistence = defaultConversationPersistence,
): Promise<ConversationOutcome<AIConversation>> {
  if (!userId?.trim() || !conversationId?.trim()) {
    return { ok: false, reason: 'INVALID_INPUT', error: 'معرفات غير صالحة' };
  }
  const rows = await persistence.getAllConversations();
  const row = rows.find((r) => r.id === conversationId);
  const conversation = row ? normalizeConversation(row) : null;
  if (!conversation || conversation.userId !== userId) {
    return { ok: false, reason: 'NOT_FOUND', error: 'المحادثة غير موجودة' };
  }
  return { ok: true, value: conversation };
}

export async function listConversationsForUser(
  userId: string,
  options: { includeArchived?: boolean } = {},
  persistence: ConversationPersistence = defaultConversationPersistence,
): Promise<AIConversation[]> {
  const rows = await persistence.getAllConversations();
  return rows
    .map(normalizeConversation)
    .filter((c): c is AIConversation => c !== null)
    .filter((c) => c.userId === userId)
    .filter((c) => (options.includeArchived ? true : !c.archived))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

// ── messages (owner-checked via the parent conversation) ───────

export interface AppendMessageInput {
  conversationId: string;
  role: AIConversationRole;
  content: string;
  toolCalls?: AIConversationMessage['toolCalls'];
  toolResultsMeta?: AIConversationMessage['toolResultsMeta'];
  validationState?: AIConversationMessage['validationState'];
}

export async function appendMessage(
  userId: string,
  input: AppendMessageInput,
  persistence: ConversationPersistence = defaultConversationPersistence,
): Promise<ConversationOutcome<AIConversationMessage>> {
  const parent = await getConversationForUser(userId, input.conversationId, persistence);
  if (!parent.ok) return parent;

  if (!input.content?.trim() && input.role !== 'assistant') {
    return { ok: false, reason: 'INVALID_INPUT', error: 'محتوى الرسالة مطلوب' };
  }
  const now = new Date().toISOString();
  try {
    const created = await persistence.createMessage({
      schemaVersion: 1,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      timestamp: now,
      toolCalls: input.toolCalls ?? null,
      toolResultsMeta: input.toolResultsMeta ?? null,
      validationState: input.validationState ?? null,
    });
    await persistence.updateConversation(input.conversationId, {
      updatedAt: now,
      lastMessageAt: now,
    });
    const normalized = normalizeMessage(created);
    if (!normalized) {
      return { ok: false, reason: 'PERSISTENCE_ERROR', error: 'تعذر حفظ الرسالة' };
    }
    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      reason: 'PERSISTENCE_ERROR',
      error: error instanceof Error ? error.name : 'persistence failure',
    };
  }
}

export async function listMessagesForUser(
  userId: string,
  conversationId: string,
  persistence: ConversationPersistence = defaultConversationPersistence,
): Promise<ConversationOutcome<AIConversationMessage[]>> {
  const parent = await getConversationForUser(userId, conversationId, persistence);
  if (!parent.ok) return parent;

  const rows = await persistence.getAllMessages();
  const messages = rows
    .map(normalizeMessage)
    .filter((m): m is AIConversationMessage => m !== null)
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  return { ok: true, value: messages };
}

// ── archive / restore (ownership preserved, §36-O) ─────────────

export async function setConversationArchived(
  userId: string,
  conversationId: string,
  archived: boolean,
  persistence: ConversationPersistence = defaultConversationPersistence,
): Promise<ConversationOutcome<AIConversation>> {
  const parent = await getConversationForUser(userId, conversationId, persistence);
  if (!parent.ok) return parent;

  // The owner column is NEVER part of any update payload — ownership
  // cannot drift through archive/restore (§36-O).
  await persistence.updateConversation(conversationId, {
    archived,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, value: { ...parent.value, archived } };
}

// ── admin visibility (explicit gate, §33 — no default surveillance) ──

export async function listConversationsForAdmin(
  adminUser: { role: string; userId: string },
  persistence: ConversationPersistence = defaultConversationPersistence,
): Promise<ConversationOutcome<AIConversation[]>> {
  if (adminUser.role !== 'admin') {
    return { ok: false, reason: 'FORBIDDEN', error: 'هذه الصلاحية للمدير النظامي فقط' };
  }
  const rows = await persistence.getAllConversations();
  const conversations = rows
    .map(normalizeConversation)
    .filter((c): c is AIConversation => c !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { ok: true, value: conversations };
}
