'use client';

// src/lib/i18n/language-context.tsx
// ══════════════════════════════════════════════════════════════
//  §20.1 Language context — fast, persistent, RTL/LTR-aware
//  switching (Arabic ⇄ English).
//
//  • `dir` + `lang` are applied to <html> on change (the Radix
//    DirectionProvider follows document direction via its own wiring;
//    Tailwind logical properties handle the rest).
//  • Choice persists in localStorage AND (opportunistically) in the
//    per-user preferences API payload — a fresh browser restores the
//    language as soon as the preference loads.
//  • `t(key)` is a plain function — zero re-render cost for callers
//    that don't change locale mid-session (the app re-renders once on
//    switch through the context value change).
// ══════════════════════════════════════════════════════════════

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translate, type Locale, type TranslationKey } from './dictionary';
import { setRuntimeLocale } from './runtime-translator';
import { setDisplayLocale } from './format';

const LANGUAGE_STORAGE_KEY = 'qnlys:language';

interface LanguageContextValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: 'ar',
  dir: 'rtl',
  setLocale: () => {},
  t: (key) => translate(key, 'ar'),
});

function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return raw === 'ar' || raw === 'en' ? raw : null;
  } catch {
    return null;
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // SSR/first paint: Arabic (the app's origin direction) — the stored
  // choice applies immediately after mount, before content settles.
  const [locale, setLocaleState] = useState<Locale>('ar');

  useEffect(() => {
    // One-time hydration of the stored locale — state must flip after
    // SSR completes; localStorage is unavailable during server render,
    // so there is no render-safe alternative for this mount-only sync.
    const stored = readStoredLocale();
    if (stored && stored !== 'ar') {
      setDisplayLocale(stored);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical one-time hydration guard
      setLocaleState(stored);
    }
  }, []);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', locale);
  }, [dir, locale]);

  // §20.1-RUNTIME — LEGACY zone-scoped EN coverage: the runtime layer
  // translates ONLY subtrees explicitly claimed as application-owned UI
  // (data-i18n="true") — it can never reach user/business data, which is
  // rendered raw outside claimed zones. The PRIMARY mechanism is explicit
  // source-level claims: t() keys and <T>/translateUIText (§I18N-BOUNDARY).
  // Inert in 'ar' (restore + no observer).
  // §20.1-FORMAT — the module-current display locale is synced in the
  // SAME effect so shared formatters (numbers/dates) follow the locale
  // even in non-React modules (print adapters, lib helpers).
  useEffect(() => {
    setDisplayLocale(locale);
    setRuntimeLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    // Sync the display locale FIRST so any render flushed by this state
    // change already formats with the new locale (numbers/dates).
    setDisplayLocale(next);
    setLocaleState(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // storage blocked — session-only language
    }
  }, []);

  const t = useCallback((key: TranslationKey) => translate(key, locale), [locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, dir, setLocale, t }),
    [locale, dir, setLocale, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
