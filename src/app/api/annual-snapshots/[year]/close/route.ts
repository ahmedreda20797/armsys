import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { closeYear } from '@/lib/year-snapshots';
import { unauthorizedError, forbiddenError, internalError, logServerFailure } from '@/lib/api-error';
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
    if (!Number.isFinite(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return NextResponse.json({ error: 'سنة غير صالحة' }, { status: 400 });
    }

    const actor = await resolveActor(permCheck.user?.id);
    const snapshot = await closeYear(yearNum, { id: actor.id, name: actor.name });

    return NextResponse.json(snapshot);
  } catch (error) {
    logServerFailure('annual-snapshots/[year]/close', 'POST', error);
    return internalError();
  }
}
