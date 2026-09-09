// scripts/create-first-admin.ts
// ══════════════════════════════════════════════════════════════
//  First-admin bootstrap — creates the initial admin user in the
//  REAL Firebase RTDB (arm_erp/users) after you configure real
//  credentials in .env.local.
//
//  Why: the login route has NO registration endpoint by design
//  (security phase M0.2) — the very first admin must be seeded
//  out-of-band. This script is the supported path.
//
//  Usage:
//    npx tsx scripts/create-first-admin.ts <email> <password> ["Full Name"]
//
//    Example:
//    npx tsx scripts/create-first-admin.ts admin@company.com "S3cure!Pass" "مدير النظام"
//
//  Requirements:
//    • .env.local with REAL Firebase credentials (service account).
//    • Run from the project root.
//
//  Security notes:
//    • Password is stored as bcrypt hash (12 rounds) — same policy
//      as hashPassword() in src/lib/auth.ts; login will accept it
//      with no needsRehash flag.
//    • Duplicate emails are rejected (case-insensitive).
//    • No secret values are ever printed.
// ══════════════════════════════════════════════════════════════

// ── env bootstrap — plain .env parser, no new dependency.
// MUST run before Firebase calls resolve env (they resolve lazily
// inside getFirebaseAdmin(), so import order is safe, but we load
// first anyway to mirror the phase65 script doctrine).
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadLocalEnvFiles(): void {
  const projectRoot = typeof __dirname !== 'undefined'
    ? path.resolve(__dirname, '..')
    : process.cwd();
  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(projectRoot, fileName);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue; // missing file is fine
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

loadLocalEnvFiles();

import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { getAdminDb, FirebaseConfigError, isFirebaseConfigured } from '../src/lib/firebase-server';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [emailArg, passwordArg, nameArg] = process.argv.slice(2);

  if (!emailArg || !passwordArg) {
    fail(
      'الاستخدام: npx tsx scripts/create-first-admin.ts <email> <password> ["الاسم الكامل"]\n' +
      'مثال:     npx tsx scripts/create-first-admin.ts admin@company.com "S3cure!Pass" "مدير النظام"'
    );
  }

  const email = emailArg.trim().toLowerCase();
  const password = passwordArg;
  const name = (nameArg || '').trim() || email.split('@')[0]
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  if (!EMAIL_RE.test(email)) {
    fail(`البريد الإلكتروني غير صالح: ${email}`);
  }
  if (password.length < 8) {
    fail('كلمة المرور لازم تكون 8 أحرف على الأقل (يفضل أقوى — حروف وأرقام ورموز).');
  }

  if (!isFirebaseConfigured()) {
    fail(
      'إعدادات Firebase غير مكتملة أو ما زالت قيمًا تجريبية في .env.local.\n' +
      'أكمل المتغيرات (FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL / FIREBASE_DATABASE_URL)\n' +
      'أو استخدم FIREBASE_SERVICE_ACCOUNT_JSON بمسار ملف Service Account JSON.'
    );
  }

  console.log('\n⏳ الاتصال بـ Firebase Realtime Database...');
  const db = getAdminDb();

  // ── Duplicate check (case-insensitive on lowercase emails) ──
  const usersSnap = await db.ref('arm_erp/users').get();
  const usersVal = (usersSnap.val() ?? {}) as Record<string, Record<string, unknown>>;
  const duplicate = Object.entries(usersVal).find(
    ([, u]) => String(u.email ?? '').trim().toLowerCase() === email
  );
  if (duplicate) {
    fail(
      `يوجد مستخدم بنفس البريد بالفعل (المفتاح: ${duplicate[0]}).\n` +
      'لو نسيت كلمة المرور، غيّرها مباشرة من قاعدة البيانات أو احذف السجل وأعد تنفيذ السكربت.'
    );
  }

  // ── Hash password (bcrypt 12 — matches hashPassword policy) ──
  console.log('🔐 توليد بصمة كلمة المرور (bcrypt, 12 rounds)...');
  const hashed = await bcrypt.hash(password, 12);

  // ── Create record — same shape as db.createRecord() ──
  const id = createId();
  const now = new Date().toISOString();
  const record = {
    id,
    email,
    name,
    role: 'admin',
    rank: 'مدير النظام',
    permissions: {}, // empty override → full admin role preset applies
    isSuspended: false,
    password: hashed,
    createdAt: now,
    updatedAt: now,
  };

  await db.ref(`arm_erp/users/${id}`).set(record);

  console.log('\n✅ تم إنشاء حساب المدير بنجاح!');
  console.log('──────────────────────────────────────────────');
  console.log(`   البريد : ${email}`);
  console.log(`   الاسم  : ${name}`);
  console.log(`   الدور  : admin (صلاحيات كاملة)`);
  console.log(`   المفتاح: arm_erp/users/${id}`);
  console.log('──────────────────────────────────────────────');
  console.log('➡️  سجّل الدخول الآن من صفحة تسجيل الدخول بنفس البريد وكلمة المرور.\n');
}

main().catch((error) => {
  if (error instanceof FirebaseConfigError || error?.name === 'FirebaseConfigError') {
    console.error(`\n❌ ${error.message}\n`);
    process.exit(1);
  }
  console.error('\n❌ فشل إنشاء الحساب:', error?.message ?? error);
  console.error(
    '\nتلميح: لو الخطأ عن الشبكة/الأذونات، تأكد أن:\n' +
    '  • FIREBASE_DATABASE_URL يشير لقاعدة بياناتك الحقيقية\n' +
    '  • Realtime Database مُنشأة في مشروع Firebase مسبقًا\n' +
    '  • Service Account لها دور Realtime Database Admin\n'
  );
  process.exit(1);
});
