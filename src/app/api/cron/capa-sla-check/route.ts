import { NextResponse } from 'next/server';

/**
 * GET /api/cron/capa-sla-check
 *
 * Vercel Cron endpoint — called every 4 hours.
 * Triggers the SLA monitoring check by calling /api/capa-sla internally.
 * Uses x-internal-scheduler header to bypass user auth.
 */
export async function GET() {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const response = await fetch(`${baseUrl}/api/capa-sla`, {
      headers: {
        'x-internal-scheduler': 'true',
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'internal-cron-token'}`,
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