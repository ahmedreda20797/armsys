// ══════════════════════════════════════════════════════════════
//  Phase 6.4 §42 — REAL provider E2E verification probe.
//
//  Runs the COMPLETE production pipeline end-to-end:
//    JWT auth → permission → employee scope → verified PI dataset
//    → deterministic analytics → input builder (minimized) →
//    classification gate → fencing → REAL provider call →
//    strict validation → output security → response envelope.
//
//  Data: in-memory fixture ONLY (m01 harness — no Firebase touched).
//  Provider: the platform's real z-ai credentials (AI_PROVIDER=z-ai).
//  Prints SAFE results only (statuses/counts/latency — no content).
//  Run: AI_ENABLED=true AI_PROVIDER=z-ai npx tsx scripts/phase64-real-probe.ts
// ══════════════════════════════════════════════════════════════

import '../src/lib/__tests__/m01-test-support';

import {
  registerFixtures,
  setTable,
  bearerHeaders,
} from '../src/lib/__tests__/m01-test-support';

const MONTH = '2026-09';
const EMP = 'emp-1';
const EMP_OTHER = 'emp-2';

async function main(): Promise<void> {
  process.env.AI_ENABLED = 'true';
  process.env.AI_PROVIDER = 'z-ai';
  process.env.AI_TIMEOUT_MS = '60000';

  const { adminToken } = await registerFixtures();

  setTable('employees', [
    { id: EMP, code: 'EMP-001', name: 'أحمد محمود', department: 'العمليات', position: 'موظف', status: 'active' },
    { id: EMP_OTHER, code: 'EMP-002', name: 'سارة أحمد', department: 'المبيعات', position: 'مندوبة', status: 'active' },
  ]);
  setTable('qualityObservations', [
    {
      id: 'obs-1', employeeId: EMP, employeeName: 'أحمد محمود',
      categoryName: 'متابعة العملاء', categoryId: 'cat-followup',
      type: 'تأخير المتابعة', notes: 'لم يتم متابعة العميل بعد الحجز',
      severity: 'medium', status: 'open', approvalStatus: 'approved',
      observationDate: '10/09/2026', month: MONTH,
    },
    {
      id: 'obs-2', employeeId: EMP, employeeName: 'أحمد محمود',
      categoryName: 'متابعة العملاء', categoryId: 'cat-followup',
      type: 'تأخير المتابعة', notes: 'تكرار تأخر المتابعة لنفس العميل',
      severity: 'medium', status: 'open', approvalStatus: 'approved',
      observationDate: '18/09/2026', month: MONTH,
    },
    {
      id: 'obs-3', employeeId: EMP_OTHER, employeeName: 'سارة أحمد',
      categoryName: 'دقة الحجز', categoryId: 'cat-booking',
      type: 'دقة الحجز', notes: 'دقة في تأكيد الحجز',
      severity: 'low', status: 'open', approvalStatus: 'approved',
      observationDate: '12/09/2026', month: MONTH,
    },
  ]);

  const { POST } = await import('../src/app/api/ai/quality-analysis/route');
  const startedAt = Date.now();
  const response = await POST(new Request('http://localhost/api/ai/quality-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearerHeaders(adminToken) },
    body: JSON.stringify({ employeeId: EMP, month: MONTH }),
  }) as never);
  const body = await response.json() as {
    status: string;
    result?: { provider: string; model: string; insights: unknown[]; recommendations: unknown[]; limitations: string[]; dataSufficiency: string; confidence: string };
    diagnostic?: { status: string };
    message?: string;
  };

  console.log(JSON.stringify({
    probe: 'phase64-real-provider-e2e',
    httpStatus: response.status,
    envelopeStatus: body.status,
    result: body.status === 'OK' && body.result ? {
      provider: body.result.provider,
      model: body.result.model,
      dataSufficiency: body.result.dataSufficiency,
      confidence: body.result.confidence,
      insights: body.result.insights.length,
      recommendations: body.result.recommendations.length,
      limitations: body.result.limitations.length,
    } : undefined,
    diagnostic: body.diagnostic ?? null,
    wallClockMs: Date.now() - startedAt,
    verdict: body.status === 'OK' ? 'OPERATIONAL_END_TO_END' : `NOT_OPERATIONAL:${body.status}`,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ probe: 'phase64-real-provider-e2e', crashed: true, error: error instanceof Error ? error.name : 'unknown' }));
  process.exit(1);
});
