'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu, Bell, PanelRightClose, PanelRightOpen, Plus,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { useAppStore } from '@/lib/store';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { useSaveUserPreferences } from '@/hooks/use-user-preferences';
import { NotificationCenterPopover } from '@/components/shared/NotificationCenterPopover';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { toast } from 'sonner';

// ══════════════════════════════════════════════════════════════
//  HeaderCreateActionSlot — §7: the CURRENT page's primary create
//  action appears here while the user has scrolled past the page
//  header (registered by PageHeaderBar through the store). One
//  effective action at a time; utility actions never register.
// ══════════════════════════════════════════════════════════════
function HeaderCreateActionSlot() {
  const action = useAppStore((s) => s.headerCreateAction);

  return (
    <AnimatePresence mode="popLayout">
      {action && (
        <motion.button
          key={action.label}
          type="button"
          initial={{ opacity: 0, y: -10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.9 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          onClick={action.onClick}
          className="hidden sm:inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-semibold shadow-lg shadow-violet-500/25 whitespace-nowrap"
          title={action.label}
        >
          <Plus className="size-3.5" />
          {action.label}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  Header Component
// ══════════════════════════════════════════════════════════════
interface HeaderProps {
  title: string;
  onMenuToggle: () => void;
  onToggleSidebarCollapse: () => void;
  sidebarCollapsed: boolean;
}

export function Header({ title, onMenuToggle, onToggleSidebarCollapse, sidebarCollapsed }: HeaderProps) {
  const { user } = useAuth();
  const savePrefs = useSaveUserPreferences();

  // §3: the toggle PINS the chosen state — the store flips and the
  // pinned preference persists (user-scoped, via the existing
  // preferences record). No cross-user path exists (server keys the
  // record to the authenticated caller).
  const handleSidebarPinToggle = () => {
    const nextPinnedOpen = sidebarCollapsed; // collapsed now → pinned open next
    onToggleSidebarCollapse();
    savePrefs.mutate({ sidebar: { pinOpen: nextPinnedOpen } }, {
      onError: () => toast.error('تعذر حفظ تفضيل القائمة'),
    });
  };
  const isMobile = useIsMobile();
  // §5: the notification PANEL moved to the shared NotificationCenterPopover
  // (Radix Popover — portal, Escape, compact rows, contained scrolling).
  // The Header keeps only the unread badge + new-notification pulse,
  // which still come from the real-time NotificationContext.
  const { unreadCount, latestNotification } = useNotificationContext();

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <header className="glass-header sticky top-0 z-30 flex flex-col">
      {/* Gradient line under header */}
      <div className="header-gradient-line" />

      <div className="flex items-center justify-between h-16 px-4 md:px-6">
        {/* ── Left: menu toggle + title ── */}
        <div className="flex items-center gap-3">
          {/* Mobile menu button — hidden on desktop via CSS (isMobile is SSR-safe false initially) */}
          <motion.button
            onClick={isMobile ? onMenuToggle : handleSidebarPinToggle}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 transition-colors"
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            aria-label="Toggle menu"
          >
            {!isMobile && (sidebarCollapsed ? <PanelRightOpen className="h-5 w-5" /> : <PanelRightClose className="h-5 w-5" />)}
            {isMobile && <Menu className="h-5 w-5" />}
          </motion.button>
          <h1 className="text-lg font-bold text-slate-800 dark:text-white truncate max-w-xs sm:max-w-md">
            {title}
          </h1>
        </div>

        {/* ── Center: Global Search trigger (Phase 6.1 — desktop field, mobile icon) ── */}
        <GlobalSearch />

        {/* ── Right: scrolling create action + notification bell + avatar ── */}
        <div className="flex items-center gap-2">
          {/* §7: the page's PRIMARY create action transitions here while
              the user scrolls — one effective action, never duplicated.
              Favorites/Pins intentionally live in the SIDEBAR (§4/§5/§10). */}
          <HeaderCreateActionSlot />

          {/* ═══════════════════════════════════════════════════════
              NOTIFICATION BELL (§5 — redesigned center)
              The panel itself is the shared NotificationCenterPopover:
              Radix Popover portal, Escape-to-close, compact rows,
              contained scrolling, unified delete confirmation.
              ═══════════════════════════════════════════════════════ */}
          <NotificationCenterPopover>
            <motion.button
              type="button"
              className="relative p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              aria-label="الإشعارات"
              aria-haspopup="dialog"
            >
              <Bell className="h-5 w-5" />

              {/* Unread count badge */}
              {unreadCount > 0 && (
                <motion.span
                  key={unreadCount}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 ring-2 ring-white dark:ring-slate-900"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </motion.span>
              )}

              {/* Pulse ring on new notification */}
              <AnimatePresence>
                {latestNotification && (
                  <motion.span
                    initial={{ scale: 1, opacity: 1 }}
                    animate={{ scale: 2.5, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute inset-0 rounded-full bg-red-500/30"
                  />
                )}
              </AnimatePresence>
            </motion.button>
          </NotificationCenterPopover>
          {/* ── User Avatar — §AVATAR-UNIFICATION: the ONE shared identity
              surface (same component as the sidebar footer and the
              collapsed rail; photo-ready via src) ── */}
          <UserAvatar name={user?.name} className="cursor-pointer hover:ring-violet-300" />
        </div>
      </div>
    </header>
  );
}
