// ══════════════════════════════════════════════════════════════
//  AI Conversation — contracts (Phase 6.4, spec §18/§19)
//
//  PERSISTENT PER-USER conversation storage, ready for Phase 6.5
//  Chat. No Chat UI is built in this phase (§18) — the schema and
//  the ownership-enforcing store exist and are tested.
//
//  CONVERSATION MEMORY vs ORGANIZATIONAL MEMORY (§19):
//    • a conversation = "what was discussed in this chat";
//    • organizational memory = "what ARM has learned/validated";
//    • conversations NEVER automatically convert into memory;
//    • a user's statement is never organizational truth without the
//      explicit validation lifecycle (memory/store.ts).
//
//  OWNERSHIP (§18): every record carries userId; every read/write
//  goes through the ownership-enforcing functions in store.ts.
//  Mixing conversations between users is structurally impossible.
//  Admin visibility exists ONLY behind an explicit admin gate
//  (listConversationsForAdmin) and is audited in later phases (§33).
// ══════════════════════════════════════════════════════════════

/** Role vocabulary for stored messages. */
export type AIConversationRole = 'user' | 'assistant' | 'system';

/** Validation state of a stored assistant message (§18/§21). */
export type AIMessageValidationState =
  | 'PENDING'
  | 'VALID'
  | 'FLAGGED'
  | 'REJECTED';

export interface AIConversation {
  schemaVersion: 1;
  conversationId: string;
  /** Owner — server-derived identity, NEVER client-provided (§30). */
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  archived: boolean;
  /** Provenance of the assistant that served the conversation. */
  provider: string | null;
  model: string | null;
  /** Optional rolling summary/context metadata (Phase 6.5). */
  summary?: string | null;
  contextMetadata?: Record<string, string> | null;
  /** Organization scope (multi-org future). */
  organizationId: string;
}

export interface AIConversationMessage {
  schemaVersion: 1;
  messageId: string;
  conversationId: string;
  role: AIConversationRole;
  content: string;
  timestamp: string;
  /** Tool calls requested during this turn (names + args digest ONLY —
   *  never full payloads with sensitive data). */
  toolCalls?: Array<{ name: string; argsDigest: string }> | null;
  /** Tool RESULTS metadata where safe — counts and statuses only. */
  toolResultsMeta?: Array<{ name: string; status: string; itemCount?: number }> | null;
  /** Output-validation state for assistant messages (§21). */
  validationState?: AIMessageValidationState;
}
