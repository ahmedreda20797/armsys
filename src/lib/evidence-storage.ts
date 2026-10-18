// §SERVER-ONLY BOUNDARY — reaches the Firebase ADMIN SDK (Storage)
// and sharp. Never import from client code.
import 'server-only';
import { createId } from '@paralleldrive/cuid2';
import { getAdminStorage, FirebaseConfigError } from '@/lib/firebase-server';
import type { EvidenceItem } from '@/types';
import {
  EVIDENCE_IMAGE_MAX_INPUT_BYTES,
  EVIDENCE_IMAGE_MAX_STORED_BYTES,
  EVIDENCE_IMAGE_MAX_WIDTH,
  EVIDENCE_IMAGE_QUALITY,
  EVIDENCE_IMAGE_STORED_MIME,
  EVIDENCE_PENDING_PREFIX,
  buildFinalStoragePath,
  buildPendingStoragePath,
  evidenceImageItems,
  parseEvidenceStoragePath,
  withFinalStoragePaths,
} from '@/lib/evidence-items';

// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-STORAGE — Firebase Storage for image evidence
//
//  Binary image content NEVER enters Realtime Database — RTDB
//  records carry metadata only (EvidenceItemImage). Objects live
//  under the locked-down evidence/ tree (storage.rules):
//    evidence/pending/<uploadId>.webp     staged, pre-save
//    evidence/<table>/<recordId>/<id>.webp bound to parent record
//
//  All access flows through the API (Bearer-authenticated); the
//  bucket itself is closed to direct client SDK access.
// ══════════════════════════════════════════════════════════════

/** Quality ladder for re-encode — readability first, byte cap last. */
const QUALITY_LADDER = [EVIDENCE_IMAGE_QUALITY, 70, 55] as const;

/** Staged-but-never-saved objects are swept after this age. */
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function bucket() {
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (!storageBucket) {
    throw new FirebaseConfigError(
      '[FIREBASE_CONFIG] متغير FIREBASE_STORAGE_BUCKET غير مضبوط في .env.local — تخزين أدلة الصور يحتاجه.\n' +
        'انسخ القيمة من Firebase Console → Storage → Get started، مثال:\n' +
        '  FIREBASE_STORAGE_BUCKET=arm-erp-project.firebasestorage.app'
    );
  }
  return getAdminStorage().bucket(storageBucket);
}

export interface OptimizedEvidenceImage {
  buffer: Buffer;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

/**
 * Defensive server-side re-encode (§11): EXIF-rotate, downscale only
 * when wider than the ceiling (no enlargement), WebP. Steps down the
 * quality ladder until the stored-size cap is met — never compresses
 * harder than needed to keep evidence text readable.
 */
export async function optimizeEvidenceImage(input: Buffer): Promise<OptimizedEvidenceImage> {
  const sharp = (await import('sharp')).default;
  let last: { buffer: Buffer; width: number | null; height: number | null } | null = null;
  for (const quality of QUALITY_LADDER) {
    const { data, info } = await sharp(input)
      .rotate()
      .resize({ width: EVIDENCE_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    last = { buffer: data, width: info.width ?? null, height: info.height ?? null };
    if (data.byteLength <= EVIDENCE_IMAGE_MAX_STORED_BYTES) break;
  }
  if (!last) throw new Error('evidence image optimization produced no output');
  if (last.buffer.byteLength > EVIDENCE_IMAGE_MAX_STORED_BYTES) {
    throw new Error(`evidence image exceeds ${EVIDENCE_IMAGE_MAX_STORED_BYTES} bytes after optimization`);
  }
  return {
    buffer: last.buffer,
    mimeType: EVIDENCE_IMAGE_STORED_MIME,
    size: last.buffer.byteLength,
    width: last.width,
    height: last.height,
  };
}

export interface StagedEvidenceImage {
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

/** Upload an optimized image to the PENDING tree (pre-save staging). */
export async function stagePendingEvidenceImage(
  optimized: OptimizedEvidenceImage,
  originalFileName: string,
): Promise<StagedEvidenceImage> {
  const uploadId = createId();
  const storagePath = buildPendingStoragePath(uploadId);
  await bucket().file(storagePath).save(optimized.buffer, {
    contentType: optimized.mimeType,
    metadata: { contentType: optimized.mimeType },
  });
  return {
    storagePath,
    fileName: originalFileName.slice(0, 255),
    mimeType: optimized.mimeType,
    size: optimized.size,
    width: optimized.width,
    height: optimized.height,
  };
}

/**
 * Move every PENDING image of the saved items to its FINAL parent-
 * bound path (server-side copy + delete). Returns the items with
 * final storagePaths. On failure, best-effort deletes the copies it
 * already created and rethrows — the caller rolls the record back,
 * so no orphaned final object survives a failed save (§21).
 */
export async function promoteEvidenceImages(
  table: string,
  recordId: string,
  items: ReadonlyArray<EvidenceItem>,
): Promise<EvidenceItem[]> {
  const pending = evidenceImageItems(items).filter(
    (item) => parseEvidenceStoragePath(item.image!.storagePath)?.kind === 'pending',
  );
  if (pending.length === 0) return [...items];

  const created: string[] = [];
  const b = bucket();
  try {
    for (const item of pending) {
      const dest = buildFinalStoragePath(table, recordId, item.id);
      await b.file(item.image!.storagePath).copy(b.file(dest));
      created.push(dest);
    }
    // Copies confirmed — remove the staged originals.
    await Promise.allSettled(pending.map((item) => b.file(item.image!.storagePath).delete()));
    return withFinalStoragePaths(items, table, recordId);
  } catch (error) {
    await Promise.allSettled(created.map((path) => b.file(path).delete()));
    throw error;
  }
}

/** Read a FINAL evidence object for authorized serving. */
export async function readEvidenceImage(
  storagePath: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const parsed = parseEvidenceStoragePath(storagePath);
  if (!parsed || parsed.kind !== 'final') return null;
  const [buffer] = await bucket().file(storagePath).download();
  return { buffer, mimeType: EVIDENCE_IMAGE_STORED_MIME };
}

/**
 * Best-effort removal of Storage objects (e.g. a saved item whose
 * image was replaced, or rollback leftovers). NEVER called for
 * archived records — archive semantics keep evidence intact (§12).
 */
export async function deleteEvidenceObjects(storagePaths: ReadonlyArray<string>): Promise<void> {
  if (storagePaths.length === 0) return;
  const b = bucket();
  await Promise.allSettled(
    storagePaths
      .filter((p) => parseEvidenceStoragePath(p))
      .map((p) => b.file(p).delete()),
  );
}

/** Storage paths of every image item (cleanup/rollback convenience). */
export function evidenceImageItemPaths(
  items: ReadonlyArray<EvidenceItem> | null | undefined,
): string[] {
  return evidenceImageItems(items ?? []).map((i) => i.image!.storagePath);
}

/**
 * §21 — transactional evidence commit for an UPDATE.
 * Promotes newly staged images, persists the record through the
 * caller's callback (which MUST write `evidenceItems`), and cleans
 * up on either side of the boundary:
 *   • persist fails → the freshly promoted final objects are deleted
 *     (no orphans, the record keeps its previous items untouched);
 *   • persist succeeds → final objects of explicitly REMOVED image
 *     items are deleted (record-scoped paths — never another
 *     record's bytes; archiving never flows through here §12).
 */
export async function commitEvidenceItems(
  table: string,
  recordId: string,
  incoming: ReadonlyArray<EvidenceItem>,
  existingItems: ReadonlyArray<EvidenceItem> | null | undefined,
  persist: (evidenceItems: EvidenceItem[]) => Promise<unknown>,
): Promise<void> {
  const incomingPending = evidenceImageItems(incoming)
    .filter((i) => parseEvidenceStoragePath(i.image!.storagePath)?.kind === 'pending')
    .map((i) => i.id);

  const promoted = await promoteEvidenceImages(table, recordId, incoming);

  const newlyFinalPaths = evidenceImageItems(promoted)
    .filter((i) => incomingPending.includes(i.id))
    .map((i) => i.image!.storagePath);

  try {
    await persist(promoted);
  } catch (error) {
    await deleteEvidenceObjects(newlyFinalPaths);
    throw error;
  }

  const keptPaths = new Set(evidenceImageItems(promoted).map((i) => i.image!.storagePath));
  const removedPaths = evidenceImageItems(existingItems ?? [])
    .map((i) => i.image!.storagePath)
    .filter((p) => parseEvidenceStoragePath(p)?.kind === 'final' && !keptPaths.has(p));
  await deleteEvidenceObjects(removedPaths);
}

/**
 * Fire-and-forget sweep of stale PENDING objects that were staged
 * but never saved (abandoned dialogs, failed submits). Runs on the
 * upload route only — cheap, bounded, best-effort.
 */
export async function sweepStalePendingEvidence(): Promise<void> {
  const cutoff = Date.now() - PENDING_MAX_AGE_MS;
  const [files] = await bucket().getFiles({ prefix: `${EVIDENCE_PENDING_PREFIX}/`, pageSize: 100 });
  const stale = files.filter((f) => (f.metadata.updated ? new Date(f.metadata.updated).getTime() < cutoff : false));
  await Promise.allSettled(stale.map((f) => f.delete()));
}

export { EVIDENCE_IMAGE_MAX_INPUT_BYTES };
