import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestAsync, hashPassword, verifyPassword, revokeAllUserRefreshTokens } from '@/lib/auth';
import { getById, updateRecord } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const payload = await authenticateRequestAsync(request);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'كلمة المرور الحالية والجديدة مطلوبة' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' },
        { status: 400 }
      );
    }

    const user = await getById('users', payload.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const pwResult = await verifyPassword(currentPassword, user.password);
    if (!pwResult.valid) {
      return NextResponse.json(
        { error: 'كلمة المرور الحالية غير صحيحة' },
        { status: 401 }
      );
    }

    // Hash and save new password
    const hashedNewPassword = await hashPassword(newPassword);
    await updateRecord('users', user.id, { password: hashedNewPassword });

    // Revoke all refresh tokens (force re-login everywhere)
    await revokeAllUserRefreshTokens(user.id);

    return NextResponse.json({ message: 'تم تغيير كلمة المرور بنجاح. يرجى تسجيل الدخول مرة أخرى.' });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
