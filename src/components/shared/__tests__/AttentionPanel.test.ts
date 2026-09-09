// ══════════════════════════════════════════════════════════════
//  AttentionPanel — regression test (one component, every page)
//
//  The contract: any page that needs "alerts / overdue / due today /
//  needs action" renders <AttentionPanel items={…} /> — the SAME
//  compact-row design, the SAME severity scale, the SAME
//  collapse/expand behavior. If this test breaks, somebody added a
//  second design and the §X audit must reconcile it back to this
//  single component.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSeverityMeta, type AttentionSeverity } from '../AttentionPanel';

describe('AttentionPanel — severity taxonomy (§5)', () => {
  it('every severity has Arabic label + icon + non-color marker', () => {
    const severities: AttentionSeverity[] = ['critical', 'urgent', 'warning', 'info'];
    for (const sev of severities) {
      const meta = getSeverityMeta(sev);
      assert.ok(meta.short.length > 0, `${sev} must have a non-empty Arabic short label`);
      assert.ok(meta.heading.length > 0, `${sev} must have a non-empty Arabic heading`);
      assert.ok(meta.aria.length > 0, `${sev} must expose an aria value`);
      assert.ok(meta.badgeClass.length > 0, `${sev} must have a badge class`);
      assert.ok(meta.iconClass.length > 0, `${sev} must have a color class`);
      assert.ok(meta.rowClass.length > 0, `${sev} must have a row class`);
    }
  });

  it('short labels are distinct (no two severities share the same badge text)', () => {
    const severities: AttentionSeverity[] = ['critical', 'urgent', 'warning', 'info'];
    const shorts = severities.map((s) => getSeverityMeta(s).short);
    assert.equal(new Set(shorts).size, shorts.length, 'short labels must be unique');
  });

  it('icons are React component references (not undefined)', () => {
    const severities: AttentionSeverity[] = ['critical', 'urgent', 'warning', 'info'];
    for (const sev of severities) {
      const meta = getSeverityMeta(sev);
      // lucide-react components render as forwardRef objects — they
      // are not undefined or null. (typeof 'object' is what forwardRef
      // returns at module evaluation time.)
      assert.equal(typeof meta.icon, 'object', `${sev} must export an icon component`);
      assert.notEqual(meta.icon, null, `${sev} must export an icon component`);
    }
  });
});

// ══════════════════════════════════════════════════════════════
//  §10 GLOBAL ALERT CONTRACT — static source contracts
//
//  Pins the two behaviors the audit demanded:
//    1. COLLAPSED BY DEFAULT — with a persistKey and no stored
//       preference, `collapsedPref === undefined → collapsed`
//       (the old `Boolean(undefined)` bug forced every panel open).
//    2. GLOW INDICATOR — a collapsed panel with active items shows
//       an external glow for EVERY severity tier, not only critical.
// ══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(import.meta.dirname, '..', 'AttentionPanel.tsx'), 'utf8');

describe('AttentionPanel — §10 default-collapsed + glow (static contracts)', () => {
  it('no stored preference → COLLAPSED (undefined collapses, never expands)', () => {
    assert.match(
      SOURCE,
      /collapsedPref === undefined\s*\n\s*\?\s*true/,
      'the persistKey branch must treat an absent preference as collapsed',
    );
    // The old bug: `Boolean(collapsedPref)` alone (undefined → expanded).
    assert.doesNotMatch(
      SOURCE,
      /\? Boolean\(collapsedPref\)\s*\n\s*:/,
      'the old Boolean(collapsedPref) default-expanded logic must stay removed',
    );
  });

  it('glow indicator exists for every severity tier while collapsed', () => {
    for (const token of [
      'shadow-[0_0_0_1px_rgba(244,63,94',   // critical → rose glow
      'shadow-[0_0_0_1px_rgba(249,115,22',  // urgent   → orange glow
      'shadow-[0_0_0_1px_rgba(245,158,11',  // warning  → amber glow
      'shadow-[0_0_0_1px_rgba(34,211,238',  // info     → cyan glow
    ]) {
      assert.ok(SOURCE.includes(token), `missing collapsed-state glow for token ${token}`);
    }
  });

  it('still re-exports getSeverityMeta consumers depend on', () => {
    assert.match(SOURCE, /export function getSeverityMeta/);
  });
});
