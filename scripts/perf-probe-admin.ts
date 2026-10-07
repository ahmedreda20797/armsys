// TEMPORARY (perf investigation): create/remove the perf-probe admin.
// Same convention as scripts/cleanup-visual-verify-admin.ts — session-only
// verification user, deleted after measurements. No secrets printed.
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadLocalEnvFiles(): void {
  for (const fileName of ['.env', '.env.local']) {
    let raw: string;
    try { raw = fs.readFileSync(path.resolve(process.cwd(), fileName), 'utf8'); } catch { continue; }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadLocalEnvFiles();

import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import admin from 'firebase-admin';

const EMAIL = 'perf-probe-temp@qnalys.local';
const PASSWORD = 'PerfProbe#2026x';

function privateKey(): string {
  const raw = process.env.FIREBASE_PRIVATE_KEY ?? '';
  // .env files may hold the key with literal \n sequences
  return raw.includes('\\n') && !raw.includes('\n') ? raw.replace(/\\n/g, '\n') : raw;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'create';
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: privateKey(),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL!,
  });
  const db = admin.database();
  const usersRef = db.ref('arm_erp/users');
  const snap = await usersRef.get();
  const users = (snap.val() ?? {}) as Record<string, Record<string, unknown>>;

  if (mode === 'remove') {
    for (const [key, u] of Object.entries(users)) {
      if (String(u.email ?? '').toLowerCase() === EMAIL) {
        await usersRef.child(key).remove();
        console.log(`removed ${key}`);
      }
    }
    console.log('cleanup done');
    return;
  }

  const existing = Object.entries(users).find(([, u]) => String(u.email ?? '').toLowerCase() === EMAIL);
  if (existing) {
    console.log(`already exists: ${existing[0]}`);
    return;
  }
  const key = createId();
  const hash = await bcrypt.hash(PASSWORD, 12);
  await usersRef.child(key).set({
    email: EMAIL,
    password: hash,
    name: 'Perf Probe',
    role: 'admin',
    permissions: {},
    createdAt: new Date().toISOString(),
    isActive: true,
  });
  console.log(`created ${key}`);
  process.exit(0);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
