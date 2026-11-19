// src/lib/__tests__/connect-test-support.ts
// ══════════════════════════════════════════════════════════════
//  Shared harness for the QNALYS Connect 1.0 test suites.
//
//  MUST be the first import of every Connect test file.
//  Layers:
//    1. m01-test-support — env (JWT_SECRET), the 'server-only'
//       neutralization, and the in-memory @/lib/db stubs (users,
//       notifications, audit collections).
//    2. THIS file — replaces the firebase-server module with the
//       in-memory RTDB fake BEFORE any Connect module loads, so
//       lib/connect/rtdb.ts binds to the fake while auth.ts (already
//       loaded by m01) keeps its inert original binding.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { registerUser, mintToken } from './m01-test-support';

import { connectFakeDb, type FakeRtdb } from './connect-rtdb-fake';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const firebaseServerPath = require.resolve('../firebase-server');
require.cache[firebaseServerPath] = {
  id: firebaseServerPath,
  filename: firebaseServerPath,
  loaded: true,
  exports: {
    getAdminDb: () => connectFakeDb,
    // auth.ts binds these at load; tests never invoke them.
    getAdminAuth: () => { throw new Error('getAdminAuth is not stubbed in Connect tests'); },
    getAdminStorage: () => { throw new Error('getAdminStorage is not stubbed in Connect tests'); },
  },
} as never;

/** Reset BOTH layers (db tables + the RTDB fake). */
export function resetConnectData(): void {
  connectFakeDb.reset();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetTestData } = require('./m01-test-support') as { resetTestData(): void };
  resetTestData();
}

export function fakeDb(): FakeRtdb {
  return connectFakeDb;
}

export {
  registerUser,
  setTable,
  bearerHeaders,
  mintToken,
  createdRecords,
  calls,
} from './m01-test-support';

// Fixed clock seeding for deterministic push-key ordering.
export function seedUsers(): Record<string, { id: string; name: string; email: string; role: string }> {
  const users = {
    admin: { id: 'usr_admin', name: 'أمين النظام', email: 'admin@test.local', role: 'admin' },
    rana: { id: 'usr_rana', name: 'رنا علي', email: 'rana@test.local', role: 'user' },
    omar: { id: 'usr_omar', name: 'عمر حسن', email: 'omar@test.local', role: 'user' },
    laila: { id: 'usr_laila', name: 'ليلى فهد', email: 'laila@test.local', role: 'user' },
    intruder: { id: 'usr_intruder', name: 'غريب', email: 'intruder@test.local', role: 'user' },
  };
  for (const u of Object.values(users)) {
    registerUser({ ...u, isSuspended: false, permissions: null });
  }
  return users;
}

/** Mint a token for a seeded user id. */
export async function tokenFor(user: { id: string; email: string; role: string }): Promise<string> {
  return mintToken({ userId: user.id, email: user.email, role: user.role });
}

export function jsonRequest(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Request {
  return new Request(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export function getUrl(path: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams(query).toString();
  return `http://localhost:3000${path}${params ? `?${params}` : ''}`;
}

/**
 * Wait for a fire-and-forget side effect (notification/audit bridges)
 * to land. Polls every 25ms up to timeoutMs — never sleeps needlessly.
 */
export async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
