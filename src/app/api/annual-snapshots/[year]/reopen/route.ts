import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { reopenYear } from '@/lib/year-snapshots';
import { unauthorizedError, forbiddenError, internalError, logServerFailure, validationError } from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'monthClose', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { year } = await params;
    const yearNum = parseInt(year, 10);
    if (!Number.isFinite(yearNum)) return validationError('سنة غير صالحة');

    const body = await request.json().catch(() => null);
    if (!body || typeof body.reason !== 'string' || body.reason.trim().length < 5) {
      return validationError('سبب إعادة الفتح مطلوب (5 أحرف على الأقل)');
    }

    const actor = await resolveActor(permCheck.user?.id);
    const snapshot = await reopenYear(yearNum, { id: actor.id, name: actor.name }, body.reason.trim());

    return NextResponse.json(snapshot);
  } catch (error) {
    logServerFailure('annual-snapshots/[year]/reopen', 'POST', error);
    return internalError();
  }
}
