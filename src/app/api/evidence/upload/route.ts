// ══════════════════════════════════════════════════════════════
//  POST /api/evidence/upload — stage an image evidence file
//
//  First half of the image flow (§10): the user picks/pastes an
//  image; this route optimizes it (sharp → WebP, downscaled only
//  when oversized) and stores it in the PENDING tree of the
//  evidence Storage bucket. The parent record's own save (module
//  POST/PUT) sanitizes the resulting metadata, persists the record,
//  then promotes the object to its final parent-bound path.
//
//  Authorization (§13/§27): the caller must hold the TARGET
//  MODULE's create permission — the same permission the eventual
//  record save checks. Evidence staging can never grant more than
//  the module already allows; the served bytes are gated per parent
//  record in /api/evidence/image.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { forbiddenError, internalError, logServerFailure, unauthorizedError, validationError } from '@/lib/api-error';
import { EVIDENCE_MODULES, isEvidenceModuleKey } from '@/lib/evidence-modules';
import {
  EVIDENCE_IMAGE_MAX_INPUT_BYTES,
  EVIDENCE_IMAGE_MIME_ALLOWLIST,
} from '@/lib/evidence-items';
import {
  FirebaseConfigError,
} from '@/lib/firebase-server';
import {
  optimizeEvidenceImage,
  stagePendingEvidenceImage,
  sweepStalePendingEvidence,
} from '@/lib/evidence-storage';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const form = await request.formData().catch(() => null);
    if (!form) return validationError('جسم الطلب غير صالح (FormData)');

    const moduleKey = form.get('module');
    if (!isEvidenceModuleKey(moduleKey)) {
      return validationError('وحدة غير معروفة');
    }
    const descriptor = EVIDENCE_MODULES[moduleKey];

    // Same permission the parent record's create route checks.
    const permCheck = await verifyPermission(request, descriptor.permissionKey, 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const file = form.get('file');
    if (!(file instanceof File)) return validationError('ملف الصورة مطلوب');
    if (!EVIDENCE_IMAGE_MIME_ALLOWLIST.includes(file.type)) {
      return validationError('صيغة الصورة غير مدعومة (المسموح: PNG / JPEG / WebP / GIF)');
    }
    if (file.size > EVIDENCE_IMAGE_MAX_INPUT_BYTES) {
      return validationError('حجم الصورة يتجاوز الحد المسموح');
    }

    const input = Buffer.from(await file.arrayBuffer());
    const optimized = await optimizeEvidenceImage(input);
    const staged = await stagePendingEvidenceImage(optimized, file.name || 'evidence');

    // Best-effort housekeeping of abandoned staging objects.
    void sweepStalePendingEvidence().catch(() => undefined);

    return Response.json(staged, { status: 201 });
  } catch (error) {
    if (error instanceof FirebaseConfigError) {
      return Response.json({ error: error.message, errorKey: 'FIREBASE_CONFIG' }, { status: 503 });
    }
    logServerFailure('evidence-upload', 'POST', error);
    return internalError();
  }
}
