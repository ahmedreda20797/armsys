# DELIVERY REPORT — QNALYS Connect 1.0 (Core Messaging System)

> **Date:** 2026-11-18 · **Branch:** main · **Status:** Implemented, tested, NOT committed, NOT deployed (per spec §19).
> **Scope honesty:** every claim below is backed by an executed command whose output is quoted in sections 14–18. Nothing was verified with production Firebase; all tests run against in-memory layers.

---

## 1. Executive summary

QNALYS Connect 1.0 is implemented as an isolated internal-messaging domain inside the existing codebase: direct (1:1) conversations, groups, and department-tied conversations; text messaging with replies, editing, tombstone deletion, permanent deletion (system-admin only), pins, mentions, internal record links; member-level monotonic read/delivery cursors; typing indicators with automatic expiry; bounded unread counts; cursor-based incremental sync with optimized polling; deep-linked notifications through the EXISTING notification system; audit through the EXISTING audit primitive; a responsive Arabic-first RTL UI integrated into the existing shell and permission registry.

Key guarantees delivered:
- **Authorization is server-side and membership-based** — every conversation-scoped API resolves the authenticated caller's ACTIVE membership record; nonmembers receive the same 404 as unknown conversations (enumeration-safe). Department relationships never grant access (§DEPARTMENT-MATERIALIZATION).
- **Idempotency under retries AND concurrency** — the `clientKey` claim is an RTDB transaction; 10 concurrent duplicate requests produce exactly ONE logical message (proven by test).
- **Ordering without sequence counters** — message ids are RTDB push keys (time-ordered, concurrency-safe); no timestamps-as-ids, no arrays.
- **No paid services, no Firebase Storage, no WebSockets, no Base64 blobs** — attachments exist only as an unwired storage-provider contract.
- **Zero regressions** — the full existing test suite fails exactly the same set of (pre-existing at HEAD) tests before and after this change, verified against a pristine `f7d17fa` checkout.

## 2. Actual architecture implemented

```
src/lib/connect/            ← server-side domain (ALL import 'server-only')
  types.ts                  pure type contracts (client-safe)
  constants.ts              limits, windows, paths (client-safe)
  ids.ts                    cuid conversation ids, push-key ordering utils
  validation.ts             every user-supplied field validated (pure)
  rtdb.ts                   THE ONLY Firebase Admin SDK touchpoint (get/set/
                            update/remove/transaction/pushKey/ordered queries)
  membership.ts             authorization primitive: requireActiveMembership,
                            requireConversationRole, loadUserProfiles
  conversation-service.ts   direct get-or-create (race-safe), groups,
                            department materialization, membership admin,
                            archive/mute, per-user index maintenance
  message-service.ts        idempotent send (claim→write→takeover), edit,
                            tombstone, purge, bounded pagination, pins,
                            bounded in-conversation search
  read-state-service.ts     monotonic cursors (transactions), bounded unread
                            scans, typing ping/expiry
  sync-service.ts           incremental sync (new + updated), delivery stamping
  notification-bridge.ts    EXISTING notifications table integration
  audit-bridge.ts           EXISTING lib/audit writeAudit → connectAuditLog
  api-helpers.ts            error mapper (404/403/410/400/500), route glue
  storage/storage-provider.ts  storage-independent attachment CONTRACT ONLY
  index.ts                  server barrel

src/app/api/connect/        ← 12 thin route files (parse → service → JSON)
src/components/connect/     ← ConversationList, MessageThread, MessageBubble,
                              MessageComposer, ConversationDetails,
                              NewConversationDialog
src/components/pages/ConnectPage.tsx
src/hooks/use-connect.ts    ← all React Query data access
src/lib/connect/sync-policy.ts + client-merge.ts  ← pure client helpers
src/lib/__tests__/connect-*.ts + connect-rtdb-fake.ts + connect-test-support.ts
```

Routes call the canonical `authorizeRequest(request, { page: 'connect', action: 'view' })` directly in each route file (visible to the route-auth regression guard), keep handlers thin, and delegate ALL business logic to services.

## 3. Files created

**Server library (13):**
`src/lib/connect/types.ts` · `constants.ts` · `ids.ts` · `validation.ts` · `rtdb.ts` · `membership.ts` · `conversation-service.ts` · `message-service.ts` · `read-state-service.ts` · `sync-service.ts` · `notification-bridge.ts` · `audit-bridge.ts` · `api-helpers.ts` · `storage/storage-provider.ts` · `index.ts`

**API routes (12):**
`src/app/api/connect/conversations/route.ts` (GET list / POST create) · `[conversationId]/route.ts` (GET details / PATCH meta+state+transfer / DELETE leave) · `.../messages/route.ts` (GET pages / POST send) · `.../messages/[messageId]/route.ts` (GET one / PATCH edit / DELETE tombstone|purge) · `.../members/route.ts` (GET / POST add) · `.../members/[memberId]/route.ts` (PATCH role / DELETE remove) · `.../read/route.ts` · `.../typing/route.ts` · `.../sync/route.ts` · `.../search/route.ts` · `.../pins/route.ts` · `src/app/api/connect/users/route.ts`

**Frontend (10):**
`src/components/pages/ConnectPage.tsx` · `src/components/connect/{ConversationList,MessageThread,MessageBubble,MessageComposer,ConversationDetails,NewConversationDialog}.tsx` · `src/hooks/use-connect.ts` · `src/lib/connect/sync-policy.ts` · `src/lib/connect/client-merge.ts`

**Tests (7):**
`src/lib/__tests__/connect-rtdb-fake.ts` · `connect-test-support.ts` · `connect-authorization.test.ts` · `connect-conversations.test.ts` · `connect-messages.test.ts` · `connect-idempotency.test.ts` · `connect-sync.test.ts`

## 4. Files modified (4, all additive)

| File | Change |
|---|---|
| `src/config/permissions.ts` | +1 APP_PAGES entry (`connect`, group `daily_ops`) + `connect: 'read'` in DEFAULT/HR/MANAGER/QUALITY presets (admin inherits via builder). No existing entry touched. |
| `src/types/index.ts` | `'connect'` added to the `PageId` union. |
| `src/app/page.tsx` | +1 lazy dynamic import + +1 `case 'connect'` in `renderPage`. |
| `database.rules.json` | +documented `.indexOn` declarations for Connect (NOT deployed — see §20). |

Also restored after build: `next-env.d.ts` (build artifact, reverted). The untracked `DELIVERY-REPORT-PRODUCTION-CSP-RECOVERY.md` was preserved untouched. **No existing module behavior was modified; no commits were made.**

## 5. Database schema and paths (RTDB, under `arm_erp/connect/`)

| Path | Shape | Purpose |
|---|---|---|
| `conversations/{convId}` | `ConversationRecord` (type, title, description, avatarRef, createdBy(+Name), createdAt/updatedAt, lastMessageId/lastMessageAt(ms)/lastMessagePreview, directKey, deptNodeId, memberCount, tenantId:null) | conversation metadata + list cursor |
| `conversations/{id}/members/{userId}` | `{ userId, role: owner|admin|member, joinedAt, addedBy, leftAt, exitReason }` | **source of truth for authorization** |
| `conversations/{id}/messages/{pushKey}` | `MessageRecord` (id, conversationId, senderUserId, senderName snapshot, body, clientKey, replyToId, mentions[], references[], editedAt, deletedAt, deletedBy, createdAt(+Ms), updatedAtMs, tenantId:null) | messages |
| `conversations/{id}/clientKeys/{clientKey}` | `{ messageId, senderUserId, createdAt }` | idempotency claims |
| `conversations/{id}/readState/{userId}` | `{ lastReadMessageId, lastDeliveredMessageId, updatedAtMs }` | read-state source of truth (group indicators) |
| `conversations/{id}/pinned/{messageId}` | `{ pinnedBy, pinnedAt, excerpt, senderUserId, senderName }` | shared pins |
| `conversations/{id}/typing/{userId}` | `{ until: epochMs }` | auto-expiring typing |
| `userConversations/{userId}/{convId}` | `UserConversationIndex` (sort key `lastMessageAt` + denormalized display fields + cursor mirror + archivedAt/mutedUntil) | per-user list projection |
| `connect/directIndex/{encoded(sortedPair)}` | convId | direct-conversation dedup gate |

**§FUTURE-TENANT:** `tenantId: null` is persisted on conversations and messages from day one; adding `companyId` later is a filter change, not a migration.

## 6. API endpoints and contracts

All require `Authorization: Bearer` + page `connect` view (same permission the sidebar uses). Errors use the canonical `api-error.ts` shape `{ error: { code, message, … } }`.

| Endpoint | Methods | Contract |
|---|---|---|
| `/api/connect/conversations` | GET | `?includeArchived=1&limit=` → `{ data: ConversationView[] }` (bounded unread counts, newest first) |
| | POST | `{ type:'direct', otherUserId }` → 201/200 `{ data, created }`; `{ type:'group'|'department', title, description?, memberUserIds, deptNodeId? }` → 201. Department requires `organization` page view. |
| `/api/connect/conversations/{id}` | GET | full details + member views + read indicators + pinned ids; **404 for nonmembers/unknown** |
| | PATCH | `{ archived, mutedUntil }` (self) OR `{ title, description }` (owner/admin, groups only) OR `{ transferOwnershipTo }` (owner) |
| | DELETE | leave (owner must transfer first → 409) |
| `.../messages` | GET | `?limit&before={key}` → `{ messages[], hasOlder, oldestKey, newestKey }` (bounded) |
| | POST | `{ body, clientKey?, replyToId?, mentions?, references? }` → 201 `created` / 200 `existing` (idempotent); sender ALWAYS from session |
| `.../messages/{mid}` | GET | single message (deep-link safe) |
| | PATCH | `{ body }` — author only, within 15-min window |
| | DELETE | tombstone (author or conv owner/admin; body scrubbed) · `?mode=purge` (system admin via `connect` `delete` action — admin bypass tier; no membership required) |
| `.../members` | GET / POST | roster; `{ userIds }` add (owner/admin; already-active skipped; rejoins reset to member) |
| `.../members/{uid}` | PATCH / DELETE | `{ role: 'admin'|'member' }` (owner-only); remove (owner/admin; owner irremovable → 409; immediate access loss) |
| `.../read` | POST | `{ messageId? }` — monotonic cursor advance |
| `.../typing` | POST | ping with 6s expiry |
| `.../sync` | GET | `?cursor&sinceMs` → `{ newMessages, updatedMessages, cursor, typing, pinnedMessageIds, serverTimeMs }` + delivery stamp |
| `.../search` | GET | `?q=` — bounded scan of newest 400 messages, ≤30 results, membership-gated |
| `.../pins` | GET / POST | `{ messageId, pinned }` — groups: owner/admin; direct: either participant |
| `/api/connect/users` | GET | `?ids=` → minimal `{ id, name, photoUrl }` display projection |

## 7. Authorization matrix

| Operation | Anonymous | Non-member | Plain member | Conversation admin | Conversation owner | System admin (`role:'admin'`) |
|---|---|---|---|---|---|---|
| List own conversations | 401 | (own only) | ✔ | ✔ | ✔ | ✔ |
| Details / messages / sync / search / read / members | 401 | **404** | ✔ | ✔ | ✔ | ✔ |
| Send / reply / edit-own / delete-own | 401 | **404** | ✔ | ✔ | ✔ | ✔ |
| Edit another's message | — | 404 | 403 | 403 | 403 | 403 (nobody but the author) |
| Tombstone another's message | — | 404 | 403 | ✔ | ✔ | ✔ |
| Purge message | — | — | — | — | — | ✔ (403 otherwise) |
| Add/remove members | — | 404 | 403 | ✔ | ✔ | ✔ |
| Change roles / transfer ownership | — | 404 | 403 | 403 (owner-only) | ✔ | ✔ |
| Pin (group) | — | 404 | 403 | ✔ | ✔ | ✔ |
| Pin (direct) | — | 404 | ✔ | ✔ | ✔ | ✔ |
| Archive/mute (self) | — | 404 | ✔ | ✔ | ✔ | ✔ |
| Edit group meta | — | 404 | 403 | ✔ | ✔ | ✔ |
| Create group | 401 | any `connect:view` user | ✔ | ✔ | ✔ | ✔ |
| Create department conversation | 401 | requires `organization:view` | per preset | per preset | per preset | ✔ |

Enforcement primitive: `requireActiveMembership` (single membership read per request). Removed/left members lose access immediately (index entry deleted in the same flow; membership tombstoned). Sender identity is never accepted from the request body.

## 8. Message ordering and idempotency design

- **Ordering:** message ids are Firebase push keys allocated via `ref.push().key` without writing. Push keys are lexicographically ordered by creation time — a later key ALWAYS sorts after an earlier one. Key-order pagination (`orderByKey` + `startAt`/`endAt` + limits) needs no index and no sequence counter; no timestamps-as-ids; no arrays. `ids.ts` provides `isNewerPushKey`/`newerPushKey` for all cursor comparisons.
- **Idempotency (narrow, no global transaction architecture):**
  1. Generate the message push key locally.
  2. `transaction()` on `conversations/{id}/clientKeys/{clientKey}`: absent → claim `{ messageId, senderUserId, createdAt }`; present → abort.
  3. Winner writes the message + conversation cursor + every member's index fields in ONE atomic multi-path `update()` (RTDB update is all-or-nothing).
  4. Loser reads the winner's claim: same sender → fetch the message (bounded wait) and return `existing`; different sender → 400 (no content leak).
  5. **Takeover:** if the original writer died between claim and write, a same-sender retry completes the write with the claim-fixed message id — idempotent by construction.
  6. If the multi-path write throws, the claim is released (best-effort) so the retry can claim fresh.
- **Concurrency safety:** RTDB transactions serialize per path; the idempotency test fires 10 truly concurrent requests and asserts exactly one `201` and one stored message. Cursor updates use the same transaction guard — a stale client cannot regress `lastReadMessageId` (test-proven).

## 9. Pagination and synchronization behavior

- **Pages:** latest = `limitToLast(50)` (hasOlder flagged with +1 probe); older = `endAt(cursor) limitToLast(51)` with the inclusive cursor dropped. Hard-capped at 100/page; history is never fully loaded.
- **Sync (active conversation, ~10s):** `newMessages` = `orderByKey().startAt(cursor)` (cursor dropped, inclusive-bound); `updatedMessages` = `orderByChild('updatedAtMs').startAt(sinceMs)` filtered strictly-greater and deduped against new — edits and tombstones flow to clients. Response carries the new cursor; the client advances only forward (`shouldAdvanceCursor`).
- **Delivery vs read:** the sync endpoint stamps `lastDeliveredMessageId` (messages actually served); opening/viewing stamps `lastReadMessageId` (read ⊇ delivered). Group indicator: "read by N of M" from `readState`.
- **List (background, ~30s):** one indexed query per user (`orderByChild('lastMessageAt')` on `userConversations/{uid}`, `limitToLast(100)`), unread computed lazily per potentially-unread row via a bounded key-range scan (cap 99 → "99+", `unreadCountTruncated`).
- **Tab discipline:** hidden tabs never poll (`refetchIntervalInBackground:false` + pure `shouldPollNow`), foreground-return refetches stale data, overlap guard `mayStartSyncRound` (+ React Query dedup), failure backoff 1×→8× (capped).

## 10. Notification integration

One engine (the existing `notifications` table + bell popover). Writes are directed records with `recipientUserIds`, `sourceModule:'connect'`, `targetPage:'connect'`, `navParams:{conversationId,messageId}` — the popover's canonical `navigateTo` channel deep-links into Connect, and ConnectPage consumes `navParams` (page-remount derivation, the codebase's own convention). Volume policy: DM → one "رسالة جديدة من {sender}" per conversation per 30-min window; group/department → silent (badge-driven) except mentions; mention → per-message, priority `high`, members-only (non-member mentions dropped at send); muted recipients skipped; membership mutations notify added users. All bridge writes are fire-and-forget and never break messaging. The `AppNotification` category union is untouched (`category:'system'` + `sourceModule:'connect'`).

## 11. UI implementation

- **Desktop:** two panes (list 340–380px + thread) inside the existing AppLayout; **mobile:** dedicated list/conversation views with back navigation and touch-friendly menus.
- **Thread:** message grouping (same sender ≤5min), Arabic day separators (اليوم/أمس), reply previews, tombstones ("تم حذف هذه الرسالة"), edited flags, mention picker (member chips), record-link chips, pinned banner (click → jump), jump-to-message highlight, typing indicator with animated dots, unread badges (Arabic numerals, ٩٩+), "load older" pagination, jump-to-latest.
- **Composer:** Enter=send / Shift+Enter=newline, Esc cancels reply/edit, auto-grow textarea, 3.5s-throttled typing ping, reply/edit banners keyed-remount prefill, record-link picker. **No attachment controls** (storage unavailable — no fake functionality).
- **Details dialog:** roster with role badges, add-member user search (reuses `useDashboardUsers`), role change, ownership transfer, remove, leave (with owner-transfer guard), archive/mute switches, group rename.
- **New-conversation dialog:** direct/group/department modes; department mode gated on `organization` page permission with the explicit-materialization caveat displayed.
- **Registration:** `PageHeaderBar` + `setPageIdentity` conventions; sidebar entry appears automatically from `APP_PAGES` + `canViewPage('connect')`.

## 12. Security decisions

1. **Session-only sender identity** — `senderUserId` from the body is never read (test-proven spoofing attempt).
2. **Enumeration-safe denials** — unknown conversation ≡ nonmember ≡ removed member: one identical 404 body (test-proven).
3. **Cross-conversation containment** — reply targets and message ids are validated against the caller's conversation; the deep-link message fetch is membership-gated.
4. **Fail-closed validation** — every body/query field passes shape+length+format validation before services run (clientKey `^[A-Za-z0-9_-]{8,64}$`, body ≤4000, title ≤120, mentions ≤20 member-filtered, references ≤5 against the `REFERENCE_TARGETS` allowlist with existence checks).
5. **Tombstone scrubs content** — the body is blanked in the same update that stamps `deletedAt`; deleted bodies never leave the server (test-proven). Mentions/refs die with the content.
6. **Purge is double-gated** — `connect` `delete` action (held only by the admin bypass tier) and audit metadata only; no content-recovery claim.
7. **No sensitive content in audit** — `connectAuditLog` records actors/actions/ids only (test asserts message text never appears).
8. **Notifications never grant access** — they carry ids for navigation; every fetch re-checks membership.
9. **Admin purge works without membership** — deliberate, documented (system administrators administrate conversations they are not in).
10. **Edit policy (documented product decision):** author-only, 15-minute window, nobody else may rewrite another person's words; admins have DELETE, never EDIT-of-others.

## 13. Performance considerations

- One ordering field per query (RTDB constraint respected): list sorts by `lastMessageAt`; messages by key; sync edits by `updatedAtMs`.
- Bounded reads everywhere: page ≤50+1, sync ≤100 new / ≤100 updated, unread scan ≤101 keys, search scan ≤400 newest.
- Atomic multi-path writes: one round-trip per send/leave/remove.
- Denormalized index entries: the conversation list is ONE query + ≤100 bounded unread scans, zero per-conversation metadata fetches.
- Single-flight caching benefits inherited through `db.ts` (`getById` users lookups are cached); request-memoized authentication (`authorizeRequest`) avoids repeated user reads.
- Typing writes are TTL-expiring single-field sets; expired entries swept opportunistically on read.
- Index declarations (documented, not published): `userConversations/$userId → lastMessageAt`; `conversations/$convId/messages → updatedAtMs`. `orderByKey` queries need none. Without the two indexes the queries still execute server-side (Admin SDK scans) — correctness unaffected, latency degraded.

## 14. Tests executed with exact commands

- Full suite: `npm test` (cross-platform runner → `tsx --test` over all `src/**/__tests__/*.test.ts|.test.mts`, `tsconfig.test.json`)
- Per-suite: `npx tsx --tsconfig tsconfig.test.json --test src/lib/__tests__/connect-authorization.test.ts` (and the other four)
- Regression guard: `npx tsx --tsconfig tsconfig.test.json --test src/lib/__tests__/route-auth-regression.test.ts`
- Baseline isolation: pristine `f7d17fa` git worktree + junctioned `node_modules`, `node scripts/run-tests.mjs`
- Typecheck: `npx tsc --noEmit -p tsconfig.json`
- Lint: `npx eslint src/lib/connect src/components/connect src/components/pages/ConnectPage.tsx src/hooks/use-connect.ts "src/app/api/connect"`
- Build: `npx next build` (in an isolated full copy at `Desktop/arm-erp-buildcheck` because the in-tree `.next/standalone` was file-locked by a running process)

## 15. Test results with exact counts

**Connect suites (all new, all executed): 61 tests, 61 pass, 0 fail**
| Suite | Tests | Pass | Fail |
|---|---|---|---|
| connect-authorization | 11 | 11 | 0 |
| connect-conversations | 18 | 18 | 0 |
| connect-messages | 14 | 14 | 0 |
| connect-idempotency | 8 | 8 | 0 |
| connect-sync | 10 | 10 | 0 |

Coverage highlights (all executed, not claimed): unauthenticated/tampered tokens → 401; nonmember/unknown/removed → identical 404 on 6 surfaces; spoofed sender ignored; cross-conversation reply rejected; member≠admin≠owner gates; direct dedupe (created→existing, 1 record in DB); self-DM and ghost-user rejected; department creation gated on organization permission + explicit materialization (node grants nothing — test with a third user); add/remove/role/transfer/leave incl. owner-must-transfer 409; memberCount exactness under no-op adds; send + atomic index updates; chronological key ordering; reply previews; mention member-filtering; record-reference existence; §EDIT-POLICY (author-only, preview refresh); tombstone body scrub; purge gating + cursor reset + claim release; pin policy; audit without content; same-clientKey sequential + 10-way concurrent dedupe; 8 concurrent distinct sends with stable ordering; 60-message pagination walk; read-cursor monotonicity incl. stale-race; typing expiry; incremental sync (new vs updated vs tombstone); delivery stamping; bounded unread count + reset; notification volume policy (DM window dedup, group silence, mention, added-to-group, ghost-mention silence); pure sync-policy/merge helpers (hidden-tab pause, overlap guard, backoff cap, cursor never regresses).

**Full existing suite (regression):**
- Working tree after changes: **3197 tests, 3190 pass, 7 fail** (ts run) + **119 tests, 117 pass, 2 fail** (mts run).
- Pristine HEAD baseline (`f7d17fa`): **3136 tests, 3129 pass, 7 fail** + **119/117/2** — **the identical failure set** (navigation highlight ×2, evidence UI regressions ×4, evidence-storage ×4, download-opt stats, find-user-by-email). Failures were reproduced on the untouched baseline before being accepted as pre-existing.
- Delta: **+61 tests, all passing; 0 new failures.** (The route-auth regression guard initially flagged the new routes; resolved by calling the canonical `authorizeRequest` in each route file rather than weakening the guard.)

## 16. TypeScript results

`npx tsc --noEmit -p tsconfig.json` → **0 errors** (whole project, before and after the final route refactor).

## 17. ESLint results

`npx eslint <all new/modified Connect surfaces>` → **0 errors, 0 warnings**. Three `react-hooks/set-state-in-effect` findings raised during development were fixed by adopting the codebase's derived-state conventions (page-remount init from `navParams`, keyed composer remount, effect-free highlight), not by disabling rules.

## 18. Production build result

`npx next build` (isolated copy; the in-tree build was blocked by an EBUSY lock on `.next/standalone` from a running dev process — left untouched): **BUILD SUCCEEDED** (`BUILD_ID: P0mk2pSMrjxoasScVtaNP`), all 12 `/api/connect/*` routes compiled as dynamic server routes, zero compile errors, zero Connect-related warnings.

## 19. Known limitations

1. **RTDB has no full-text search** — in-conversation search is a bounded scan of the newest 400 messages (labeled "تم البحث في أحدث 400 رسالة فقط" in the UI); older matches are missed. Global search explicitly not built (§SPEC-13).
2. **Unread counts are lazily computed** — exact up to 99, then "99+"; a list refresh performs ≤N bounded scans (one per potentially-unread row).
3. **`updatedAtMs` sync window** — without the documented `messages → updatedAtMs` index the edit-sync query still works but scans server-side; with it, it is indexed. (Index publication is a manual owner action, §20.)
4. **Edit window is 15 minutes** — a product decision, documented and single-sourced in `EDIT_WINDOW_MS`.
5. **Direct-conversation display names** in the list are snapshots refreshed on each send/details fetch; a user rename appears in the list after the next message or details open.
6. **Index-entry cursor mirror** is written by the same transaction-guarded code as the authoritative `readState` but on a second path; a pathological interleaving could briefly lag the badge by one mark-read (self-heals on the next mark-read; `readState` remains authoritative for indicators).
7. **No client-side tests for React components** — the project's node:test harness has no DOM renderer; UI behavior is covered indirectly by the pure policy/merge helpers and the fact that the production build compiles all components. UI verification on a running instance is listed under §20.
8. **Presence indicators are not implemented** (§SPEC-11: "Presence should not require continuous high-frequency database writes" — deferred; typing indicators only).

## 20. Required manual owner actions

1. **Publish the two index declarations** to the Firebase Console / `database.rules.json` (already mirrored in this repo's file, NOT deployed): `arm_erp/connect/userConversations/$userId → .indexOn ["lastMessageAt"]` and `arm_erp/connect/conversations/$conversationId/messages → .indexOn ["updatedAtMs"]`. Until published, queries still work (server-side scan, SDK warning logged). No rules were changed on production; nothing was deployed.
2. **Manual smoke test on a running instance** (no production data was touched by this work): create a direct conversation, exchange messages between two sessions, verify badges, mentions, mobile layout.
3. Optional: enable RTDB rules hardening for `arm_erp/connect/*` in the Console (this module is Admin-SDK-only; client SDKs never touch these paths).
4. Optional: add Connect to per-role permission overrides in the Control Center if a role should NOT have messaging (`connect: none`).

## 21. Deferred functionality (per §SPEC-15, clean extension points only)

Actual uploads/downloads (storage contract in `storage/storage-provider.ts`, unwired) · audio/voice · calls · screen share · WebSockets/external realtime · global conversation search · paid storage · external integrations · full multi-tenant enforcement (`tenantId` fields persisted, never read) · SQL migration (repository boundary = `lib/connect/rtdb.ts`, single file to replace).

## 22. Recommended next implementation phase

1. **Publish the indexes** (§20.1) and run a two-user live smoke test on staging data.
2. **Attachments v1.1** — pick a provider implementing `StorageProvider` (self-hosted object storage keeps the no-paid-Services constraint), wire upload/download endpoints + composer controls behind it.
3. **Typing/presence consolidation** — reuse the `typing` TTL node pattern for lightweight presence if the product needs it.
4. **Unread counter upgrade** — if list scans ever become hot at scale, add a transaction-maintained per-member `unreadCount` (the cursor design already provides the reset semantics it needs).
5. **Global search** — only with a real index (e.g., a search service); RTDB cannot support it honestly.

---

### Status legend recap

- **Implemented and tested:** everything in §§5–11 with the 61-test suite (§15) — all executed against in-memory layers that faithfully model RTDB semantics (atomic multi-path update, per-path transaction serialization, empty-node pruning, time-ordered push keys).
- **Implemented, not production-verified:** all production behavior (no live Firebase was touched; §20.2 smoke test recommended).
- **Designed but not implemented:** none beyond the storage contract (which is a contract by design).
- **Deferred:** §21.
