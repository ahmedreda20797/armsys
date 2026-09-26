// scripts/zz-verify-mint-token.ts — TEMP verification helper (§36 manual tests).
// Mints a signed access+refresh pair for an EXISTING admin user so the
// browser can be driven without the login form. Prints tokens to stdout.
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadLocalEnvFiles(): void {
  const projectRoot = process.cwd();
  for (const fileName of ['.env', '.env.local']) {
    const p = path.join(projectRoot, fileName);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}
loadLocalEnvFiles();

async function main() {
  const { getAdminDb } = await import('../src/lib/firebase-server');
  const { SignJWT } = await import('jose');
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  if (!secret) throw new Error('JWT_SECRET missing');

  const db = getAdminDb();
  const snap = await db.ref('arm_erp/users').limitToFirst(80).get();
  const users = snap.val() as Record<string, { email?: string; role?: string; name?: string; status?: string }>;
  const list = Object.entries(users ?? {}).map(([id, u]) => ({ id, email: u.email, role: u.role, name: u.name, status: u.status }));
  console.log('USERS:', JSON.stringify(list.map(u => ({ id: u.id, email: u.email, role: u.role, status: u.status })), null, 1));
  const adminUser = list.find(u => u.role === 'admin' && (!u.status || u.status === 'active'));
  if (!adminUser) throw new Error('no active admin user found');

  const payload = { userId: adminUser.id, email: adminUser.email, role: adminUser.role };
  const access = await new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('arm-erp').setExpirationTime('2h').sign(secret);
  const refresh = await new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('arm-erp').setExpirationTime('7d').sign(secret);
  console.log('ACCESS_TOKEN:');
  console.log(access);
  console.log('REFRESH_TOKEN:');
  console.log(refresh);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e); process.exit(1); });
