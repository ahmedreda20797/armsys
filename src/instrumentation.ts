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
//  request arrives, so the first login is a WARM login (~1s):
//    1. resolveFirebaseCredentials() — fails loudly (log-only) on
//       missing/placeholder config instead of failing the login.
//    2. initialize the Admin app + fetch an OAuth token via one
//       tiny bounded RTDB read (same code path findUserByEmail uses).
//  A scheduled re-warm keeps a fresh token in the Admin SDK cache
//  (Google tokens live ~1h), so idle servers don't go cold again.
//
//  Safety: every stage is try/catch-isolated and logged with durations
//  only — NO credentials, keys, or user data are ever logged. A
//  failed warm-up never crashes the server; the login route's own
//  FirebaseConfigError contract still handles misconfiguration.
// ══════════════════════════════════════════════════════════════

const WARMUP_TIMEOUT_MS = 30_000;
const REWARM_INTERVAL_MS = 50 * 60 * 1000; // stay ahead of the ~1h token lifetime

function log(stage: string, ms: number, ok: boolean, extra?: string) {
  const tag = ok ? '✔' : '✖';
  console.log(`[FirebaseWarmup] ${tag} ${stage} ${Math.round(ms)}ms${extra ? ` — ${extra}` : ''}`);
}

function withTimeout<T>(label: string, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t0 = performance.now();
    const timer = setTimeout(() => {
      reject(new Error(`${label} exceeded ${WARMUP_TIMEOUT_MS}ms`));
    }, WARMUP_TIMEOUT_MS);
    run()
      .then((v) => {
        clearTimeout(timer);
        log(label, performance.now() - t0, true);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        log(label, performance.now() - t0, false, String(err?.message ?? err).slice(0, 160));
        reject(err);
      });
  });
}

async function warmFirebase(): Promise<void> {
  const t0 = performance.now();

  // Lazy imports — keeps edge/browser bundles untouched and avoids
  // loading firebase-admin at all when the runtime isn't nodejs.
  const { resolveFirebaseCredentials, getAdminDb } = await import('@/lib/firebase-server');
  const { pingDatabase } = await import('@/lib/db');

  // Stage 1 — credential resolution (config errors surface HERE, at
  // boot, with the actionable FirebaseConfigError message in the log).
  await withTimeout('credentials', async () => {
    resolveFirebaseCredentials();
  }).catch(() => undefined); // logged; boot continues — login route still reports properly

  // Stage 2 — Admin app init + OAuth token + first RTDB round-trip
  // (one tiny bounded read of the same shape the login path performs).
  try {
    await withTimeout('rtdb-probe', () => pingDatabase());
    // Stage 3 — the indexed query path (orderByChild/equalTo). Exercise
    // it once so a missing .indexOn rule or a hung query is discovered
    // in the boot log, not during someone's first login attempt.
    await withTimeout('rtdb-indexed-probe', () =>
      getAdminDb()
        .ref('arm_erp/users')
        .orderByChild('email')
        .equalTo('__warmup_probe__')
        .limitToFirst(1)
        .get(),
    ).catch(() => undefined);
  } catch {
    // already logged inside withTimeout
  }

  console.log(`[FirebaseWarmup] done in ${Math.round(performance.now() - t0)}ms`);
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  void warmFirebase();

  // Periodic re-warm: keeps the Admin SDK's OAuth token fresh so a
  // server idle for hours doesn't serve the next user a cold login.
  const timer = setInterval(() => {
    void warmFirebase();
  }, REWARM_INTERVAL_MS);
  // Never keep the process alive just for the re-warm timer.
  if (typeof timer.unref === 'function') timer.unref();
}
