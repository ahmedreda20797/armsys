import { NextResponse } from 'next/server';
import { pingDatabase } from '@/lib/db';

/**
 * GET /api/health — public, unauthenticated health probe.
 *
 * M0.1 hardening: the response contains NO user data (no emails, roles
 * or users-table contents) and the check performs a single-record read
 * instead of scanning the whole users table.
 */
export async function GET() {
  try {
    const start = Date.now();
    await pingDatabase();
    return NextResponse.json({
      status: 'ok',
      database: { connected: true, responseTimeMs: Date.now() - start },
    });
  } catch {
    return NextResponse.json(
      { status: 'error', database: { connected: false } },
      { status: 500 }
    );
  }
}
