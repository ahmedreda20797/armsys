import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { compareYears } from '@/lib/year-snapshots';
import { unauthorizedError, forbiddenError, internalError, logServerFailure, validationError } from '@/lib/api-error';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'monthClose', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { searchParams } = new URL(request.url);
    const yearA = parseInt(searchParams.get('a') || '', 10);
    const yearB = parseInt(searchParams.get('b') || '', 10);

    if (!Number.isFinite(yearA) || !Number.isFinite(yearB)) {
      return validationError('سنتا المقارنة مطلوبتان');
    }

    const comparison = await compareYears(yearA, yearB);
    return NextResponse.json(comparison);
  } catch (error) {
    logServerFailure('annual-snapshots/compare', 'GET', error);
    return internalError();
  }
}
