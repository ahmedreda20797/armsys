// ══════════════════════════════════════════════════════════════
//  ApprovalHistoryTimeline layout contract — Phase 1 hardening
//  (Objective B)
//
//  The Observation Detail dialog timeline must render each event as
//  dot → flexible horizontal connector → content using flex layout
//  primitives. This is a source-contract guard (the project has no
//  DOM test infrastructure): it locks the responsive requirements —
//  no absolute-positioned separators, no fixed pixel widths, flex-1
//  connector, min-w-0 overflow protection, RTL preserved.
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPONENT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
  'src', 'components', 'shared', 'approval', 'ApprovalHistoryTimeline.tsx',
);

const source = readFileSync(COMPONENT_PATH, 'utf-8');

test('connector uses flexible layout primitives (flex-1), not fixed widths', () => {
  // The connector line must stretch via flex, not a hardcoded width.
  assert.match(source, /h-px[^"]*flex-1|flex-1[^"]*h-px/,
    'a horizontal (h-px) connector with flex-1 must exist');
  assert.match(source, /min-w-0/, 'min-w-0 guards against flex overflow');
  assert.match(source, /flex-1/, 'flex-1 present');
});

test('no fixed pixel widths or offset-origin separators remain', () => {
  // The old broken separators used hardcoded start offsets (start-27 /
  // start-35 = 108px / 140px from the inline-start edge).
  assert.ok(!source.includes('start-27'), 'no start-27 hardcoded offset');
  assert.ok(!source.includes('start-35'), 'no start-35 hardcoded offset');
  // No arbitrary-value pixel widths (e.g. w-[400px]) and no inline width styles.
  assert.ok(!/w-\[\d+px\]/.test(source), 'no arbitrary pixel width utilities');
  assert.ok(!/width:\s*\d/.test(source), 'no inline numeric width styles');
  // No absolute-positioned horizontal separators.
  assert.ok(!/absolute[^"]*h-px|h-px[^"]*absolute/.test(source),
    'no absolutely-positioned horizontal separator lines');
});

test('event dot and content sit in a flex row (aligned, shrink-protected)', () => {
  assert.match(source, /flex items-start gap/, 'per-event flex row layout');
  assert.match(source, /size-2\.5 shrink-0/, 'dot is a fixed-size, never-shrinking marker');
  assert.match(source, /shrink-0[^"]*text-sm/, 'event label does not shrink under the connector');
});

test('RTL direction and logical ordering preserved', () => {
  assert.match(source, /dir="rtl"/, 'component keeps RTL direction');
  assert.match(source, /break-words/, 'long notes wrap instead of overflowing the dialog');
  // Event order still derives from the append-only events (newest-first sort kept).
  assert.match(source, /sort\(/, 'defensive newest-first sort retained');
});
