// Cleanup: remove the temporary visual-verification admin created for
// the Settings Center navigation task (same convention as the previous
// task's manual verification — created for the session, deleted after).
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadLocalEnvFiles(): void {
  const projectRoot = process.cwd();
  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(projectRoot, fileName);
    let raw: string;
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
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

import { getAdminDb } from '../src/lib/firebase-server';

const TARGET_EMAIL = 'visual-verify-temp@qnalys.local';
const TARGET_KEY = process.argv[2] ?? 'qeeruzbcgca40c3y20g5bijh';

async function main(): Promise<void> {
  const db = getAdminDb();
  const usersSnap = await db.ref('arm_erp/users').get();
  const users = (usersSnap.val() ?? {}) as Record<string, Record<string, unknown>>;
  const entry = Object.entries(users).find(
    ([key, u]) => key === TARGET_KEY || String(u.email ?? '').toLowerCase() === TARGET_EMAIL,
  );
  if (!entry) {
    console.log(`✅ cleanup: no user found for ${TARGET_EMAIL} (already removed)`);
    return;
  }
  const [key, user] = entry;
  if (String(user.email ?? '').toLowerCase() !== TARGET_EMAIL) {
    console.error(`❌ safety: key ${key} does not match the target email — aborting`);
    process.exit(1);
  }
  await db.ref(`arm_erp/users/${key}`).remove();
  // Remove any session records bound to this user (best effort).
  for (const sessionPath of ['arm_erp/sessions', 'arm_erp/online']) {
    try {
      const snap = await db.ref(sessionPath).get();
      const val = (snap.val() ?? {}) as Record<string, { userId?: string }>;
      const stale = Object.entries(val).filter(([, s]) => s?.userId === key).map(([k]) => k);
      for (const k of stale) {
        await db.ref(`${sessionPath}/${k}`).remove();
      }
      if (stale.length) console.log(`   removed ${stale.length} ${sessionPath} record(s)`);
    } catch {
      /* node absent — fine */
    }
  }
  console.log(`✅ cleanup: removed temp admin ${TARGET_EMAIL} (key ${key}); users back to ${Object.keys(users).length - 1}`);
  process.exit(0);
}

main().catch((e) => { console.error('❌', e?.message ?? e); process.exit(1); });
