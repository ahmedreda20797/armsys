'use client';

// ══════════════════════════════════════════════════════════════
//  Header — compact application control bar (§HEADER-V3)
//
//  THREE conceptual zones on ONE 48px baseline:
//    A. PAGE IDENTITY (start)   — icon · title · context line. The
//       title comes from the page's own registration
//       (usePageIdentity) or the APP_PAGES registry; pages no longer
//       repeat a large title inside their content.
//    B. GLOBAL CONTROLS (end)   — search, notifications, profile.
//       The avatar is THE user-profile entry point (the sidebar no
//       longer duplicates it): it opens the profile menu with the
//       identity summary, «الملف الشخصي» and «تسجيل الخروج».
//    C. CONTEXTUAL ACTIONS      — whatever the CURRENT page
//       registered (usePageHeaderActions): compact icon buttons for
//       high-priority utilities (refresh/customize) and one compact
//       quick-actions menu trigger for the rest. Nothing page-specific
//       is hardcoded here; pages with no registration render none.
//
//  The desktop sidebar collapse control stays OUT of the header — the
//  sidebar surface owns its own pin/collapse affordances (Sidebar.tsx).
//  The mobile Menu button stays: on <lg the sidebar is an overlay and
//  this is its only opener.
// ══════════════════════════════════════════════════════════════

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, LogOut, Menu, Plus, UserCircle, Zap } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { AuthUser } from '@/types';
import { useIsDesktop, useIsMobile } from '@/hooks/use-mobile';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { useLanguage } from '@/lib/i18n/language-context';
import { useAppStore, type HeaderContextualAction } from '@/lib/store';
import { APP_PAGES, localizedPageLabel, localizedPageDescription } from '@/config/permissions';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { NotificationCenterPopover } from '@/components/shared/NotificationCenterPopover';
import { UserAvatar } from '@/components/shared/UserAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
          className="hidden sm:inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white text-xs font-semibold shadow-lg shadow-brand-500/25 whitespace-nowrap"
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
//  HeaderContextualActions — zone C renderer.
//
//  Consumes ONLY what the current page registered. 'icon' actions
//  render as standalone compact buttons on ≥sm and collapse INTO the
//  actions menu below that (mobile = one actions trigger, §9).
//  The menu opens toward the inline-end of the trigger (left in RTL,
//  mirrored automatically in LTR via the Radix direction context).
// ══════════════════════════════════════════════════════════════
function HeaderContextualActions({ actions }: { actions: HeaderContextualAction[] }) {
  const isMobile = useIsMobile();
  const { t } = useLanguage();
  const iconActions = actions.filter((a) => a.display === 'icon');
  const menuActions = actions.filter((a) => (a.display ?? 'menu') === 'menu');
  // Narrow screens fold every contextual action into the single menu;
  // wider screens keep icon actions inline and menu the rest.
  const showMenuTrigger = isMobile ? actions.length > 0 : menuActions.length > 0;

  const renderMenuItem = (action: HeaderContextualAction) => (
    <DropdownMenuItem
      key={action.id}
      onClick={action.onClick}
      disabled={action.disabled}
      className="gap-2.5 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800 rounded-lg"
    >
      {action.icon && <span className="shrink-0 text-slate-400">{action.icon}</span>}
      <span className="flex-1 truncate">{action.label}</span>
      {action.active && <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-400 shrink-0" />}
    </DropdownMenuItem>
  );

  return (
    <>
      {!isMobile &&
        iconActions.map((action) => (
          <motion.button
            key={action.id}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            whileTap={{ scale: 0.92 }}
            title={action.label}
            aria-label={action.label}
            aria-pressed={action.active}
            className={`size-9 grid place-items-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:opacity-50 disabled:pointer-events-none ${
              action.active
                ? 'text-brand-300 bg-brand-500/10'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
            }`}
          >
            {action.icon ?? <Zap className="size-4" />}
          </motion.button>
        ))}

      {showMenuTrigger && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              aria-label={t('header.quickActions')}
              aria-haspopup="menu"
              title={t('header.quickActions')}
              className="size-9 grid place-items-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 data-[state=open]:text-brand-300 data-[state=open]:bg-brand-500/10"
            >
              <Zap className="size-4" />
            </motion.button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className="bg-slate-900 border-slate-700/60 min-w-44 p-1.5 z-50"
          >
            {menuActions.map(renderMenuItem)}
            {/* Narrow screens: the collapsed icon actions join the same
                menu — one actions surface, nothing lost. */}
            {isMobile && iconActions.length > 0 && (
              <>
                {menuActions.length > 0 && <DropdownMenuSeparator className="bg-slate-700/50" />}
                {iconActions.map(renderMenuItem)}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  LanguageToggle — §20.1 one-tap Arabic ⇄ English from the shell.
//  Shows the language you can switch TO (EN when Arabic, ع when
//  English) — the international convention for shell language
//  switches. The flip is instant: dictionary `t()` re-renders once,
//  the runtime layer (§20.1-RUNTIME) swaps the rest in a single pass.
// ══════════════════════════════════════════════════════════════
function LanguageToggle() {
  const { locale, setLocale } = useLanguage();
  const next = locale === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      title={locale === 'ar' ? 'English' : 'العربية'}
      className="h-9 min-w-9 px-1.5 grid place-items-center rounded-lg text-[11px] font-bold tracking-wide text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      {locale === 'ar' ? 'EN' : 'ع'}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════
//  HeaderProfileMenu — §AVATAR-UNIFICATION: the avatar is THE user
//  profile entry point. Compact professional menu: identity summary
//  (name · position · email from the existing authenticated user —
//  no extra fetches), «الملف الشخصي» (the settings surface) and
//  «تسجيل الخروج». Radix handles outside-click, Escape, keyboard
//  navigation and RTL mirroring via the app direction provider.
// ══════════════════════════════════════════════════════════════
function HeaderProfileMenu({ user, onLogout }: { user: AuthUser | null; onLogout: () => void }) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { t } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={user?.name ? `${t('header.account')} — ${user.name}` : t('header.account')}
          aria-haspopup="menu"
          title={t('header.account')}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 transition-transform hover:scale-105 active:scale-95"
        >
          <UserAvatar name={user?.name} src={user?.photoURL} className="cursor-pointer" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="bg-slate-900 border-slate-700/60 min-w-60 p-1.5 z-50"
      >
        <DropdownMenuLabel className="px-2 py-2">
          <p className="text-sm font-semibold text-white truncate">{user?.name ?? t('header.profileFallbackUser')}</p>
          {user?.rank && (
            <span className="inline-block mt-1 px-1.5 py-0 text-[9px] font-medium rounded-full bg-brand-600/20 text-brand-400 border border-brand-600/30">
              {user.rank}
            </span>
          )}
          {user?.email && (
            <p className="mt-1 text-[10px] text-slate-500 truncate" dir="ltr">
              {user.email}
            </p>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-slate-700/50" />
        <DropdownMenuItem
          onClick={() => navigateTo('profile')}
          className="gap-2.5 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800 rounded-lg"
        >
          <UserCircle className="size-3.5" />
          {t('header.profile')}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-slate-700/50" />
        <DropdownMenuItem
          onClick={onLogout}
          className="gap-2.5 cursor-pointer text-xs text-red-400 focus:text-red-300 focus:bg-red-500/10 rounded-lg"
        >
          <LogOut className="size-3.5" />
          {t('header.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ══════════════════════════════════════════════════════════════

export function Header() {
  const { user, logout } = useAuth();
  const { locale, t } = useLanguage();
  // §SIDEBAR-TABLET — desktop (≥1024) is the only range where the
  // sidebar may live in the layout; below it the drawer is the only
  // surface, so the hamburger must exist there too.
  const isDesktop = useIsDesktop();
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  // §SIDEBAR-V2: when the sidebar is UNPINNED it has no layout
  // footprint — this menu button (desktop + mobile) is its opener.
  // When PINNED (desktop only), the sidebar is always visible in the
  // layout and the button disappears (no redundant chrome).
  const sidebarPinned = useAppStore((s) => s.sidebarPinned);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const showMenuButton = !isDesktop || !sidebarPinned;
  // §5: the notification PANEL is the shared NotificationCenterPopover
  // (Radix Popover — portal, Escape, compact rows, contained scrolling,
  // store-driven open requests). The Header keeps only the unread
  // badge + new-notification pulse from the real-time context.
  const { unreadCount, latestNotification } = useNotificationContext();

  // ── Zone A — page identity ──
  // The page's own registration wins; the APP_PAGES registry is the
  // shared fallback (title + purpose line) so EVERY page has identity
  // in the header with zero per-page code.
  const currentPage = useAppStore((s) => s.currentPage);
  const pageIdentity = useAppStore((s) => s.pageIdentity);
  const registeredActions = useAppStore((s) => s.pageHeaderActions);
  const identity = pageIdentity?.pageId === currentPage ? pageIdentity.value : null;
  const pageTitle = identity?.title ?? localizedPageLabel(currentPage, locale);
  const pageSubtitle = identity?.description ?? localizedPageDescription(currentPage, locale) ?? null;
  // Zone C — only the CURRENT page's registration is consumed.
  const contextualActions =
    registeredActions?.pageId === currentPage ? registeredActions.value : [];

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <header className="glass-header sticky top-0 z-30 flex flex-col">
      {/* Gradient line under header */}
      <div className="header-gradient-line" />

      <div className="flex items-center justify-between gap-3 h-12 px-3 md:px-5">
        {/* ── Zone A: menu (when sidebar floats) + page identity ── */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {showMenuButton && (
            <motion.button
              onClick={toggleSidebar}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 transition-colors shrink-0"
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              aria-label={t('header.openMenu')}
              aria-expanded={sidebarOpen}
            >
              <Menu className="h-5 w-5" />
            </motion.button>
          )}
          <div className="flex items-center gap-2.5 min-w-0">
            {identity?.icon && (
              <div className="hidden sm:grid place-items-center size-8 rounded-lg border border-slate-700/50 bg-slate-800/50 text-slate-300 shrink-0 [&_svg]:size-4">
                {identity.icon}
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <h1 className="text-sm font-semibold text-white truncate">{pageTitle}</h1>
              {pageSubtitle && (
                <div className="text-[11px] text-slate-500 truncate">{pageSubtitle}</div>
              )}
            </div>
          </div>
        </div>

        {/* ── Zones C + B: contextual actions → create slot → search →
            notifications → profile. §HEADER-SEARCH: the global search
            sits with the header control cluster; the icon is compact/
            icon-first and the field expands from it horizontally. */}
        <div className="flex items-center gap-1 shrink-0">
          <HeaderContextualActions actions={contextualActions} />

          {/* §7: the page's PRIMARY create action transitions here while
              the user scrolls — one effective action, never duplicated.
              Favorites/Pins intentionally live in the SIDEBAR (§4/§5/§10). */}
          <HeaderCreateActionSlot />

          {/* §20.1 — one-tap language switch from the shell */}
          <LanguageToggle />

          <GlobalSearch />

          {/* ═══════════════════════════════════════════════════════
              NOTIFICATION BELL (§NOTIFICATIONS-V2)
              The panel is the shared NotificationCenterPopover:
              Radix Popover portal, Escape-to-close, outside-click close,
              compact rows, contained scrolling, unread distinction.
              The standalone Notification Center page was removed.
              ═══════════════════════════════════════════════════════ */}
          <NotificationCenterPopover>
            <motion.button
              type="button"
              className="relative p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              aria-label={t('header.notifications')}
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

          {/* ── User avatar — THE profile entry point (§3): opens the
              compact profile menu; the sidebar no longer duplicates it. ── */}
          <HeaderProfileMenu user={user} onLogout={logout} />
        </div>
      </div>
    </header>
  );
}
