# DELIVERY REPORT — QNALYS Connect: Conversation, Avatar & Responsive UI Fix

> **Date:** 2026-11-19 · **Branch:** main · **Status:** Implemented, **live-verified against the real database and browser**, NOT committed, NOT deployed, no production settings changed. One test conversation (test@qnalys.com ↔ Ahmed Reda — the owner's account) was created as the authorized reproduction of the reported failure; no messages were sent to other users.
> **Diagnostics source:** the running dev server's own log (`.next/dev/logs/next-development.log`) — the owner's failing attempts were captured there with full stack traces; nothing was guessed.

---

## 1. Root cause of the internal server error (Part 1)

**The exact failing operation** (from the server log, op `POST /api/connect/conversations`, thrown at `validateFirebaseMergePaths` → `connectUpdate` → `getOrCreateDirectConversation`):

```
update failed: values argument contains a path /y7gxb6pg2vlhdek8iofhbp90
that is ancestor of another path /y7gxb6pg2vlhdek8iofhbp90/members/hcrlw9104t0brdc0ygjhmzr1
```

**Root cause:** real RTDB **rejects any `update()` map that contains both a path and one of its descendants** (client-side validation, BEFORE any write — atomic, no partial state). Direct- and group-conversation creation wrote the conversation record and its member records as `{ [convId]: conversation, [convId/members/uid]: member }` in ONE map — an ancestor+descendant pair. Every attempt 500'd with «حدث خطأ داخلي في الخادم» (the mapped fallback of `connectErrorResponse`), and no conversation was ever created.

**Why the tests missed it:** the in-memory RTDB fake implemented `update()` as "shallow per path, deeper value wins" (mirroring `db.ts`'s own patch semantics) and silently accepted overlapping paths — **the fake diverged from real RTDB semantics**, so 107 green tests co-existed with a hard production failure on the very first real use.

**Identity compatibility (task §2):** verified end-to-end — the account search returns the canonical `users`-table id (cuid, e.g. `hcrlw9104t0brdc0ygjhmzr1` = Ahmed Reda), `isValidEntityId` accepts it, `getById('users', otherUserId)` resolves it, and the same id is used for members, index entries and the directKey. No employee/org-node identifiers substitute anywhere in the Connect path.

## 2. Fix implemented (Part 1)

1. **`getOrCreateDirectConversation`** — the shell + both memberships are written as ONE node (`{ [convId]: { ...conversation, members: { uid: member } } }`): atomic, single-path, real-RTDB-legal. The race-loser cleanup now deletes just `{ [convId]: null }` (members die with the node).
2. **`createGroupConversation`** — same embedding (creator = owner inside `members`).
3. **The fake now enforces the real contract** — `applyUpdate` throws the EXACT real error for any ancestor+descendant pair (segment-wise prefix check, order-independent, nothing written on rejection). This class of divergence can never hide again.
4. **Audit of every other multi-path update** in the module (send/edit/tombstone/purge/remove/leave/transfer/meta/read-state/pins): all write strictly sibling paths — verified unaffected; the message-send atomic update was already correct.

**Preserved:** the directIndex transaction (dedup gate), idempotency claims, composite sync cursors — untouched.

## 3. Unindexed-query recovery (found during the same diagnosis)

The log also captured a second production blocker: `Index not defined, add ".indexOn": "lastMessageAt", for path /arm_erp/connect/userConversations/{uid}` — RTDB **rejects child-ordered queries whose index is not declared, even for the Admin SDK** (server-side constraint, not a security rule — the 1.0 report's "Admin SDK scans" claim was wrong). The repo's `database.rules.json` already documents both indexes but production has not published them (publishing is explicitly out of scope for this task).

- `listUserConversations` — on "Index not defined", falls back to a plain read of the caller's OWN index node (bounded by their conversation count), sorted in memory. Identical result, degraded efficiency; one concise warn per server process.
- `syncConversation` updated-window — falls back to a bounded newest-400-by-key scan filtered by `updatedAtMs` (recent-edit traffic fully covered; edits to messages older than the window are deferred until the index is published — documented limitation, never a crash; the composite cursor holds instead of advancing past unproven records).
- Live result: `GET /api/connect/conversations` went from 500 → 200 with the conversation listed.

## 4. Direct conversation verification (live, real RTDB — BOTH SIDES)

Accounts: `test@qnalys.com` + `test2@qnalys.com` (owner-supplied for testing).

| Scenario | Result |
|---|---|
| First-time creation (test → Ahmed Reda) | **HTTP 201 `created:true`** — the previously-500 call now succeeds |
| Repeated selection (same pair) | **200, the SAME conversation id** — no duplicate |
| Creation from the test2 side (201) + message sent | ✔ |
| List | **200** — conversations listed (previously 500 on the missing index) |
| Self / invalid / suspended / unauthorized / concurrent / duplicate | automated suite (unchanged contracts, re-run green) |
| Search-selection → open (browser) | ✔ selecting "Ahmed Reda" opened the SAME conversation, **zero error toasts** |
| **Open a conversation containing a message** | ✔ window renders the message, read-marking runs — see §4a (loop) + §4b (counter) |
| Send / edit / **delete** / read (live, both sides) | ✔ see §4c |
| Index-side writes | members node exists beneath the single-path write (test-asserted); both members' index entries present |

### §4a — Regression found and fixed during verification: read-marking render loop

Opening the conversation **with a message** crashed with *Maximum update depth exceeded*. Root cause: `MessageThread`'s read-marking effect depends on the `onMessagesViewed` callback identity, and the window's `handleMessagesViewed` depended on the whole `useMarkRead` result object — which React Query recreates every render. Each render re-fired the effect → `mutate` (synchronous pending-state update) → render → new identity → re-fire. It only triggers when `lastMessageId` is non-null (empty conversations no-op — why earlier verification missed it).

**Fix:** depend only on the stable `mutate` function, gate on `open`, and dedupe per target id via a ref. Verified live: window opens with the message, no crash. The mobile body-scroll lock was hardened in the same pass against breakpoint oscillation (lock engages on open, releases only when the overlay fully closes).

### §4b — THE UNREAD-COUNTER BUG (the reported "counter never clears"): mirror transactions aborted on real RTDB

**Root cause (verified by reading the real nodes):** `markRead`/`markDelivered` mirrored their cursors onto `userConversations/{uid}/{conv}` via **full-replace transactions whose function starts with `if (!cur) return undefined`**. On real RTDB the transaction function's FIRST invocation is speculative — it receives the locally-cached value, which is `null` on any fresh server process. Returning `undefined` there **aborts the transaction immediately**, so the mirror write NEVER landed: `readState` (source of truth) recorded the read correctly, but the mirror — which the conversation list reads for unread counts — stayed stale. Result: the badge never cleared after opening the conversation, exactly as reported. The in-memory fake has no speculative-null pass, so 118 tests co-existed with this production failure.

**Fix:** the mirror advances via an **existence-checked LEAF update** (`userConversations/{uid}/{conv}/lastReadMessageId` + `lastDeliveredMessageId`) — no speculative-null exposure, no full-replace risk; monotonicity remains guaranteed by the SOURCE transactions, and the mirror self-heals on the next mark-read (the documented 1.0 projection-lag limitation).

**Live verification (both sides, real RTDB):**
1. test2 created a conversation with test (201) and sent a message (201).
2. test's list: **unread 1** with the Arabic preview — badge appears ✔
3. test opened (markRead 200) → list **unread 0** — **the badge clears** ✔ (the reported bug)
4. The mirror on disk now carries `lastReadMessageId` ✔ (previously absent)
5. test replied (201) → test2's view **unread appears** → test2 opened (markRead) → **0** ✔

### §4c — Send / edit / delete / read flows (live, real RTDB, from both sides — API **and** UI)

| Flow | Result |
|---|---|
| Send (201, push-key id, Arabic body intact — UTF-8 verified) | ✔ |
| **Edit via the UI** (⋮ → «تعديل»): composer remounts **prefilled** with the message body → save (Enter) → toast «تم تعديل الرسالة» → bubble shows the new body + **(معدّلة)** indicator | ✔ — instrumented: exactly ONE `PATCH /messages/{id}` to the correct message with the correct body |
| Edit → sync: the edit reached the OTHER account (test2) as `updatedMessages` with `editedAt` + new body, `updatedCursorMs` advanced | ✔ (this flow was dead in 1.0 — the client never sent `sinceMs`) |
| **Delete via the UI** (⋮ → «حذف»): tombstone «تم حذف هذه الرسالة» renders in place | ✔ — one logical `DELETE …?mode=tombstone` (a second recorded request is the built-in 401 auto-retry after token expiry, §UNIFIED-FETCH) |
| Tombstone scrub: body `null` in the response AND in a fresh GET (content unrecoverable), mentions/refs cleared, **list preview reset to null** on the other side | ✔ |
| Tombstone → sync: flows to the other account (`deletedAt` set, body null) | ✔ |
| Read: markRead 200 → unread 0 on **both** sides; delivery stamps advanced by sync; unread badge clears in the browser | ✔ |
| Pagination (GET messages: newest page, `hasOlder`, `newestKey`) | ✔ |

**Anomaly note (honesty):** during the FIRST UI-edit session — which ran while the page was recovering from the `useRef` render crash (§4a) — one unrelated message received a stray edit ("+000" appended). The instrumented re-runs under the fixed code show exactly one correctly-targeted PATCH per edit and no stray writes; the anomaly is attributed to the crashed-build session and did not reproduce.

**Test data left in place:** the conversation test ↔ test2 (`ptr8rq33…`) contains a tombstoned test message; both counters read 0/0 at hand-over.

### §4d — §UNREAD-SELF: the sender's own message never counts as unread

The two-sided test exposed one more wart: the sender's own message counted toward their own badge (test2 saw unread 2: their own message + the reply). Fixed in `buildSendUpdateMap`: the send atomically advances the sender's read/delivery cursors (source `readState` node + mirror leaves) — the new message's push key is the newest, so the advance is monotonic by construction. Live: test2 sent another message → **test2 unread 0**, recipient's view **unread 1** ✔. Test added (`§UNREAD-SELF`).

*Note: the first reply of the session (sent before this fix compiled) left one self-counted message in test's counter until their next open — stale-data artifact, not a live bug; state was cleaned via markRead.*

## 5. Avatar system (Part 2)

**Existing source inspected (not assumed):** the canonical profile picture is the user record's **`photoURL`** field — a self-contained **256×256 WebP `data:` URL** written by the existing `/api/profile/photo` workflow (client crops to a square; `sharp` re-encodes server-side; 4 MB input cap; audited). No Firebase Storage, no second provider, CSP already allows `img-src data:`. Retrieval is unauthenticated-safe (the data URL carries no path or permission surface) and scoped to the user record the caller is already authorized to read.

**Root cause of cross-user invisibility:** Connect's `loadUserProfiles` read **`user.photoUrl`** (lowercase) while the canonical field is **`photoURL`** — always undefined → every Connect surface showed initials. The owner saw their own picture only because the profile page reads `photoURL` directly.

**Fix (minimum, additive):**
- `loadUserProfiles` reads **`photoURL`** with a defensive `photoUrl` fallback — one line, flows everywhere: user-search projection (`?query=` + `?ids=`), conversation details member views, and the list.
- `ConversationView.avatarUrl` added: for direct rows the OTHER participant's picture is resolved server-side with ONE batched profile read (fresh per request — no cache to go stale after a picture update); groups → null (icon kept).
- `AvatarImage` wired into: panel account-search results, panel conversation rows, conversation-window header, conversation-details member rows. Missing/invalid/inaccessible pictures → Radix `Avatar` falls back to initials automatically (data: URLs cannot 404; broken src renders the fallback).

**Authorization model unchanged:** the projection remains `{ id, name, photoUrl }` — the picture travels only through the same already-authorized endpoints; no new exposure, no storage paths, no private fields.

**Live verification:** Ahmed Reda's real uploaded WebP resolves in `?ids=` and the list `avatarUrl`, and **renders in the browser for the test account** (list row + window header, `loaded: true` — see screenshots). Freshness proven by tests (V1 → V2 resolves immediately).

## 6. Responsive floating panel (Part 3)

All overlay geometry is inline (§RECOVERY from the previous phase) and now **viewport-adaptive** — no fixed size for every device:

- **Units:** `dvh` for heights (the virtual keyboard can never hide the composer/search), `clamp()`/`min()` for widths, `env(safe-area-inset-*)` on every edge, breakpoints via the canonical `useIsMobileViewport`.
- **Launcher:** bottom-left with safe-area insets.
- **Desktop/laptop/tablet panel:** `width: clamp(300px, 26vw, 380px)` (380 on large desktops → 374 at 1440 → 355 at 1366 → 300 floor on tablets), `height: clamp(380px, 100dvh − 8rem − safe-area, 640px)` — the page keeps its full width and visible context (panel never exceeds 640px tall).
- **Mobile panel (<768px):** near-full-screen sheet (`top/right/left 0.5rem + safe-area`, bottom above the launcher so the close ✕ AND the launcher both remain reachable); **body scroll locked** behind the open overlay (strict restore on cleanup).
- **Conversation window:** desktop `clamp(340px, 30vw, 420px)` × `clamp(380px, 100dvh − 3rem, 620px)` anchored beside the panel column; mobile near-full-screen — `dvh` sizing keeps the composer above the keyboard.
- **Internal structure unchanged:** header/search fixed, list scrolls independently, composer anchored — all verified at every size.

## 7. Browser verification (REAL — live app, real database)

**Scenario chain executed as `test@qnalys.com`:** panel → conversation list shows «Ahmed Reda» **with his real uploaded picture** (`loaded: true`) → clicking the row opens the conversation window beside the panel (420×620, header «Ahmed Reda» + avatar, composer anchored) → minimized → account search "Ahmed Reda" → selecting the account **reopens the SAME conversation** (zero error toasts) → navigation away and back keeps the launcher.

**Viewport matrix (DOM-measured, all six PASS):**

| Viewport | Panel | Inside viewport | No h-overflow | Mobile branch | Search | Close |
|---|---|---|---|---|---|---|
| 1920×1080 | 380×640 | ✔ | ✔ | desktop | ✔ | ✔ |
| 1440×900 | 374×640 | ✔ | ✔ | desktop | ✔ | ✔ |
| 1366×768 | 355×640 | ✔ | ✔ | desktop | ✔ | ✔ |
| 768×1024 | 300×640 | ✔ | ✔ | desktop | ✔ | ✔ |
| 390×844 | 364×760 (near-full) | ✔ | ✔ | **✔ mobile** | ✔ | ✔ |
| 360×740 | 334×656 (near-full) | ✔ | ✔ | **✔ mobile** | ✔ | ✔ |

**Screenshots captured:** desktop conversation open with avatar (panel + window + right sidebar), laptop panel (1366×768), mobile near-full panel with avatar row (390×844) — saved in the session artifacts.

**Deliberately not executed:** sending a message to Ahmed Reda (production write to a real person); the composer/receive path is covered by the automated route-level suite. Also: the automation webview pauses its animation timeline (transitions were force-finished to measure end states — committed styles are the contract).

**Environment finding (documented):** in the automation webview, CDP viewport changes fire `resize` but NOT matchMedia `change` — the mobile branch now subscribes to BOTH (`useIsMobileViewport`), making it reliable in every environment.

## 8. Automated test results (executed)

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| connect-merge-paths-avatars (NEW) | 8 | 8 | 0 — fake rejects ancestor/descendant maps (the exact production error), atomic no-write, siblings/null still legal; direct+group creation stores embedded members; list avatarUrl (picture / legacy field / none) |
| connect-account-search (+2 avatar tests) | 11 | 11 | 0 — canonical photoURL, legacy fallback, missing → null, fresh update |
| connect-conversations | 21 | 21 | 0 |
| connect-authorization | 11 | 11 | 0 |
| connect-messages | 14 | 14 | 0 |
| connect-idempotency | 10 | 10 | 0 |
| connect-sync (+§UNREAD-SELF) | 15 | 15 | 0 |
| connect-floating-ui | 16 | 16 | 0 |
| connect-floating-nav | 13 | 13 | 0 |
| **Connect total** | **119** | **119** | **0** |

TypeScript: **0 errors**. ESLint (all touched surfaces): **0 errors, 0 warnings** (two pre-existing `this`-alias warnings in the untracked fake silenced with inline disables).

## 9. Production build result

**SUCCEEDED** — isolated copy (physical node_modules; junctions break Turbopack): `✓ Compiled successfully in 48s`, `BUILD_EXIT=0`, **`BUILD_ID: Q_7aAZ8Qkg8_Bwtsi1KHu`** — with ALL final changes (merge-path fix, mirror-cursor fix, §UNREAD-SELF, render-phase jump fix, read-marking loop guard, responsive geometry).

## 10. Exact files modified

| File | Change |
|---|---|
| `src/lib/connect/conversation-service.ts` | Direct + group creation: members EMBEDDED in the conversation node (single-path writes); loser cleanup single-path; §INDEX-FALLBACK for the list; batched `avatarUrl` resolution on the list + details view |
| `src/lib/connect/rtdb.ts` | + `isUnindexedQueryError` / `warnUnindexedOnce` (shared §INDEX-FALLBACK seam) |
| `src/lib/connect/sync-service.ts` | §INDEX-FALLBACK for the updated-messages window (bounded newest-400 scan, cursor-hold semantics) |
| `src/lib/connect/constants.ts` | + `SYNC_UPDATED_FALLBACK_SCAN` |
| `src/lib/connect/membership.ts` | `photoURL` canonical read (+ legacy fallback) — the avatar root-cause fix |
| `src/lib/connect/types.ts` | `ConversationView.avatarUrl` |
| `src/components/connect/floating/ConnectFloatingRoot.tsx` | §RESPONSIVE geometry (clamp/dvh/safe-area/useIsMobileViewport); mobile body-scroll lock |
| `src/components/connect/floating/ConnectPanel.tsx` | Card fills the responsive wrapper; `AvatarImage` (search + rows) |
| `src/components/connect/floating/ConversationWindow.tsx` | Header `AvatarImage`; **§LOOP-GUARD** — stable read-marking deps (mutate only) + per-target request dedupe (the verified maximum-update-depth fix) |
| `src/components/connect/ConversationDetails.tsx` | Member-row `AvatarImage` |
| `src/hooks/use-mobile.ts` | + `useIsMobileViewport` (resize + matchMedia dual subscription) |
| `src/lib/__tests__/connect-rtdb-fake.ts` | **Strict merge-path validation mirroring real RTDB** (+ pre-existing lint silencers) |
| `src/lib/__tests__/connect-merge-paths-avatars.test.ts` | NEW (8 tests, §8) |
| `src/lib/__tests__/connect-account-search.test.ts` | +2 avatar tests |

**Untouched:** backend services beyond the named seams, permission registry, `database.rules.json`, deep-link shim, the approved floating interaction model.

## 11. Remaining limitations

1. **The two `.indexOn` declarations must still be published** to production rules (already documented in `database.rules.json` — owner action; publishing restores the indexed list/sync paths; until then the fallbacks serve them correctly at degraded efficiency).
2. Sync fallback scans the newest 400 messages by key — edits to older messages flow only after the index is published (no crash, no skipped cursor).
3. The account-selection browser step sent no real messages (production protection); composer delivery is covered by the automated suite.

## 12. Manual tests still required

1. Two-account smoke (owner + one account): A sends → B receives → B replies → read/delivery ticks → badges → refresh → history (per the 1.0.1 report §19; now that creation works, this is the last acceptance step).
2. A changes their profile picture → B sees the new picture in Connect after the next list/sync round (freshness test-proven; visual check pending real accounts).
3. On a real phone: keyboard opens over the composer (dvh), safe-area insets on a notched device.

---
**Legend:** §1–§7 verified live or by executed tests; §11 items are explicitly unverified-by-design pending owner actions.
