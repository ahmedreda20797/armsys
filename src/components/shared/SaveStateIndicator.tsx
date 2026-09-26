'use client';

// ══════════════════════════════════════════════════════════════
//  SaveStateIndicator — the ONE honest save-state control
//  (§UX-STRUCTURE PART 12D / PART 16).
//
//  States:
//    saved      — persistence CONFIRMED by the server response.
//    saving     — request in flight; controls should stay disabled.
//    unsaved    — local edits not yet persisted.
//    idle       — nothing to communicate (renders nothing).
//    error      — persistence FAILED (never show a success toast).
//
//  "تم الحفظ" must only ever be shown AFTER the server confirmed
//  the write (12A.9). No fake success messages.
// ══════════════════════════════════════════════════════════════

import { Check, Loader2, TriangleAlert, PencilLine } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SaveState = 'idle' | 'saving' | 'saved' | 'unsaved' | 'error';

const STATE_META: Record<Exclude<SaveState, 'idle'>, { icon: React.ReactNode; text: string; className: string }> = {
  saving: {
    icon: <Loader2 className="size-3 animate-spin" aria-hidden="true" />,
    text: 'جارٍ الحفظ…',
    className: 'text-slate-400',
  },
  saved: {
    icon: <Check className="size-3" aria-hidden="true" />,
    text: 'تم الحفظ',
    className: 'text-emerald-400',
  },
  unsaved: {
    icon: <PencilLine className="size-3" aria-hidden="true" />,
    text: 'تغييرات غير محفوظة',
    className: 'text-amber-400',
  },
  error: {
    icon: <TriangleAlert className="size-3" aria-hidden="true" />,
    text: 'تعذر الحفظ',
    className: 'text-rose-400',
  },
};

export function SaveStateIndicator({
  state,
  savedText,
  savingText,
  unsavedText,
  errorText,
  className,
}: {
  state: SaveState;
  /** Override the Arabic defaults (e.g. English UI). */
  savedText?: string;
  savingText?: string;
  unsavedText?: string;
  errorText?: string;
  className?: string;
}) {
  if (state === 'idle') return null;
  const meta = STATE_META[state];
  const text =
    state === 'saving' ? (savingText ?? meta.text)
    : state === 'saved' ? (savedText ?? meta.text)
    : state === 'unsaved' ? (unsavedText ?? meta.text)
    : (errorText ?? meta.text);
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', meta.className, className)}
    >
      {meta.icon}
      {text}
    </span>
  );
}
