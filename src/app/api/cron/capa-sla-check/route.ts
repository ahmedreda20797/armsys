import { NextRequest, NextResponse } from 'next/server';
import { getCronSecret, isCronRequest } from '@/lib/cron-auth';

/**
 * GET /api/cron/capa-sla-check
 *
 * Vercel Cron endpoint — called every 4 hours.
 * Triggers the SLA monitoring check by calling /api/capa-sla internally.
 *
 * M0.1: the incoming call must present the server-side CRON_SECRET as a
 * Bearer token (Vercel Cron attaches it automatically when CRON_SECRET is
 * configured), and the same secret is forwarded to /api/capa-sla. The old
 * x-internal-scheduler header bypass and the hardcoded fallback secret are
 * removed — when CRON_SECRET is not configured, cron calls fail closed.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isCronRequest(request)) {
      if (!getCronSecret()) {
        console.error(
          '[CRON capa-sla-check] CRON_SECRET is not configured — cron calls are rejected. ' +
          'Set CRON_SECRET in the environment to enable scheduled SLA checks.'
        );
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cronSecret = getCronSecret() as string;
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const response = await fetch(`${baseUrl}/api/capa-sla`, {
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
      },
      signal: AbortSignal.timeout(60_000), // 60s timeout
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[CRON capa-sla-check] SLA endpoint returned error:', response.status, text);
      return NextResponse.json(
        { error: 'SLA check failed', status: response.status },
        { status: 502 }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      cron: 'capa-sla-check',
      triggeredAt: new Date().toISOString(),
      result: data.summary,
    });
  } catch (error) {
    console.error('[CRON capa-sla-check] Error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// Allow Vercel Cron to call this endpoint
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
