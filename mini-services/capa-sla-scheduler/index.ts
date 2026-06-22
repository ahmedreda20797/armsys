// ══════════════════════════════════════════════════════════════
//  CAPA SLA Auto-Monitoring Scheduler
//  Runs every 4 hours, calls /api/capa-sla to check overdue CAPAs
//  and trigger warning/critical/escalation notifications.
// ══════════════════════════════════════════════════════════════
// @ts-nocheck — standalone Bun service; node-cron & Bun types not in Next.js tsconfig

/* eslint-disable @typescript-eslint/no-require-imports */
const cron = require('node-cron');

const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://localhost:3000';
const SCHEDULE_CRON = '0 */4 * * *'; // Every 4 hours: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00

// In-memory execution log (last 20 runs)
const executionLog: Array<{
  timestamp: string;
  status: 'success' | 'error';
  summary?: Record<string, number>;
  error?: string;
  duration: number;
}> = [];

async function runSlaCheck() {
  const startTime = Date.now();
  console.log(`[CAPA SLA Scheduler] Running SLA check at ${new Date().toISOString()}`);

  try {
    const response = await fetch(`${MAIN_APP_URL}/api/capa-sla`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Pass auth cookie — in production, use a service account token
        'x-internal-scheduler': 'true',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;

    console.log(`[CAPA SLA Scheduler] Completed in ${duration}ms. Summary:`, JSON.stringify(data.summary));

    // Log execution
    executionLog.unshift({
      timestamp: new Date().toISOString(),
      status: 'success',
      summary: data.summary,
      duration,
    });

    // Keep only last 20 entries
    if (executionLog.length > 20) executionLog.length = 20;

    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[CAPA SLA Scheduler] Error after ${duration}ms:`, errorMessage);

    executionLog.unshift({
      timestamp: new Date().toISOString(),
      status: 'error',
      error: errorMessage,
      duration,
    });

    if (executionLog.length > 20) executionLog.length = 20;

    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  HTTP Health & Log endpoints
// ══════════════════════════════════════════════════════════════

const PORT = 3004;

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        service: 'capa-sla-scheduler',
        status: 'running',
        schedule: SCHEDULE_CRON,
        lastLogCount: executionLog.length,
      });
    }

    // Execution log
    if (url.pathname === '/log') {
      return Response.json({ executions: executionLog });
    }

    // Manual trigger
    if (url.pathname === '/trigger' && req.method === 'POST') {
      runSlaCheck();
      return Response.json({ message: 'SLA check triggered', timestamp: new Date().toISOString() });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
});

// ══════════════════════════════════════════════════════════════
//  Start cron scheduler
// ══════════════════════════════════════════════════════════════

// Validate cron expression
if (!cron.validate(SCHEDULE_CRON)) {
  console.error(`[CAPA SLA Scheduler] Invalid cron expression: ${SCHEDULE_CRON}`);
  process.exit(1);
}

// Schedule the task
cron.schedule(SCHEDULE_CRON, () => {
  runSlaCheck();
}, {
  scheduled: true,
  timezone: 'Africa/Cairo',
});

console.log(`[CAPA SLA Scheduler] Started on port ${PORT}`);
console.log(`[CAPA SLA Scheduler] Schedule: "${SCHEDULE_CRON}" (every 4 hours, Cairo timezone)`);
console.log(`[CAPA SLA Scheduler] Endpoints: GET /health, GET /log, POST /trigger`);

// Run once on startup (with 10s delay to let main app warm up)
setTimeout(() => {
  console.log('[CAPA SLA Scheduler] Running initial SLA check after startup delay...');
  runSlaCheck();
}, 10000);