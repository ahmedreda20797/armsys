// scripts/migrate-passwords.ts
// One-time migration script: converts all plaintext passwords to bcrypt hashes
// Run with: npx tsx scripts/migrate-passwords.ts
//
// After migration, all existing users will need to reset their passwords
// because their plaintext passwords will be replaced with bcrypt hashes.
// The login system auto-migrates on first successful login, so users
// can still log in with their old passwords — they'll be silently rehashed.

import { getAdminDb } from '../src/lib/firebase-server';
import bcrypt from 'bcryptjs';

const ROUNDS = 12;

async function migratePasswords() {
  console.log('═══════════════════════════════════════════');
  console.log('  ARM ERP Password Migration');
  console.log('  Migrating plaintext → bcrypt hashes');
  console.log('═══════════════════════════════════════════\n');

  const db = getAdminDb();
  const usersRef = db.ref('arm_erp/users');
  const snapshot = await usersRef.get();

  if (!snapshot.exists()) {
    console.log('❌ No users found in database');
    return;
  }

  const users = snapshot.val();
  const entries = Object.entries(users) as [string, any][];

  console.log(`📊 Found ${entries.length} users to check\n`);

  let migrated = 0;
  let alreadyHashed = 0;
  let failed = 0;

  for (const [id, user] of entries) {
    const email = user.email || 'unknown';
    const password = user.password;

    if (!password) {
      console.log(`⚠️  SKIP ${email}: no password field`);
      failed++;
      continue;
    }

    // Already bcrypt-hashed
    if (password.startsWith('$2a$') || password.startsWith('$2b$')) {
      console.log(`✅ OK   ${email}: already hashed`);
      alreadyHashed++;
      continue;
    }

    // Migrate plaintext → bcrypt
    try {
      const hash = await bcrypt.hash(password, ROUNDS);
      await usersRef.child(id).update({ password: hash });
      console.log(`🔄 DONE ${email}: plaintext → bcrypt (${ROUNDS} rounds)`);
      migrated++;
    } catch (err) {
      console.log(`❌ FAIL ${email}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(`  Migration Complete:`);
  console.log(`    ✅ Migrated:  ${migrated}`);
  console.log(`    🔒 Already:    ${alreadyHashed}`);
  console.log(`    ❌ Failed:    ${failed}`);
  console.log(`    📊 Total:     ${entries.length}`);
  console.log('═══════════════════════════════════════════\n');
}

migratePasswords().catch(console.error);
