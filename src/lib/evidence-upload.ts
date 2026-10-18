// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-UPLOAD — client half of the image evidence flow
//
//  Pure client-side helper (browser only):
//    validate → optional canvas downscale (saves upload bytes for
//    huge screenshots) → FormData POST /api/evidence/upload.
//  The server ALWAYS re-encodes defensively (sharp) — the canvas
//  pass is an optimization, never a security boundary.
//
//  Uses the canonical authFetch (Bearer + 401 refresh) — the same
//  layer every other upload (profile photo, XLSX) uses.
// ══════════════════════════════════════════════════════════════

import { authFetch } from '@/lib/api-fetch';
import type { EvidenceModuleKey } from '@/lib/evidence-modules';
import {
  EVIDENCE_IMAGE_MAX_INPUT_BYTES,
  EVIDENCE_IMAGE_MAX_WIDTH,
  EVIDENCE_IMAGE_MIME_ALLOWLIST,
} from '@/lib/evidence-items';

export interface EvidenceUploadResult {
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

/** Client validation BEFORE any network work (§20). Throws Arabic errors. */
export function assertValidEvidenceImageFile(file: File): void {
  if (!EVIDENCE_IMAGE_MIME_ALLOWLIST.includes(file.type)) {
    throw new Error('صيغة الصورة غير مدعومة (المسموح: PNG / JPEG / WebP / GIF)');
  }
  if (file.size > EVIDENCE_IMAGE_MAX_INPUT_BYTES) {
    throw new Error('حجم الصورة يتجاوز الحد المسموح');
  }
}

/**
 * Canvas downscale (best-effort): shrink screenshots wider than the
 * shared ceiling and re-encode WebP before uploading. Any failure —
 * or a result that wouldn't shrink the payload — falls back to the
 * ORIGINAL file; the server optimizes regardless.
 */
async function downscaleForUpload(file: File): Promise<File> {
  try {
    if (file.size <= 512 * 1024) return file; // already small — ship as-is
    const bitmap = await createImageBitmap(file);
    if (bitmap.width <= EVIDENCE_IMAGE_MAX_WIDTH) {
      bitmap.close?.();
      return file; // no oversized dimension — let the server encode
    }
    const scale = EVIDENCE_IMAGE_MAX_WIDTH / bitmap.width;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    );
    if (!blob || blob.size >= file.size) return file;
    const baseName = (file.name || 'evidence').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } catch {
    return file;
  }
}

/** Stage an image on the server; returns the metadata to embed in the item. */
export async function uploadEvidenceImage(
  file: File,
  module: EvidenceModuleKey,
): Promise<EvidenceUploadResult> {
  assertValidEvidenceImageFile(file);
  const prepared = await downscaleForUpload(file);

  const formData = new FormData();
  formData.append('module', module);
  formData.append('file', prepared, prepared.name || 'evidence');

  const res = await authFetch('/api/evidence/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || 'فشل رفع الصورة');
  }
  return res.json() as Promise<EvidenceUploadResult>;
}
