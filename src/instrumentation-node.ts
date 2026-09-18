// src/instrumentation-node.ts
// ══════════════════════════════════════════════════════════════
//  Node.js-only instrumentation work (Firebase Admin warm-up).
//
//  SPLIT BOUNDARY: instrumentation.ts must stay importable by the
//  EDGE runtime (Turbopack compiles it for both runtimes), so every
//  firebase-admin / node:* reference lives HERE — loaded only inside
//  instrumentation.ts's `process.env.NEXT_RUNTIME === 'nodejs'`
//  branch, which Turbopack eliminates from the edge bundle. Never
//  import this module from client or edge code.
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

  // Lazy imports — avoids loading firebase-admin at all when the
  // warm-up stages fail early; the module itself is node-only.
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

/**
 * Node.js boot warm-up + periodic token re-warm (never keeps the
 * process alive for the timer).
 */
export function registerNodeInstrumentation(): void {
  void warmFirebase();

  const timer = setInterval(() => {
    void warmFirebase();
  }, REWARM_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}
