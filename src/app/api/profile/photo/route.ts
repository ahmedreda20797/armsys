// ══════════════════════════════════════════════════════════════
//  /api/profile/photo — §USER-PHOTO self-service
//
//  POST   — the AUTHENTICATED user uploads their OWN profile photo.
//           The client crops/zooms the picture into a square canvas
//           (the profile dialog) and sends the final square; the
//           server re-encodes it defensively to a 256×256 WebP data:
//           URL on the user record (same storage as the admin route —
//           RTDB inline, CSP already allows img-src data:).
//  DELETE — back to the initials avatar.
//
//  Privacy: self-scoped by requireAuth (never another user's id);
//  input capped at 4 MB; the original image is not retained. The
//  change is audit-logged exactly like the admin photo route.
// ══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { getById, updateRecord } from '@/lib/db';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';

const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MB
const AVATAR_SIZE = 256;

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = await getById('users', auth.userId);
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

    // Defensive server-side re-encode → square 256×256 WebP.
    const sharp = (await import('sharp')).default;
    const input = Buffer.from(await file.arrayBuffer());
    const output = await sharp(input)
      .rotate() // respect EXIF orientation
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer();
    const photoURL = `data:image/webp;base64,${output.toString('base64')}`;

    await updateRecord('users', auth.userId, { photoURL });

    const actor = await resolveActor(auth.userId);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'userPhoto',
      entityId: auth.userId,
      monthKey: null,
      before: { photoURL: user.photoURL ?? null },
      after: { photoURL },
      details: `تحديث الصورة الشخصية للحساب ${user.name ?? auth.userId}`,
    });

    return NextResponse.json({ success: true, photoURL });
  } catch (error) {
    console.error('Upload profile photo error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء رفع الصورة' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = await getById('users', auth.userId);
    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }
    await updateRecord('users', auth.userId, { photoURL: null });

    const actor = await resolveActor(auth.userId);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'userPhoto',
      entityId: auth.userId,
      monthKey: null,
      before: { photoURL: user.photoURL ?? null },
      after: { photoURL: null },
      details: `حذف الصورة الشخصية للحساب ${user.name ?? auth.userId}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete profile photo error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف الصورة' }, { status: 500 });
  }
}
