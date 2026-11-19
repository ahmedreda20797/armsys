// src/lib/connect/types.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — DOMAIN TYPES
//
//  Pure type contracts shared by the server services (lib/connect),
//  the API routes (app/api/connect) and the client UI. This module
//  imports NOTHING — no server-only, no db, no React — so it is safe
//  on both sides of the server/client boundary.
//
//  §FUTURE-TENANT — every persisted entity carries an optional
//  tenantId field (null today, never enforced in 1.0). The column is
//  part of the wire/RTDB shape from day one so a future multi-tenant
//  rollout adds filtering without a data migration.
// ══════════════════════════════════════════════════════════════

// ─── Conversation ──────────────────────────────────────────────

export type ConversationType = 'direct' | 'group' | 'department';

/** Member role INSIDE one conversation (independent of app RBAC). */
export type ConversationRole = 'owner' | 'admin' | 'member';

/** Persisted conversation record — RTDB path connect/conversations/{id}. */
export interface ConversationRecord {
  id: string;
  type: ConversationType;
  /** Group/department title. Direct conversations leave it null. */
  title: string | null;
  description: string | null;
  /** Optional avatar reference (storage-independent — see storage-provider). */
  avatarRef: string | null;
  createdBy: string;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Denormalized ordering/preview cursor for cheap list rendering. */
  lastMessageId: string | null;
  /** Epoch ms of the last message (numeric sort key). */
  lastMessageAt: number | null;
  /** First ~120 chars of the last message (cosmetic, may lag). */
  lastMessagePreview: string | null;
  /** Direct conversations: sorted "userA|userB" dedup key. */
  directKey: string | null;
  /** Department conversations: the org node the group was created for. */
  deptNodeId: string | null;
  /** Active (non-left) member count, maintained on membership changes. */
  memberCount: number;
  /** §FUTURE-TENANT — null in 1.0. */
  tenantId: string | null;
}

/** Per-conversation membership — RTDB path connect/conversations/{id}/members/{userId}. */
export interface ConversationMember {
  userId: string;
  role: ConversationRole;
  joinedAt: string;
  addedBy: string;
  /** Set when the member left (or was removed) — tombstone, not delete. */
  leftAt: string | null;
  /** How membership ended when leftAt is set ('left' | 'removed'). */
  exitReason?: 'left' | 'removed' | null;
}

// ─── Messages ──────────────────────────────────────────────────

/**
 * Internal QNALYS record link (§RECORD-REFS). `type` maps to a table
 * in REFERENCE_TARGETS (lib/connect/constants) whose existence is
 * validated server-side at send time; `title` is a display snapshot.
 */
export interface MessageReference {
  type: 'employee' | 'orgNode' | 'capaCase' | 'complaint' | 'followUp' | 'requests';
  id: string;
  title: string | null;
}

/** Persisted message — RTDB path connect/conversations/{id}/messages/{pushKey}. */
export interface MessageRecord {
  id: string;
  conversationId: string;
  senderUserId: string;
  /** Display snapshot — messages render even if the user record changes. */
  senderName: string | null;
  body: string;
  /** Client-generated idempotency key (claimed atomically before write). */
  clientKey: string | null;
  replyToId: string | null;
  /** Mentioned USER ids (validated against conversation membership). */
  mentions: string[] | null;
  /** Internal record links (existence-validated). */
  references: MessageReference[] | null;
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  createdAt: string;
  /** Epoch ms duplicate of createdAt (key-order parallel, queryable). */
  createdAtMs: number;
  /** Epoch ms of the last edit (drives updated-message sync). */
  updatedAtMs: number;
  /** §FUTURE-TENANT — null in 1.0. */
  tenantId: string | null;
}

/** Deletion modes. Tombstone scrubs the body; purge removes the record. */
export type DeletionMode = 'tombstone' | 'purge';

// ─── Per-user conversation index ───────────────────────────────

/**
 * Lightweight per-user projection used for the conversation list —
 * RTDB path connect/userConversations/{userId}/{conversationId}.
 * Written ATOMICALLY with every mutation that affects the user's
 * view (send, read, archive). The read cursor here is a mirror of
 * connect/conversations/{id}/readState/{userId} (which is the
 * group-indicator source of truth); both are written by the same
 * read-path code and never diverge intentionally.
 */
export interface UserConversationIndex {
  conversationId: string;
  /** Denormalized display fields (updated atomically with the source). */
  type: ConversationType;
  title: string | null;
  /** Direct conversations: resolved display title + other participant. */
  displayTitle?: string;
  directOtherUserId?: string | null;
  /** Caller's role mirror (cosmetic list data — membership is truth). */
  myRole?: ConversationRole;
  /** Denormalized conversation.createdAt (details render). */
  createdAt?: string;
  /** Epoch ms — the single sort key for the list query. */
  lastMessageAt: number;
  lastMessageId: string | null;
  lastMessagePreview: string | null;
  memberCount: number;
  /** Cursor mirror (see interface comment). */
  lastReadMessageId: string | null;
  lastDeliveredMessageId: string | null;
  /** Per-user archive (does not affect other members). */
  archivedAt: string | null;
  /** Per-user mute until epoch ms (1.0: notifications only). */
  mutedUntil: number | null;
  updatedAt: string;
}

// ─── API DTOs (client contracts) ───────────────────────────────

/** Member row as exposed to the UI (joined with the users table). */
export interface ConversationMemberView extends ConversationMember {
  name: string | null;
  email: string | null;
  photoUrl: string | null;
  /** Server-side flag: is this member's read cursor ≥ the asked message. */
  hasRead: boolean;
}

/** Conversation payload returned by the list/details endpoints. */
export interface ConversationView {
  id: string;
  type: ConversationType;
  title: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageId: string | null;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  createdBy: string;
  memberCount: number;
  /** Display title for direct conversations (resolved server-side). */
  displayTitle: string;
  /** The OTHER participant of a direct conversation (for avatars). */
  directOtherUserId: string | null;
  /**
   * §AVATAR-SOURCE — the other participant's existing profile picture
   * (data: URL from the canonical photoURL field), resolved server-side
   * for direct conversations; null for groups / missing pictures
   * (clients fall back to initials / the group icon).
   */
  avatarUrl: string | null;
  /** Caller's own membership + per-user state. */
  myRole: ConversationRole;
  archivedAt: string | null;
  mutedUntil: number | null;
  lastReadMessageId: string | null;
  /** Bounded unread count (capped — see UNREAD_COUNT_CAP). */
  unreadCount: number;
  /** true when the bounded scan hit the cap (UI renders "99+"). */
  unreadCountTruncated: boolean;
  tenantId: string | null;
}

/** Message payload as exposed to the UI (deleted bodies scrubbed). */
export interface MessageView {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string | null;
  body: string | null;
  replyToId: string | null;
  /** Snapshot of the replied-to message (id + sender + excerpt). */
  replyPreview: { id: string; senderName: string | null; excerpt: string } | null;
  mentions: string[] | null;
  references: MessageReference[] | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  createdAtMs: number;
}

/** Read-state row for group "seen by" indicators. */
export interface ReadStateView {
  userId: string;
  lastReadMessageId: string | null;
  lastDeliveredMessageId: string | null;
}

/** Incremental sync payload (GET .../sync). */
export interface ConversationSyncPayload {
  conversationId: string;
  /** Strictly-new messages after the client cursor (ascending). */
  newMessages: MessageView[];
  /** Existing messages whose edits/deletes happened after `sinceMs`. */
  updatedMessages: MessageView[];
  /**
   * Newest message id SERVED to this client (client becomes cursor).
   * §SYNC-CONTINUATION — the cursor advances only past processed
   * records, so a round that hits the 100-message cap leaves the rest
   * for the next round (no permanent gap).
   */
  cursor: string | null;
  /**
   * §SYNC-CONTINUATION — the updated-messages cursor (epoch ms): the
   * highest `updatedAtMs` fully processed by THIS round. The client
   * echoes it (with `updatedCursorKey`) as `sinceMs`; null when the
   * client sent no sinceMs yet.
   */
  updatedCursorMs: number | null;
  /** §SYNC-CONTINUATION — push key of the last processed update at
   *  `updatedCursorMs` (RTDB orders value ties by key). */
  updatedCursorKey: string | null;
  /** Typing participants (client filters by expiry). */
  typing: { userId: string; until: number }[];
  /** Pinned message ids (current set — cheap, no pagination). */
  pinnedMessageIds: string[];
  /** Epoch ms of this sync response (fallback sinceMs for new clients). */
  serverTimeMs: number;
}

/** Result of POST .../messages (send). */
export interface SendMessageResult {
  /** 'created' = first write; 'existing' = idempotent replay. */
  status: 'created' | 'existing';
  message: MessageView;
}

/**
 * Minimal USER-ACCOUNT projection for the direct-chat account search.
 * Deliberately narrow: no emails, roles, permissions, suspension
 * flags, or private account fields ever leave the server.
 */
export interface ConnectAccountSummary {
  id: string;
  name: string | null;
  photoUrl: string | null;
}
