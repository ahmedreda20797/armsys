// src/lib/__tests__/connect-account-search.test.ts
// ══════════════════════════════════════════════════════════════
//  Connect 1.0.1 — ACCOUNT SEARCH + USER LOOKUP PRIVACY
//
//  The ?query= mode is the ONLY data source for starting a direct
//  conversation (it replaced the controlPanel-gated /api/dashboard/
//  users picker that broke direct-chat creation for every non-admin
//  role). Contracts proven here:
//    • USER ACCOUNTS only (never employee-directory records)
//    • MINIMAL projection: { id, name, photoUrl } — no emails, roles,
//      permissions, suspension flags, or private fields
//    • email matches the query but the email is NEVER returned
//    • the caller is never offered; suspended accounts are hidden
//    • hard result limit (no arbitrary account enumeration)
//    • <2-char queries return empty without a table read
//    • the ids mode (member rendering) stays minimal + null-safe
// ══════════════════════════════════════════════════════════════

import './connect-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, tokenFor, jsonRequest, getUrl, resetConnectData, setTable } from './connect-test-support';
import { GET as usersRoute } from '@/app/api/connect/users/route';

let users: ReturnType<typeof seedUsers>;
let tokens: Record<string, string>;

/** Seed the getAll('users') table (the auth map is seeded separately
 *  by seedUsers — the search reads the same users table the real app
 *  keeps in RTDB). */
function seedUsersTable(extra: Record<string, unknown>[] = []): void {
  const base = Object.values(users).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    photoUrl: null,
    isSuspended: false,
    // Private fields that must NEVER leak through the search:
    passwordHash: 'x$argon2-hash',
    refreshToken: 'secret-refresh-token',
    permissions: { controlPanel: 'edit' },
  }));
  setTable('users', [...base, ...extra] as Record<string, unknown>[]);
}

before(async () => {
  users = seedUsers();
  tokens = {
    admin: await tokenFor(users.admin),
    rana: await tokenFor(users.rana),
    omar: await tokenFor(users.omar),
  };
});

beforeEach(() => {
  resetConnectData();
  users = seedUsers();
});

describe('Account search (?query=) — the direct-chat entry workflow', () => {
  it('finds an account by display name; projection is minimal', async () => {
    seedUsersTable();
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'عمر' }), tokens.rana) as never,
    );
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.accounts.length, 1);
    const account = data.accounts[0];
    assert.deepEqual(Object.keys(account).sort(), ['id', 'name', 'photoUrl'], 'minimal projection only');
    assert.equal(account.id, users.omar.id);
    assert.equal(account.name, users.omar.name);
  });

  it('matches by email but the email NEVER leaves the server', async () => {
    seedUsersTable();
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'omar@test.local' }), tokens.rana) as never,
    );
    const { data } = await res.json();
    assert.equal(data.accounts.length, 1);
    assert.equal(data.accounts[0].id, users.omar.id);
    assert.equal(JSON.stringify(data.accounts).includes('omar@test.local'), false, 'no email in the response');
  });

  it('private account fields (password hash, tokens, permission overrides) never leak', async () => {
    seedUsersTable();
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'رنا' }), tokens.rana) as never,
    );
    const raw = JSON.stringify(await res.json());
    for (const secret of ['argon2', 'secret-refresh-token', 'controlPanel']) {
      assert.equal(raw.includes(secret), false, `${secret} must never appear`);
    }
  });

  it('excludes the caller themselves (no self-DM entry point)', async () => {
    seedUsersTable();
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'رنا' }), tokens.rana) as never,
    );
    const { data } = await res.json();
    assert.equal(data.accounts.some((a: { id: string }) => a.id === users.rana.id), false);
  });

  it('hides suspended accounts (inactive accounts are not selectable)', async () => {
    seedUsersTable([{ id: 'usr_suspended', name: 'معلق الحساب', email: 'suspended@test.local', isSuspended: true }]);
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'معلق' }), tokens.rana) as never,
    );
    const { data } = await res.json();
    assert.equal(data.accounts.length, 0, 'suspended account must not be offered');
  });

  it('queries shorter than 2 characters return empty', async () => {
    seedUsersTable();
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'ع' }), tokens.rana) as never,
    );
    const { data } = await res.json();
    assert.deepEqual(data.accounts, []);
  });

  it('results are hard-limited (no arbitrary account enumeration)', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `usr_bulk_${i}`, name: `موظف النمط الموحد ${i}`, email: `bulk${i}@test.local`, isSuspended: false,
    }));
    seedUsersTable(many);
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'النمط الموحد' }), tokens.rana) as never,
    );
    const { data } = await res.json();
    assert.equal(data.accounts.length <= 8, true, 'bounded result set');
  });

  it('401 without a token; 403 for a connect-permission override of none', async () => {
    seedUsersTable();
    const anon = await usersRoute(new Request(getUrl('/api/connect/users', { query: 'رنا' })) as never);
    assert.equal(anon.status, 401);

    // A user whose permission override removes connect entirely.
    const { registerUser } = await import('./connect-test-support');
    registerUser({ id: 'usr_noconn', name: 'بلا تواصل', email: 'noconn@test.local', role: 'user', isSuspended: false, permissions: { connect: 'none' } });
    const noconnToken = await tokenFor({ id: 'usr_noconn', email: 'noconn@test.local', role: 'user' });
    const denied = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { query: 'رنا' }), noconnToken) as never,
    );
    assert.equal(denied.status, 403, 'decision.allowed is enforced (not just authentication)');
  });
});

describe('ids mode (member/profile rendering)', () => {
  it('resolves known ids to the minimal projection; unknown ids → null fields', async () => {
    seedUsersTable();
    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { ids: `${users.omar.id},usr_missing` }), tokens.rana) as never,
    );
    const { data } = await res.json();
    assert.equal(data.length, 2);
    assert.equal(data[0].name, users.omar.name);
    assert.deepEqual(Object.keys(data[1]).sort(), ['id', 'name', 'photoUrl']);
    assert.equal(data[1].name, null);
  });
});

describe('§AVATAR-SOURCE — canonical photoURL reaches Connect', () => {
  it('the ids projection carries the EXISTING profile picture (photoURL, not photoUrl)', async () => {
    // The profile-photo workflow (/api/profile/photo) stores a data:
    // URL on the user record under photoURL. Connect must read THAT
    // field (1.0.1 read user.photoUrl — a casing mismatch that showed
    // initials to everyone but the owner). The ids mode joins through
    // getById('users') — the registered map.
    const DATA_URL = 'data:image/webp;base64,AAAA';
    const { registerUser } = await import('./connect-test-support');
    registerUser({ id: 'usr_withphoto', name: 'صاحب الصورة', email: 'withphoto@test.local', role: 'user', photoURL: DATA_URL, isSuspended: false });
    registerUser({ id: 'usr_legacy', name: 'حقل قديم', email: 'legacy@test.local', role: 'user', photoUrl: 'data:image/webp;base64,BBBB', isSuspended: false });
    registerUser({ id: 'usr_nophoto', name: 'بلا صورة', email: 'nophoto@test.local', role: 'user', isSuspended: false });

    const res = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { ids: 'usr_withphoto,usr_legacy,usr_nophoto' }), tokens.rana) as never,
    );
    const { data } = await res.json() as { data: { id: string; photoUrl: string | null }[] };
    const byId = new Map(data.map((u) => [u.id, u]));
    assert.equal(byId.get('usr_withphoto')?.photoUrl, DATA_URL, 'canonical photoURL resolves');
    assert.equal(byId.get('usr_legacy')?.photoUrl, 'data:image/webp;base64,BBBB', 'legacy lowercase fallback');
    assert.equal(byId.get('usr_nophoto')?.photoUrl, null, 'missing picture → null (initials fallback)');
  });

  it('an updated profile picture resolves fresh (no stale cache)', async () => {
    const DATA_URL_V1 = 'data:image/webp;base64,V1';
    const { registerUser } = await import('./connect-test-support');
    registerUser({ id: 'usr_updater', name: 'يحدث صورته', email: 'updater@test.local', role: 'user', photoURL: DATA_URL_V1, isSuspended: false });
    const first = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { ids: 'usr_updater' }), tokens.rana) as never,
    );
    assert.equal(((await first.json()) as { data: { photoUrl: string }[] }).data[0].photoUrl, DATA_URL_V1);

    const DATA_URL_V2 = 'data:image/webp;base64,V2';
    registerUser({ id: 'usr_updater', name: 'يحدث صورته', email: 'updater@test.local', role: 'user', photoURL: DATA_URL_V2, isSuspended: false });
    const second = await usersRoute(
      jsonRequest('GET', getUrl('/api/connect/users', { ids: 'usr_updater' }), tokens.rana) as never,
    );
    assert.equal(((await second.json()) as { data: { photoUrl: string }[] }).data[0].photoUrl, DATA_URL_V2, 'the new picture resolves immediately');
  });
});
