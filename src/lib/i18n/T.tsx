'use client';

// src/lib/i18n/T.tsx
// ══════════════════════════════════════════════════════════════
//  §I18N-BOUNDARY — the source-level claim that a string is
//  application-owned UI.
//
//  <T>إجمالي الموظفين</T>
//
//  renders the translated string for the active locale (re-rendering
//  on language switch) and returns a bare text node — no wrapper
//  element, zero layout impact, RTL/LTR-neutral.
//
//  CONTRACT: the child must be a STATIC UI string authored by the
//  application (a label, title, button text, status caption…). Never
//  pass employee/customer names, notes, observations, descriptions,
//  IDs or any value that originates from stored business data — those
//  must be rendered directly ({employee.name}) with NO claim wrapper.
//  See ./ui-text.ts for the canonical boundary contract.
//
//  Composed UI («الفترة: 2026-09»): claim only the static fragment and
//  interpolate the dynamic value as a sibling —
//      <><T>الفترة: </T>{period}</>
//  Numbers/dates meant for display should go through the centralized
//  locale formatters in ./format instead of being embedded in strings.
// ══════════════════════════════════════════════════════════════

import React from 'react';
import { useLanguage } from './language-context';
import { translateUIText } from './ui-text';

export function T({ children }: { children: string }): string {
  const { locale } = useLanguage();
  return translateUIText(children, locale);
}
