import { NextRequest, NextResponse } from 'next/server';

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseURL: string;
}

// ──────────────────────────────────────────────
// POST — test Firebase RTDB connectivity via REST API
// ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<FirebaseConfig>;

    // Basic validation
    if (!body.apiKey || !body.databaseURL) {
      return NextResponse.json(
        { success: false, error: 'apiKey و databaseURL مطلوبان' },
        { status: 400 }
      );
    }

    const databaseURL = body.databaseURL.replace(/\/$/, ''); // trim trailing slash
    const testUrl = `${databaseURL}/test-connection.json?auth=${body.apiKey}`;
    const testValue = Date.now().toString();

    // ── Step 1: Write a test value ──
    const writeRes = await fetch(testUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testValue),
    });

    if (!writeRes.ok) {
      const errorText = await writeRes.text().catch(() => '');
      return NextResponse.json({
        success: false,
        error: `فشل في الكتابة: ${writeRes.status} ${errorText}`,
      });
    }

    // ── Step 2: Read the value back ──
    const readRes = await fetch(testUrl);
    if (!readRes.ok) {
      return NextResponse.json({
        success: false,
        error: `فشل في القراءة: ${readRes.status}`,
      });
    }

    const readData = await readRes.json();
    if (readData !== testValue) {
      return NextResponse.json({
        success: false,
        error: 'القيمة المقروءة لا تطابق القيمة المكتوبة',
      });
    }

    // ── Step 3: Clean up — delete the test node ──
    await fetch(testUrl, { method: 'DELETE' }).catch(() => {
      // Best-effort cleanup — don't fail the test if delete fails
    });

    return NextResponse.json({
      success: true,
      message: 'اتصال ناجح بـ Firebase',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير معروف';
    return NextResponse.json({
      success: false,
      error: `فشل الاتصال: ${message}`,
    });
  }
}
