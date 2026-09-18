// ══════════════════════════════════════════════════════════════
//  §20.1 i18n dictionary contract — every key must carry BOTH a
//  non-empty Arabic and a non-empty English value (no untranslated
//  half-dictionary), and the translate() fallback must never render
//  a raw key when Arabic exists.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DICTIONARY, translate, type Locale } from '@/lib/i18n/dictionary';

describe('§20.1 translation dictionary coverage', () => {
  it('every key has non-empty ar AND en values', () => {
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      assert.ok(typeof entry.ar === 'string' && entry.ar.trim().length > 0, `${key}.ar missing/empty`);
      assert.ok(typeof entry.en === 'string' && entry.en.trim().length > 0, `${key}.en missing/empty`);
    }
  });

  it('covers the core shell namespaces (nav, login, settings, actions, states)', () => {
    const keys = Object.keys(DICTIONARY);
    for (const prefix of ['nav.', 'login.', 'settings.', 'action.', 'state.', 'sidebar.']) {
      assert.ok(keys.some((k) => k.startsWith(prefix)), `namespace ${prefix} has no keys`);
    }
  });

  it('translate() resolves both locales and falls back to Arabic for an unknown locale', () => {
    assert.equal(translate('action.save', 'ar'), 'حفظ');
    assert.equal(translate('action.save', 'en'), 'Save');
    assert.equal(translate('action.save', 'fr' as Locale), 'حفظ');
  });

  it('translate() returns the raw key only when the key itself is unknown', () => {
    assert.equal(translate('nonexistent.key' as never, 'en'), 'nonexistent.key');
  });
});
