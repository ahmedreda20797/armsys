import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseConfigured } from '@/lib/firebase-server';
import { requireAuth } from '@/lib/verify-permission';

// ──────────────────────────────────────────────
// POST — validate client-provided Firebase config structure
// ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const requiredFields = [
      'apiKey',
      'authDomain',
      'projectId',
      'storageBucket',
      'messagingSenderId',
      'appId',
      'databaseURL',
    ] as const;

    type FieldName = (typeof requiredFields)[number];
    type Config = Partial<Record<FieldName, unknown>>;

    const config = body as Config;

    // Check for missing fields
    const missing: FieldName[] = [];
    for (const field of requiredFields) {
      const value = config[field];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `الحقول المطلوبة مفقودة: ${missing.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Additional structural validation
    if (typeof config.projectId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'projectId يجب أن يكون نصاً' },
        { status: 400 }
      );
    }

    if (
      typeof config.databaseURL === 'string' &&
      !config.databaseURL.startsWith('https://')
    ) {
      return NextResponse.json(
        { success: false, error: 'databaseURL يجب أن يبدأ بـ https://' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'إعدادات Firebase صالحة',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'جسم الطلب غير صالح' },
      { status: 400 }
    );
  }
}

// ──────────────────────────────────────────────
// GET — check whether Firebase is configured server-side
// ──────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    configured: isFirebaseConfigured(),
  });
}
