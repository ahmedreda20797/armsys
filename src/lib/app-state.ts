/**
 * Application State Machine
 * Derives a single AppState from auth context values.
 * Only the overlay layer reacts to state changes — the shell never remounts.
 */

export type AppState =
  | 'initializing'   // Firebase/JWT session check in progress
  | 'login'          // No session — show login overlay
  | 'ready';         // Authenticated — show app content

export function deriveAppState(loading: boolean, user: unknown): AppState {
  if (loading) return 'initializing';
  if (!user) return 'login';
  return 'ready';
}
