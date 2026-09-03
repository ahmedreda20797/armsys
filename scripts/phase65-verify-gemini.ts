// ══════════════════════════════════════════════════════════════
//  Phase 6.5-A — ONE-COMMAND real Gemini activation & verification
//
//  Usage (the administrator, on any machine with the real key):
//    AI_ENABLED=true AI_PROVIDER=gemini \
//    AI_API_KEY=<real-key> \
//    AI_MODEL=<real-model-id> \
//    npx tsx scripts/phase65-verify-gemini.ts
//
//  REAL-FIREBASE mode (Phase 6.5-A §2/§3 — the UI-parity test):
//    PHASE65_REAL_FIREBASE=true npx tsx scripts/phase65-verify-gemini.ts
//      (or: npx tsx scripts/phase65-verify-gemini.ts --real-firebase)
//    Resolves the REAL employee record behind the UI selection
//    (default: code EMP-040 / أحمد الطبيبي — overridable via
//    PHASE65_EMPLOYEE_CODE / PHASE65_EMPLOYEE_NAME) and the REAL
//    month (default 2026-08 — overridable via PHASE65_MONTH), then
//    runs the FULL production pipeline over REAL Firebase data:
//    real auth → permission → scope → PI dataset → analytics →
//    input builder → gateway → provider → strict validation →
//    output security. Local .env/.env.local are loaded automatically
//    (existing process env always wins). NO secret value is ever
//    printed; no ARM record content is ever printed — safe
//    aggregates only.
//
//  Steps (safe output only — no secrets, no raw provider bodies):
//    1. Configuration booleans + gateway state
//    2. Model discovery (ListModels) — what the account ACTUALLY
//       supports right now (ids only, for EXPLICIT admin choice;
//       the script never configures anything by itself)
//    3. Minimal safe echo request (ARM_AI_HEALTH_OK) through the
//       REAL adapter — no ARM data involved
//    4. The full quality-analysis pipeline (verified facts +
//       deterministic analytics + evidence + provider interpretation
//       + strict validation):
//       • fixture mode (default): over an IN-MEMORY fixture —
//         clearly labeled, kept for deterministic regression;
//       • real-Firebase mode: over the REAL employee/month with a
//         parity check against the UI-observed values, SAFE payload
//         size metrics and per-stage timing.
//    5. Verdict + the exact remaining manual steps
// ══════════════════════════════════════════════════════════════

// ── env bootstrap (MUST run before any module that reads env —
//    @/lib/auth validates JWT_SECRET at module load). Plain .env
//    parser — no new dependency (Vercel-compatible doctrine). ──
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadLocalEnvFiles(): void {
  const projectRoot = typeof __dirname !== 'undefined'
    ? path.resolve(__dirname, '..')
    : process.cwd();
  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(projectRoot, fileName);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue; // missing file is fine — shell env may carry everything
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadLocalEnvFiles();

import { readAISafeDiagnostics } from '../src/lib/ai/provider/config';
import { discoverGeminiModels } from '../src/lib/ai/provider/models';
import { runProviderHealthCheck } from '../src/lib/ai/provider/health';
import {
  buildPayloadMetrics,
  buildRealDatasetParitySummary,
  classifyRealDataOutcome,
  compareWithUiObservation,
  resolveRealEmployee,
  safeBooleanFlags,
  type UiObservedValues,
} from '../src/lib/ai/quality/verification';

const REAL_FIREBASE_MODE = process.argv.includes('--real-firebase')
  || process.env.PHASE65_REAL_FIREBASE === 'true';

// The UI-observed context this verification must reproduce (STEP 2).
const UI_CODE = process.env.PHASE65_EMPLOYEE_CODE?.trim() || 'EMP-040';
const UI_NAME = process.env.PHASE65_EMPLOYEE_NAME?.trim() || 'أحمد الطبيبي';
const UI_MONTH = process.env.PHASE65_MONTH?.trim() || '2026-08';
/** Values READ OFF the real Smart Quality Report UI (milestone §UI). */
const UI_OBSERVED: UiObservedValues = {
  rawQualityScore: 95,
  qualityContribution: 14.25,
  qualityDeductionCount: 3,
  totalDeductionDays: 1.5,
};

// Fixture-mode constants (kept — the fixture path stays the default
// deterministic regression; Phase 6.5-A §14).
const MONTH = '2026-09';
const EMP = 'emp-1';
const EMP_OTHER = 'emp-2';

function booleanFlags() {
  return safeBooleanFlags(process.env, [
    'AI_ENABLED',
    'AI_PROVIDER',
    'AI_MODEL',
    'AI_API_KEY',
    'AI_TIMEOUT_MS',
  ]);
}

/** Streaming stage marker (stderr, safe labels only — no data, no
 *  secrets) so a long-running real verification shows WHERE it is. */
function stage(label: string): void {
  console.error(`[phase65] ${new Date().toISOString()} — ${label}`);
}

async function seedArmFixture(): Promise<void> {
  const { setTable } = await import('../src/lib/__tests__/m01-test-support');
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
}

// ── STEP 4 (fixture mode) — unchanged deterministic regression ──
async function runFixtureArmTest(): Promise<Record<string, unknown>> {
  const {
    registerFixtures,
    bearerHeaders,
  } = await import('../src/lib/__tests__/m01-test-support');
  process.env.AI_ENABLED = 'true';
  await seedArmFixture();
  const { adminToken } = await registerFixtures();
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
  };
  return {
    requestType: 'quality-analysis (Smart Quality AI pipeline)',
    authorizedScope: `admin JWT · employee=${EMP} · month=${MONTH}`,
    dataLayer: 'IN-MEMORY FIXTURE (no Firebase touched — real-Firebase mode: PHASE65_REAL_FIREBASE=true)',
    pipeline: 'verified facts + deterministic analytics + evidence + provider interpretation + strict validation + output security',
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
  };
}

// ── STEP 4 (real-Firebase mode) — the UI-parity verification ────
async function runRealFirebaseArmTest(): Promise<Record<string, unknown>> {
  const { isValidMonthKey } = await import('../src/lib/month-utils');
  const { isFirebaseConfigured } = await import('../src/lib/firebase-server');
  const { getAll } = await import('../src/lib/db');
  const { signToken } = await import('../src/lib/auth');
  const { getEmployeePerformanceDataset } = await import('../src/lib/performance-intelligence');
  const { runEmployeeAnalytics } = await import('../src/lib/analytics/service');
  const { buildQualityAIAnalysisInput } = await import('../src/lib/ai/quality/input-builder');
  const { QUALITY_AI_MAX_OUTPUT_TOKENS } = await import('../src/lib/ai/quality');
  const { QUALITY_AI_SYSTEM_PROMPT, buildQualityAIUserContent } = await import('../src/lib/ai/quality/prompt');

  const report: Record<string, unknown> = {
    requestType: 'quality-analysis (Smart Quality AI pipeline) — REAL Firebase',
    dataLayer: 'REAL_FIREBASE',
    month: { requested: UI_MONTH, valid: isValidMonthKey(UI_MONTH) },
  };

  if (!isFirebaseConfigured()) {
    report.blocked = 'FIREBASE_NOT_CONFIGURED — set FIREBASE_* on this machine (category A)';
    report.failureClassification = { layer: 'A', conclusion: 'Firebase credentials missing — no real data path possible' };
    return report;
  }

  stage('4a: connecting Firebase — reading employees');
  // ── Real employee resolution (canonical id — never guessed) ──
  const employees = await getAll<{ id: string; code?: string; name?: string; department?: string; status?: unknown }>('employees');
  const resolved = resolveRealEmployee(employees, { code: UI_CODE, name: UI_NAME });
  report.employeeResolution = resolved
    ? {
        requested: { code: UI_CODE, name: UI_NAME },
        canonicalEmployeeId: resolved.employeeId,
        matchedBy: resolved.matchedBy,
        code: resolved.code,
        name: resolved.name,
        department: resolved.department,
        employeesScanned: employees.length,
      }
    : { requested: { code: UI_CODE, name: UI_NAME }, matched: false, employeesScanned: employees.length };
  if (!resolved) {
    report.blocked = 'EMPLOYEE_NOT_FOUND in real Firebase for the requested UI context (category B)';
    report.failureClassification = { layer: 'B', conclusion: 'the UI employee context does not resolve to a real record' };
    return report;
  }
  if (!isValidMonthKey(UI_MONTH)) {
    report.blocked = 'INVALID_MONTH_KEY (category B)';
    report.failureClassification = { layer: 'B', conclusion: 'requested month is not YYYY-MM' };
    return report;
  }

  stage('4b: employee resolved — reading users');
  // ── Real admin caller (production auth path — real users table) ──
  const users = await getAll<{ id: string; role?: string; email?: string; isSuspended?: boolean }>('users');
  const admin = users.find((u) => u && u.role === 'admin' && !u.isSuspended);
  if (!admin) {
    report.blocked = 'NO_ACTIVE_ADMIN_USER — cannot mint a real caller token (category K)';
    report.failureClassification = { layer: 'K', conclusion: 'verification caller unavailable in the real users table' };
    return report;
  }
  const adminToken = await signToken({ userId: admin.id, email: admin.email || `${admin.id}@verification.local`, role: 'admin' }, 'access');

  stage('4c: admin token minted — building PI dataset (Firebase reads)');
  // ── REAL dataset (the SAME service both routes call) — timed ──
  const datasetStartedAt = Date.now();
  const dataset = await getEmployeePerformanceDataset({
    employeeId: resolved.employeeId,
    monthKey: UI_MONTH,
    windowMonths: 6,
    minOccurrences: 2,
  });
  const firebaseLoadMs = Date.now() - datasetStartedAt;
  if (!dataset) {
    report.blocked = 'EMPLOYEE_DATASET_NULL — identity read returned no record (category A/B)';
    report.failureClassification = { layer: 'A', conclusion: `employees/${resolved.employeeId} did not resolve through the PI loaders` };
    return report;
  }
  const summary = buildRealDatasetParitySummary(dataset);
  report.datasetParity = {
    firebaseLoadMs,
    summary,
    uiObserved: UI_OBSERVED,
    uiParityMatches: compareWithUiObservation(summary, UI_OBSERVED),
  };

  stage('4d: dataset built — running deterministic analytics + input builder');
  // ── Deterministic analytics + input builder — timed, measured ──
  const analyticsStartedAt = Date.now();
  const analyticsOutcome = await runEmployeeAnalytics(dataset);
  const analyticsMs = Date.now() - analyticsStartedAt;
  if (!analyticsOutcome.ok) {
    report.blocked = `ANALYTICS_${analyticsOutcome.reason} (category D/K)`;
    report.failureClassification = { layer: 'D', conclusion: 'deterministic analytics failed on the real dataset' };
    return report;
  }
  const inputBuildStartedAt = Date.now();
  const built = buildQualityAIAnalysisInput(dataset, analyticsOutcome.result, null);
  const inputBuildMs = Date.now() - inputBuildStartedAt;
  if (built.kind !== 'READY') {
    const gateMessage = 'message' in built ? built.message : built.reason;
    report.blocked = `INPUT_BUILDER_${built.kind}: ${gateMessage} (category B)`;
    report.failureClassification = { layer: 'B', conclusion: 'the real employee/month context failed the deterministic sufficiency gate' };
    return report;
  }

  // ── SAFE payload measurements (§5) — the payload itself is NEVER printed ──
  const payloadJson = JSON.stringify(built.payload);
  report.payloadMetrics = {
    analyticsMs,
    inputBuildMs,
    ...buildPayloadMetrics(built.payload, {
      payloadJson,
      systemPrompt: QUALITY_AI_SYSTEM_PROMPT,
      userContent: buildQualityAIUserContent(payloadJson),
      temperature: 0.2,
      maxOutputTokens: QUALITY_AI_MAX_OUTPUT_TOKENS,
      timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 45_000,
    }),
  };

  stage('4e: payload measured — invoking REAL route (this may take up to AI_TIMEOUT_MS)');
  // ── REAL route invocation — the exact production path ──
  const { POST } = await import('../src/app/api/ai/quality-analysis/route');
  const startedAt = Date.now();
  const response = await POST(new Request('http://localhost/api/ai/quality-analysis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ employeeId: resolved.employeeId, month: UI_MONTH }),
  }) as never);
  const body = await response.json() as {
    status: string;
    result?: { provider: string; model: string; insights: unknown[]; recommendations: unknown[]; limitations: string[]; dataSufficiency: string; confidence: string };
    diagnostic?: { status: string; errorCategory?: string | null; timingMs?: Record<string, number> };
    reason?: string;
  };
  stage('4f: route responded');
  const wallClockMs = Date.now() - startedAt;
  const timingMs = body.diagnostic?.timingMs ?? null;
  const preProviderMs = timingMs
    ? (timingMs.analyticsMs ?? 0) + (timingMs.inputBuildMs ?? 0) + (timingMs.providerResolveMs ?? 0)
      + (timingMs.cacheLookupMs ?? 0) + (timingMs.securityGatesMs ?? 0)
    : analyticsMs + inputBuildMs;
  report.realRouteTest = {
    authorizedScope: `real admin JWT (user=${admin.id}) · canonical employee=${resolved.employeeId} · month=${UI_MONTH}`,
    pipeline: 'verified facts + deterministic analytics + evidence + gateway + provider + strict validation + output security',
    httpStatus: response.status,
    envelopeStatus: body.status,
    reason: body.reason ?? null,
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
    wallClockMs,
  };
  report.failureClassification = classifyRealDataOutcome({
    envelopeStatus: body.status,
    errorCategory: body.diagnostic?.errorCategory ?? null,
    wallClockMs,
    providerMs: timingMs?.providerMs ?? null,
    preProviderMs,
    firebaseLoadMs,
  });
  return report;
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = {
    phase: '6.5-A',
    mode: REAL_FIREBASE_MODE ? 'REAL_FIREBASE' : 'FIXTURE (default)',
    step1_configuration: {
      flags: booleanFlags(),
      gateway: readAISafeDiagnostics(),
    },
  };

  // ── Step 2: model discovery (real endpoint, safe listing) ──
  stage('step2: model discovery (ListModels) starting');
  const discovery = await discoverGeminiModels();
  stage('step2: model discovery done');
  const usable = discovery.models.filter((m) => m.supportsGenerate).map((m) => m.id);
  report.step2_modelDiscovery = {
    attempted: discovery.attempted,
    reachable: discovery.reachable,
    authenticated: discovery.authenticated,
    status: discovery.status,
    errorCategory: discovery.errorCategory,
    latencyMs: discovery.latencyMs,
    totalListed: discovery.models.length,
    generateCapableModels: usable,
    guidance: usable.length > 0
      ? `اختر الموديل صراحةً: AI_MODEL=${usable[0] === undefined ? '' : '<one-of-the-ids-above>'}`
      : 'لا قائمة — أكمل الإعداد (مفتاح صالح) ثم أعد التشغيل.',
  };

  // ── Step 3: minimal safe echo request (NO ARM data) ──
  stage('step3: minimal echo health check starting');
  const health = await runProviderHealthCheck();
  stage('step3: echo health check done');
  report.step3_minimalEchoRequest = {
    attempted: health.attempted,
    provider: health.provider,
    model: health.model,
    providerReachable: health.providerReachable,
    modelAccepted: health.modelAccepted,
    operational: health.operational,
    echoMatched: health.echoMatched,
    status: health.status,
    errorCategory: health.errorCategory,
    // Phase 6.5-A §3 — SAFE provider diagnostics: the exact provider
    // rejection (bounded, secret-redacted) so failures are actionable.
    providerHttpStatus: health.providerHttpStatus,
    providerStatus: health.providerStatus,
    safeReason: health.safeReason,
    latencyMs: health.latencyMs,
  };

  // ── Step 4: the full ARM pipeline test ──
  if (health.operational) {
    stage(`step4: ARM pipeline test starting (mode=${REAL_FIREBASE_MODE ? 'REAL_FIREBASE' : 'FIXTURE'})`);
    report.step4_realArmDataTest = REAL_FIREBASE_MODE
      ? await runRealFirebaseArmTest()
      : await runFixtureArmTest();
    stage('step4: ARM pipeline test done');
  } else {
    report.step4_realArmDataTest = { skipped: 'provider health is not OPERATIONAL — fix steps 1-3 first' };
  }

  const healthOk = report.step3_minimalEchoRequest as { operational?: boolean };
  const armTest = report.step4_realArmDataTest as { envelopeStatus?: string; failureClassification?: { layer: string } } | undefined;
  const armOk = armTest?.envelopeStatus === 'OK';
  report.verdict = !healthOk.operational
    ? 'REAL_PROVIDER_NOT_VERIFIED — see steps 1-3 for the exact blocking category'
    : armOk
      ? (REAL_FIREBASE_MODE ? 'REAL_FIREBASE_SMART_QUALITY_SUCCESS' : 'REAL_PROVIDER_OPERATIONAL_END_TO_END')
      : `SMART_QUALITY_TEST_FAILED_LAYER_${armTest?.failureClassification?.layer ?? 'UNKNOWN'}`;
  report.remainingManualSteps = REAL_FIREBASE_MODE
    ? (armOk
      ? [
          'Vercel Production environment configuration is required: add AI_ENABLED/AI_PROVIDER=gemini/AI_MODEL/AI_API_KEY/AI_TIMEOUT_MS in Project Settings → Environment Variables (Production scope), then redeploy.',
          'Free-tier notice: provider quotas/policies apply — usage stays on-demand, bounded and rate-limited.',
        ]
      : [
          'Review failureClassification — it names the exact §10 layer responsible.',
          'Vercel Production environment configuration is required: add AI_ENABLED/AI_PROVIDER=gemini/AI_MODEL/AI_API_KEY/AI_TIMEOUT_MS in Project Settings → Environment Variables (Production scope), then redeploy.',
        ])
    : [
        'Vercel Production environment configuration is required: add AI_ENABLED/AI_PROVIDER=gemini/AI_MODEL/AI_API_KEY/AI_TIMEOUT_MS in Project Settings → Environment Variables (Production scope), then redeploy.',
        'Real-Firebase verification: run PHASE65_REAL_FIREBASE=true npx tsx scripts/phase65-verify-gemini.ts — the ARM data step then runs against the real data path (employee EMP-040 / أحمد الطبيبي · month 2026-08 by default).',
        'Free-tier notice: provider quotas/policies apply — usage stays on-demand, bounded and rate-limited.',
      ];

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ phase: '6.5-A', crashed: true, error: error instanceof Error ? error.name : 'unknown' }));
  process.exit(1);
});
