# DELIVERY REPORT — QNALYS Connect UI Integration Recovery

> **Date:** 2026-11-19 · **Branch:** main · **Baseline commit:** `f7d17fa` · **Status:** Implemented, **visually verified in a live browser**, NOT committed, NOT deployed, no production data modified (one read-only API check + one deliberately-avoided write — see §7).
> **Prepared with:** real-browser verification as `test@qnalys.com` (credentials supplied by the owner for this session).

---

## 1. Executive summary

The reported failure was real and had **three independent causes**, all diagnosed empirically against the running application (not guessed) and all fixed:

1. **Connect was still a sidebar destination** — the `APP_PAGES` registry entry lacked the codebase's canonical `overlayOnly` flag, so the right sidebar (which renders `visiblePages = APP_PAGES minus overlayOnly`) kept rendering «تواصل».
2. **The floating launcher rendered but was effectively invisible** — its positioning depended on Tailwind utilities (`fixed bottom-5 z-[45] …`) that were **missing from the served stylesheet** in the deployed instance; with `position:fixed` not applied, the launcher fell back to its static flow position at the very END of the document (measured live: `y = 1076` on a 720px viewport — below the fold). All critical overlay geometry is now **inline styles**, immune to stylesheet-generation state.
3. **The panel could freeze at its animation start state** — the framer-motion entrance depended on `requestAnimationFrame`; in rendering contexts with a throttled/paused animation timeline the panel stayed at 62% scale, opacity 0 (measured live). The emergence animation is now **declarative CSS transitions**: the final open state is styled at React-commit time and the compositor merely interpolates — the panel can never be trapped invisible.
4. **Environment factor:** two server processes were contending for port 3000 — a **stale Nov 16 process** (predating the redesign) and today's server. The user's screenshot showing "Connect still as a normal navigation item" and "the old page" was served by code predating the floating redesign. The stale process must not be reused (§8).

**Verified in a live browser (desktop + 390px mobile, RTL):** Connect absent from the right sidebar · launcher pinned at the far-left viewport corner · panel emerges from the launcher (360×560 at its corner, origin `left bottom`) · page layout width unchanged (1198px with panel open and closed) · real account search returning real accounts · launcher + open panel persist across page navigation · close reverses toward the launcher · no horizontal overflow on mobile. Two screenshots captured (§7).

---

## 2. Diagnosis of the actual failure (traced, not assumed)

| # | Question from the task | Answer (evidence) |
|---|---|---|
| 1 | Why Connect still appears in the right sidebar | `src/config/permissions.ts` registered `connect` **without `overlayOnly`**; `usePermissions.visiblePages` (the sidebar universe) includes every non-`overlayOnly` page the role can view; the Sidebar, layout editor (`SidebarEditNav`), favorites and pins all derive from that same set. The mechanism exists in the codebase (notifications, employee360, profile, settings sections all use it) — Connect 1.0 simply didn't use it. |
| 2 | Why the floating launcher was not rendered | It WAS in the DOM — but not where it must be. Live measurement: wrapper `position` computed as **static-context fallback**; launcher rect `y=1076` on a 720px viewport (below the fold). Root cause: the `fixed`/`bottom-5`/`z-[45]` utilities were **absent from the served CSS** in the deployed instance, so the element laid out in normal flow at the end of `AppLayout`. A bare `position:fixed` probe appended in the same page pinned correctly — isolating the failure to the missing utilities, not the browser. |
| 3 | Global shell or page-only mounting | **Global** — `ConnectFloatingRoot` is mounted once in `AppLayout` (the shared authenticated shell), NOT inside any page. Confirmed live: the launcher and open panel survive page navigation. The `ConnectPage` is only a deep-link shim. |
| 4 | Why conversation controls disappeared | The user was looking at the **shim placeholder page** (the "Communication Dashboard Open" state) — which by design renders no conversation UI — while the launcher was invisible per #2. The conversation interface itself was never removed; it lives in the floating panel/window. The shim additionally offered no actionable control (fixed this round — now carries a working "open" button). |
| 5 | Old Connect page still rendered? | No page-level regression: `src/app/page.tsx` still routes `case 'connect'` to the shim (kept for notification deep links). The problem was never the router — it was the sidebar entry (#1) plus the invisible launcher (#2). |
| 6 | Permission/CSS/z-index/route/mount blockers | **CSS was the blocker** (#2) + the frame-loop animation freeze (§1.3). Permissions were correct (the launcher gates on `connect` view; the test account holds `connect: read` — verified live). Z-index (45/46) sits above content and below page modals. |
| 7 | Was the deployed app running the latest implementation? | **Mixed.** Port 3000 had TWO listeners: PID 8744 (created **Nov 16** — pre-redesign) and PID 24356 (`next start`/dev started today, serving current source with Next.js Dev Tools). The user's screenshot matches the stale process's output. Any verification must target a freshly (re)started server. |

## 3. What changed (exact files)

| File | Change |
|---|---|
| `src/config/permissions.ts` | `connect` APP_PAGES entry: **+ `overlayOnly: true`** (+ doctrine comment). Removes the sidebar/favorites/pins/layout-editor entry while keeping the permission key, the `PageId`, the API gates and deep links fully intact. |
| `src/components/connect/floating/ConnectFloatingRoot.tsx` | **§RECOVERY hardening:** (a) launcher/panel/window geometry moved to **inline styles** (launcher `fixed bottom 1.25rem left 1rem z-45`; panel `fixed bottom 5.25rem left 1rem w min(360px,100vw-2rem)`; window desktop `400px` card left of the panel / mobile near-full-screen via `useIsMobile`); (b) entrance/exit switched from framer-motion variants to **declarative CSS transitions** (`overlayMotionStyle`) — no `AnimatePresence`, no frame-loop dependency; (c) plain (non-animated) launcher wrapper; (d) `data-testid="connect-launcher"`; (e) Escape handling on the wrappers; closed surfaces are `visibility:hidden` + `pointer-events:none` so they can never intercept page interactions. |
| `src/components/connect/floating/connect-animations.ts` | Rewritten: pure `overlayMotionStyle(open, reduced, kind)` producing compositor-friendly styles (opacity/transform/visibility/pointerEvents/transition/willChange) with the same emergence geometry (`scale(0.62)→1`, origin `left bottom`, open 220ms / close 150ms, `prefers-reduced-motion` → `transition: none`). |
| `src/components/connect/floating/ConnectPanel.tsx` | Inline box fallbacks (card stays a visible bounded surface regardless of stylesheet state); dialog role/testid moved to the positioned wrapper. |
| `src/components/connect/floating/ConversationWindow.tsx` | + `open` prop: **all polling (messages/sync/details) and read-marking are gated on it** — a minimized/transitioning window polls nothing; inline box fallbacks; dialog semantics moved to the wrapper. |
| `src/components/pages/ConnectPage.tsx` | The shim is no longer a dead end: live `panelOpen` state + a working **«فتح لوحة التواصل» button**; header text reflects state. Still mounts zero Connect queries. |
| `src/lib/__tests__/connect-floating-nav.test.ts` | **NEW (13 tests)** — pins the recovery contract: `connect` overlayOnly + absent from the sidebar universe + operational pages untouched + admin-uniform exclusion; authorization unchanged (presets still `read`, stored overrides still deny, admin bypass intact); deep-link compatibility (`PageId` union + `renderPage` case); **AppLayout mounts the root exactly once; no page component mounts it; the shim polls nothing**; launcher testid present. |
| `src/lib/__tests__/connect-floating-ui.test.ts` | Rewritten animation section for the declarative contract: open state fully styled at commit; closed state hides + re-emerges toward the launcher with delayed `visibility`; close < open; reduced-motion → `transition: none`; compositor-friendly property allowlist; store lifecycle/drafts unchanged. |

**Preserved untouched:** all backend services/APIs, `database.rules.json`, the permission presets (`connect: read` unchanged), conversation data, both prior delivery reports, every unrelated module.

## 4. Navigation changes (sidebar removal — the canonical mechanism)

- `overlayOnly: true` is the exact mechanism the codebase already uses for pages that are permission identities but never sidebar destinations (notifications, employee360, profile, settings sections, masterData, rulesEngine…).
- Effects, all verified: the **Sidebar** renders `visibleIds` from `visiblePages` (overlayOnly-filtered) → Connect disappears; the **layout editor** receives the same `visiblePages` → cannot re-add it; **persisted user layouts** are filtered by `visibleIds` at render → stale `connect` entries in saved layouts are dropped non-destructively; **favorites/pins** reconcile against the same set.
- **Authorization untouched** — removing a nav entry never widens/narrows access: presets keep `connect: read`, stored `connect: none` overrides still deny (403 gates from the previous phase remain), admin bypass intact. Proven by the new tests and the re-run permission regression guards (`route-auth-regression`, `m02/m021`) — all green.
- The `connect` **PageId stays routable** (`renderPage` case + shim) so notification deep links (`navParams.conversationId/messageId`) keep working.

## 5. Global mounting

`ConnectFloatingRoot` is mounted **exactly once** inside `AppLayout` (`src/components/layout/AppLayout.tsx`) — the shared authenticated shell that wraps every page — gated on `Boolean(user) && canViewPage('connect')`. It owns the session's single conversation-list subscription (launcher badge + panel share one React Query cache); the window's message/sync/details subscriptions exist only while a conversation is active and **poll only while the window is open**. No page component mounts it (test-enforced). Subscriptions/listeners clean up through React Query + hook lifecycles; the responsive switch uses the app's canonical `useIsMobile` (`useSyncExternalStore` over `matchMedia`, SSR-safe).

## 6. Floating launcher + emergence animation

- **Launcher:** 52px fixed button at the viewport's **bottom-left** (16px margins, `z-index 45`), messaging icon, unread badge (bounded server counts, ٩٩+ above 99, hidden while the panel is open), `aria-label`/`aria-expanded`/`aria-haspopup`, focus-visible ring, focus returns to it when the panel closes, `data-testid` for e2e. Zero layout participation — inline-positioned.
- **Emergence:** the panel anchors `1rem` from the left, `5.25rem` from the bottom — directly above the launcher — with `transformOrigin: left bottom` (the button's own corner). Open: `opacity 0→1` + `scale 0.62→1` + a small `translate(-14px,10px)→0` settle over 220ms `cubic-bezier(0.22,1,0.36,1)`; close reverses in 150ms toward the same corner; `visibility` flips after the close transition. **Declarative CSS transitions** — the final state is committed with the DOM, so the panel cannot be trapped invisible by a paused animation timeline (the 1.0.1 failure mode). `prefers-reduced-motion` swaps to an instant swap (`transition: none`).
- The conversation window uses the same declarative motion; desktop = 400px card beside the panel (`left: calc(1rem + 360px + 0.75rem)`), mobile = near-full-screen via `useIsMobile`.

## 7. Browser visual verification (REAL — performed this session)

Environment: live app on `http://localhost:3000` (dev server serving current source), logged in as `test@qnalys.com` (role `user`, `connect: read`) — credentials supplied by the owner for this verification. Measured via DOM/computed-style reads + **two screenshots**.

| # | Scenario (from the task) | Result |
|---|---|---|
| 1 | Open a normal QNALYS page | ✔ Follow-ups page rendered |
| 2 | Right sidebar present | ✔ (icon rail, unchanged) |
| 3 | Connect absent from the right sidebar | ✔ `connectInSidebar: false` (DOM scan of all nav buttons) |
| 4 | Floating launcher visible at the far left | ✔ rect `x=16, y=648` on a 720px viewport (bottom-left corner), `position:fixed; bottom:20px; z-index:45` |
| 5 | Click the launcher | ✔ `aria-expanded=true`; panel mounted |
| 6 | Panel expands from the launcher | ✔ final geometry **360×560 at x=16, y=76** — sitting on the launcher's corner, `transformOrigin: left bottom`; open state styled at commit (verified inline: `opacity:1; scale(1); transition: 220ms cubic-bezier(0.22,1,0.36,1)`) |
| 7 | Panel overlays without resizing the page | ✔ `main` width **1198px with panel closed AND open** (identical) |
| 8 | Search for an existing QNALYS user account | ✔ typed "Ahmed" → dedicated Connect API returned **3 real accounts** rendered as options (Ahmed Lotfy / Ahmed Reda / Ahmed Salah) with avatar initials + Arabic helper text «اختر حساباً لفتح المحادثة المباشرة أو إنشائها»; self-search ("test") correctly returns the empty state (caller exclusion) |
| 9 | Select that account | **Deliberately NOT executed** — every candidate is a REAL production user; selecting would create a real conversation (an outward-facing write + potential notification to a real person). The open-or-create path is covered by the automated route-level suite (created→existing, concurrency dedup, self/suspended rejection). Stated honestly rather than claimed. |
| 10 | Conversation opens | Not exercised live for the same reason (see #9); the window component compiles, mounts behind the same declarative motion contract, and its polling gating is unit-tested. |
| 11 | Navigate to another QNALYS page | ✔ clicked «المتابعة اليومية» — page changed |
| 12 | Launcher remains available | ✔ launcher still mounted, **panel still open** after navigation (global mount) |
| 13 | Close returns smoothly to the launcher | ✔ inline styles flip to the closed emergence state (`opacity:0`, `scale(0.62) translate(-14px,10px)`, delayed `visibility:hidden`, `pointer-events:none`) |
| — | RTL | ✔ app is RTL; physical left anchoring unaffected; Arabic-first copy throughout |
| — | Mobile (390×780) | ✔ launcher pinned (x=16, y=708); panel **358px wide, fits viewport** (`fitsViewport: true`); `scrollWidth ≤ innerWidth` (no horizontal overflow) |
| — | Screenshots | ✔ mobile (panel + search results over dimmed page) and desktop (right rail, full-width content, far-left panel + launcher) — saved under the session artifacts |

**Verification-environment notes (honesty):**
- The automation webview pauses its animation timeline (occluded pane): transitions froze at their first frame during measurement, and screenshots initially timed out. Forcing `getAnimations().finish()` proved the committed end-state geometry; the screenshots were captured successfully after that. In a normal browser the 220ms transition plays naturally — the *committed* styles, not the timeline, are the product contract now.
- Read-only API checks used the session token (users list + two `?query=` calls). **No conversation was created, no message sent, no production record modified.**

## 8. Required manual action — server restart

The stale Nov 16 process (PID 8744) must be stopped and a single server started so the served build is unambiguous:

```powershell
# Identify what holds :3000
netstat -ano | findstr :3000
# Stop the stale process(es) — then start ONE server from the project root
npm run dev      # or: npm run build && npm start
```

The interface in this report was verified against the current-source server. If another long-lived process is serving an old build, browsers hitting it will keep showing the old UI regardless of the code.

## 9. Automated test results (executed)

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| connect-floating-nav (NEW — recovery contract) | 13 | 13 | 0 |
| connect-floating-ui (declarative animation + store) | 15 | 15 | 0 |
| connect-authorization | 11 | 11 | 0 |
| connect-conversations | 21 | 21 | 0 |
| connect-messages | 14 | 14 | 0 |
| connect-idempotency | 10 | 10 | 0 |
| connect-sync | 14 | 14 | 0 |
| connect-account-search | 9 | 9 | 0 |
| **Connect total** | **107** | **107** | **0** |
| settings-sidebar-cleanup + sidebar-state + navigation-bridge (touched area) | 37 | 37 | 0 |
| route-auth-regression + m02/m021 permission guards | 10 | 10 | 0 |

TypeScript: `npx tsc --noEmit -p tsconfig.json` → **0 errors**. ESLint (all touched surfaces) → **0 errors, 0 warnings**. Production build: **SUCCEEDED** in an isolated copy (junctions break Turbopack — "Symlink … points out of the filesystem root"): `✓ Compiled successfully in 33.0s`, `BUILD_EXIT=0`, `BUILD_ID: NYv0AY2b19xrvAn7nHOhQ`.

## 10. Remaining issues / limitations

1. **The account-selection step of the browser scenario (#9–10) was not executed live** — deliberate production-data protection. Everything up to the selection renders live; the selection itself is contract-tested at the route level. A single two-account smoke test on staging (per the prior report's §19) remains the last acceptance step.
2. The conversation **window** (message thread) was not screenshot-verified for the same reason; its logic is the previously tested stack, now with open-gated polling.
3. The stale-server hazard (#7) is operational, not code: **restart the server** before judging the UI (§8).
4. Unchanged 1.0.1 limitations: presence indicators deferred (typing only), bounded search scans, 15-minute edit window, unread cap 99+.

## 11. Status legend

- **Implemented and browser-verified:** sidebar removal, global launcher, emergence animation (committed end-state), account search rendering, navigation persistence, close reversal, mobile fit, RTL.
- **Implemented and automated-tested, not browser-executed:** account selection → open-or-create → conversation window (production-data protection).
- **Requires manual action:** server restart (§8); two-account smoke test on staging.
- **Not done by design:** deploy, commit, production Firebase changes.
