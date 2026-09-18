// ══════════════════════════════════════════════════════════════
//  POST /api/dashboard/users/[id]/photo — §USER-PHOTO
//
//  Authorized administrators upload a profile photo for a system
//  user. Storage approach: the image is resized to a 256×256 WebP
//  (sharp — already a project dependency) and stored INLINE as a
//  data: URL on the user record — the same RTDB-record storage the
//  rest of the system uses. No external storage provider is
//  introduced, no bucket configuration is required, and the CSP
//  already allows `img-src data:`.
//
//  Privacy: admin-only (controlPanel:edit), input capped at 4 MB,
//  output is a fixed small avatar — no original image is retained.
// ══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import { getById, updateRecord } from '@/lib/db';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';

const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MB
const AVATAR_SIZE = 256;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const check = await verifyPermission(request, 'controlPanel', 'edit');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    const { id } = await params;
    const user = await getById('users', id);
    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'ملف الصورة مطلوب', field: 'file' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'الملف يجب أن يكون صورة', field: 'file' }, { status: 400 });
    }
    if (file.size > MAX_INPUT_BYTES) {
      return NextResponse.json(
        { error: 'حجم الصورة يتجاوز 4 ميجابايت', field: 'file' },
        { status: 400 },
      );
    }

    // Resize → square 256×256 WebP (~5–15 KB) → inline data: URL.
    const sharp = (await import('sharp')).default;
    const input = Buffer.from(await file.arrayBuffer());
    const output = await sharp(input)
      .rotate() // respect EXIF orientation
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
    const photoURL = `data:image/webp;base64,${output.toString('base64')}`;

    await updateRecord('users', id, { photoURL });

    const actor = await resolveActor(check.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'userPhoto',
      entityId: id,
      monthKey: null,
      before: { photoURL: user.photoURL ?? null },
      after: { photoURL },
      details: `تحديث صورة المستخدم ${user.name ?? id}`,
    });

    return NextResponse.json({ success: true, photoURL });
  } catch (error) {
    console.error('Upload user photo error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء رفع الصورة' }, { status: 500 });
  }
}

/** DELETE the photo (back to initials avatar). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const check = await verifyPermission(request, 'controlPanel', 'edit');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }
    const { id } = await params;
    const user = await getById('users', id);
    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }
    await updateRecord('users', id, { photoURL: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete user photo error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف الصورة' }, { status: 500 });
  }
}
