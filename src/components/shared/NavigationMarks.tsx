'use client';

// ══════════════════════════════════════════════════════════════
//  Navigation marks — ⭐ Favorite / 📌 Pin (Milestone 7 §22/§23)
//
//  ONE shared UI action pair over the personalization architecture:
//    • FavoriteToggle — "important to me" bookmark.
//    • PinToggle      — persistent quick access entry.
//  Both render an active state from the CURRENT user's saved
//  entries, persist through the existing user-preferences record,
//  and are permission-safe at read (an entry whose route is no
//  longer visible never renders — reconcileNavigationEntries).
// ══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { Star, Pin as PinIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useUserPreferences, useToggleFavoriteEntry, useTogglePinEntry } from '@/hooks/use-user-preferences';
import { navigationEntriesEqual, type NavigationDescriptor } from '@/lib/personalization';

/** Active-state pair for ⭐/📌 — consumed by overflow menus (§6). */
export function useMarkState(descriptor: NavigationDescriptor) {
  const { data: preferences } = useUserPreferences();
  const favoriteActive = useMemo(
    () => (preferences?.favorites ?? []).some((e) => navigationEntriesEqual(e, descriptor)),
    [preferences, descriptor.route, descriptor.targetType, descriptor.targetId],
  );
  const pinActive = useMemo(
    () => (preferences?.pins ?? []).some((e) => navigationEntriesEqual(e, descriptor)),
    [preferences, descriptor.route, descriptor.targetType, descriptor.targetId],
  );
  return { favoriteActive, pinActive };
}

/** Persist a favorite toggle from OUTSIDE the FavoriteToggle button (menus). */
export function useFavoriteToggleAction() {
  const toggle = useToggleFavoriteEntry();
  return async (descriptor: NavigationDescriptor) => {
    try {
      const added = await toggle.mutateAsync(descriptor);
      toast.success(added ? 'أُضيف إلى المفضلة ⭐' : 'أُزيل من المفضلة');
    } catch {
      toast.error('تعذر تحديث المفضلة');
    }
  };
}

/** Persist a pin toggle from OUTSIDE the PinToggle button (menus). */
export function usePinToggleAction() {
  const toggle = useTogglePinEntry();
  return async (descriptor: NavigationDescriptor) => {
    try {
      const added = await toggle.mutateAsync(descriptor);
      toast.success(added ? 'تم التثبيت 📌' : 'أُزيل التثبيت');
    } catch {
      toast.error('تعذر تحديث التثبيت');
    }
  };
}

interface MarkButtonProps {
  descriptor: NavigationDescriptor;
  /** Compact icon-only rendering for table rows/cards. */
  size?: 'sm' | 'md';
}

export function FavoriteToggle({ descriptor, size = 'md' }: MarkButtonProps) {
  const { data: preferences } = useUserPreferences();
  const toggle = useToggleFavoriteEntry();
  const active = useMemo(
    () => (preferences?.favorites ?? []).some((e) => navigationEntriesEqual(e, descriptor)),
    [preferences, descriptor.route, descriptor.targetType, descriptor.targetId],
  );

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const added = await toggle.mutateAsync(descriptor);
      toast.success(added ? 'أُضيف إلى المفضلة ⭐' : 'أُزيل من المفضلة');
    } catch {
      toast.error('تعذر تحديث المفضلة');
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={toggle.isPending}
      aria-pressed={active}
      aria-label={active ? `إزالة ${descriptor.label} من المفضلة` : `إضافة ${descriptor.label} إلى المفضلة`}
      title={active ? 'إزالة من المفضلة' : 'مفضلة ⭐'}
      className={size === 'sm' ? 'size-7' : 'size-8'}
    >
      <Star
        className={active ? 'size-4 text-amber-400 fill-amber-400' : 'size-4 text-slate-400'}
      />
    </Button>
  );
}

export function PinToggle({ descriptor, size = 'md' }: MarkButtonProps) {
  const { data: preferences } = useUserPreferences();
  const toggle = useTogglePinEntry();
  const active = useMemo(
    () => (preferences?.pins ?? []).some((e) => navigationEntriesEqual(e, descriptor)),
    [preferences, descriptor.route, descriptor.targetType, descriptor.targetId],
  );

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const added = await toggle.mutateAsync(descriptor);
      toast.success(added ? 'تم التثبيت 📌' : 'أُزيل التثبيت');
    } catch {
      toast.error('تعذر تحديث التثبيت');
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={toggle.isPending}
      aria-pressed={active}
      aria-label={active ? `إزالة تثبيت ${descriptor.label}` : `تثبيت ${descriptor.label}`}
      title={active ? 'إزالة التثبيت' : 'تثبيت 📌'}
      className={size === 'sm' ? 'size-7' : 'size-8'}
    >
      <PinIcon
        className={active ? 'size-4 text-cyan-400 fill-cyan-400' : 'size-4 text-slate-400'}
      />
    </Button>
  );
}
