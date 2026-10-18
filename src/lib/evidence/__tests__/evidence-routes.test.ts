// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-STORAGE — upload/serve route authorization tests
//
//  Runs the REAL route handlers against the in-memory db harness
//  (m01-test-support — same convention as the M0.1 security suite)
//  with the Storage module replaced by in-memory fakes, so no
//  Firebase/network access happens:
//    • upload rejects: no header → 401, dummy token → 401,
//      unprivileged user → 403, unknown module → 400, bad mime → 400
//    • upload happy path (admin) → 201 + staged metadata
//    • serve rejects: no header → 401, tampered → 401, unknown
//      path shape → 404, unregistered path → 404, permission-less
//      viewer → 404 (anti-enumeration), and serves registered
//      evidence for an authorized viewer.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  registerFixtures,
  resetTestData,
  setTable,
  bearerHeaders,
  tamperToken,
  type TestTokens,
} from './m01-test-support';

// ── Stub the Storage module BEFORE any route module loads (same
//    require-cache technique as the db harness). ──
const storageModulePath = path.resolve(
  path.dirname(pathToFileURL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '../../evidence-storage.ts',
);

const stagedPaths: string[] = [];
let promotedToFinal: string[] = [];
const deletedPaths: string[] = [];
let storedObjects = new Map<string, Buffer>();

const storageStub: Record<string, unknown> = {
  EVIDENCE_IMAGE_MAX_INPUT_BYTES: 8 * 1024 * 1024,
  optimizeEvidenceImage: async (input: Buffer) => ({
    buffer: input,
    mimeType: 'image/webp',
    size: input.byteLength,
    width: 640,
    height: 480,
  }),
  stagePendingEvidenceImage: async (optimized: { buffer: Buffer }, fileName: string) => {
    const storagePath = `evidence/pending/stage-${stagedPaths.length + 1}.webp`;
    stagedPaths.push(storagePath);
    storedObjects.set(storagePath, optimized.buffer);
    return { storagePath, fileName, mimeType: 'image/webp', size: optimized.buffer.byteLength, width: 640, height: 480 };
  },
  promoteEvidenceImages: async (_table: string, recordId: string, items: Array<Record<string, any>>) => {
    const out = items.map((item) => {
      if (item.type !== 'image' || !item.image) return item;
      if (!item.image.storagePath.startsWith('evidence/pending/')) return item;
      const finalPath = `evidence/qualityObservations/${recordId}/${item.id}.webp`;
      storedObjects.set(finalPath, storedObjects.get(item.image.storagePath) ?? Buffer.alloc(0));
      storedObjects.delete(item.image.storagePath);
      promotedToFinal.push(finalPath);
      return { ...item, image: { ...item.image, storagePath: finalPath } };
    });
    return out;
  },
  commitEvidenceItems: async (
    _table: string,
    recordId: string,
    incoming: Array<Record<string, any>>,
    existingItems: Array<Record<string, any>> | null | undefined,
    persist: (items: Array<Record<string, any>>) => Promise<unknown>,
  ) => {
    const promoted = await storageStub.promoteEvidenceImages('qualityObservations', recordId, incoming);
    await persist(promoted);
    const kept = new Set(
      (promoted as Array<Record<string, any>>)
        .filter((i) => i.type === 'image' && i.image)
        .map((i) => i.image.storagePath),
    );
    for (const item of existingItems ?? []) {
      if (item.type === 'image' && item.image && !kept.has(item.image.storagePath)) {
        deletedPaths.push(item.image.storagePath);
      }
    }
  },
  deleteEvidenceObjects: async (paths: string[]) => {
    for (const p of paths) {
      storedObjects.delete(p);
      deletedPaths.push(p);
    }
  },
  evidenceImageItemPaths: (items: Array<Record<string, any>> | null | undefined) =>
    (items ?? []).filter((i) => i.type === 'image' && i.image).map((i) => i.image.storagePath),
  readEvidenceImage: async (storagePath: string) => {
    const buffer = storedObjects.get(storagePath);
    return buffer ? { buffer, mimeType: 'image/webp' } : null;
  },
  sweepStalePendingEvidence: async () => undefined,
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require.cache[require.resolve(storageModulePath)] = {
  id: storageModulePath,
  filename: storageModulePath,
  loaded: true,
  exports: storageStub,
} as any;

// Route modules load AFTER the stubs are in place.
interface PostRoute { POST: (req: Request) => Promise<Response> }
interface GetRoute { GET: (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response> }

function pngBlob(): Blob {
  // Minimal 1×1 PNG header — mime detection is by declared type here.
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
}

describe('§EVIDENCE — POST /api/evidence/upload authorization', () => {
  let route: PostRoute;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/evidence/upload/route')) as unknown as PostRoute;
    tokens = await registerFixtures();
  });

  const uploadRequest = (headers: Record<string, string>, moduleKey = 'qualityObservations') => {
    const fd = new FormData();
    fd.append('module', moduleKey);
    fd.append('file', pngBlob(), 'screenshot.png');
    return new Request('http://localhost/api/evidence/upload', { method: 'POST', headers, body: fd });
  };

  it('no Authorization header → 401', async () => {
    const res = await route.POST(uploadRequest({}));
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await route.POST(uploadRequest(bearerHeaders('x')));
    assert.equal(res.status, 401);
  });

  it("authenticated 'user' role without observations create → 403", async () => {
    const res = await route.POST(uploadRequest(bearerHeaders(tokens.userToken)));
    assert.equal(res.status, 403);
  });

  it('admin on an unknown module → 400', async () => {
    const res = await route.POST(uploadRequest(bearerHeaders(tokens.adminToken), 'notAModule'));
    assert.equal(res.status, 400);
  });

  it('admin with a non-image file → 400', async () => {
    const fd = new FormData();
    fd.append('module', 'qualityObservations');
    fd.append('file', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'evil.svg');
    const res = await route.POST(
      new Request('http://localhost/api/evidence/upload', {
        method: 'POST',
        headers: bearerHeaders(tokens.adminToken),
        body: fd,
      }),
    );
    assert.equal(res.status, 400);
  });

  it('admin with a valid image → 201 + pending staged metadata', async () => {
    resetTestData();
    await registerFixtures();
    const res = await route.POST(uploadRequest(bearerHeaders(tokens.adminToken)));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.match(body.storagePath, /^evidence\/pending\/stage-\d+\.webp$/);
    assert.equal(body.mimeType, 'image/webp');
  });
});

describe('§EVIDENCE — GET /api/evidence/image/[...path] authorization', () => {
  let route: GetRoute;
  let tokens: TestTokens;
  const RECORD_ID = 'rec-ev-1';
  const REGISTERED_PATH = `evidence/qualityObservations/${RECORD_ID}/item-1.webp`;

  before(async () => {
    route = (await import('@/app/api/evidence/image/[...path]/route')) as unknown as GetRoute;
    tokens = await registerFixtures();
    // The parent observation carries the image item in evidenceItems.
    setTable('qualityObservations', [
      {
        id: RECORD_ID,
        employeeId: 'emp-1',
        evidence: '',
        evidenceItems: [
          { id: 'item-1', type: 'image', image: { storagePath: REGISTERED_PATH, fileName: 'shot.webp', mimeType: 'image/webp', size: 8 } },
        ],
      },
    ]);
    storedObjects.set(REGISTERED_PATH, Buffer.from('fakebytes'));
  });

  const serve = (headers: Record<string, string>, segments: string[]) =>
    route.GET(
      new Request('http://localhost/api/evidence/image', { headers }),
      { params: Promise.resolve({ path: segments }) },
    );

  it('no Authorization header → 401', async () => {
    const res = await serve({}, REGISTERED_PATH.split('/'));
    assert.equal(res.status, 401);
  });

  it('tampered token → 401', async () => {
    const res = await serve(bearerHeaders(tamperToken(tokens.adminToken)), REGISTERED_PATH.split('/'));
    assert.equal(res.status, 401);
  });

  it('pending paths are NEVER served → 404', async () => {
    const res = await serve(bearerHeaders(tokens.adminToken), ['evidence', 'pending', 'stage-1.webp']);
    assert.equal(res.status, 404);
  });

  it('a path not registered on the parent record → 404', async () => {
    const res = await serve(bearerHeaders(tokens.adminToken), ['evidence', 'qualityObservations', RECORD_ID, 'guessed.webp']);
    assert.equal(res.status, 404);
  });

  it("viewer without the source permission → 404 (anti-enumeration, never 200/403 leak)", async () => {
    const res = await serve(bearerHeaders(tokens.userToken), REGISTERED_PATH.split('/'));
    assert.equal(res.status, 404);
  });

  it('authorized admin viewer gets the registered image bytes', async () => {
    const res = await serve(bearerHeaders(tokens.adminToken), REGISTERED_PATH.split('/'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.toString(), 'fakebytes');
    assert.match(res.headers.get('cache-control') ?? '', /private/);
  });
});
