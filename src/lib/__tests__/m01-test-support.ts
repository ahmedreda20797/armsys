// src/lib/__tests__/m01-test-support.ts
// Shared harness for the M0.1 security tests.
//
// IMPORTANT: this must be the FIRST import of every M0.1 test file —
// it installs the environment (@/lib/auth refuses to load without
// JWT_SECRET) and replaces the Firebase-backed db layer with
// in-memory stubs, so route handlers run without any network access.
//
// The stubs patch the compiled module's export object in place: every
// consumer (route handlers, verify-permission, rules-engine) resolved
// '@/lib/db' to the same module instance, so property lookups at call
// time hit these stubs.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'm0-1-test-jwt-secret-0123456789abcdef';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'm0-1-test-cron-secret-0123456789abcdef';

// §SERVER-ONLY stub — 'server-only' throws under Node's default export
// condition (its tripwire targets client BUNDLES, which tests are not).
// Tests run real server modules in plain Node, so the marker module is
// neutralized before anything imports db/auth/verify-permission.
// (tsconfig.test.json maps the package to a stub for the test runner;
// this in-place neutralization additionally covers direct single-file
// `npx tsx --test` runs that bypass the runner's tsconfig.)
const serverOnlyPath = require.resolve('server-only');
require.cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
} as any;

// The compiled CJS exports use non-configurable getters, so individual
// functions cannot be redefined. Instead the module's cache entry is
// replaced with a stub exports object BEFORE any consumer (route
// handler, verify-permission, ...) loads @/lib/db — this file is always
// the first import of every M0.1 test file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realDb: Record<string, any> = require('../db');

export interface CallLogEntry {
  fn: string;
  args: unknown[];
}

const users = new Map<string, Record<string, any>>();
const tables = new Map<string, Record<string, any>[]>();

/** Every stubbed db call, for assertions (e.g. "getAll('users') never ran"). */
export const calls: CallLogEntry[] = [];
/** Every record created through the createRecord stub. */
export const createdRecords: Array<{ table: string; data: Record<string, any> }> = [];

function table(name: string): Record<string, any>[] {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name)!;
}

export function resetTestData(): void {
  users.clear();
  tables.clear();
  calls.length = 0;
  createdRecords.length = 0;
}

export function registerUser(user: Record<string, any>): void {
  users.set(user.id, user);
}

export function setTable(name: string, rows: Record<string, any>[]): void {
  tables.set(name, rows);
}

/** Stub exports: real constants (TTL, …) are preserved, I/O becomes in-memory. */
const stubbedDb: Record<string, any> = { ...realDb };

stubbedDb.getById = async (t: string, id: string) => {
  calls.push({ fn: 'getById', args: [t, id] });
  if (t === 'users') {
    const u = users.get(id);
    return u ? { ...u } : null;
  }
  const row = table(t).find((r) => r.id === id);
  return row ? { ...row } : null;
};

stubbedDb.getAll = async (t: string) => {
  calls.push({ fn: 'getAll', args: [t] });
  return table(t).map((r) => ({ ...r }));
};

stubbedDb.getAllBatch = async (ts: string[]) => {
  calls.push({ fn: 'getAllBatch', args: [ts] });
  const map = new Map<string, Record<string, any>[]>();
  for (const t of ts) map.set(t, table(t).map((r) => ({ ...r })));
  return map;
};

stubbedDb.findFirst = async (t: string, filters: Record<string, unknown>) => {
  calls.push({ fn: 'findFirst', args: [t] });
  return (
    table(t).find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) || null
  );
};

stubbedDb.createRecord = async (t: string, data: Record<string, any>) => {
  calls.push({ fn: 'createRecord', args: [t] });
  const rec = {
    ...data,
    id: `rec-${createdRecords.length + 1}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  table(t).push(rec);
  createdRecords.push({ table: t, data: rec });
  return rec;
};

stubbedDb.createRecordWithId = async (t: string, id: string, data: Record<string, any>) => {
  calls.push({ fn: 'createRecordWithId', args: [t, id] });
  const rec = { ...data, id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  table(t).push(rec);
  createdRecords.push({ table: t, data: rec });
  return rec;
};

stubbedDb.updateRecord = async (t: string, id: string, data: Record<string, any>) => {
  calls.push({ fn: 'updateRecord', args: [t, id] });
  const row = table(t).find((r) => r.id === id);
  if (row) Object.assign(row, data, { updatedAt: new Date().toISOString() });
  return row ? { ...row } : null;
};

stubbedDb.updateRecords = async (t: string, updatesById: Record<string, Record<string, unknown>>) => {
  // §NOTIFICATIONS-UX — bulk multi-path patch: ONE call applies every
  // patch (never a per-id fan-out). Tests assert the call SHAPE.
  calls.push({ fn: 'updateRecords', args: [t, Object.keys(updatesById).length] });
  for (const [id, patch] of Object.entries(updatesById)) {
    const row = table(t).find((r) => r.id === id);
    if (row) Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  }
  return Object.keys(updatesById).length;
};

stubbedDb.deleteRecord = async (t: string, id: string) => {
  calls.push({ fn: 'deleteRecord', args: [t, id] });
};

stubbedDb.invalidateCache = () => undefined;

stubbedDb.getEmployeeMap = async () => new Map();

stubbedDb.pingDatabase = async () => {
  calls.push({ fn: 'pingDatabase', args: [] });
};

// Swap the module in the require cache so every later consumer of
// '@/lib/db' (resolved to the same file) receives the stubbed exports.
const dbPath = require.resolve('../db');
const cachedModule = require.cache[dbPath];
if (cachedModule) {
  cachedModule.exports = stubbedDb;
}

/** Direct access for tests that need to swap an individual stub (e.g. make pingDatabase throw). */
export const dbStubs: Record<string, any> = stubbedDb;

/** Mint a valid access token (dynamic import — env is guaranteed set). */
export async function mintToken(user: {
  userId: string;
  email: string;
  role: string;
}): Promise<string> {
  const { signToken } = await import('@/lib/auth');
  return signToken(user, 'access');
}

/**
 * Tamper with a token's signature so it fails verification.
 *
 * Mutates the FIRST signature character: its bits are always
 * significant. (Mutating the LAST character is unreliable — a
 * 43-char base64url HMAC-SHA256 signature has 2 don't-care padding
 * bits in the final character, so some flips decode to the SAME MAC
 * bytes and the tampered token stays valid, flaking the tests.)
 */
export function tamperToken(token: string): string {
  const parts = token.split('.');
  const sig = parts[2];
  parts[2] = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  return parts.join('.');
}

export function bearerHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface TestTokens {
  adminToken: string;
  userToken: string;
  hrToken: string;
  managerToken: string;
  qualityToken: string;
}

/** Register one user per role and mint tokens for each. */
export async function registerFixtures(): Promise<TestTokens> {
  registerUser({ id: 'u-admin', email: 'admin@test.local', name: 'مسؤول النظام', role: 'admin' });
  registerUser({ id: 'u-user', email: 'user@test.local', name: 'مستخدم عادي', role: 'user' });
  // §ORG-BOUNDARY: HR/quality presets carry employees scope 'all' — to
  // make them resolve the whole test company (not fail-closed), their
  // user records need an explicit boundary override of the GA root.
  registerUser({ id: 'u-hr', email: 'hr@test.local', name: 'موارد بشرية', role: 'hr', orgBoundaryNodeIds: ['ga'] });
  registerUser({ id: 'u-manager', email: 'manager@test.local', name: 'مدير', role: 'manager' });
  registerUser({ id: 'u-quality', email: 'quality@test.local', name: 'جودة', role: 'quality', orgBoundaryNodeIds: ['ga'] });
  const [adminToken, userToken, hrToken, managerToken, qualityToken] = await Promise.all([
    mintToken({ userId: 'u-admin', email: 'admin@test.local', role: 'admin' }),
    mintToken({ userId: 'u-user', email: 'user@test.local', role: 'user' }),
    mintToken({ userId: 'u-hr', email: 'hr@test.local', role: 'hr' }),
    mintToken({ userId: 'u-manager', email: 'manager@test.local', role: 'manager' }),
    mintToken({ userId: 'u-quality', email: 'quality@test.local', role: 'quality' }),
  ]);
  return { adminToken, userToken, hrToken, managerToken, qualityToken };
}

/** Build an xlsx file Blob from an array-of-arrays sheet. */
export async function xlsxBlob(rows: unknown[][]): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Blob([new Uint8Array(buf)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
