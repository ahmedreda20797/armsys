'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  Fingerprint,
  Clock,
  FileText,
  Scale,
  Award,
  Banknote,
  Plane,
  BarChart3,
  Settings,
  Database,
  LogOut,
  X,
  ChevronRight,
  ChevronLeft,
  ClipboardCheck,
  ShieldCheck,
  MessageSquareWarning,
  BookOpen,
  AlertTriangle,
  Monitor,
  Bell,
  Zap,
  Shield,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { SIDEBAR_GROUPS } from '@/config/permissions';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Fingerprint,
  Clock,
  FileText,
  Scale,
  Award,
  Banknote,
  Plane,
  BarChart3,
  Settings,
  Database,
  ClipboardCheck,
  ShieldCheck,
  MessageSquareWarning,
  BookOpen,
  AlertTriangle,
  Monitor,
  Bell,
  Zap,
  Shield,
};

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

// ══════════════════════════════════════════════════════════════════
//  Fixed-position Tooltip — rendered in a portal so it NEVER
//  affects layout flow or causes any horizontal shift.
// ══════════════════════════════════════════════════════════════════
function SidebarTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleMouseEnter = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.top + rect.height / 2,
      right: window.innerWidth - rect.left + 8,
    });
    setShow(true);
  }, []);

  const handleMouseLeave = useCallback(() => setShow(false), []);

  // Only portal after mount — avoids SSR document.body access
  const tooltip = mounted && show
    ? createPortal(
        <motion.div
          initial={{ opacity: 0, x: 8, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 8, scale: 0.95 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: 'fixed',
            top: pos.top,
            right: pos.right,
            transform: 'translateY(-50%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          className="px-3 py-1.5 rounded-lg bg-slate-800/98 backdrop-blur-xl border border-slate-600/50 text-white text-xs whitespace-nowrap shadow-xl shadow-black/30"
          role="tooltip"
        >
          {label}
          {/* Arrow pointing right */}
          <div className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-2.5 h-2.5 bg-slate-800/98 rotate-45 border-r border-t border-slate-600/50" />
        </motion.div>,
        document.body
      )
    : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative"
    >
      {children}
      <AnimatePresence>{tooltip}</AnimatePresence>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Collapsed Desktop Sidebar — icons only, no section headers
// ══════════════════════════════════════════════════════════════════
function CollapsedSidebar({
  currentPage,
  onNavigate,
  onToggleCollapse,
  userName,
  userInitials,
  onLogout,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  onToggleCollapse: () => void;
  userName: string;
  userInitials: string;
  onLogout: () => void;
}) {
  const { visiblePages } = usePermissions();

  return (
    <div
      className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:right-0 z-20 shadow-xl"
      style={{ width: 72 }} // fixed width — never changes
    >
      <div className="flex flex-col h-full bg-slate-900 text-white" style={{ width: 72 }}>
        {/* Logo */}
        <div className="flex items-center justify-center h-20 border-b border-slate-700/50 shrink-0">
          <motion.img
            src="/logo-full-clean.png"
            alt="ARM Logo"
            className="h-10 w-auto object-contain"
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* Navigation — icons only, NO section headers, NO separators */}
        <nav className="flex-1 overflow-y-auto py-3 flex flex-col items-center gap-1 px-2">
          {SIDEBAR_GROUPS.map((group) => {
            const groupPages = visiblePages.filter((p) => p.groupId === group.id);
            if (groupPages.length === 0) return null;
            return (
              <React.Fragment key={group.id}>
                {groupPages.map((page) => {
                  const Icon = ICON_MAP[page.icon];
                  const isActive = currentPage === page.id;
                  return (
                    <SidebarTooltip key={page.id} label={page.title}>
                      <motion.button
                        onClick={() => onNavigate(page.id)}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.95 }}
                        aria-label={page.title}
                        className={cn(
                          'w-12 h-10 flex items-center justify-center rounded-lg transition-colors duration-150 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50',
                          isActive
                            ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        )}
                      >
                        {Icon && <Icon className="h-5 w-5 shrink-0" />}
                        {isActive && (
                          <motion.div
                            className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-l-full bg-violet-400"
                            layoutId="collapsedIndicator"
                            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                          />
                        )}
                      </motion.button>
                    </SidebarTooltip>
                  );
                })}
              </React.Fragment>
            );
          })}
        </nav>

        {/* Bottom controls */}
        <div className="border-t border-slate-700/50 py-3 flex flex-col items-center gap-2 shrink-0">
          <SidebarTooltip label={userName}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-sm font-bold text-white ring-2 ring-slate-600 flex items-center justify-center cursor-default hover:ring-violet-500/40 transition-all">
              {userInitials}
            </div>
          </SidebarTooltip>
          <SidebarTooltip label="تسجيل الخروج">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onLogout}
              aria-label="تسجيل الخروج"
              className="w-10 h-10 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <LogOut className="h-4 w-4" />
            </motion.button>
          </SidebarTooltip>
          <SidebarTooltip label="توسيع القائمة">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onToggleCollapse}
              aria-label="توسيع القائمة"
              className="w-10 h-10 rounded-lg text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
            >
              <ChevronLeft className="h-4 w-4" />
            </motion.button>
          </SidebarTooltip>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Cosmic collapse arrow
// ══════════════════════════════════════════════════════════════════
function CosmicChevron({ isOpen }: { isOpen: boolean }) {
  return (
    <motion.div
      animate={{ rotate: isOpen ? 180 : 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/20 shrink-0"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-violet-400">
        <path
          d="M7.5 3.75L5 6.25L2.5 3.75"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  );
}

export function Sidebar({
  currentPage,
  onNavigate,
  isOpen,
  onToggle,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const { visiblePages } = usePermissions();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();

  const userInitials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';
  const userName = user?.name || '';
  const userRank = user?.rank || '';

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    SIDEBAR_GROUPS.forEach((g, i) => { initial[g.id] = i > 0; });
    return initial;
  });

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  // Collapsed desktop sidebar
  if (!isMobile && isCollapsed) {
    return (
      <CollapsedSidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        onToggleCollapse={onToggleCollapse}
        userName={userName}
        userInitials={userInitials}
        onLogout={logout}
      />
    );
  }

  const expandedNav = (
    <nav className="flex-1 overflow-y-auto py-3 px-3 arm-scroll">
      {SIDEBAR_GROUPS.map((group, groupIdx) => {
        const groupPages = visiblePages.filter((p) => p.groupId === group.id);
        if (groupPages.length === 0) return null;
        const isGroupCollapsed = collapsedGroups[group.id] ?? false;

        return (
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIdx * 0.06 + 0.15, duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={cn(groupIdx > 0 && 'mt-2')}
          >
            <button
              onClick={() => toggleGroup(group.id)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/50 transition-colors group/header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            >
              <span className="text-xs leading-none shrink-0">{group.emoji}</span>
              <span className="flex-1 text-right text-[10px] font-bold tracking-wide text-slate-500 group-hover/header:text-slate-400 whitespace-nowrap transition-colors">
                {group.label}
              </span>
              <CosmicChevron isOpen={!isGroupCollapsed} />
            </button>

            <AnimatePresence initial={false}>
              {!isGroupCollapsed && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  className="overflow-hidden space-y-0.5 mt-0.5"
                >
                  {groupPages.map((page, index) => {
                    const Icon = ICON_MAP[page.icon];
                    const isActive = currentPage === page.id;
                    return (
                      <motion.li
                        key={page.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 + 0.05, duration: 0.18 }}
                      >
                        <motion.button
                          onClick={() => onNavigate(page.id)}
                          whileHover={{ x: -4 }}
                          transition={{ duration: 0.12 }}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                            isActive
                              ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          )}
                        >
                          {Icon && (
                            <Icon className={cn('h-5 w-5 shrink-0', isActive && 'scale-110')} />
                          )}
                          <span className="truncate">{page.title}</span>
                          {isActive && (
                            <motion.div
                              className="mr-auto w-1.5 h-1.5 rounded-full bg-violet-300"
                              layoutId="activeIndicator"
                              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                            />
                          )}
                        </motion.button>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </nav>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      {/* Logo */}
      <div className="relative flex items-center justify-center h-20 px-4 border-b border-slate-700/50 shrink-0">
        {isMobile && (
          <button
            onClick={onToggle}
            className="absolute top-4 left-4 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            aria-label="إغلاق القائمة"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <motion.img
          src="/logo-full-clean.png"
          alt="ARM Logo"
          className="h-16 w-auto object-contain drop-shadow-[0_0_15px_rgba(99,102,241,0.15)]"
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className="absolute top-4 left-4 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            aria-label="طي القائمة"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {expandedNav}

      {/* User Profile */}
      <div className="border-t border-slate-700/50 p-4 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-sm font-bold text-white ring-2 ring-violet-500/50 shrink-0">
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{userName}</p>
            <span className="inline-block mt-0.5 px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-600/20 text-violet-400 border border-violet-600/30">
              {userRank}
            </span>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white transition-all duration-150 shadow-md shadow-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
        >
          <LogOut className="h-4 w-4" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </div>
  );

  // Mobile overlay
  if (isMobile) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onToggle}
            />
            <motion.aside
              className="fixed inset-y-0 right-0 z-50 w-72 shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    );
  }

  // Desktop expanded — fixed width, never changes
  return (
    <div
      className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:right-0 z-20 shadow-2xl"
      style={{ width: 288 }}
    >
      {sidebarContent}
    </div>
  );
}
