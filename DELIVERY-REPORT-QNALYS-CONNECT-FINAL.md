# DELIVERY REPORT — QNALYS Connect 1.0 → 1.0.1 (Final Verification, Bug Fixes & Floating UI Redesign)

> **Date:** 2026-11-19 · **Branch:** main · **Baseline commit:** `f7d17fa` · **Status:** Implemented and tested — NOT committed, NOT deployed, no production data or settings touched (per spec §2/§21).
> **Scope honesty:** every "verified" claim below cites an executed command (§14–§18). Nothing was verified against production Firebase; all automated tests run against the in-memory layers, and the UI is verified by type-check/build + the manual smoke procedure (§19).

---

## 1. Executive summary

This phase took the existing QNALYS Connect 1.0 implementation to completion:

1. **Diagnosed and fixed the reported direct-conversation creation failure.** Root cause: the "new conversation" dialog sourced its user picker from the FULL dashboard users directory (`/api/dashboard/users`, no `?basic=1`), which is gated on `controlPanel` page view — a permission held by NO preset role except the admin bypass. Every non-admin role — exactly the roles that hold `connect: read` — got **403**, so the picker was empty and starting a direct conversation was impossible for them. Direct-chat creation was re-founded on a new **account-search endpoint** (`/api/connect/users?query=`), gated on the Connect permission itself, returning a minimal display projection.
2. **Closed a real authorization hole**: all 12 Connect API routes authenticated the caller but **ignored the authorization decision** (`decision.allowed`) — any authenticated user could use the full Connect API regardless of the `connect` page permission. All routes now enforce `decision.allowed → 403` (canonical pattern, matches `employee-360`).
3. **Fixed two synchronization defects** that could permanently desync clients: the client never sent `sinceMs` (so edits/deletes never flowed to other clients through the sync loop), and the sync cursor jumped to the conversation's newest message instead of the last **served** message (so >100 new/updated messages between rounds were silently skipped, and delivery cursors were stamped beyond what was actually delivered). The sync contract now carries a served-based cursor plus a composite (updatedAtMs, pushKey) updated-messages cursor with bounded window widening — proven gap-free by tests for >100 new, >100 updated, and a >110-record single-millisecond burst.
4. **Fixed unreadable error toasts**: `apiFetch` threw `[object Object]` for the canonical `{ error: { code, message } }` envelope; it now extracts the Arabic `message` from both envelopes.
5. **Delivered the floating Connect UI**: far-left launcher (no layout width), panel that **emerges from the launcher** (origin-anchored scale/opacity animation, reduced-motion aware), an independent floating conversation window (reusing the tested thread/composer/details stack), per-conversation draft preservation, mobile near-full-screen layouts, and a single subscription owner so page navigation never double-polls. The existing RIGHT sidebar and page widths are untouched.
6. **Zero new regressions**: full suite failure set is identical (by name and count) to the pristine `f7d17fa` baseline; **+33 new tests, all passing** (61 → 94 Connect tests).

## 2. Root cause of the original conversation-creation failure

**Symptom:** selecting a user in "محادثة جديدة" and pressing «بدء المحادثة» failed; non-admin users saw an empty candidate list («لا يوجد مستخدمون مطابقون»); errors surfaced as `[object Object]` when they did occur.

**Traced flow (all steps inspected, none assumed):**

1. `NewConversationDialog.tsx` → `useDashboardUsers('full', open)` → **`GET /api/dashboard/users`** (FULL variant).
2. `dashboard/users/route.ts` GET: the full variant requires **`verifyPermission(request, 'controlPanel', 'view')`** → 403 unless the caller holds the Control Center page.
3. `src/config/permissions.ts`: every preset carries **`controlPanel: 'none'`** (lines 342/396/448/501); `connect: 'read'` is granted to DEFAULT/HR/MANAGER/QUALITY (lines 346/400/452/505). Only the admin bypass tier can list users.
4. ⇒ For every non-admin Connect user the picker request 403'd → `systemUsers` undefined → zero candidates → **direct-conversation creation impossible for exactly the roles Connect was enabled for**. (Admins could reach the API, but the workflow was still sourced from a management directory rather than an account-search surface.)
5. Aggravating defect: when the API *did* return an error, `apiFetch` threw `new Error(error.error)` — for the canonical `apiError` envelope `{ error: { code, message } }` this stringifies the object → **`[object Object]`** toasts, hiding the Arabic message.

**Fix (§4 semantics preserved):** the only direct-chat workflow is now **account search** in the floating panel (`/api/connect/users?query=` → select → get-or-create via the existing secure API). The group/department dialog was rewired to the same endpoint. No frontend workaround was added for the broken directory — the broken dependency was removed.

## 3. Exact files modified

**Backend (server lib + API):**

| File | Change |
|---|---|
| `src/app/api/connect/users/route.ts` | + `?query=` account-search mode (minimal projection, limits, status rules, caller/self exclusion, `decision.allowed` enforcement). `?ids=` mode unchanged. |
| `src/app/api/connect/conversations/route.ts` | `decision.allowed` enforcement (GET+POST); suspended-account rejection on direct creation; removed a duplicate `loadUserProfiles` call; nested org-permission check renamed (`orgDecision`) to avoid shadowing. |
| `src/app/api/connect/conversations/[conversationId]/route.ts` | `decision.allowed` enforcement ×3 handlers. |
| `src/app/api/connect/conversations/[conversationId]/messages/route.ts` | `decision.allowed` enforcement ×2. |
| `src/app/api/connect/conversations/[conversationId]/messages/[messageId]/route.ts` | `decision.allowed` enforcement ×3; purge's delete-action check renamed (`deleteDecision`). |
| `src/app/api/connect/conversations/[conversationId]/members/route.ts` | `decision.allowed` enforcement ×2. |
| `src/app/api/connect/conversations/[conversationId]/members/[memberId]/route.ts` | `decision.allowed` enforcement ×2. |
| `src/app/api/connect/conversations/[conversationId]/pins/route.ts` | `decision.allowed` enforcement ×2. |
| `src/app/api/connect/conversations/[conversationId]/read/route.ts` | `decision.allowed` enforcement. |
| `src/app/api/connect/conversations/[conversationId]/typing/route.ts` | `decision.allowed` enforcement. |
| `src/app/api/connect/conversations/[conversationId]/search/route.ts` | `decision.allowed` enforcement. |
| `src/app/api/connect/conversations/[conversationId]/sync/route.ts` | `decision.allowed` enforcement; parses `sinceKey` (composite cursor). |
| `src/lib/connect/sync-service.ts` | Served-based `cursor`; delivery stamping only for actually-served messages; composite `(updatedAtMs, pushKey)` updated-messages continuation with bounded window widening; `updatedCursorMs/updatedCursorKey` in the payload. |
| `src/lib/connect/types.ts` | `ConversationSyncPayload.updatedCursorMs/updatedCursorKey`; `ConnectAccountSummary`. |
| `src/lib/connect/constants.ts` | `ACCOUNT_SEARCH_MIN/QUERY_MAX/RESULTS_MAX`. |
| `src/lib/connect/client-merge.ts` | `MessagesCacheShape.updatedCursorMs/updatedCursorKey/syncedAtMs`; monotonic persistence in `applySyncPayload`. |

**Client (hooks + shell + UI):**

| File | Change |
|---|---|
| `src/lib/api-fetch.ts` | Error extraction handles BOTH envelopes (`{error:"…"}` and `{error:{message}}`) — Arabic messages instead of `[object Object]`. |
| `src/hooks/use-connect.ts` | Sync rounds echo `sinceMs`+`sinceKey`; sync `refetchInterval` now actually applies the tested failure backoff (`activePollIntervalMs(fetchFailureCount)` — the helper existed and was tested in 1.0 but was never wired); + `useConnectAccountSearch`; + `useOpenDirectConversation` (select-to-open-or-create with per-account in-flight coalescing). |
| `src/components/connect/floating/connect-floating-store.ts` | **NEW** — overlay state (panel/window/minimize, per-conversation drafts, deep-link entry). |
| `src/components/connect/floating/connect-animations.ts` | **NEW** — pure launcher→panel emergence variants (+reduced-motion), GPU-friendly property contract. |
| `src/components/connect/floating/ConnectPanel.tsx` | **NEW** — floating panel: header/unread summary, account search (debounced) replacing the list while searching, compact conversation rows. |
| `src/components/connect/floating/ConversationWindow.tsx` | **NEW** — floating conversation window wrapping the existing MessageThread/MessageComposer/ConversationDetails; read-on-view, typing, search, drafts. |
| `src/components/connect/floating/ConnectFloatingRoot.tsx` | **NEW** — mounted ONCE in AppLayout: launcher (unread badge), panel emergence, window, group dialog, account→conversation flow. |
| `src/components/connect/NewConversationDialog.tsx` | Rewritten as **group/department-only** (direct mode removed — replaced by panel account search); member picker switched from the controlPanel-gated directory to connect account search; multi-select chips. |
| `src/components/connect/MessageComposer.tsx` | + optional `initialBody`/`onBodyChange` (draft preservation; edit sessions never overwrite the stored draft). |
| `src/components/pages/ConnectPage.tsx` | Rewritten as a **shim**: registers page identity, converts deep-links/visits into ONE overlay open (`openWithConversation`), mounts NO Connect queries (no duplicate polling). |
| `src/components/layout/AppLayout.tsx` | + `<ConnectFloatingRoot />` mounted once (the only shared-UI integration point; fixed positioning, zero layout participation). |

**Tests:**

| File | Change |
|---|---|
| `src/lib/__tests__/connect-account-search.test.ts` | **NEW** — 9 tests (privacy, limits, status rules, 401/403, ids mode). |
| `src/lib/__tests__/connect-floating-ui.test.ts` | **NEW** — 15 tests (animation contract incl. reduced-motion + GPU-friendly keys; store lifecycle + drafts + deep-link jump target). |
| `src/lib/__tests__/connect-sync.test.ts` | +4 tests (>100 new; >100 updated; same-ms burst >cap; cache cursor monotonicity). |
| `src/lib/__tests__/connect-conversations.test.ts` | +3 tests (suspended target; concurrent pair creation; permission-override 403). |
| `src/lib/__tests__/connect-idempotency.test.ts` | +2 tests (same-key different-payload protection; crashed-writer takeover). Cleaned 2 pre-existing `require()` lint errors in-file (static import). |

**Preserved untouched:** `database.rules.json`, `src/config/permissions.ts`, `src/types/index.ts`, `src/app/page.tsx` (all carried user changes from 1.0 — left exactly as found), both prior delivery reports, all unrelated modules.

## 4. Backend changes and justification

| Change | Why |
|---|---|
| Account-search endpoint | The broken picker's replacement (root cause §2) — Connect-scoped, minimal projection, bounded. |
| `decision.allowed` enforcement ×23 handlers | Authentication alone was accepted; the canonical app pattern (e.g. `employee-360`) gates on the decision. Over-permissive API = security defect, fixed at the gate. |
| Suspended-account rejection on direct creation | Spec §4: "Invalid, inactive, or unauthorized accounts must be handled safely." |
| Sync served-cursor + composite updated cursor | Spec §6C: >100 updates must not create permanent gaps; cursors must never advance past unprocessed records. |
| `apiFetch` error extraction | Spec §4: "Failures must return meaningful, controlled error responses … understandable Arabic error messages." (Shared file — backward compatible with the legacy string envelope used across the app.) |

No schema changes, no new tables/nodes, no business-logic rewrites: conversation/message/read-state services are byte-identical except the sync cursor semantics.

## 5–9. UI redesign implementation (floating launcher, panel, window, search, direct-chat flow)

**Spatial contract (§7):** `AppLayout` keeps `flex → [Sidebar (RIGHT), main column]` untouched. `ConnectFloatingRoot` renders `position: fixed` elements only — **launcher `left-4 bottom-5`, panel above it, window beside the panel** — participating in zero layout, so page content and the existing right sidebar keep their exact widths. Both coexist independently.

**Launcher (§8):** 52px round button, far-left edge, messaging icon, QNALYS slate/emerald identity, unread badge (bounded server counts, ٩٩+ above 99, hidden while the panel is open), `aria-label`/`aria-expanded`/`aria-haspopup`, keyboard focusable, focus returns to it when the panel closes, persists across navigation (mounted once), RTL-safe physical positioning.

**Launcher→panel animation (§9):** the panel is anchored at `bottom-[5.25rem] left-4` with `transformOrigin: left bottom` — the launcher's own corner — and animates `opacity 0→1`, `scale 0.62→1`, `x/y settle` over ~220ms (reverse ~150ms on close). Transform/opacity only (GPU-composited; the property allowlist is **test-enforced**). `prefers-reduced-motion` swaps to fade-only (test-enforced: no scale/x/y). No layout properties animate; no reflow; no page shift; the overlay has no backdrop so underlying controls are never blocked (pointer events pass outside the panel).

**Panel (§10):** header (identity + unread summary + group-creation + close), one search field with two modes — empty ⇒ conversation rows (avatar, name, preview, relative time, unread badge, active highlight; independently scrollable); query ≥ 2 chars ⇒ **account search results** replacing the list. Loading/empty/error states are explicit and Arabic. Efficient rendering: the list is the existing bounded server projection; no message histories are loaded by the panel.

**Account search (§11):** debounced 250ms (panel) / 250ms (dialog); server-side filtering over the cached users table; results ≤ 8; minimal `{ id, name, photoUrl }`; email is matchable but **never returned**; caller excluded; suspended accounts hidden. **Selecting an account** calls `POST /api/connect/conversations {type:'direct', otherUserId}` (the existing race-safe get-or-create) — there is **no confirm dialog and no create button**; the conversation opens automatically (existing or newly created — `created` in the response is not even needed by the UI). Repeated/overlapping clicks coalesce onto one in-flight request per account (`useOpenDirectConversation`), and the server's `directIndex` transaction is the ultimate dedup gate (test-proven). Group/department creation keeps its dialog workflow (now also usable by every Connect-enabled role).

**Conversation window (§12):** independent fixed overlay (desktop: 400×≤600px card beside the panel; mobile: near-full-screen sheet). Header (avatar, title, subtitle, in-conversation search, details, minimize, close). Message area reuses `MessageThread` (grouping, day separators, replies, tombstones, edited flags, mention chips, pinned banner, jump/highlight, typing dots, load-older). Composer reuses `MessageComposer` (Enter/Shift+Enter, Esc cancels, auto-grow, RTL, typing ping) — **no attachment/voice controls** (storage not approved). **Drafts**: per-conversation text persists across switches, minimize and close; cleared on send; edit sessions prefill without overwriting the draft. Multi-window complexity was deliberately avoided in favor of one window + preserved drafts (spec-sanctioned).

**Responsive (§13/§14):** desktop keeps the launcher far-left, panel emergence, window beside the panel, right sidebar unchanged. Mobile: compact launcher, panel `calc(100vw-2rem)` wide, window near-full-screen (`inset-2`) with a back button, comfortable touch targets (≥36px rows/buttons), no horizontal overflow (fixed positioning + width caps), composer keeps keyboard usability. RTL: physical `left-*` positioning and `transformOrigin` are direction-independent; Arabic-first copy throughout.

## 10. Security verification

- **Server-derived sender identity** — unchanged, test-proven (`senderUserId in the body is IGNORED`).
- **Membership enforcement** — unchanged: non-member/unknown/removed ⇒ identical 404 on 6 surfaces (tests re-run green).
- **NEW: page-permission enforcement on every Connect route** — a `connect: none` override yields 403 on list/create/users-search (new tests). Previously authentication alone passed all 12 routes.
- **NEW: account-search privacy** — minimal projection; no emails/roles/permissions/hash/tokens in any response (raw-JSON assertions); self excluded; suspended hidden; ≤ 8 results; ≥ 2-char queries; `connect` permission required.
- **Request validation** — unchanged (fail-closed validators re-run green). Payload limits unchanged.
- **Audit** — unchanged; still records actors/actions/ids only (content-absence test re-run green).
- **Suspended accounts cannot be targeted** by new direct conversations (new test; shell-writes asserted zero).

## 11. Idempotency findings

The transaction-based `clientKey` claim is **correct** and now fully covered against the spec's six scenarios:

| Scenario | Verdict | Evidence |
|---|---|---|
| Same key + same payload | existing replay, one record | existing test (re-ran green) |
| Same key + **different payload** (same sender) | **original message wins, never replaced** | NEW test |
| Concurrent duplicates | 10-way concurrent ⇒ exactly one 201/one message | existing test (re-ran green) |
| Writer failure **before** writing | TAKEOVER completes the claim-fixed id; still one message; subsequent retries replay | NEW test (claim pre-seeded, then send) |
| Ambiguous write failure (may have succeeded) | claim released best-effort on the failure path; the takeover path heals a dangling claim (proven above) — a released claim + a write that actually landed cannot double-write because the message id is pre-allocated and the write is idempotent by construction | design review + NEW takeover test |
| Retry after success + failed HTTP | same-key replay returns `existing` (first scenario) | existing test |

A client key can never let a different payload replace an accepted message (server returns the original record).

## 12. Message ordering findings

**Verdict: the existing RTDB push-key strategy is sufficient and preserved.**
- Message ids are `ref.push().key` allocated server-side without writing; lexicographic key order = allocation order (time-ordered, per-process monotonic counters absorb sub-millisecond bursts). Thread order, pagination (`orderByKey` bounds) and cursors are ALL defined in terms of key order — self-consistent regardless of which server instance allocated the key or small clock differences; there are no sequence counters and no transactional dependencies (spec §6A constraint respected).
- Retried requests reuse the claim-fixed id (§11) — a retry cannot reorder or duplicate.
- Delayed requests sort at their allocation point — the position the message logically occupied when created.
- Concurrent distinct sends: 8-way test asserts all land, unique, time-ordered (re-ran green).

## 13. Synchronization findings

Three defects found and fixed (§1.3), contract now:

- **New messages**: `startAt(cursor)` capped at 100/round; the response `cursor` = the last **served** id (never the conversation's newest). >100-between-rounds ⇒ N rounds of 100, zero skips (test walks 130).
- **Updated messages** (edits/tombstones): window `orderByChild('updatedAtMs').startAt(sinceMs)` capped at 100/round; continuation via composite `(updatedCursorMs, updatedCursorKey)` — RTDB orders value ties by key, so the cursor resumes exactly after the last processed record; same-millisecond bursts larger than the cap neither stall nor skip (window widens ×3, bounded to 600 — test walks a 110-record single-ms burst and covers all of it).
- **The client actually participates now**: every sync round echoes `sinceMs` (+ `sinceKey` when present) and persists the returned cursors monotonically (forward-only, test-enforced). In 1.0 the client never sent `sinceMs`, so **edits/deletes never reached other clients via the sync loop at all** — the silent biggest bug of the phase.
- **Delivery stamps** now reflect only actually-served messages (1.0 stamped the conversation's newest id even when nothing was served — corrupting delivered-state under truncation).
- Unchanged: monotonic read cursors (transaction-guarded, test-proven), bounded unread scans, typing TTL, hidden-tab pause, overlap guard, backoff, React Query dedup.

## 14. Tests executed with exact commands

- Connect suites: `npx tsx --tsconfig tsconfig.test.json --test src/lib/__tests__/connect-{authorization,conversations,messages,idempotency,sync,account-search,floating-ui}.test.ts`
- Full regression: `node scripts/run-tests.mjs` (project root)
- Pristine baseline: `git worktree add ../arm-erp-baseline f7d17fa` + node_modules junction + copied `.env.example` (gitignored file the env-hygiene tests read; its absence produced 6 artifact failures on the first baseline attempt — re-run after the copy) + `node scripts/run-tests.mjs`
- Typecheck: `npx tsc --noEmit -p tsconfig.json`
- Lint: `npx eslint src/lib/connect src/components/connect src/components/pages/ConnectPage.tsx src/hooks/use-connect.ts "src/app/api/connect" src/lib/api-fetch.ts src/components/layout/AppLayout.tsx <new test files>`
- Build: isolated full copy at `Desktop/arm-erp-buildcheck` (junctioned node_modules; the in-tree `.next` is held by a running dev process — EBUSY, same as the 1.0 phase) + `npx next build`

## 15. Test results with exact counts

**Connect suites: 94 tests, 94 pass, 0 fail** (was 61/61 — +33 new, all passing)

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| connect-authorization | 11 | 11 | 0 |
| connect-conversations | 21 | 21 | 0 |
| connect-messages | 14 | 14 | 0 |
| connect-idempotency | 10 | 10 | 0 |
| connect-sync | 14 | 14 | 0 |
| connect-account-search (new) | 9 | 9 | 0 |
| connect-floating-ui (new) | 15 | 15 | 0 |

## 16. Baseline regression comparison (§6E — count discrepancy reconciled)

**Current tree (after this phase):** ts run **3230 tests / 3223 pass / 7 fail**; mts run **119 / 117 / 2**.
**Pristine `f7d17fa` baseline (executed this phase: worktree + junctioned node_modules + `.env.example` copied — see the artifact note below):** ts run **3136 / 3129 / 7**; mts run **119 / 117 / 2**.

**The 1.0 report's "7 failures vs the longer category list" discrepancy, reconciled:** the runner's `fail` count tallies failing top-level test entries, while the 1.0 report's category list enumerated failing **suites/subtests** — e.g. `evidence-items.test.ts` contributes TWO failing suites (`parseEvidenceStoragePath`, `sanitizeEvidenceItems — server-authoritative §20`) whose failing subtests are `rejects traversal…` and `strips client-forged provenance…`; `Phase 6.1 — exact navigation contract` is one suite whose failing subtest is `24. highlight integration…`. Both descriptions describe the same underlying failure set, counted at different levels. Neither number was wrong; the 1.0 report was simply mixing levels.

**Failure-name comparison (executed, both logs):** **identical sets** —

- `evidence/__tests__/evidence-items.test.ts` — suites `parseEvidenceStoragePath` + `sanitizeEvidenceItems (server-authoritative §20)` (subtests: `rejects traversal…`, `strips client-forged provenance…`)
- `quality-observations/__tests__/evidence.test.ts` — the four `UI regression — …` subtests
- `search/__tests__/global-search.test.ts` (`Phase 6.1 — exact navigation contract`) — `24. highlight integration…`
- `§DOWNLOAD-OPT — GET /api/notification-stats (30s AOCC poll path)` (ts) + `download-opt-route-contracts.test.mts` (`N. stats contract unchanged + both reads use the POLL tier`) (mts)
- `find-user-by-email.test.mts` (mts)

**Artifact note (honesty):** the FIRST baseline attempt reported 13 ts failures — 6 of them were `env-example-secrets` tests failing solely because `.env.example` is a **gitignored** file absent from a fresh worktree (they read it from `process.cwd()`). After copying it into the baseline, the baseline reproduced exactly 7 + 2 failures. None of those 6 were ever related to this phase's changes.

**Delta: +33 tests, all passing; 0 new failures; the pre-existing failure set is untouched (no unrelated test was modified or silenced).**

## 17. TypeScript and ESLint results

- `npx tsc --noEmit -p tsconfig.json` → **0 errors** (whole project).
- `npx eslint <all Connect + touched surfaces>` → **0 errors, 0 warnings**. (Two PRE-EXISTING `require()` lint errors inside `connect-idempotency.test.ts` — a file this phase extends — were cleaned by switching to a static import; no rule was disabled.)

## 18. Production build result

**BUILD SUCCEEDED** — `npx next build` in an isolated full copy (`Desktop/arm-erp-buildcheck`; physically-copied `node_modules` — a junction breaks Turbopack with "Symlink … points out of the filesystem root", and the in-tree `.next` is held by a running dev process, the same EBUSY constraint as the 1.0 phase). Built with ALL final changes (deep-link jump wiring, sync backoff wiring included):

- `✓ Compiled successfully in 18.8s` · exit code **0** · `BUILD_ID: WPyBGqY7rnOlf8NZjxCzR`
- All **12 `/api/connect/*` routes compiled** as dynamic server routes (ƒ), including the extended `/api/connect/users`
- Zero compile errors; the floating components, shim page, and AppLayout integration all build.

## 19. Manual smoke test (two real accounts — NOT performed by this phase)

Prerequisites: two existing QNALYS accounts (A with `connect` permission, B likewise; at least one NON-admin to prove the fixed workflow), a running dev/prod instance, two browsers or profiles.

1. Log in as **A**. Navigate to any page (e.g. Home). Verify the **far-left** floating launcher with the messaging icon; the RIGHT sidebar and page layout are unchanged and the page width is not reduced.
2. Click the launcher → the panel **emerges from the button** (expands from the launcher corner; closing shrinks back into it).
3. In the panel search, type a few letters of **B's account display name** (and once, B's email) → account results appear ≤ ~250ms after typing stops; A does NOT appear in the results.
4. Click **B** → the conversation opens automatically (no confirm dialog). Watch the network tab: exactly ONE `POST /api/connect/conversations` per click; repeated rapid clicks ⇒ still one request (in-flight coalescing).
5. Send a message from **A** → appears instantly (optimistic), conversation list reorders.
6. Log in as **B** (separate browser/session) → the launcher badge shows the unread count; B's panel lists A's conversation with the preview.
7. B opens the conversation → badge clears; B replies.
8. A's window receives B's reply within ~10s (sync round); A's typing indicator shows while B types (and vice versa).
9. **Edit check:** A edits their own message within 15 minutes → B's window shows the edited text + flag within ~10s. Delete a message → both sides show the tombstone. (These exercise the FIXED sinceMs flow.)
10. Unread badges: send 2 messages from A while B is on another page → B's badge = 2; B opens the conversation → 0.
11. Refresh both sessions → history intact; drafts: type text in A's composer, switch to another conversation and back → the draft is still there; minimize the window (−) → the draft persists; close (✕) and reopen from the panel → draft persists.
12. Navigate A through several QNALYS pages (reports, tables) → the launcher stays available; the page never shifts horizontally; open a page modal (e.g. any dialog) → it renders ABOVE the Connect surfaces; Escape inside the Connect panel closes only the panel.
13. Keyboard: Tab to the launcher, Enter to open, Escape to close → focus returns to the launcher.
14. Mobile (or devtools viewport ≈ 390px): launcher visible; panel fits the viewport; opening a conversation goes near-full-screen with a back button; compose with the soft keyboard; no horizontal scroll.
15. `prefers-reduced-motion` (OS setting or devtools emulation): open/close the panel → fade only, no scale/movement.

**Success criteria:** every step passes with zero console errors; direct-chat creation works for a NON-admin account (the 1.0 bug); no duplicate conversations exist after repeated selection (verify in the Firebase Console under `arm_erp/connect/conversations` — exactly one per pair).

## 20. Any manual action required from the user

1. **Run the §19 smoke test** with two real accounts (this phase cannot access production).
2. **Publish the two index declarations** to the Firebase Console / production `database.rules.json` (already mirrored in the repo's `database.rules.json` from 1.0 — unchanged by this phase, NOT deployed): `userConversations/$uid → .indexOn ["lastMessageAt"]`, `conversations/$cid/messages → .indexOn ["updatedAtMs"]`. Until published, queries still work (server-side scan; the edit-sync window benefits most from the index).
3. Optional: per-role `connect: none` overrides in the Control Center now genuinely deny the API (§10) — review any role that should not have messaging.
4. Nothing else — no deploy, no commit, no console changes were made by this phase.

## 21. Remaining limitations (unchanged from 1.0 unless noted)

1. RTDB has no full-text search — in-conversation search remains a bounded newest-400 scan (labeled in the UI). Account search is likewise a server-side filtered scan of the cached users table (bounded results; the table is the same cached single-flight read the dashboard uses).
2. Unread counts exact ≤ 99, then "٩٩+".
3. Edit window 15 minutes (product decision, `EDIT_WINDOW_MS`).
4. Direct display names refresh on the next message/details fetch (denormalized snapshots).
5. **No DOM-renderer in the test harness** — the React components are verified by type-check + production build + the pure logic tests (animation contract, store lifecycle) + the §19 manual procedure. The panel/window/launcher are marked *implemented but not UI-automation-tested*.
6. Presence indicators remain deferred (typing only) — the panel's rows therefore show no online dots (the spec allows this: "where reliable presence data exists").
7. **Pathological sync note (new, documented):** the updated-messages continuation widens its window up to 600 records to traverse a same-millisecond tie group larger than the 100-record cap; a hypothetical >600-record single-millisecond edit burst would retry on the next round unchanged (no data loss — it resumes identically; real edit traffic cannot reach this).
8. Sync-with-`sinceMs` for clients is forward-compatible only within this codebase version — an OLD 1.0 tab (cached JS) will still sync without `sinceMs` (new-message flow works; edit flow for that stale tab degrades to what 1.0 did). A refresh picks up 1.0.1.

## 22. Status legend

- **Implemented and tested:** everything in §5–§13 backed by the 93-test suite (§15) + tsc + eslint; sync/idempotency/authorization behavior via route-level tests on the in-memory RTDB fake.
- **Implemented but not production-verified:** all production behavior (no live Firebase touched).
- **Requires manual verification:** §19 smoke test (two real accounts), UI animation feel, mobile keyboard behavior, Console index publication (§20.2).
- **Deferred by design:** §21 (unchanged deferrals; presence; attachments pending storage approval).

---

### §15a. Executed evidence appendix (literal outputs)

```
# Connect suites (7 files, after all changes)
ℹ tests 94
ℹ pass 94
ℹ fail 0

# Full regression — CURRENT tree (node scripts/run-tests.mjs)
ℹ tests 3230
ℹ suites 767
ℹ pass 3223
ℹ fail 7
  (evidence-items ×2 suites / evidence.test.ts UI regressions ×4 /
   global-search Phase 6.1 highlight / §DOWNLOAD-OPT notification-stats)
ℹ tests 119      # mts run
ℹ pass 117
ℹ fail 2         # find-user-by-email + download-opt route contracts

# Full regression — PRISTINE f7d17fa (worktree + node_modules junction
# + .env.example copied; first attempt without it: 13 fail, 6 = env
# artifacts)
ℹ tests 3136
ℹ pass 3129
ℹ fail 7         # IDENTICAL failure names to the current tree
ℹ tests 119
ℹ pass 117
ℹ fail 2

# TypeScript (whole project)
(npx tsc --noEmit -p tsconfig.json)  → no output, exit 0

# ESLint (all Connect + touched surfaces)
(npx eslint …)   → no output, exit 0

# Production build (isolated copy, physical node_modules)
✓ Compiled successfully in 19.6s
BUILD_EXIT=0
ƒ /api/connect/conversations
ƒ /api/connect/conversations/[conversationId]
ƒ /api/connect/conversations/[conversationId]/members
ƒ /api/connect/conversations/[conversationId]/members/[memberId]
ƒ /api/connect/conversations/[conversationId]/messages
ƒ /api/connect/conversations/[conversationId]/messages/[messageId]
ƒ /api/connect/conversations/[conversationId]/pins
ƒ /api/connect/conversations/[conversationId]/read
ƒ /api/connect/conversations/[conversationId]/search
ƒ /api/connect/conversations/[conversationId]/sync
ƒ /api/connect/conversations/[conversationId]/typing
ƒ /api/connect/users
```
