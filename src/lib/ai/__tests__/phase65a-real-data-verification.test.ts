// ══════════════════════════════════════════════════════════════
//  Phase 6.5-A — REAL-DATA verification helpers + timing tests
//
//  Deterministic unit coverage for the real-Firebase verification
//  path (NO Firebase credentials needed — the pipeline runs on the
//  m01 in-memory harness; the REAL Firebase/Gemini run stays in the
//  explicit manual script, Phase 6.5-A §17):
//    • real employee id resolution (UI code/name → canonical id)
//    • real month key resolution (UI month parity)
//    • dataset parity summary is aggregate-only (no record content)
//    • UI observation comparison
//    • payload size measurements (numbers only, no content)
//    • §10 failure taxonomy classification
//    • safe configuration flags (booleans, never values)
//    • per-stage timing instrumentation on the service envelopes
//      (OK / timeout / cache-hit) — additive, numbers only
//    • the default fixture script path stays intact (fixture mode
//      is the script default; real mode is opt-in)
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  resetTestData,
  registerFixtures,
  setTable,
} from '../../__tests__/m01-test-support';
import { getEmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence/types';
import { runEmployeeAnalytics } from '@/lib/analytics/service';
import { isValidMonthKey } from '@/lib/month-utils';
import {
  runQualityAIAnalysis,
  buildQualityAIAnalysisInput,
  QUALITY_AI_MAX_OUTPUT_TOKENS,
} from '../quality';
import { buildQualityAIUserContent, QUALITY_AI_SYSTEM_PROMPT } from '../quality/prompt';
import {
  buildPayloadMetrics,
  buildRealDatasetParitySummary,
  classifyRealDataOutcome,
  compareWithUiObservation,
  resolveRealEmployee,
  safeBooleanFlags,
} from '../quality/verification';
import { AIProviderError, type AIProvider, type AIProviderCompletion, type AIProviderRequest } from '../provider';
import {
  clearQualityAICacheForTests,
  clearQualityAIRateLimitForTests,
} from '../quality/cache';

const MONTH = '2026-08';
const EMP = 'emp-real-1';

// ── world seeds (deterministic fixtures — spec §51: NO Firebase writes) ──
async function seedRealShapeWorld(): Promise<EmployeePerformanceDataset> {
  resetTestData();
  clearQualityAICacheForTests();
  clearQualityAIRateLimitForTests();
  await registerFixtures();
  setTable('employees', [
    { id: EMP, code: 'EMP-040', name: 'أحمد الطبيبي', department: 'المبيعات', position: 'مندوب', status: 'active' },
  ]);
  setTable('qualityObservations', [
    {
      id: 'obs-1', employeeId: EMP, employeeName: 'أحمد الطبيبي',
      categoryName: 'متابعة العملاء', categoryId: 'cat-followup',
      type: 'تأخير المتابعة', notes: 'ملاحظة سرية للتحقق — لم يتم متابعة العميل',
      severity: 'medium', status: 'open', approvalStatus: 'approved',
      observationDate: '10/08/2026', month: MONTH,
    },
    {
      id: 'obs-2', employeeId: EMP, employeeName: 'أحمد الطبيبي',
      categoryName: 'متابعة العملاء', categoryId: 'cat-followup',
      type: 'تأخير المتابعة', notes: 'تكرار تأخر المتابعة',
      severity: 'medium', status: 'open', approvalStatus: 'pending',
      observationDate: '18/08/2026', month: MONTH,
    },
    {
      id: 'obs-3', employeeId: EMP, employeeName: 'أحمد الطبيبي',
      categoryName: 'دقة الحجز', categoryId: 'cat-booking',
      type: 'دقة الحجز', notes: 'ملاحظة دقة',
      severity: 'low', status: 'open', approvalStatus: 'approved',
      observationDate: '20/08/2026', month: MONTH,
    },
  ]);
  const dataset = await getEmployeePerformanceDataset({ employeeId: EMP, monthKey: MONTH, windowMonths: 6, minOccurrences: 2 });
  assert.ok(dataset, 'dataset must assemble for the seeded employee');
  return dataset;
}

// ── 1) real employee id resolution ──────────────────────────────
describe('Phase 6.5-A real-data verification — employee resolution', () => {
  const rows = [
    { id: 'abc123xyz', code: 'EMP-040', name: 'أحمد الطبيبي', department: 'المبيعات', status: 'active' },
    { id: 'def456uvw', code: 'EMP-041', name: 'سارة أحمد', department: 'المبيعات', status: 'active' },
  ];

  it('resolves by canonical internal id when the UI value IS the record id', () => {
    const resolved = resolveRealEmployee(rows, { code: 'abc123xyz', name: '' });
    assert.ok(resolved);
    assert.equal(resolved.employeeId, 'abc123xyz');
    assert.equal(resolved.matchedBy, 'id');
  });

  it('resolves by employee code (trimmed, case-insensitive) — the UI shows EMP-040', () => {
    const resolved = resolveRealEmployee(rows, { code: ' emp-040 ', name: '' });
    assert.ok(resolved);
    assert.equal(resolved.employeeId, 'abc123xyz');
    assert.equal(resolved.matchedBy, 'code');
    assert.equal(resolved.name, 'أحمد الطبيبي');
  });

  it('resolves by exact name when the code does not match', () => {
    const resolved = resolveRealEmployee(rows, { code: 'EMP-999', name: 'أحمد الطبيبي' });
    assert.ok(resolved);
    assert.equal(resolved.employeeId, 'abc123xyz');
    assert.equal(resolved.matchedBy, 'name');
  });

  it('returns null on no match — never guesses an id', () => {
    assert.equal(resolveRealEmployee(rows, { code: 'EMP-000', name: 'لا يوجد' }), null);
    assert.equal(resolveRealEmployee([], { code: 'EMP-040', name: 'أحمد الطبيبي' }), null);
  });
});

// ── 2) real month resolution ────────────────────────────────────
describe('Phase 6.5-A real-data verification — month resolution', () => {
  it('accepts the UI month key (2026-08) with the SAME validator the routes use', () => {
    assert.equal(isValidMonthKey('2026-08'), true);
  });

  it('rejects malformed month keys before any pipeline call', () => {
    assert.equal(isValidMonthKey('2026-8'), false);
    assert.equal(isValidMonthKey('08/2026'), false);
    assert.equal(isValidMonthKey(''), false);
  });
});

// ── 3) dataset parity summary (aggregates only) ─────────────────
describe('Phase 6.5-A real-data verification — parity summary', () => {
  it('surfaces the aggregate counts the UI renders — and NO record content', async () => {
    const dataset = await seedRealShapeWorld();
    const summary = buildRealDatasetParitySummary(dataset);

    assert.equal(summary.employeeId, EMP);
    assert.equal(summary.employeeCode, 'EMP-040');
    assert.equal(summary.period, MONTH);
    assert.equal(summary.qualityObservationCount, 3);
    assert.equal(summary.observationApproved, 2);
    assert.equal(summary.observationPending, 1);
    assert.ok(summary.repeatedIssueGroupsCount >= 1);

    // Safe-diagnostics guarantee: the summary shape is pinned to the
    // aggregate keys — no raw records, no notes, no PII beyond the
    // employee identity the report header itself shows.
    assert.deepEqual(
      Object.keys(summary).sort(),
      [
        'attendanceStatus', 'capaCount', 'complaintCount', 'department',
        'employeeCode', 'employeeId', 'employeeName', 'evidenceCount',
        'finalized', 'followUpCount', 'hasKpiScheme', 'hasKpiSnapshot',
        'observationApproved', 'observationPending', 'period',
        'qualityContribution', 'qualityDeductionCount',
        'qualityMaxContribution', 'qualityObservationCount', 'qualityWeight',
        'rawQualityScore', 'repeatedIssueGroupsCount', 'totalDeductionDays',
        'travelDealCount',
      ].sort(),
    );
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes('ملاحظة سرية'), false, 'raw observation notes must never enter the summary');
  });

  it('compares measured values against the UI-observed numbers (booleans only)', async () => {
    const dataset = await seedRealShapeWorld();
    const summary = buildRealDatasetParitySummary(dataset);
    // The values read off the real Smart Quality Report UI — compared
    // against a summary forced to match / mismatch them explicitly.
    const ui = { rawQualityScore: 95, qualityContribution: 14.25, qualityDeductionCount: summary.qualityDeductionCount, totalDeductionDays: 1.5 };
    const matches = compareWithUiObservation(
      { ...summary, rawQualityScore: 95, qualityContribution: 14.25, totalDeductionDays: 1.5 },
      ui,
    );
    assert.deepEqual(matches, {
      rawQualityScore: true,
      qualityContribution: true,
      qualityDeductionCount: true,
      totalDeductionDays: true,
    });
    const mismatch = compareWithUiObservation(summary, { rawQualityScore: 112 });
    assert.equal(mismatch.rawQualityScore, false);
  });
});

// ── 4) payload size measurements ────────────────────────────────
describe('Phase 6.5-A real-data verification — payload metrics', () => {
  it('measures the ACTUAL provider input with numbers only — never its content', async () => {
    const dataset = await seedRealShapeWorld();
    const analyticsOutcome = await runEmployeeAnalytics(dataset);
    assert.ok(analyticsOutcome.ok);
    const built = buildQualityAIAnalysisInput(dataset, analyticsOutcome.ok ? analyticsOutcome.result : null, null);
    assert.equal(built.kind, 'READY');
    if (built.kind !== 'READY') return;

    const payloadJson = JSON.stringify(built.payload);
    const userContent = buildQualityAIUserContent(payloadJson);
    const metrics = buildPayloadMetrics(built.payload, {
      payloadJson,
      systemPrompt: QUALITY_AI_SYSTEM_PROMPT,
      userContent,
      temperature: 0.2,
      maxOutputTokens: QUALITY_AI_MAX_OUTPUT_TOKENS,
      timeoutMs: 45_000,
    });

    assert.ok(metrics.factsCount >= 1);
    assert.ok(metrics.evidenceCatalogEntries >= 1);
    assert.ok(metrics.evidenceRecordRefs >= 1);
    assert.equal(metrics.payloadBytes, Buffer.byteLength(payloadJson, 'utf8'));
    assert.equal(metrics.userContentBytes, Buffer.byteLength(userContent, 'utf8'));
    assert.equal(metrics.totalInputBytes, Buffer.byteLength(QUALITY_AI_SYSTEM_PROMPT + userContent, 'utf8'));
    assert.equal(metrics.totalInputKb > 0, true);
    assert.deepEqual(metrics.generation, { temperature: 0.2, maxOutputTokens: QUALITY_AI_MAX_OUTPUT_TOKENS, timeoutMs: 45_000 });

    // Content-exclusion guarantee (§5: safe aggregate measurements only).
    const metricsJson = JSON.stringify(metrics);
    assert.equal(metricsJson.includes('متابعة العملاء'), false, 'metrics must never carry payload content');
    assert.equal(metricsJson.includes('UNTRUSTED DATA'), false);
  });
});

// ── 5) §10 failure taxonomy classification ──────────────────────
describe('Phase 6.5-A real-data verification — failure classification', () => {
  const base = { wallClockMs: 45_000, preProviderMs: 120, firebaseLoadMs: 240 };

  it('OK → NONE', () => {
    assert.equal(classifyRealDataOutcome({ ...base, envelopeStatus: 'OK' }).layer, 'NONE');
  });

  it('NO_DATA / INSUFFICIENT_DATA → layer B (data context, not AI)', () => {
    assert.equal(classifyRealDataOutcome({ ...base, envelopeStatus: 'NO_DATA' }).layer, 'B');
    assert.equal(classifyRealDataOutcome({ ...base, envelopeStatus: 'INSUFFICIENT_DATA' }).layer, 'B');
  });

  it('AI_TIMEOUT with provider-dominant timing → E/H (provider generation)', () => {
    const c = classifyRealDataOutcome({ ...base, envelopeStatus: 'AI_TIMEOUT', providerMs: 44_800 });
    assert.equal(c.layer, 'E/H');
  });

  it('AI_TIMEOUT without provider timing falls back to measured pre-provider share', () => {
    const c = classifyRealDataOutcome({ ...base, envelopeStatus: 'AI_TIMEOUT', providerMs: null });
    assert.equal(c.layer, 'E/H');
    const slowPre = classifyRealDataOutcome({
      envelopeStatus: 'AI_TIMEOUT', wallClockMs: 45_000, providerMs: null, preProviderMs: 44_900, firebaseLoadMs: 44_000,
    });
    assert.equal(slowPre.layer, 'K');
  });

  it('provider failures map to their §10 layers', () => {
    assert.equal(classifyRealDataOutcome({ ...base, envelopeStatus: 'AI_RATE_LIMITED' }).layer, 'F');
    assert.equal(classifyRealDataOutcome({ ...base, envelopeStatus: 'AI_ERROR', errorCategory: 'AI_PROVIDER_ERROR' }).layer, 'G');
    assert.equal(classifyRealDataOutcome({ ...base, envelopeStatus: 'AI_ERROR', errorCategory: 'RESTRICTED_DATA_BLOCKED' }).layer, 'J');
    assert.equal(classifyRealDataOutcome({ ...base, envelopeStatus: 'AI_INVALID_RESPONSE' }).layer, 'I');
  });
});

// ── 6) safe configuration flags ─────────────────────────────────
describe('Phase 6.5-A real-data verification — safe flags', () => {
  it('reports booleans only — never a secret value', () => {
    const flags = safeBooleanFlags(
      { AI_API_KEY: 'super-secret-value', AI_ENABLED: 'true', AI_MODEL: '' },
      ['AI_API_KEY', 'AI_ENABLED', 'AI_MODEL'],
    );
    assert.deepEqual(flags, { AI_API_KEY: true, AI_ENABLED: true, AI_MODEL: false });
    assert.equal(JSON.stringify(flags).includes('super-secret-value'), false);
  });
});

// ── 7) per-stage timing instrumentation (additive, numbers only) ─
class TimedFakeProvider implements AIProvider {
  readonly name = 'fake-timed';
  readonly model = 'fake-timed-1';
  readonly requests: AIProviderRequest[] = [];
  constructor(private readonly behavior: () => Promise<string>) {}
  async analyze(request: AIProviderRequest): Promise<AIProviderCompletion> {
    this.requests.push(request);
    const text = await this.behavior();
    return { text, provider: this.name, model: this.model, latencyMs: 1 };
  }
}

const VALID_AI_JSON = JSON.stringify({
  insights: [{
    id: 'ins-1',
    type: 'REPEATED_ISSUE',
    title: 'تكرار في متابعة العملاء',
    factBasis: 'تم تسجيل 2 ملاحظة من التصنيف نفسه خلال الفترة',
    interpretation: 'قد يشير التكرار إلى نمط يستحق المراجعة الإدارية',
    summary: 'نمط متكرر في متابعة العملاء',
    severity: 'MEDIUM',
    confidence: 'MEDIUM',
    supportingEvidence: [{ refId: 'observations' }],
    limitations: ['عينة محدودة خلال الفترة'],
  }],
  recommendations: [],
  limitations: ['البيانات التاريخية غير كافية لتحليل الاتجاه'],
  confidence: 'MEDIUM',
});

describe('Phase 6.5-A — service stage timing diagnostic (additive §6)', () => {
  beforeEach(() => {
    clearQualityAICacheForTests();
    clearQualityAIRateLimitForTests();
  });

  it('OK envelope carries OPERATIONAL diagnostic + numeric stage timings', async () => {
    const dataset = await seedRealShapeWorld();
    const provider = new TimedFakeProvider(async () => VALID_AI_JSON);
    const response = await runQualityAIAnalysis({ dataset, userId: 'u-admin', provider });
    assert.equal(response.status, 'OK');
    if (response.status !== 'OK') return;
    assert.equal(response.diagnostic?.status, 'OPERATIONAL');
    const timing = response.diagnostic?.timingMs;
    assert.ok(timing, 'OK envelope must carry timingMs');
    assert.equal(typeof timing.analyticsMs, 'number');
    assert.equal(typeof timing.inputBuildMs, 'number');
    assert.equal(typeof timing.providerMs, 'number');
    assert.equal(typeof timing.totalMs, 'number');
    assert.ok(timing.totalMs >= (timing.providerMs ?? 0));
    // Numbers only — no content anywhere in the diagnostic.
    assert.equal(JSON.stringify(response.diagnostic).includes('متابعة العملاء'), false);
  });

  it('AI_TIMEOUT envelope carries the measured pre-provider stages', async () => {
    const dataset = await seedRealShapeWorld();
    const provider: AIProvider = {
      name: 'fake-timeout',
      model: 'fake-timeout-1',
      analyze: async () => { throw new AIProviderError('AI_TIMEOUT', 'انتهت مهلة طلب المزود'); },
    };
    const response = await runQualityAIAnalysis({ dataset, userId: 'u-admin', provider });
    assert.equal(response.status, 'AI_TIMEOUT');
    if (response.status !== 'AI_TIMEOUT') return;
    assert.equal(response.diagnostic?.status, 'TIMEOUT');
    const timing = response.diagnostic?.timingMs;
    assert.ok(timing, 'timeout envelope must carry timingMs');
    assert.equal(typeof timing.analyticsMs, 'number');
    assert.equal(typeof timing.totalMs, 'number');
  });

  it('cache hit returns the cached result with a diagnostic and never re-calls the provider', async () => {
    const dataset = await seedRealShapeWorld();
    const provider = new TimedFakeProvider(async () => VALID_AI_JSON);
    const first = await runQualityAIAnalysis({ dataset, userId: 'u-admin', provider });
    assert.equal(first.status, 'OK');
    if (first.status !== 'OK') return;
    assert.equal(first.cached, false);
    const second = await runQualityAIAnalysis({ dataset, userId: 'u-admin', provider });
    assert.equal(second.status, 'OK');
    if (second.status !== 'OK') return;
    assert.equal(second.cached, true);
    assert.equal(provider.requests.length, 1, 'second call must be served from cache');
    assert.equal(second.diagnostic?.status, 'OPERATIONAL');
  });
});

// ── 8) the default fixture script path stays intact (§14) ───────
describe('Phase 6.5-A — verification script retains the fixture mode as default', () => {
  const scriptPath = path.resolve(__dirname, '../../../../scripts/phase65-verify-gemini.ts');

  it('fixture mode is the default; real-Firebase is strictly opt-in', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.equal(source.includes("process.env.PHASE65_REAL_FIREBASE === 'true'"), true, 'real mode must be opt-in');
    assert.equal(source.includes('IN-MEMORY FIXTURE'), true, 'fixture path must remain labeled and available');
    assert.equal(source.includes('seedArmFixture'), true, 'fixture seeding must remain');
    assert.equal(source.includes('runRealFirebaseArmTest'), true, 'real-Firebase mode must remain');
    assert.equal(source.includes('REAL_FIREBASE'), true, 'real data layer must be labeled');
  });

  it('the script never prints the API key or the raw payload', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.equal(source.includes('console.log(JSON.stringify(report'), true, 'only the safe report is printed');
    assert.equal(
      /console\.(log|error|info|warn)\([^;]*payloadJson/.test(source),
      false,
      'payload content must never reach any console call',
    );
  });
});
