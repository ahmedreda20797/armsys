// ══════════════════════════════════════════════════════════════
//  Phase 6.1 — AI Foundation tests (spec §31)
//
//  Proves the FOUNDATION properties without any runtime AI:
//   • AI contracts are serializable
//   • evidence is required for insights/recommendations
//   • confidence is represented
//   • recommendations do not execute automatically
//   • no raw DB dump contract
//   • no Python dependency
//   • no external AI call
//   • no KPI mutation / no source-record mutation
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as governance from '@/lib/ai/governance';
import type {
  AIAnalysisInput,
  AIAnalysisResponse,
  AIInsight,
  AIRecommendation,
  OrganizationalMemoryEntry,
  RecommendationOutcome,
} from '@/lib/ai/types';

const srcOf = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const AI_FILES = [
  'src/lib/ai/types.ts',
  'src/lib/ai/governance.ts',
  'src/lib/ai/index.ts',
];

const EVIDENCE = [{ collection: 'qualityObservations', recordId: 'obs-1' }];

const insight: AIInsight = {
  id: 'ins-1',
  type: 'anomaly',
  title: 'انحراف في أوقات المتابعة',
  summary: 'انخفاض معدل المتابعة في الوقت المحدد خلال الأسبوعين الأخيرين',
  evidence: EVIDENCE,
  confidence: 'medium',
  severity: 'medium',
  scope: { kind: 'employee', employeeId: 'emp-1' },
  createdAt: '2026-08-31T00:00:00.000Z',
  status: 'new',
};

const recommendation: AIRecommendation = {
  id: 'rec-1',
  category: 'quality',
  recommendation: 'إعادة توزيع مهام المتابعة الصباحية',
  reason: 'ارتباط زمني بين ذروة الحجوزات وتأخر المتابعات',
  supportingEvidence: EVIDENCE,
  confidence: 'medium',
  expectedImpact: { direction: 'improvement', description: 'تحسن زمن تأكيد الحجوزات' },
  status: 'proposed',
};

const analysisInput: AIAnalysisInput = {
  schemaVersion: 1,
  subject: { kind: 'employee', employeeId: 'emp-1' },
  period: { from: '2026-07-01', to: '2026-08-31' },
  verifiedFacts: [
    { id: 'fact-1', statement: 'معدل المتابعة 87.2%', value: 87.2, source: EVIDENCE[0] },
  ],
  analytics: {
    engine: 'typescript-analytics-engine',
    generatedAt: '2026-08-31T00:00:00.000Z',
    metrics: [{ key: 'followUpRate', value: 87.2 }],
  },
  evidence: EVIDENCE,
  confidence: 'medium',
};

const memoryEntry: OrganizationalMemoryEntry = {
  id: 'mem-1',
  stage: 'recommendation',
  subject: { kind: 'employee', employeeId: 'emp-1' },
  summary: 'توصية بإعادة توزيع المهام',
  evidence: EVIDENCE,
  relatedEntryIds: ['mem-0'],
  createdAt: '2026-08-31T00:00:00.000Z',
};

const outcome: RecommendationOutcome = {
  id: 'out-1',
  recommendationId: 'rec-1',
  status: 'accepted',
  decidedBy: 'u-admin',
  decidedAt: '2026-08-31T00:00:00.000Z',
};

describe('Phase 6.1 — AI Foundation: contracts (§20-§24, §31)', () => {
  it('contracts are serializable (JSON round-trip)', () => {
    for (const contract of [insight, recommendation, analysisInput, memoryEntry, outcome]) {
      assert.equal(governance.isSerializableContract(contract), true);
    }
    const response: AIAnalysisResponse = {
      schemaVersion: 1,
      insights: [insight],
      recommendations: [recommendation],
      generatedAt: '2026-08-31T00:00:00.000Z',
      confidence: 'medium',
    };
    assert.equal(governance.isSerializableContract(response), true);
    // Non-serializable values (functions) are rejected.
    assert.equal(governance.isSerializableContract({ bad: () => 1 }), false);
  });

  it('evidence is REQUIRED for insights and recommendations', () => {
    assert.equal(governance.isEvidenceBacked(EVIDENCE), true);
    assert.equal(governance.isEvidenceBacked([]), false);
    assert.equal(governance.isEvidenceBacked(undefined), false);
    assert.equal(governance.isEvidenceBacked([{ collection: '', recordId: 'x' }]), false);
    assert.equal(governance.isEvidenceBacked([{ collection: 'qualityObservations', recordId: '' }]), false);
    assert.equal(governance.validateAIInsight({ ...insight, evidence: [] }), 'الـinsight يجب أن يستند إلى أدلة');
    assert.equal(governance.validateAIInsight({ ...insight, evidence: undefined as unknown as AIInsight['evidence'] }), 'الـinsight يجب أن يستند إلى أدلة');
    assert.equal(governance.validateAIInsight(insight), null);
    assert.equal(governance.validateAIRecommendation({ ...recommendation, supportingEvidence: [] }), 'التوصية يجب أن تستند إلى أدلة');
    assert.equal(governance.validateAIRecommendation(recommendation), null);
  });

  it('confidence is represented on every contract', () => {
    assert.ok(['low', 'medium', 'high'].includes(analysisInput.confidence));
    assert.ok(['low', 'medium', 'high'].includes(insight.confidence));
    assert.ok(['low', 'medium', 'high'].includes(recommendation.confidence));
    // Invalid confidence values fail the guards.
    assert.equal(
      governance.validateAIInsight({ ...insight, confidence: 'certain' as unknown as AIInsight['confidence'] }),
      'مستوى الثقة مطلوب',
    );
  });

  it('the AI input contract carries verified facts + analytics + evidence — never a raw dump', () => {
    // Every verified fact is traceable to evidence.
    for (const fact of analysisInput.verifiedFacts) {
      assert.ok(fact.source.collection.length > 0);
      assert.ok(fact.source.recordId.length > 0);
    }
    assert.ok(analysisInput.evidence.length > 0);
    // The input contract has NO raw-rows field.
    const keys = Object.keys(analysisInput);
    for (const forbidden of ['rows', 'records', 'database', 'dump', 'firebase']) {
      assert.equal(keys.includes(forbidden), false);
    }
  });

  it('recommendations do not execute automatically — lifecycle starts at proposed', () => {
    assert.equal(recommendation.status, 'proposed');
    // The governance module exposes NO execution capability.
    const exportNames = Object.keys(governance);
    for (const name of exportNames) {
      assert.equal(/^(execute|run|apply|perform|invoke)/i.test(name), false, `forbidden export: ${name}`);
    }
  });

  it('organizational memory + outcome loop are explicit-workflow contracts only', () => {
    assert.ok(['problem', 'observation', 'analysis', 'recommendation', 'decision', 'action', 'outcome', 'learning'].includes(memoryEntry.stage));
    assert.ok(['accepted', 'rejected', 'executed', 'superseded'].includes(outcome.status));
    // Measured impact exists only in the explicit outcome contract.
    assert.equal((analysisInput as unknown as Record<string, unknown>).measuredImpact, undefined);
  });
});

describe('Phase 6.1 — AI Foundation: governance & safety (§25, §31)', () => {
  it('the AI layer is declared READ-ONLY with hard mutation boundaries', () => {
    assert.equal(governance.AI_READ_ONLY, true);
    for (const forbidden of ['employees', 'kpis', 'permissions', 'companyConfiguration']) {
      assert.ok(governance.AI_FORBIDDEN_MUTATIONS.includes(forbidden as never));
    }
  });

  it('allowed data sources are verified/controlled — no direct database access', () => {
    for (const source of governance.AI_ALLOWED_DATA_SOURCES) {
      assert.notEqual(source, 'rawDatabase');
      assert.notEqual(source, 'firebase');
    }
  });

  it('no raw DB dump contract: the AI module never imports the db/auth/firebase layers', () => {
    for (const file of AI_FILES) {
      const source = srcOf(file);
      assert.equal(/from '@\/lib\/db'/.test(source), false, file);
      assert.equal(/from '@\/lib\/auth'/.test(source), false, file);
      assert.equal(/from '@\/lib\/firebase-server'/.test(source), false, file);
      assert.equal(/firebase-admin/.test(source), false, file);
    }
  });

  it('no external AI call / provider integration of any kind', () => {
    for (const file of AI_FILES) {
      const source = srcOf(file).toLowerCase();
      for (const forbidden of ['openai', 'anthropic', 'gemini', 'claude', "fetch(", 'axios', 'api_key', 'apikey']) {
        assert.equal(source.includes(forbidden), false, `${file} must not reference ${forbidden}`);
      }
    }
  });

  it('no Python dependency anywhere in the search or AI foundation', () => {
    const searchFiles = [
      'src/lib/search/types.ts', 'src/lib/search/search-domains.ts',
      'src/lib/search/search-normalize.ts', 'src/lib/search/record-matcher.ts',
      'src/lib/search/adapters.ts', 'src/lib/search/search-request.ts',
      'src/lib/search/search-service.ts', 'src/lib/search/search-navigation.ts',
      'src/app/api/search/route.ts',
    ];
    for (const file of [...searchFiles, ...AI_FILES]) {
      assert.equal(srcOf(file).toLowerCase().includes('python'), false, file);
    }
  });

  it('search layer is read-only: no write operation exists in the search service or route', () => {
    const sources = [
      'src/lib/search/search-service.ts',
      'src/app/api/search/route.ts',
    ];
    for (const file of sources) {
      const source = srcOf(file);
      for (const forbidden of ['createRecord', 'updateRecord', 'deleteRecord', 'invalidateCache', 'deleteWhere']) {
        assert.equal(source.includes(forbidden), false, `${file} must not contain ${forbidden}`);
      }
    }
  });
});
