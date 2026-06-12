import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

/**
 * Firebase Client SDK — lazy-initialisation helpers.
 *
 * **IMPORTANT**: This module uses the `firebase` *client* packages which are
 * browser-only.  It must ONLY be imported inside `'use client'` components
 * (preferably via `next/dynamic` to avoid SSR issues).
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _app: FirebaseApp | null = null;
let _db: Database | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;
let _initialized = false;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialize the Firebase client app with the provided configuration.
 *
 * This function is idempotent — calling it multiple times with the same config
 * will return the cached app instance on subsequent calls.
 *
 * @param config - Firebase configuration object (apiKey, authDomain, …).
 */
export function initializeFirebaseClient(config: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  databaseURL?: string;
  measurementId?: string;
}): FirebaseApp {
  if (_app) return _app;

  if (getApps().length > 0) {
    _app = getApp();
  } else {
    _app = initializeApp(config);
  }

  // Eagerly initialise the commonly-used services
  try {
    if (config.databaseURL) {
      _db = getDatabase(_app);
    }
  } catch {
    // databaseURL may be missing — that's fine
  }

  try {
    _auth = getAuth(_app);
  } catch {
    // Should never fail, but guard just in case
  }

  try {
    _storage = getStorage(_app);
  } catch {
    // storageBucket may be missing — that's fine
  }

  _initialized = true;
  return _app;
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Returns the Firebase App instance, or `null` if `initializeFirebaseClient`
 * has not been called yet.
 */
export function getFirebaseApp(): FirebaseApp | null {
  return _app;
}

/**
 * Returns the Firebase Realtime Database client.
 *
 * Returns `null` if:
 *  - `initializeFirebaseClient` was never called, or
 *  - No `databaseURL` was provided in the config.
 */
export function getFirebaseDb(): Database | null {
  return _db;
}

/**
 * Returns the Firebase Auth client.
 *
 * Returns `null` if `initializeFirebaseClient` has not been called.
 */
export function getFirebaseAuth(): Auth | null {
  return _auth;
}

/**
 * Returns the Firebase Storage client.
 *
 * Returns `null` if:
 *  - `initializeFirebaseClient` was never called, or
 *  - No `storageBucket` was provided in the config.
 */
export function getFirebaseStorage(): FirebaseStorage | null {
  return _storage;
}

/**
 * Convenience flag — `true` once `initializeFirebaseClient` has completed
 * successfully (regardless of whether all sub-services are available).
 */
export function isFirebaseClientInitialized(): boolean {
  return _initialized;
}
