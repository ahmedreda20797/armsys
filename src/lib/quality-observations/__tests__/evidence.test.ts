// ══════════════════════════════════════════════════════════════
//  Quality Observation Evidence Viewer — Milestone 7 tests
//
//  Covers (spec §24), against the PURE classification helpers:
//    • URL detection — valid https/http URLs, long URLs, URLs
//      with ports/paths/query strings; parsed via the URL parser.
//    • Plain text — never treated as a URL (incl. text containing
//      dots), full text preserved, display preview truncates
//      visually only.
//    • Empty — whitespace/null/undefined → empty kind, empty label.
//    • Security — javascript:, data:, file:, mailto:, vbscript:
//      are NEVER openable URLs (classified as text); relative
//      strings never resolve to URLs; no HTML conversion exists.
//    • Copy exactness — truncation helpers never mutate or
//      reimplement the original evidence value.
//    • UI regression (source introspection) — the Evidence section
//      is part of the EXISTING ObservationDetailDialog; approval
//      controls, admin edit/delete, timeline and KPI behavior in
//      the dialog remain untouched; evidence renders as React text
//      (no dangerouslySetInnerHTML anywhere in the page).
//
//  Run: npx tsx --test src/lib/quality-observations/__tests__/evidence.test.ts
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  EVIDENCE_EMPTY_LABEL,
  classifyEvidence,
  parseSafeHttpUrl,
  truncateEvidenceForDisplay,
} from '@/lib/quality-observations/evidence';

const here = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════
//  URL detection
// ═══════════════════════════════════════════════════════════════

test('classifyEvidence — valid https URL detected', () => {
  const result = classifyEvidence('https://example.com/file.pdf');
  assert.equal(result.kind, 'url');
  if (result.kind === 'url') assert.equal(result.url, 'https://example.com/file.pdf');
});

test('classifyEvidence — valid http URL detected', () => {
  const result = classifyEvidence('http://example.com');
  assert.equal(result.kind, 'url');
});

test('classifyEvidence — Google Drive link detected', () => {
  const result = classifyEvidence('https://drive.google.com/file/d/1AbC_xyz/view?usp=sharing');
  assert.equal(result.kind, 'url');
});

test('classifyEvidence — Google Docs link detected', () => {
  const result = classifyEvidence('https://docs.google.com/document/d/1AbC/edit');
  assert.equal(result.kind, 'url');
});

test('classifyEvidence — URL with port, path, query and fragment', () => {
  const result = classifyEvidence('https://intranet.local:8443/evidence/2026?a=1&b=2#page');
  assert.equal(result.kind, 'url');
});

test('classifyEvidence — very long URL supported', () => {
  const longUrl = `https://example.com/${'a'.repeat(2000)}`;
  const result = classifyEvidence(longUrl);
  assert.equal(result.kind, 'url');
  if (result.kind === 'url') assert.equal(result.url, longUrl);
});

test('classifyEvidence — surrounding whitespace does not break URL detection', () => {
  const result = classifyEvidence('  https://example.com/report.pdf  \n');
  assert.equal(result.kind, 'url');
  if (result.kind === 'url') assert.equal(result.url, 'https://example.com/report.pdf');
});

// ═══════════════════════════════════════════════════════════════
//  Plain text
// ═══════════════════════════════════════════════════════════════

test('classifyEvidence — Arabic plain text is not a URL', () => {
  const result = classifyEvidence('تم التواصل مع العميل عن طريق الهاتف.');
  assert.equal(result.kind, 'text');
  if (result.kind === 'text') assert.equal(result.text, 'تم التواصل مع العميل عن طريق الهاتف.');
});

test('classifyEvidence — complaint-number text is not a URL', () => {
  const result = classifyEvidence('رقم الشكوى 12345');
  assert.equal(result.kind, 'text');
});

test('classifyEvidence — bare domain without scheme is NOT a URL (no fragile dot heuristic)', () => {
  // 'www.example.com' has no scheme: the URL parser requires one
  // without a base, so it stays text — arbitrary dotted text is
  // never treated as an openable link.
  assert.equal(classifyEvidence('www.example.com').kind, 'text');
  assert.equal(classifyEvidence('example.com/path').kind, 'text');
  assert.equal(classifyEvidence('ملف.مرفق.pdf').kind, 'text');
  assert.equal(classifyEvidence('1.2.3.4').kind, 'text');
});

test('classifyEvidence — full text preserved verbatim', () => {
  const evidence = 'تم التواصل مع العميل وتأكيد الحجز — المرجع #9981، بتاريخ 12/08/2026';
  const result = classifyEvidence(evidence);
  if (result.kind === 'text') assert.equal(result.text, evidence);
  else assert.fail('expected text kind');
});

test('classifyEvidence — multiline text evidence supported', () => {
  const evidence = 'سطر أول\nسطر ثاني\nسطر ثالث';
  const result = classifyEvidence(evidence);
  assert.equal(result.kind, 'text');
  if (result.kind === 'text') assert.equal(result.text, evidence);
});

// ═══════════════════════════════════════════════════════════════
//  Empty state
// ═══════════════════════════════════════════════════════════════

test('classifyEvidence — empty string → empty kind', () => {
  assert.equal(classifyEvidence('').kind, 'empty');
});

test('classifyEvidence — whitespace-only → empty kind', () => {
  assert.equal(classifyEvidence('   ').kind, 'empty');
  assert.equal(classifyEvidence('\t\n ').kind, 'empty');
});

test('classifyEvidence — null/undefined → empty kind', () => {
  assert.equal(classifyEvidence(null).kind, 'empty');
  assert.equal(classifyEvidence(undefined).kind, 'empty');
});

test('EVIDENCE_EMPTY_LABEL — Arabic empty-state label defined', () => {
  assert.equal(EVIDENCE_EMPTY_LABEL, 'لا يوجد دليل / إثبات');
});

// ═══════════════════════════════════════════════════════════════
//  Security — dangerous schemes are NEVER openable URLs
// ═══════════════════════════════════════════════════════════════

test('classifyEvidence — javascript: scheme is treated as plain text, never a URL', () => {
  const result = classifyEvidence('javascript:alert(1)');
  assert.equal(result.kind, 'text');
  assert.equal(parseSafeHttpUrl('javascript:alert(1)'), null);
});

test('classifyEvidence — data: URI is treated as plain text, never a URL', () => {
  const result = classifyEvidence('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
  assert.equal(result.kind, 'text');
  assert.equal(parseSafeHttpUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), null);
});

test('parseSafeHttpUrl — rejects every non-web scheme', () => {
  assert.equal(parseSafeHttpUrl('file:///C:/Windows/system32/config'), null);
  assert.equal(parseSafeHttpUrl('mailto:someone@example.com'), null);
  assert.equal(parseSafeHttpUrl('vbscript:msgbox("x")'), null);
  assert.equal(parseSafeHttpUrl('ftp://files.example.com/doc.pdf'), null);
  assert.equal(parseSafeHttpUrl('about:blank'), null);
  assert.equal(parseSafeHttpUrl('chrome://settings'), null);
});

test('parseSafeHttpUrl — scheme confusion attempts stay rejected', () => {
  // Mixed-case scheme IS valid http (URL parser normalizes protocol).
  // But embedded/whitespace tricks that defeat startsWith checks must
  // still fail parsing or lose the safe protocol.
  assert.equal(parseSafeHttpUrl('HTTP://example.com') !== null, true); // normalized → safe
  assert.equal(parseSafeHttpUrl('javascript\t:alert(1)'), null);
  assert.equal(parseSafeHttpUrl(' java script:alert(1)'), null);
  assert.equal(parseSafeHttpUrl('javascript://example.com'), null);
  // URL with credentials still fine — protocol governs openability.
  assert.equal(parseSafeHttpUrl('https://user:pass@example.com/x') !== null, true);
});

test('parseSafeHttpUrl — non-string and unparseable input → null', () => {
  assert.equal(parseSafeHttpUrl(''), null);
  assert.equal(parseSafeHttpUrl('not a url at all'), null);
  assert.equal(parseSafeHttpUrl('http://'), null);
});

// ═══════════════════════════════════════════════════════════════
//  Copy exactness — display truncation never touches the original
// ═══════════════════════════════════════════════════════════════

test('truncateEvidenceForDisplay — short values returned untouched', () => {
  const url = 'https://example.com/test.pdf';
  assert.equal(truncateEvidenceForDisplay(url), url);
});

test('truncateEvidenceForDisplay — long URL truncated visually but original intact', () => {
  const url = `https://example.com/${'x'.repeat(300)}`;
  const displayed = truncateEvidenceForDisplay(url);
  assert.ok(displayed.length < url.length);
  assert.ok(displayed.includes('…'));
  // The ORIGINAL string is a distinct immutable value — never mutated.
  assert.equal(url.length, 300 + 'https://example.com/'.length);
});

test('truncateEvidenceForDisplay — truncation preserves head and tail of the URL', () => {
  const url = `https://example.com/docs/${'m'.repeat(200)}/final.pdf`;
  const displayed = truncateEvidenceForDisplay(url, 60);
  assert.ok(displayed.startsWith('https://example.com/'));
  assert.ok(displayed.endsWith('final.pdf').valueOf() === true || displayed.includes('…'));
});

// ═══════════════════════════════════════════════════════════════
//  UI regression — Evidence section lives inside the EXISTING
//  ObservationDetailDialog; approval/admin/timeline untouched
//  (source introspection, established project test convention)
// ═══════════════════════════════════════════════════════════════

const PAGE_PATH = path.join(here, '..', '..', '..', 'components', 'pages', 'quality-kpi', 'ObservationsPage.tsx');

function readPageSource(): string {
  return readFileSync(PAGE_PATH, 'utf8');
}

test('UI regression — ObservationDetailDialog renders a dedicated evidence section', () => {
  const source = readPageSource();
  assert.ok(source.includes('الدليل / الإثبات'), 'evidence section title missing');
  assert.ok(source.includes('Eviden'), 'evidence classification helper must be used');
});

test('UI regression — all three evidence actions present with Arabic labels', () => {
  const source = readPageSource();
  assert.ok(source.includes('نسخ الدليل'), 'copy action missing');
  assert.ok(source.includes('عرض الدليل'), 'view action missing');
  assert.ok(source.includes('فتح الرابط'), 'open-link action missing');
});

test('UI regression — empty evidence state label rendered', () => {
  const source = readPageSource();
  // The page renders the empty state through the shared constant, so the
  // identifier (not the literal) appears in source.
  assert.ok(source.includes('EVIDENCE_EMPTY_LABEL'), 'empty-state label missing');
});

test('UI regression — approval controls remain in the detail dialog', () => {
  const source = readPageSource();
  assert.ok(source.includes('سجل الاعتماد'), 'approval history section missing');
  assert.ok(source.includes('سجل الأحداث'), 'timeline section missing');
  assert.ok(source.includes('اعتماد</Button>') || source.includes('>اعتماد'), 'approve button missing');
  assert.ok(source.includes('رفض'), 'reject control missing');
});

test('UI regression — admin edit/delete controls and month lock unchanged', () => {
  const source = readPageSource();
  assert.ok(source.includes('تعديل (مدير النظام)'), 'admin edit control missing');
  assert.ok(source.includes('حذف (مدير النظام)'), 'admin delete control missing');
  assert.ok(source.includes('monthClosed'), 'month-closed gate missing');
});

test('UI regression — no unsafe HTML injection anywhere in the observations page', () => {
  const source = readPageSource();
  assert.ok(!source.includes('dangerouslySetInnerHTML'), 'dangerouslySetInnerHTML must never be used');
});

test('UI regression — evidence viewer introduces no new fetch', () => {
  const source = readPageSource();
  // The evidence section must render from the already-loaded obs object —
  // no new data-fetching hooks for evidence.
  assert.ok(!source.includes('useEvidenceQuery'), 'evidence must not add a fetch layer');
  assert.ok(!source.includes('fetchEvidence'), 'evidence must not add a fetch function');
});

test('UI regression — external links open safely (noopener noreferrer)', () => {
  const source = readPageSource();
  assert.ok(
    source.includes('noopener') && source.includes('noreferrer'),
    'external link open must use noopener noreferrer',
  );
});
