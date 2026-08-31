// ══════════════════════════════════════════════════════════════
//  Phase 5.3 — Evidence navigation tests (spec §22-§32, §37)
//
//  The root cause proven by these contracts (spec §25): the Phase 5.2
//  receiver hook probed the DOM ONCE at a fixed 250ms delay — before
//  any target page's async data had rendered — and DESTROYED the
//  highlight intent on a miss. The Phase 5.3 receiver polls until the
//  record element exists (bounded), and target pages make the record
//  reachable (month seeding, auto-expand).
//
//  The project has no DOM test harness (no jsdom), so target-page
//  contracts are asserted as SOURCE CONTRACTS on the real files —
//  the same convention the Phase 4/5.2 suites use — while every
//  pure decision (navigation intents, summaries, month derivation)
//  is tested behaviorally.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildEvidenceNavigation,
} from '@/lib/evidence/evidence-navigation';
import {
  evidenceRecordMonth,
} from '@/lib/evidence/record-projection';
import {
  buildEvidenceSummary,
  EVIDENCE_FORBIDDEN_MESSAGE,
} from '@/lib/evidence/evidence-summaries';
import { EVIDENCE_COLLECTIONS } from '@/lib/evidence/evidence-collections';

const ROOT = join(process.cwd(), 'src');
function srcOf(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('Phase 5.3 §37 (1-3) — preview record, id, summary', () => {
  it('1. the preview loads the canonical record (route reads the table by id)', () => {
    const route = srcOf('app/api/evidence/preview/route.ts');
    assert.match(route, /getById<Record<string, unknown>>\(table, recordId\)/);
    // projection comes from the canonical record, never a copy
    assert.match(route, /projectEvidenceRecord\(collection, raw\)/);
  });

  it('2. the navigation payload carries the exact record ID', () => {
    const intent = buildEvidenceNavigation('qualityObservations', 'hmet9c32q38nwcy4i655j48k');
    assert.equal(intent.highlightId, 'hmet9c32q38nwcy4i655j48k');
    assert.equal(intent.exact, true);
    const page = srcOf('components/pages/quality-kpi/smart-report/SmartQualityReportPage.tsx');
    assert.match(page, /navigateTo\(intent\.page, intent\.highlightId \?\? undefined, navParams\)/);
  });

  it('3. the summary is human-readable; the raw id stays secondary', () => {
    const summary = buildEvidenceSummary(
      'ملاحظة جودة',
      'obs-raw-id',
      {
        title: 'ملاحظة جودة',
        fields: [
          { label: 'التاريخ', value: '15/07/2026' },
          { label: 'النوع', value: 'تأخير' },
          { label: 'الحالة', value: 'معتمدة' },
        ],
        meta: { month: '2026-07' },
      },
      'granted',
    );
    assert.equal(summary.metaLines[0], '15/07/2026');
    assert.equal(summary.rawId, 'obs-raw-id'); // secondary technical slot
    assert.ok(!summary.metaLines.includes('obs-raw-id'));
    // meta.month never leaks into the primary display lines
    assert.ok(!summary.metaLines.includes('2026-07'));
  });
});

describe('Phase 5.3 §37 (4-5) — navigation payload reaches the target page', () => {
  it('4. month-filtered targets receive the record month in navParams', () => {
    const page = srcOf('components/pages/quality-kpi/smart-report/SmartQualityReportPage.tsx');
    // the record month (server-derived meta.month) is forwarded
    assert.match(page, /evidencePreview\?\.projected\?\.meta\?\.month/);
    assert.match(page, /\{\s*\.\.\.intent\.navParams, month: recordMonth\s*\}/);
  });

  it('5. the target page consumes the highlight id (store receiver)', () => {
    const hook = srcOf('hooks/use-record-highlight.ts');
    assert.match(hook, /useAppStore\(\(s\) => s\.highlightId\)/);
    // and pages opt in
    for (const f of [
      'components/pages/quality-kpi/ObservationsPage.tsx',
      'components/pages/ComplaintsPage.tsx',
      'components/pages/FollowUpsPage.tsx',
      'components/pages/TravelPage.tsx',
    ]) {
      assert.match(srcOf(f), /useRecordHighlight\(/, f);
    }
  });
});

describe('Phase 5.3 §37 (6-10) — locate, open, scroll, highlight, clear', () => {
  it('6. the receiver WAITS for the record: polls instead of a one-shot probe', () => {
    const hook = srcOf('hooks/use-record-highlight.ts');
    assert.match(hook, /POLL_INTERVAL_MS/);
    assert.match(hook, /LOCATE_TIMEOUT_MS/);
    // the Phase 5.2 root cause — destroy-on-first-miss — is gone
    assert.doesNotMatch(hook, /LOCATE_DELAY_MS/);
    assert.match(hook, /setTimeout\(attempt, POLL_INTERVAL_MS\)/);
    // bounded give-up, quiet (never hangs, never fabricates)
    assert.match(hook, /Date\.now\(\) < deadline/);
    // ready gate keeps the intent while data is loading
    assert.match(hook, /options\?\.ready !== false/);
  });

  it('7. exact records OPEN: travel auto-expand, follow-ups group expand, CAPA detail', () => {
    // Travel: card auto-expands once the data arrives
    const travel = srcOf('components/pages/TravelPage.tsx');
    assert.match(travel, /setExpandedCardId\(highlightId\)/);
    assert.match(travel, /trips\.some\(\(t\) => t\.id === highlightId\)/);
    // Follow-ups: the owning employee group auto-expands (cards view)
    const followUps = srcOf('components/pages/FollowUpsPage.tsx');
    assert.match(followUps, /collapsedEmployees/);
    assert.match(followUps, /followUps\.find\(\(item\) => item\.id === highlightId\)/);
    // CAPA: detail mode is driven by navParams.id (detailParam strategy)
    const capa = srcOf('components/pages/CAPAPage.tsx');
    assert.match(capa, /navParams/);
  });

  it('8. the located record scrolls into view', () => {
    const hook = srcOf('hooks/use-record-highlight.ts');
    assert.match(hook, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  });

  it('9. the located record gets the temporary highlight class', () => {
    const hook = srcOf('hooks/use-record-highlight.ts');
    assert.match(hook, /classList\.add\('evidence-highlight'\)/);
    const css = srcOf('app/globals.css');
    assert.match(css, /\.evidence-highlight/);
  });

  it('10. the highlight CLEARS: class removed and intent cleared after a few seconds', () => {
    const hook = srcOf('hooks/use-record-highlight.ts');
    assert.match(hook, /HIGHLIGHT_VISIBLE_MS/);
    assert.match(hook, /classList\.remove\('evidence-highlight'\)/);
    assert.match(hook, /setHighlightId\(null\)/);
    // and the cleanup runs on unmount/id change too
    assert.match(hook, /cancelled = true/);
  });
});

describe('Phase 5.3 §37 (11-13) — wrong id, unauthorized, honest fallback', () => {
  it('11. a wrong ID can never open another record (exact attribute match)', () => {
    const hook = srcOf('hooks/use-record-highlight.ts');
    assert.match(hook, /\[data-record-id="\$\{CSS\.escape\(recordId\)\}"\]/);
  });

  it('12. unauthorized source: no contents, no navigation button', () => {
    // Route: forbidden carries NO record contents (existing doctrine)
    const route = srcOf('app/api/evidence/preview/route.ts');
    assert.match(route, /EVIDENCE_FORBIDDEN_MESSAGE/);
    assert.match(route, /access: 'forbidden' as const/);
    // Modal: navigation buttons render only for granted access (§32)
    const modal = srcOf('components/pages/quality-kpi/smart-report/EvidencePreviewModal.tsx');
    assert.match(modal, /access === 'granted'/);
    assert.match(modal, /EVIDENCE_FORBIDDEN_MESSAGE/);
  });

  it('13. unsupported exact navigation falls back HONESTLY (labeled page navigation)', () => {
    for (const collection of ['qualityDeductions', 'attendanceResults', 'monthSnapshots', 'kpiSchemes'] as const) {
      const intent = buildEvidenceNavigation(collection, 'whatever');
      assert.equal(intent.exact, false);
      assert.equal(intent.highlightId, null);
      assert.equal(intent.page, EVIDENCE_COLLECTIONS[collection].page);
    }
    const modal = srcOf('components/pages/quality-kpi/smart-report/EvidencePreviewModal.tsx');
    // the honest label exists and the old pretense is gone
    assert.match(modal, /الانتقال إلى الصفحة/);
    assert.doesNotMatch(modal, /الانتقال إلى المصدر/);
  });
});

describe('Phase 5.3 — target pages make the record REACHABLE (spec §27)', () => {
  it('Quality Notes: month filter is seeded from the evidence nav month', () => {
    const obs = srcOf('components/pages/quality-kpi/ObservationsPage.tsx');
    assert.match(obs, /navMonth \?\? CURRENT_MONTH/);
    // the record cards carry the receiver attribute
    assert.match(obs, /data-record-id=\{obs\.id\}/);
  });

  it('Travel: month filter seeded + record-id rendered on the card', () => {
    const travel = srcOf('components/pages/TravelPage.tsx');
    assert.match(travel, /const \[filterMonth, setFilterMonth\] = useState<string>\(navMonth \?\? 'all'\)/);
    assert.match(travel, /data-record-id=\{trip\.id\}/);
  });

  it('Complaints and Follow-ups render receiver attributes on records', () => {
    const complaints = srcOf('components/pages/ComplaintsPage.tsx');
    assert.match(complaints, /data-record-id=\{complaint\.id\}/);
    const followUps = srcOf('components/pages/FollowUpsPage.tsx');
    assert.match(followUps, /data-record-id=\{item\.id\}/);
  });

  it('preview responses carry the record month metadata (server-derived)', () => {
    const route = srcOf('app/api/evidence/preview/route.ts');
    assert.match(route, /evidenceRecordMonth\(collection, raw\)/);
    assert.match(route, /meta: \{ month \}/);
  });

  it('evidenceRecordMonth derives the month strictly from the stored date', () => {
    assert.equal(
      evidenceRecordMonth('qualityObservations', { observationDate: '15/07/2026' }),
      '2026-07',
    );
    assert.equal(
      evidenceRecordMonth('travelDeals', { departureDate: '02/01/2026' }),
      '2026-01',
    );
    // collections without month-filtered targets → null
    assert.equal(evidenceRecordMonth('complaints', { createdAt: '2026-07-15T00:00:00Z' }), null);
    // malformed/unparseable → null (never guesses)
    assert.equal(evidenceRecordMonth('qualityObservations', { observationDate: '2026-07-15' }), null);
    assert.equal(evidenceRecordMonth('qualityObservations', { observationDate: '32/13/2026' }), null);
    assert.equal(evidenceRecordMonth('qualityObservations', {}), null);
  });
});
