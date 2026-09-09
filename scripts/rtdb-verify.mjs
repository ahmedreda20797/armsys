// Verifies the corrected FIREBASE_DATABASE_URL end-to-end, replicating the
// login path: indexed query fails (no .indexOn yet) -> fallback scan succeeds.
// Prints existence/timings only — never row contents.
import { readFileSync } from 'node:fs';

const envText = readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const admin = (await import('firebase-admin')).default;
const svcJson = env.FIREBASE_SERVICE_ACCOUNT_JSON ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) : null;
const cred = svcJson
  ? admin.credential.cert(svcJson)
  : admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    });

const t0 = Date.now();
if (!admin.apps.length) admin.initializeApp({ credential: cred, databaseURL: env.FIREBASE_DATABASE_URL });

const tToken = Date.now();
await cred.getAccessToken();
console.log('token         :', `${Date.now() - tToken}ms`);

// Leg 1 — indexed query (fails fast without .indexOn — the fallback trigger)
const tQuery = Date.now();
try {
  const q = await admin
    .database()
    .ref('arm_erp/users')
    .orderByChild('email')
    .equalTo('probe@does-not-matter.test')
    .limitToFirst(2)
    .get();
  console.log('indexed query :', `OK in ${Date.now() - tQuery}ms (matches: ${q.exists() ? Object.keys(q.val()).length : 0})`);
} catch (e) {
  console.log('indexed query :', `FAILED in ${Date.now() - tQuery}ms →`, String(e.message).slice(0, 90), '→ fallback will handle this');
}

// Leg 2 — plain read (the proven fallback path)
const tScan = Date.now();
const snap = await admin.database().ref('arm_erp/users').limitToFirst(1).get();
console.log('plain read    :', snap.exists() ? 'OK — USERS TABLE HAS DATA ✓' : 'OK — users table EMPTY (no admin user yet?)', `${Date.now() - tScan}ms`);

// Count users (shallow keys only)
const tCount = Date.now();
const all = await admin.database().ref('arm_erp/users').get();
const count = all.exists() ? Object.keys(all.val()).length : 0;
console.log('users count   :', count, `(${Date.now() - tCount}ms)`);
console.log('total         :', `${Date.now() - t0}ms`);
process.exit(0);
