// ══════════════════════════════════════════════════════════════
//  §10 GLOBAL ALERT CONTRACT — `ui` flags namespace regression
//
//  Guards the ROOT-CAUSE FIX for "alert cards look permanently
//  expanded": the unified AttentionPanel stores its collapsed state
//  under userPreferences.ui.<persistKey>. That namespace used to be
//  silently stripped by the PUT sanitizer, so collapse state never
//  survived a refetch. These tests pin the whitelist behavior:
//    • boolean-only values accepted
//    • non-boolean values dropped (never crash)
//    • key cap enforced (no unbounded growth)
//    • absent/invalid ui body → ui omitted (not null)
//
//  Run: npx tsx --test src/lib/personalization/__tests__/ui-flags.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeUserPreferencesInput,
  UI_PREFS_MAX_KEYS,
} from '@/lib/personalization';

describe('§10 ui flags namespace (alert collapse persistence)', () => {
  it('accepts boolean ui flags (AttentionPanel persistKey values)', () => {
    const out = sanitizeUserPreferencesInput({
      ui: { riskAttention: true, travelUrgentAttention: false },
    });
    assert.ok(out, 'sanitized output must not be null');
    assert.deepEqual(out.ui, { riskAttention: true, travelUrgentAttention: false });
  });

  it('drops non-boolean values instead of crashing', () => {
    const out = sanitizeUserPreferencesInput({
      ui: { riskAttention: true, evil: 'drop-me', nested: { x: 1 }, arr: [1] },
    });
    assert.ok(out);
    assert.deepEqual(out.ui, { riskAttention: true });
  });

  it('rejects invalid keys (empty / overlong) but keeps valid ones', () => {
    const out = sanitizeUserPreferencesInput({
      ui: { '': true, ['k'.repeat(65)]: true, validKey: true },
    });
    assert.ok(out);
    assert.deepEqual(out.ui, { validKey: true });
  });

  it(`caps accepted keys at UI_PREFS_MAX_KEYS (${UI_PREFS_MAX_KEYS})`, () => {
    const flags: Record<string, boolean> = {};
    for (let i = 0; i < UI_PREFS_MAX_KEYS + 10; i++) flags[`flag${i}`] = true;
    const out = sanitizeUserPreferencesInput({ ui: flags });
    assert.ok(out?.ui);
    assert.equal(Object.keys(out.ui!).length, UI_PREFS_MAX_KEYS);
  });

  it('invalid ui body → ui omitted, request still valid (no 400)', () => {
    const out = sanitizeUserPreferencesInput({ ui: ['not', 'an', 'object'] });
    assert.ok(out);
    assert.equal(out.ui, undefined);
  });

  it('body without any whitelisted field still returns an object (merge-safe)', () => {
    // The PUT route merges over the existing record; an empty sanitize
    // result (e.g. only an unknown key) must not be null → 400.
    const out = sanitizeUserPreferencesInput({ unknown: 1 });
    assert.deepEqual(out, {});
  });
});
