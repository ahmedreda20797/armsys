// ══════════════════════════════════════════════════════════════
//  Polling Policy — Milestone 9 (API polling & session hardening)
//
//  Pure, DOM-free decision helpers shared by AuthContext and
//  NotificationContext so the polling behavior is unit-testable:
//
//    • No polling while the tab is hidden (both loops previously
//      fired unconditionally — the root cause of idle traffic).
//    • Returning to the foreground refreshes state once when the
//      last fetch is stale (foreground recovery).
//    • Auth identity refresh and notification polling stay fully
//      independent loops — neither triggers the other.
//
//  Interval choices (evidence from the audited implementation):
//    • NOTIFICATION_POLL_INTERVAL: 45s unchanged. It is the
//      reliability fallback for the Firebase real-time listener;
//      reliability must be preserved (Part F).
//    • FOREGROUND_STALE_THRESHOLD: 30s — matches the React Query
//      staleTime (query-provider) so foreground recovery behaves
//      consistently with the rest of the app.
//    • AUTH_REFRESH_INTERVAL: 5 min (was 60s). The old interval
//      fetched /api/auth/me every minute purely to pick up
//      permission/suspension changes. Suspension is enforced
//      server-side on every API call (authenticateFromRequest), and
//      permission edits surface on the next refetch anyway — the
//      timer only improves UI reactivity, so a 5-min cadence plus
//      foreground recovery preserves correctness at 1/5th the
//      traffic. The 12-min access-token refresh timer in
//      AuthContext is independent and untouched.
// ══════════════════════════════════════════════════════════════

export const NOTIFICATION_POLL_INTERVAL_MS = 45_000;
export const FOREGROUND_STALE_THRESHOLD_MS = 30_000;
export const AUTH_REFRESH_INTERVAL_MS = 5 * 60_000;
export const AUTH_FOREGROUND_STALE_MS = 5 * 60_000;

/** Should a periodic poll fire right now? Hidden tabs never poll. */
export function shouldPollNow(args: {
  isVisible: boolean;
  lastPollAt: number | null;
  now: number;
  intervalMs: number;
}): boolean {
  if (!args.isVisible) return false;
  if (args.lastPollAt === null) return true;
  return args.now - args.lastPollAt >= args.intervalMs;
}

/** When a tab becomes visible, refresh once only if data is stale. */
export function shouldRefreshOnForeground(args: {
  lastFetchAt: number | null;
  now: number;
  staleThresholdMs: number;
}): boolean {
  if (args.lastFetchAt === null) return true;
  return args.now - args.lastFetchAt >= args.staleThresholdMs;
}
