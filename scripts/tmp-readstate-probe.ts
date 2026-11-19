// Read-only probe — MUST import test-support FIRST (neutralizes server-only).
import '../src/lib/__tests__/connect-test-support';
import * as fs from 'node:fs';
function loadEnv(): void {
  for (const fileName of ['.env', '.env.local']) {
    try {
      for (const line of fs.readFileSync(fileName, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
      }
    } catch { /* missing */ }
  }
}
loadEnv();
import { connectFakeDb } from '../src/lib/__tests__/connect-rtdb-fake';
void connectFakeDb; // keep the fake binding registered
import { getAdminDb } from '../src/lib/firebase-server';
const db = getAdminDb();
const uid = 'p8z1hwwzh1zk53j0dph93duj';
const conv = 'v25difhbylunrz8b12dbar52';
const mirror = await db.ref(`arm_erp/connect/userConversations/${uid}/${conv}`).get();
const readState = await db.ref(`arm_erp/connect/conversations/${conv}/readState/${uid}`).get();
const messages = await db.ref(`arm_erp/connect/conversations/${conv}/messages`).get();
console.log('mirror.lastReadMessageId:', mirror.val()?.lastReadMessageId);
console.log('mirror.lastMessageId:', mirror.val()?.lastMessageId);
console.log('mirror.lastMessagePreview:', JSON.stringify(mirror.val()?.lastMessagePreview));
console.log('readState:', JSON.stringify(readState.val()));
console.log('message keys:', Object.keys(messages.val() ?? {}));
process.exit(0);
