// src/lib/connect/constants.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — MODULE CONSTANTS
//
//  Every tunable limit lives here (validation windows, pagination
//  bounds, polling intervals). Pure module — importable from client
//  and server.
// ══════════════════════════════════════════════════════════════

import type { MessageReference } from './types';

// ─── RTDB paths (relative to the arm_erp root used by db.ts) ───
export const CONNECT_DB_ROOT = 'arm_erp/connect';
export const CONVERSATIONS_PATH = `${CONNECT_DB_ROOT}/conversations`;
export const USER_CONVERSATIONS_PATH = `${CONNECT_DB_ROOT}/userConversations`;

// ─── Validation limits ─────────────────────────────────────────
export const MESSAGE_BODY_MAX = 4000;
export const MESSAGE_BODY_MIN = 1;
export const CLIENT_KEY_MAX = 64;
/** clientKey charset — avoids RTDB path hazards (no / # $ [ .). */
export const CLIENT_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const CONVERSATION_TITLE_MAX = 120;
export const CONVERSATION_DESCRIPTION_MAX = 500;
export const MENTIONS_MAX = 20;
export const REFERENCES_MAX = 5;
export const GROUP_MEMBERS_MAX = 100;
export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 100;

// ─── Account search (direct-chat entry workflow) ───────────────
/** Minimum query length before the panel asks the server. */
export const ACCOUNT_SEARCH_MIN = 2;
/** Maximum query length accepted (fail closed on junk). */
export const ACCOUNT_SEARCH_QUERY_MAX = 100;
/** Hard result limit — arbitrary account enumeration is prevented. */
export const ACCOUNT_SEARCH_RESULTS_MAX = 8;

// ─── Pagination / sync bounds ──────────────────────────────────
/** Messages returned per page (both directions). */
export const MESSAGE_PAGE_SIZE = 50;
/** Hard ceiling a client may request (protects the DB from 4-digit page sizes). */
export const MESSAGE_PAGE_SIZE_MAX = 100;
/** Cap for the bounded unread scan — above this the UI shows the cap. */
export const UNREAD_COUNT_CAP = 99;
/** Bounded window for in-conversation search (newest N messages scanned server-side). */
export const SEARCH_SCAN_LIMIT = 400;
/** Max search results per response. */
export const SEARCH_RESULT_LIMIT = 30;
/** Sync: max NEW messages returned per poll (client pages the rest). */
export const SYNC_NEW_MESSAGES_MAX = 100;
/** Sync: max UPDATED messages returned per poll. */
export const SYNC_UPDATED_MESSAGES_MAX = 100;
/**
 * §INDEX-FALLBACK — newest-by-key scan window for the updated-messages
 * sync while the messages/.indexOn["updatedAtMs"] is unpublished.
 * Edits to messages older than this window are deferred until the
 * index is published (documented limitation).
 */
export const SYNC_UPDATED_FALLBACK_SCAN = 400;

// ─── Policy windows ────────────────────────────────────────────
/**
 * §EDIT-POLICY — the AUTHOR may edit their own message within this
 * window from creation. No one else may edit a message (conversation
 * admins may DELETE, never rewrite another person's words). Product
 * decision documented in the delivery report; change here to move it.
 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Typing indicator lifetime — writers refresh it while typing. */
export const TYPING_TTL_MS = 6_000;
/**
 * §NOTIFY-DEDUP — a new-message notification for the SAME conversation
 * is suppressed within this window (prevents flooding the shared
 * notification center with one record per chat message). Mention
 * notifications bypass this window (explicit calls deserve their own
 * notification).
 */
export const CONNECT_NOTIFY_DEDUP_WINDOW_MS = 30 * 60 * 1000;
/** Messages younger than this may be grouped under one sender bubble. */
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

// ─── Client polling intervals (§SYNC-POLICY) ───────────────────
export const ACTIVE_CONVERSATION_POLL_MS = 10_000;
export const CONVERSATION_LIST_POLL_MS = 30_000;
/** Overlap guard — a poll never re-fires while the previous is pending. */
export const SYNC_MIN_GAP_MS = 2_000;

// ─── Internal record links (§RECORD-REFS) ──────────────────────
/**
 * type → RTDB table verified by existence check at send time. The
 * titles are render labels; the mapping is the ONLY place that knows
 * the table name, so a table rename is a one-line change.
 */
export const REFERENCE_TARGETS: Record<MessageReference['type'], { table: string; label: string }> = {
  employee: { table: 'employees', label: 'موظف' },
  orgNode: { table: 'orgNodes', label: 'جهة تنظيمية' },
  capaCase: { table: 'capaCases', label: 'حالة كابا' },
  complaint: { table: 'complaints', label: 'شكوى عميل' },
  followUp: { table: 'followUps', label: 'متابعة يومية' },
  requests: { table: 'requests', label: 'طلب' },
};

/** Audit collection (existing audit primitive — lib/audit). */
export const CONNECT_AUDIT_COLLECTION = 'connectAuditLog';

/** Notification integration identifiers (existing notifications table). */
export const CONNECT_SOURCE_MODULE = 'connect';
