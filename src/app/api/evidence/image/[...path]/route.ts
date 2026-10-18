// ══════════════════════════════════════════════════════════════
//  GET /api/evidence/image/<table>/<recordId>/<itemId>.webp
//
//  Authorized serving of a stored image evidence object (§13/§14).
//  The bucket is closed to direct access; EVERY byte flows through
//  here and is gated by the PARENT RECORD's authorization:
//    1. Bearer authentication (middleware + requireAuth).
//    2. Source-module view permission (verifyPermission).
//    3. Employee scope on the parent record (out-of-scope resolves
//       404, identical to the missing path — anti-enumeration).
//    4. The exact storagePath must be registered on the parent
//       record's evidenceItems — a guessed path that matches no
//       saved item is never served.
//  PENDING paths are never served (they have no parent record to
//  authorize against; the form previews those from local state).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { internalError, logServerFailure, unauthorizedError } from '@/lib/api-error';
import {
  asScopeViewer,
  linkedRecordInScope,
  resolveEmployeeScopeFromDb,
} from '@/lib/scope/server';
import { scopeOptionsFor } from '@/lib/evidence/preview-request';
import type { EvidenceCollection } from '@/lib/evidence/evidence-collections';
import { evidenceModuleOfTable, EVIDENCE_MODULES } from '@/lib/evidence-modules';
import { parseEvidenceStoragePath } from '@/lib/evidence-items';
import { readEvidenceImage } from '@/lib/evidence-storage';
import { FirebaseConfigError } from '@/lib/firebase-server';
import type { EvidenceItem } from '@/types';

/** Module keys that share the preview system's scope doctrine. */
const COLLECTION_BY_MODULE: Partial<Record<string, EvidenceCollection>> = {
  qualityObservations: 'qualityObservations',
  qualityDeductions: 'qualityDeductions',
  followUps: 'followUps',
  capaCases: 'capaCases',
  complaints: 'complaints',
};

function notFound(): Response {
  return Response.json({ error: 'الدليل غير موجود' }, { status: 404 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { path } = await params;
    const storagePath = (path ?? []).join('/');
    const parsed = parseEvidenceStoragePath(storagePath);
    // Unknown/traversal/pending paths are all indistinguishable 404s.
    if (!parsed || parsed.kind !== 'final') return notFound();

    const moduleKey = evidenceModuleOfTable(parsed.table);
    if (!moduleKey) return notFound();
    const descriptor = EVIDENCE_MODULES[moduleKey];

    const permCheck = await verifyPermission(request, descriptor.permissionKey, 'view');
    if (!permCheck.allowed || !permCheck.user) return notFound();

    const raw = await getById<Record<string, unknown>>(parsed.table, parsed.recordId);
    if (!raw) return notFound();

    // Out-of-scope == not found (anti-enumeration, same as every
    // source detail route). hrDeductions mirrors the default
    // employee-mandatory doctrine of its own routes.
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user), undefined, permCheck.user.permissions,
    );
    const collection = COLLECTION_BY_MODULE[moduleKey];
    const scopeOptions = collection
      ? scopeOptionsFor(collection)
      : { optionalLink: false };
    if (!linkedRecordInScope(
      raw as { employeeId?: string | null; [key: string]: unknown },
      scopeCtx,
      scopeOptions,
    )) {
      return notFound();
    }

    // The path must belong to an image item SAVED on this record.
    const items = Array.isArray(raw.evidenceItems) ? (raw.evidenceItems as EvidenceItem[]) : [];
    const registered = items.some(
      (item) => item && item.type === 'image' && item.image?.storagePath === storagePath,
    );
    if (!registered) return notFound();

    const image = await readEvidenceImage(storagePath);
    if (!image) return notFound();

    return new Response(new Uint8Array(image.buffer), {
      status: 200,
      headers: {
        'Content-Type': image.mimeType,
        'Content-Length': String(image.buffer.byteLength),
        // Authorized per-user content — never shared-cacheable.
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    if (error instanceof FirebaseConfigError) {
      return Response.json({ error: error.message, errorKey: 'FIREBASE_CONFIG' }, { status: 503 });
    }
    logServerFailure('evidence-image', 'GET', error);
    return internalError();
  }
}
