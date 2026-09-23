'use client';

// ══════════════════════════════════════════════════════════════
//  GlobalRecordHighlight — the ONE declarative Qnalys highlight
//  component (companion to the useRecordHighlight() receiver).
//
//  Two paths, ONE visual language and lifecycle (§QNALYS-HIGHLIGHT
//  in globals.css — crimson/burgundy on charcoal, layered surface
//  tint + accent border + controlled pulse, RTL/LTR-neutral):
//    • Hook path  — pages mark records with `data-record-id` and
//      call useRecordHighlight(); the resolved element receives
//      the `data-qn-highlight` attribute (React never manages it,
//      so re-renders cannot wipe the highlight mid-window).
//    • Declarative path (this component) — pages render
//      <GlobalRecordHighlight recordId={record.id} variant="row">
//      and the active state is REAL React state (precise store
//      selector: only the targeted record re-renders).
//
//  Targeting is ALWAYS the canonical record identity — never a
//  display name, row index or label:
//
//    interface QnalysHighlightTarget {
//      entityType: 'employee' | 'deal' | 'observation' | …;
//      recordId: string;        // the canonical id (EMP-040, …)
//      fieldId?: string;        // optional field-level targeting
//      sectionId?: string;      // optional section targeting
//      source?: string;         // 'global-search' | 'dashboard' | …
//    }
//
//  No text, tooltips or labels are rendered by this component, so
//  there is nothing to localize — and nothing that could mirror or
//  break RTL. Layout is untouched: the highlight is purely
//  visual (tint / border / glow / pseudo-elements).
// ══════════════════════════════════════════════════════════════

import React from 'react';
import { useAppStore } from '@/lib/store';
import type { QnalysHighlightVariant } from '@/hooks/use-record-highlight';

/** The canonical navigation-highlight target contract. */
export interface QnalysHighlightTarget {
  /** What kind of record is being targeted (semantic, for callers). */
  entityType: string;
  /** The CANONICAL record id — the only trusted targeting mechanism. */
  recordId: string;
  /** Optional field-level target (resolves [data-record-field]). */
  fieldId?: string;
  /** Optional section target (resolves [data-record-section]). */
  sectionId?: string;
  /** Where the navigation came from (telemetry/debug only, never rendered). */
  source?: 'global-search' | 'dashboard' | 'report' | 'employee-360'
    | 'operations' | 'quality' | 'hr' | 'travel' | 'evidence' | string;
}

const ALLOWED_TAGS = new Set(['div', 'tr', 'li', 'section', 'article', 'span', 'td', 'dl']);

export interface GlobalRecordHighlightProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render — must fit the page's markup (tr for table rows). */
  as?: 'div' | 'tr' | 'li' | 'section' | 'article' | 'span' | 'td' | 'dl';
  /** The CANONICAL record id (record.id) — never a display name. */
  recordId: string;
  /** Optional field target, mirrored to [data-record-field]. */
  fieldId?: string;
  /** Optional section target, mirrored to [data-record-section]. */
  sectionId?: string;
  /** Visual shape — same lifecycle/tokens as every other variant. */
  variant?: QnalysHighlightVariant;
  children?: React.ReactNode;
}

export function GlobalRecordHighlight({
  as = 'div',
  recordId,
  fieldId,
  sectionId,
  variant = 'record',
  className,
  children,
  ...rest
}: GlobalRecordHighlightProps) {
  // Precise selector — this component re-renders only when the global
  // navigation highlight IS this record (or leaves it).
  const isActive = useAppStore((s) => (s.highlightId === recordId ? s.highlightId : null));

  const tag = ALLOWED_TAGS.has(as) ? as : 'div';
  const classes = [
    className,
    isActive ? 'qn-highlight' : null,
    isActive ? `qn-highlight--${variant}` : null,
  ].filter(Boolean).join(' ');

  return React.createElement(
    tag,
    {
      className: classes || undefined,
      'data-record-id': recordId,
      ...(fieldId ? { 'data-record-field': fieldId } : {}),
      ...(sectionId ? { 'data-record-section': sectionId } : {}),
      ...(isActive ? { 'data-qn-highlight': variant } : {}),
      ...rest,
    },
    children,
  );
}

export default GlobalRecordHighlight;
