// src/instrumentation.ts
// ══════════════════════════════════════════════════════════════
//  Next.js server boot instrumentation (AUTH-ROOT-CAUSE FIX).
//
//  WHY THIS EXISTS: a COLD first login paid the full Firebase Admin
//  startup cost inline — credential resolution + Admin SDK init +
//  the OAuth2 access-token fetch + the first RTDB round-trip —
//  which on this deployment measured ~17–20s. findUserByEmail's
//  indexed-query guard (10s) then burned its whole budget while the
//  socket was still connecting, fell back to the users-table scan,
//  and the combined path hovered dangerously close to the 45s
//  frontend timeout. The login itself was never "broken" — it was
//  doing cold-start work inside the request.
//
//  FIX: perform that exact work ONCE at server boot, before any
//  request arrives, so the first login is a WARM login (~1s).
//
//  §EDGE BOUNDARY (build-critical): Turbopack compiles THIS module
//  for BOTH runtimes — Node AND Edge. Any static or dynamic import
//  of firebase-admin / node:* reachable from here is bundled into
//  the Edge build and fails it ("node:fs is not supported in the
//  Edge Runtime"). Therefore the Node-only work lives in
//  instrumentation-node.ts and is imported DIRECTLY inside the
//  `NEXT_RUNTIME === 'nodejs'` branch — the one shape Turbopack's
//  per-runtime dead-code elimination recognizes (a helper-function
//  indirection defeats it and drags node:fs into the edge bundle).
//
//  Safety: every warm-up stage is try/catch-isolated and logged with
//  durations only — NO credentials, keys, or user data are ever
//  logged. A failed warm-up never crashes the server; the login
//  route's own FirebaseConfigError contract still handles
//  misconfiguration.
// ══════════════════════════════════════════════════════════════

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // The literal import specifier MUST sit inside this guarded block —
    // see §EDGE BOUNDARY above.
    const { registerNodeInstrumentation } = await import('./instrumentation-node');
    registerNodeInstrumentation();
  }
}
