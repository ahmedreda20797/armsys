import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseURL: string;
}

/**
 * M0.1 SSRF hardening: the destination is NOT attacker-controllable.
 * Only official Firebase Realtime Database hosts over plain https
 * (no port, no credentials) are accepted — localhost, private/internal
 * ranges and arbitrary hosts are rejected before any request is made.
 */
function isAllowedDatabaseUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.port !== '') return false;
  if (url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return host.endsWith('.firebaseio.com') || host.endsWith('.firebasedatabase.app');
}

// ──────────────────────────────────────────────
// POST — test Firebase RTDB connectivity via REST API
// (admin-only diagnostic; used by the Firebase settings page)
// ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // M0.1: this endpoint performs server-side requests to a
    // caller-supplied URL — it is restricted to users holding the
    // 'firebase' page permission (in practice: admins).
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'مطلوب تسجيل الدخول' }, { status: 401 });
    }
    const permCheck = await verifyPermission(request, 'firebase');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = (await request.json()) as Partial<FirebaseConfig>;

    // Basic validation
    if (!body.apiKey || !body.databaseURL) {
      return NextResponse.json(
        { success: false, error: 'apiKey و databaseURL مطلوبان' },
        { status: 400 }
      );
    }

    if (typeof body.databaseURL !== 'string' || !isAllowedDatabaseUrl(body.databaseURL.trim())) {
      return NextResponse.json(
        { success: false, error: 'رابط قاعدة البيانات غير مسموح — يجب أن يكون رابط Firebase RTDB صالحًا (https)' },
        { status: 400 }
      );
    }

    const databaseURL = body.databaseURL.trim().replace(/\/$/, ''); // trim trailing slash
    const testUrl = `${databaseURL}/test-connection.json?auth=${encodeURIComponent(body.apiKey)}`;
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
