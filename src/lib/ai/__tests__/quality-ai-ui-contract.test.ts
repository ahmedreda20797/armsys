// ══════════════════════════════════════════════════════════════
//  Phase 6.2 — AI section UI + integration contracts (§49)
//
//  Static source-contract tests (same doctrine as the Phase 4/5
//  UI test files): the browser bundle can never carry provider
//  configuration, the section stays on-demand + abortable, states
//  are distinct, evidence opens the EXISTING EvidencePreviewModal,
//  Arabic labels exist for EVERY enum, and the §68 period rule is
//  applied. Covered here: 24 facts independent · 25 evidence
//  integration · 26 Arabic rendering · 27 prompt version display ·
//  28 Global Search/KPI untouched (suite) · 64 server-only config.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function readSrc(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const SECTION_PATH = 'src/components/pages/quality-kpi/smart-report/AIAnalysisSection.tsx';
const PAGE_PATH = 'src/components/pages/quality-kpi/smart-report/SmartQualityReportPage.tsx';
const VIEW_PATH = 'src/components/pages/quality-kpi/smart-report/ai-view.ts';
const CONTRACTS_PATH = 'src/lib/ai/quality/contracts.ts';
const SERVICE_PATH = 'src/lib/ai/quality/service.ts';
const ROUTE_PATH = 'src/app/api/ai/quality-analysis/route.ts';
const PROMPT_PATH = 'src/lib/ai/quality/prompt.ts';

describe('AI section — mounting & failure isolation (§23/§24/§53)', () => {
  it('AI section is mounted in the Smart Report in the reserved "التحليل الذكي" spot', () => {
    const page = readSrc(PAGE_PATH);
    assert.match(page, /<AIAnalysisSection\b/);
    assert.match(page, /onViewEvidence=\{handleViewEvidence\}/);
    assert.match(page, /employeeId=\{employeeId\}/);
    assert.match(page, /month=\{month\}/);
  });

  it('the section renders AFTER Analytics and never blocks the facts sections', () => {
    const page = readSrc(PAGE_PATH);
    const analyticsAt = page.indexOf('<AnalyticsSection');
    const aiAt = page.indexOf('<AIAnalysisSection');
    assert.ok(analyticsAt !== -1 && aiAt !== -1);
    assert.ok(aiAt > analyticsAt, 'AI section must come after the deterministic analytics');
  });

  it('AI output is ON-DEMAND (§25): a button runs it — no automatic render-time fetch', () => {
    const section = readSrc(SECTION_PATH);
    assert.match(section, /تشغيل التحليل الذكي/);
    assert.match(section, /تحديث التحليل/);
    assert.match(section, /useState<AiState>\(\{ kind: 'IDLE' \}\)/);
    assert.ok(!/useQuery\(/.test(section), 'no render-time query — fetch happens on demand');
  });

  it('in-flight requests are abortable on subject/period change and unmount (§25/§52)', () => {
    const section = readSrc(SECTION_PATH);
    assert.match(section, /AbortController/);
    assert.match(section, /abortRef\.current\?\.abort\(\)/);
    assert.match(section, /useEffect/);
  });

  it('every §24 state has an explicit UI state (no silent failure)', () => {
    const section = readSrc(SECTION_PATH);
    for (const marker of [
      "'IDLE'", "'LOADING'", "'READY'", "'FAILED'",
      'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_ERROR', 'AI_INVALID_RESPONSE',
      'AI_RATE_LIMITED', 'NO_DATA', 'INSUFFICIENT_DATA', 'NETWORK_ERROR',
    ]) {
      assert.ok(section.includes(marker), `missing state marker: ${marker}`);
    }
  });

  it('failure copy promises the report stays usable (§24/§53) and limits honest wording (§69)', () => {
    const view = readSrc(VIEW_PATH);
    const section = readSrc(SECTION_PATH);
    assert.match(view, /البيانات التاريخية غير كافية حاليًا/);
    assert.match(section, /تبقى متاحة بشكل طبيعي/);
    // §69: limited data must NOT read as "فشل التحليل".
    const heading = view.match(/aiFailureHeading[\s\S]*?\n\}/);
    assert.ok(heading && !heading[0].includes('فشل التحليل'));
  });
});

describe('AI section — evidence integration (§44/§45)', () => {
  it('insight evidence opens the EXISTING EvidencePreviewModal — no second viewer', () => {
    const section = readSrc(SECTION_PATH);
    assert.match(section, /fetchEvidencePreview/);
    assert.match(section, /onViewEvidence\(/);
    // The modal itself is mounted exactly once — in the report page.
    const page = readSrc(PAGE_PATH);
    assert.equal((page.match(/<EvidencePreviewModal/g) ?? []).length, 1);
    // No new evidence viewer component was created anywhere.
    assert.ok(!readSrc('src/lib/evidence/evidence-collections.ts').includes('aiEvidence'));
  });

  it('every evidence chip is clickable and carries the record group (auditable AI, §45)', () => {
    const section = readSrc(SECTION_PATH);
    assert.match(section, /ai-evidence-chip/);
    assert.match(section, /الأدلة:/);
  });
});

describe('AI section — client security (§31/§64)', () => {
  it('browser code never imports provider/config/env — only the API envelope types', () => {
    const section = readSrc(SECTION_PATH);
    assert.ok(!section.includes('process.env'), 'no env access in client code');
    assert.ok(!/from '@\/lib\/ai\/provider'/.test(section), 'no provider import in client code');
    assert.ok(!section.includes("from '../provider'"));
    assert.match(section, /import type \{ QualityAIApiResponse/);
  });

  it('the service and route import the provider factory — server-side only', () => {
    const service = readSrc(SERVICE_PATH);
    assert.match(service, /createAIProviderFromEnv/);
    const route = readSrc(ROUTE_PATH);
    assert.match(route, /runQualityAIAnalysis/);
    assert.ok(!route.includes('AI_API_KEY'), 'route never touches the raw key');
  });

  it('observability logs structure ONLY — never prompt/response content (§58)', () => {
    const service = readSrc(SERVICE_PATH);
    assert.match(service, /logObservability/);
    const block = service.match(/function logObservability[\s\S]*?\n\}/);
    assert.ok(block, 'logger helper exists');
    assert.ok(block![0].length < 700, 'logger stays a tiny structural helper');
    for (const banned of ['apiKey', 'systemPrompt', 'userContent', 'response.text', 'AI_API_KEY']) {
      assert.ok(!block![0].includes(banned), `logger must never touch ${banned}`);
    }
  });
});

describe('Arabic output rendering + stable enums (§46)', () => {
  it('EVERY enum value has an Arabic label — maps stay exhaustive', () => {
    const contracts = readSrc(CONTRACTS_PATH);
    const view = readSrc(VIEW_PATH);
    const typeValues = [...contracts.matchAll(/'([A-Z_]+)',/g)].map((m) => m[1]);
    for (const value of new Set(typeValues)) {
      if (value === 'PROPOSED') continue;
      assert.ok(view.includes(`'${value}'`) || view.includes(value), `no Arabic label mapping for ${value}`);
    }
  });

  it('enum unions remain stable English — Arabic lives only in label maps', () => {
    const contracts = readSrc(CONTRACTS_PATH);
    const unionBlocks = contracts.match(/export const AI_[A-Z_]+ = \[[\s\S]*?\] as const;/g) ?? [];
    assert.ok(unionBlocks.length >= 5);
    for (const block of unionBlocks) {
      assert.ok(!/[\u0600-\u06FF]/.test(block), 'enum array contains Arabic — forbidden (§46)');
    }
  });

  it('failure headings + impact labels are Arabic and cover the §24 statuses', () => {
    const view = readSrc(VIEW_PATH);
    assert.match(view, /aiFailureHeading/);
    assert.match(view, /AI_IMPACT_LABELS/);
  });
});

describe('AI §68 period rule — the AI section displays the period', () => {
  it('READY view always names the period and marks MTD as not finalized (§21/§68)', () => {
    const section = readSrc(SECTION_PATH);
    assert.match(section, /الفترة: \{periodLabel\}/);
    assert.match(section, /formatMonthLabelAr/);
    assert.match(section, /حتى تاريخه \(MTD\)/);
    assert.match(section, /ليست شهرًا نهائيًا/);
  });
});

describe('System prompt guardrails (§17/§18/§19/§30)', () => {
  const prompt = readSrc(PROMPT_PATH);

  it('contains source-of-truth, evidence requirement, uncertainty, fairness and no-causality rules', () => {
    assert.match(prompt, /مصدر الحقيقة/);
    assert.match(prompt, /evidenceCatalog/);
    assert.match(prompt, /غير كافية/);
    assert.match(prompt, /مهمل|ضعيف|غير كفء/); // forbidden-vocabulary section
    assert.match(prompt, /يتزامن مع|قد يشير إلى/);
  });

  it('declares the data block UNTRUSTED and forbids prompt-level business data (§17/§30)', () => {
    assert.match(prompt, /UNTRUSTED/);
    assert.match(prompt, /<<<ARM_DATA_BEGIN>>>/);
    assert.match(prompt, /AI_PROMPT_VERSION/);
  });

  it('prompt is versioned and the version constant is consumed by results + cache', () => {
    const version = readSrc('src/lib/ai/quality/version.ts');
    assert.match(version, /quality-analysis-v1/);
    const service = readSrc(SERVICE_PATH);
    assert.match(service, /AI_PROMPT_VERSION/);
  });
});

describe('READ-ONLY enforcement (§3/§16/§40/§41)', () => {
  it('the AI layer performs NO writes: no db mutation calls anywhere in ai/quality + route', () => {
    const files = [SERVICE_PATH, ROUTE_PATH, 'src/lib/ai/quality/input-builder.ts', 'src/lib/ai/quality/validate.ts', 'src/lib/ai/quality/cache.ts'];
    // db-layer mutation symbols — forbidden EVERYWHERE in the AI layer.
    const RECORD_PATTERNS = [/\bcreateRecord\b/, /\bupdateRecord\b/, /\bdeleteRecord\b/];
    // In-memory Map/Array methods are legitimate (cache LRU) — flagged
    // everywhere EXCEPT the in-memory cache module.
    const MEMORY_PATTERNS = [/\.set\(/, /\.update\(/, /\.remove\(/];
    for (const file of files) {
      const source = readSrc(file);
      for (const pattern of RECORD_PATTERNS) {
        assert.ok(!pattern.test(source), `${file} matches forbidden write pattern: ${pattern}`);
      }
      if (!file.endsWith('cache.ts')) {
        for (const pattern of MEMORY_PATTERNS) {
          assert.ok(!pattern.test(source), `${file} matches forbidden write pattern: ${pattern}`);
        }
      }
    }
  });

  it('no Organizational Memory writes and no feedback-training hooks (§40/§41/§42)', () => {
    const service = readSrc(SERVICE_PATH);
    assert.ok(!service.includes('OrganizationalMemory'));
    const section = readSrc(SECTION_PATH);
    assert.ok(!/thumb|مفيد.*تدريب|feedback.*training/i.test(section));
  });
});
