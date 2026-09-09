import { initializeApp, getApps, cert, getApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { createPrivateKey } from 'node:crypto';
import * as fs from 'node:fs';

type FirebaseAdminInstance = ReturnType<typeof initializeApp>;

// ════════════════════════════════════════════════════════════════
//  FirebaseConfigError — actionable configuration failure
//
//  Thrown when Firebase env credentials are missing, placeholder,
//  or malformed. Carries an Arabic, step-by-step fix message so the
//  operator (not a cryptic OpenSSL decoder error) sees exactly what
//  to do. API routes detect it via `instanceof` / `name` and surface
//  the message to the client with errorKey 'FIREBASE_CONFIG'.
// ════════════════════════════════════════════════════════════════

export class FirebaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseConfigError';
    // Preserve instanceof across bundler target down-leveling
    Object.setPrototypeOf(this, FirebaseConfigError.prototype);
  }
}

// ─── Placeholder detection ───────────────────────────────────────

/**
 * Substrings that mark a value as an unfilled template/placeholder.
 * Marker set is intentionally conservative (human-readable template
 * text) — base64 key bodies cannot contain '-' so 'your-' is safe,
 * and full PEM validation below catches fake keys independently.
 */
const PLACEHOLDER_MARKERS = [
  'your-',
  'your_',
  'change-me',
  'change_me',
  'placeholder',
  '[redacted',
  'xxx',
  'insert-',
  'todo',
];

export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (!value) return true;
  const s = value.trim().toLowerCase();
  if (!s) return true;
  return PLACEHOLDER_MARKERS.some((m) => s.includes(m));
}

// ─── Private-key normalization ───────────────────────────────────

/**
 * Normalize a FIREBASE_PRIVATE_KEY value into a well-formed PEM string.
 *
 * Handles every common .env.local pasting mistake:
 *  • the whole service-account JSON pasted as the value
 *  • one layer of wrapping quotes  ("..." / '...')
 *  • literal \n / \r\n escape sequences  (and real newlines)
 *  • missing trailing newline after the footer
 *
 * Throws FirebaseConfigError (Arabic message) when the result is not
 * a parseable PKCS#8 PEM private key.
 */
export function normalizePrivateKey(raw: string): string {
  let key = (raw ?? '').trim();

  // 1. Whole service-account JSON pasted → extract private_key
  if (key.startsWith('{')) {
    try {
      const parsed = JSON.parse(key) as { private_key?: unknown };
      if (typeof parsed.private_key === 'string' && parsed.private_key.trim()) {
        key = parsed.private_key.trim();
      }
    } catch {
      // Not valid JSON — fall through to PEM validation which will
      // produce a precise error for whatever this actually is.
    }
  }

  // 2. Strip ONE layer of wrapping quotes (dotenv keeps them inside
  //    quoted values when the value itself is re-quoted by hand).
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  // 3. Literal escape sequences → real newlines (most common mistake:
  //    pasting the JSON key content but losing the escape decoding).
  key = key
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n');

  // 4. Ensure the PEM footer terminates with a newline (OpenSSL is
  //    strict about the final line break).
  if (!key.endsWith('\n')) key += '\n';

  return key;
}

const PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
const PEM_FOOTER = '-----END PRIVATE KEY-----';

/** Validate the normalized key parses as a real private key. */
function assertValidPem(pem: string): void {
  if (!pem.includes(PEM_HEADER) || !pem.includes(PEM_FOOTER)) {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_PRIVATE_KEY ليس مفتاح PEM صالح.\n' +
        'لازم يبدأ بـ "-----BEGIN PRIVATE KEY-----" وينتهي بـ "-----END PRIVATE KEY-----".\n' +
        'أنشئ مفتاحًا جديدًا: Firebase Console → Project Settings → Service accounts → Generate new private key.'
    );
  }

  try {
    createPrivateKey(pem);
  } catch {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_PRIVATE_KEY موجود لكن محتواه التالف (المتصفح الداخلي للـ OpenSSL فشل في فك المفتاح).\n' +
        'الأسباب الشائعة: نسخ جزء من المفتاح أو فقد أسطر أو من ملف JSON غلط.\n' +
        'الحل: نزّل Service Account JSON جديد من Firebase Console والصق قيمة private_key كاملة بين علامتي تنصيص، أو استخدم FIREBASE_SERVICE_ACCOUNT_JSON مباشرة.'
    );
  }
}

// ─── Credential resolution ───────────────────────────────────────

interface ResolvedCredentials {
  projectId: string;
  privateKey: string;
  clientEmail: string;
  databaseURL: string;
  storageBucket?: string;
}

/**
 * Read the full service-account JSON either inline (starts with '{')
 * or as a file path — the easiest setup path: download the JSON from
 * Firebase Console and point FIREBASE_SERVICE_ACCOUNT_JSON at it.
 */
function readServiceAccountJson(): Record<string, unknown> | null {
  const ref = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!ref) return null;

  let raw: string;
  if (ref.startsWith('{')) {
    raw = ref;
  } else {
    try {
      raw = fs.readFileSync(ref, 'utf8');
    } catch {
      throw new FirebaseConfigError(
        `[FIREBASE_CONFIG] FIREBASE_SERVICE_ACCOUNT_JSON مضبوط على مسار ملف لكنه غير قابل للقراءة: ${ref}\n` +
          'تأكد من وجود الملف وصلاحية القراءة، أو الصق محتوى JSON كاملًا داخل المتغير.'
      );
    }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.private_key || !parsed.client_email) {
      throw new FirebaseConfigError(
        '[FIREBASE_CONFIG] محتوى FIREBASE_SERVICE_ACCOUNT_JSON ليس ملف Service Account صالح (ينقصه private_key أو client_email).\n' +
          'نزّل الملف مرة أخرى: Firebase Console → Project Settings → Service accounts → Generate new private key.'
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof FirebaseConfigError) throw error;
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_SERVICE_ACCOUNT_JSON ليس JSON صالحًا.\n' +
        'تأكد من نسخ محتوى الملف كاملًا أو استخدام مسار الملف الصحيح.'
    );
  }
}

/** Shape-level validation for human-readable credential fields. */
function assertValidShape(creds: ResolvedCredentials): void {
  if (isPlaceholderValue(creds.projectId)) {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_PROJECT_ID ما زال قيمة تجريبية (Placeholder).\n' +
        'ضعه في .env.local بصيغة معرّف مشروعك الحقيقي، مثال:\n' +
        '  FIREBASE_PROJECT_ID=arm-erp-prod'
    );
  }
  if (/\s/.test(creds.projectId)) {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_PROJECT_ID لا يقبل مسافات — المعرف الحقيقي يكون بأحرف صغيرة وشرطات فقط.'
    );
  }
  if (isPlaceholderValue(creds.clientEmail) || !creds.clientEmail.includes('@')) {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_CLIENT_EMAIL ما زال قيمة تجريبية أو غير صالح.\n' +
        'الصيغة الصحيحة: firebase-adminsdk-xxxxx@<project-id>.iam.gserviceaccount.com\n' +
        'انسخه من ملف Service Account JSON (الحقل client_email).'
    );
  }
  if (!/^https:\/\//i.test(creds.databaseURL)) {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_DATABASE_URL لازم يبدأ بـ https://\n' +
        'انسخه من Firebase Console → Realtime Database (أو الحقل databaseURL من ملف JSON).'
    );
  }
  if (isPlaceholderValue(creds.databaseURL)) {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] FIREBASE_DATABASE_URL ما زال قيمة تجريبية.\n' +
        'مثال للصيغة الصحيحة:\n' +
        '  https://<project-id>-default-rtdb.firebaseio.com\n' +
        'أو (للمناطق الأوروبية/الآسيوية):\n' +
        '  https://<project-id>-default-rtdb.<region>.firebasedatabase.app'
    );
  }
}

/** Build the hard Arabic failure banner used by every config error. */
function missingVarsBanner(missing: string[]): string {
  return (
    `[FIREBASE_CONFIG] متغيرات Firebase الناقصة في .env.local: ${missing.join(', ')}\n` +
    'خطوات الإصلاح:\n' +
    '1) Firebase Console → Project Settings → Service accounts → Generate new private key (نزّل JSON)\n' +
    '2) الأسهل: ضع مسار ملف JSON في .env.local:\n' +
    '     FIREBASE_SERVICE_ACCOUNT_JSON=C:/path/to/serviceAccount.json\n' +
    '   أو انسخ الحقول يدويًا: project_id و client_email و private_key\n' +
    '3) أعد تشغيل الخادم ثم أنشئ أول حساب مدير:\n' +
    '     npx tsx scripts/create-first-admin.ts admin@example.com "كلمة-مرور-قوية" "مدير النظام"'
  );
}

/**
 * Resolve and fully validate Firebase credentials from env.
 * Exported for diagnostics/tests — getFirebaseAdmin calls it lazily.
 */
export function resolveFirebaseCredentials(): ResolvedCredentials {
  const sa = readServiceAccountJson();

  const projectId = sa?.project_id as string | undefined;
  const clientEmail = sa?.client_email as string | undefined;
  const privateKeyRaw = sa?.private_key as string | undefined;

  const missing: string[] = [];
  if (!process.env.FIREBASE_PROJECT_ID && !projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!process.env.FIREBASE_PRIVATE_KEY && !privateKeyRaw) missing.push('FIREBASE_PRIVATE_KEY');
  if (!process.env.FIREBASE_CLIENT_EMAIL && !clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!process.env.FIREBASE_DATABASE_URL) missing.push('FIREBASE_DATABASE_URL');

  if (missing.length > 0) {
    throw new FirebaseConfigError(missingVarsBanner(missing));
  }

  const privateKey = normalizePrivateKey(
    privateKeyRaw ?? process.env.FIREBASE_PRIVATE_KEY!
  );
  assertValidPem(privateKey);

  const creds: ResolvedCredentials = {
    projectId: projectId ?? process.env.FIREBASE_PROJECT_ID!,
    clientEmail: clientEmail ?? process.env.FIREBASE_CLIENT_EMAIL!,
    privateKey,
    databaseURL: process.env.FIREBASE_DATABASE_URL!,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  };

  assertValidShape(creds);
  return creds;
}

// ─── Admin singleton ─────────────────────────────────────────────

const globalForFirebase = globalThis as unknown as {
  firebaseAdmin: FirebaseAdminInstance | undefined;
};

export function getFirebaseAdmin(): FirebaseAdminInstance {
  if (globalForFirebase.firebaseAdmin) {
    return globalForFirebase.firebaseAdmin;
  }

  const creds = resolveFirebaseCredentials();

  const app = getApps().length === 0
    ? initializeApp({
        credential: cert({
          projectId: creds.projectId,
          privateKey: creds.privateKey,
          clientEmail: creds.clientEmail,
        }),
        databaseURL: creds.databaseURL,
        storageBucket: creds.storageBucket,
      })
    : getApp();

  if (process.env.NODE_ENV !== 'production') {
    globalForFirebase.firebaseAdmin = app;
  }

  return app;
}

export function getAdminDb() {
  return getDatabase(getFirebaseAdmin());
}

export function getAdminAuth() {
  return getAuth(getFirebaseAdmin());
}

export function getAdminStorage() {
  return getStorage(getFirebaseAdmin());
}

export const adminDb = getAdminDb;
export const adminAuth = getAdminAuth;
export const adminStorage = getAdminStorage;

export function isFirebaseConfigured(): boolean {
  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_DATABASE_URL',
  ];
  if (!required.every((v) => !!process.env[v] && !isPlaceholderValue(process.env[v]))) {
    return !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }
  return true;
}
