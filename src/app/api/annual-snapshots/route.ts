import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { listAnnualSnapshots, computeAnnualSnapshot } from '@/lib/year-snapshots';
import { unauthorizedError, forbiddenError, internalError, logServerFailure } from '@/lib/api-error';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'monthClose', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const annuals = await listAnnualSnapshots();
    return NextResponse.json(annuals);
  } catch (error) {
    logServerFailure('annual-snapshots', 'GET', error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'monthClose', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json().catch(() => null);
    if (!body || typeof body.year !== 'number') {
      return NextResponse.json({ error: 'السنة مطلوبة' }, { status: 400 });
    }

    const snapshot = await computeAnnualSnapshot(body.year);
    return NextResponse.json(snapshot);
  } catch (error) {
    logServerFailure('annual-snapshots', 'POST', error);
    return internalError();
  }
}
