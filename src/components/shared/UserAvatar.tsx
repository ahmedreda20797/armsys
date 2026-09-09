'use client';

// ══════════════════════════════════════════════════════════════
//  UserAvatar — the ONE avatar surface (§AVATAR-UNIFICATION)
//
//  Every place that shows the signed-in user (Header, expanded
//  sidebar footer, collapsed rail) renders THIS component, so the
//  identity look is byte-identical everywhere:
//    • same violet→indigo gradient + violet ring
//    • same initials computation (first letters of the name words)
//    • same photo support: when `src` is provided the photo fills
//      the circle; on load error (or no src) the initials fallback
//      shows — Radix Avatar handles the swap automatically.
//
//  The user-profile page (uploading personal photos) does not exist
//  yet; when it lands it only needs to feed `src` — no call site
//  redesign. Sizes are controlled through className (default size-9).
// ══════════════════════════════════════════════════════════════

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface UserAvatarProps {
  /** display name — used for initials + aria labels */
  name?: string | null;
  /** optional personal photo URL (future user-profile feature) */
  src?: string | null;
  /** size overrides via className (default size-9) */
  className?: string;
  ariaLabel?: string;
}

/** Shared initials computation — single source of truth. */
export function getUserInitials(name: string | undefined | null): string {
  if (!name || name.trim().length === 0) return '؟؟';
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function UserAvatar({ name, src, className, ariaLabel }: UserAvatarProps) {
  const initials = getUserInitials(name);

  return (
    <Avatar
      className={cn(
        'size-9 bg-linear-to-br from-violet-600 to-indigo-600 ring-2 ring-violet-500/40 transition-all',
        className,
      )}
      aria-label={ariaLabel ?? (name ? `صورة المستخدم ${name}` : 'صورة المستخدم')}
    >
      {src && <AvatarImage src={src} alt={name ?? 'المستخدم'} />}
      <AvatarFallback
        className="bg-linear-to-br from-violet-600 to-indigo-600 text-xs font-bold text-white"
        delayMs={src ? 300 : 0}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
