// ══════════════════════════════════════════════════════════════
//  Firebase configuration validation tests
//
//  Covers the operator-facing hardening added after the login
//  outage: placeholder detection, private-key normalization
//  (quotes / \n escapes / whole-JSON paste), PEM validation via
//  OpenSSL parse, FIREBASE_SERVICE_ACCOUNT_JSON support and the
//  Arabic actionable FirebaseConfigError messages.
//
//  Real network is NEVER touched — getFirebaseAdmin is not called;
//  only resolveFirebaseCredentials / pure helpers run here.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  isPlaceholderValue,
  normalizePrivateKey,
  resolveFirebaseCredentials,
  FirebaseConfigError,
} from '../firebase-server';

// A REAL, generated-for-tests RSA PKCS#8 private key (non-secret —
// throwaway key pair created solely for this test suite so the
// OpenSSL parse assertion exercises a genuinely valid PEM).
const REAL_PEM = (() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim() + '\n';
})();

describe('isPlaceholderValue', () => {
  it('[1] flags template markers as placeholders', () => {
    assert.equal(isPlaceholderValue('your-firebase-project-id'), true);
    assert.equal(isPlaceholderValue('your-jwt-secret-change-me'), true);
    assert.equal(isPlaceholderValue('[REDACTED:ssh_private_key]'), true);
    assert.equal(isPlaceholderValue('YOUR_PRIVATE_KEY_HERE'), true); // 'your_' marker
    assert.equal(isPlaceholderValue(''), true);
    assert.equal(isPlaceholderValue(undefined), true);
  });

  it('[2] accepts real-looking values', () => {
    assert.equal(isPlaceholderValue('arm-erp-prod'), false);
    assert.equal(
      isPlaceholderValue('firebase-adminsdk-abc@arm-erp-prod.iam.gserviceaccount.com'),
      false
    );
  });
});

describe('normalizePrivateKey', () => {
  it('[3] converts literal \\n escapes to real newlines', () => {
    const escaped = REAL_PEM.replace(/\n/g, '\\n');
    const out = normalizePrivateKey(escaped);
    assert.ok(out.includes('-----BEGIN PRIVATE KEY-----\n'));
    assert.equal(out.split('\n').length, REAL_PEM.split('\n').length);
  });

  it('[4] strips one layer of wrapping quotes', () => {
    const out = normalizePrivateKey(`"${REAL_PEM.replace(/\n/g, '\\n')}"`);
    assert.ok(out.startsWith('-----BEGIN PRIVATE KEY-----\n'));
    assert.ok(out.endsWith('-----END PRIVATE KEY-----\n'));
  });

  it('[5] extracts private_key when the whole JSON is pasted', () => {
    const json = JSON.stringify({
      project_id: 'demo',
      client_email: 'a@b.iam.gserviceaccount.com',
      private_key: REAL_PEM,
    });
    const out = normalizePrivateKey(json);
    assert.ok(out.startsWith('-----BEGIN PRIVATE KEY-----\n'));
  });

  it('[6] ensures trailing newline after the footer', () => {
    const noFooterNl = REAL_PEM.trimEnd();
    assert.ok(normalizePrivateKey(noFooterNl).endsWith('\n'));
  });
});

describe('resolveFirebaseCredentials', () => {
  const FIREBASE_KEYS = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_DATABASE_URL',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ] as const;
  const ORIGINAL: Record<string, string | undefined> = Object.fromEntries(
    FIREBASE_KEYS.map((k) => [k, process.env[k]])
  );

  beforeEach(() => {
    // Reset the Firebase-related slice of env per test
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_PRIVATE_KEY;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_DATABASE_URL;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  });

  it('[7] throws FirebaseConfigError listing missing vars (Arabic banner)', () => {
    assert.throws(
      () => resolveFirebaseCredentials(),
      (err: unknown) => {
        assert.ok(err instanceof FirebaseConfigError);
        const msg = (err as Error).message;
        assert.ok(msg.includes('FIREBASE_PRIVATE_KEY'));
        assert.ok(msg.includes('FIREBASE_DATABASE_URL'));
        assert.ok(msg.includes('create-first-admin')); // actionable next step
        return true;
      }
    );
  });

  it('[8] placeholder project id → actionable error (not a crash)', () => {
    process.env.FIREBASE_PROJECT_ID = 'your-firebase-project-id';
    process.env.FIREBASE_PRIVATE_KEY = REAL_PEM;
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@real.iam.gserviceaccount.com';
    process.env.FIREBASE_DATABASE_URL = 'https://real-default-rtdb.firebaseio.com';
    assert.throws(
      () => resolveFirebaseCredentials(),
      (err: unknown) => {
        assert.ok(err instanceof FirebaseConfigError);
        assert.match((err as Error).message, /FIREBASE_PROJECT_ID/);
        return true;
      }
    );
  });

  it('[9] non-PEM garbage key → precise Arabic decode error', () => {
    process.env.FIREBASE_PROJECT_ID = 'real-project';
    process.env.FIREBASE_PRIVATE_KEY = 'YOUR_PRIVATE_KEY_HERE';
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@real.iam.gserviceaccount.com';
    process.env.FIREBASE_DATABASE_URL = 'https://real-default-rtdb.firebaseio.com';
    assert.throws(
      () => resolveFirebaseCredentials(),
      (err: unknown) => {
        assert.ok(err instanceof FirebaseConfigError);
        assert.match((err as Error).message, /BEGIN PRIVATE KEY/);
        return true;
      }
    );
  });

  it('[10] valid env credentials resolve and normalize the key', () => {
    process.env.FIREBASE_PROJECT_ID = 'real-project';
    process.env.FIREBASE_PRIVATE_KEY = `"${REAL_PEM.replace(/\n/g, '\\n')}"`;
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@real.iam.gserviceaccount.com';
    process.env.FIREBASE_DATABASE_URL = 'https://real-default-rtdb.firebaseio.com';

    const creds = resolveFirebaseCredentials();
    assert.equal(creds.projectId, 'real-project');
    assert.ok(creds.privateKey.startsWith('-----BEGIN PRIVATE KEY-----\n'));
  });

  it('[11] FIREBASE_SERVICE_ACCOUNT_JSON (inline) fills the three fields', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: 'sa-project',
      client_email: 'sa@sa-project.iam.gserviceaccount.com',
      private_key: REAL_PEM,
    });
    process.env.FIREBASE_DATABASE_URL = 'https://sa-project-default-rtdb.firebaseio.com';

    const creds = resolveFirebaseCredentials();
    assert.equal(creds.projectId, 'sa-project');
    assert.equal(creds.clientEmail, 'sa@sa-project.iam.gserviceaccount.com');
    assert.ok(creds.privateKey.includes('BEGIN PRIVATE KEY'));
  });

  it('[12] FIREBASE_SERVICE_ACCOUNT_JSON as unreadable path → clear error', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '/definitely/not/a/real/file.json';
    process.env.FIREBASE_DATABASE_URL = 'https://x.firebaseio.com';
    assert.throws(
      () => resolveFirebaseCredentials(),
      (err: unknown) => {
        assert.ok(err instanceof FirebaseConfigError);
        assert.match((err as Error).message, /FIREBASE_SERVICE_ACCOUNT_JSON/);
        return true;
      }
    );
  });

  it('[13] database URL without https → shape error', () => {
    process.env.FIREBASE_PROJECT_ID = 'real-project';
    process.env.FIREBASE_PRIVATE_KEY = REAL_PEM;
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@real.iam.gserviceaccount.com';
    process.env.FIREBASE_DATABASE_URL = 'http://insecure.firebaseio.com';
    assert.throws(
      () => resolveFirebaseCredentials(),
      (err: unknown) => {
        assert.ok(err instanceof FirebaseConfigError);
        assert.match((err as Error).message, /FIREBASE_DATABASE_URL/);
        return true;
      }
    );
  });

  // Restore the Firebase env slice so other suites are unaffected
  after(() => {
    for (const k of FIREBASE_KEYS) {
      const v = ORIGINAL[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
});
