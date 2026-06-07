import { initializeApp, getApps, cert, getApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

type FirebaseAdminInstance = ReturnType<typeof initializeApp>;

const globalForFirebase = globalThis as unknown as {
  firebaseAdmin: FirebaseAdminInstance | undefined;
};

export function getFirebaseAdmin(): FirebaseAdminInstance {
  if (globalForFirebase.firebaseAdmin) {
    return globalForFirebase.firebaseAdmin;
  }

  const requiredEnvVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
  ];

  // Check if required env vars are present
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase environment variables: ${missing.join(', ')}`
    );
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n');

  const app = getApps().length === 0
    ? initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID!,
          privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      })
    : getApp();

  if (process.env.NODE_ENV !== 'production') {
    globalForFirebase.firebaseAdmin = app;
  }

  return app;
}

/** Returns the Firebase Admin Realtime Database instance. */
export function getAdminDb() {
  return getDatabase(getFirebaseAdmin());
}

/** Returns the Firebase Admin Auth instance. */
export function getAdminAuth() {
  return getAuth(getFirebaseAdmin());
}

/** Returns the Firebase Admin Storage instance. */
export function getAdminStorage() {
  return getStorage(getFirebaseAdmin());
}

/** Shorthand alias matching the expected import name. */
export const adminDb = getAdminDb;
export const adminAuth = getAdminAuth;
export const adminStorage = getAdminStorage;

/** Checks whether Firebase Admin is configured (env vars present). */
export function isFirebaseConfigured(): boolean {
  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
  ];
  return required.every((v) => !!process.env[v]);
}
