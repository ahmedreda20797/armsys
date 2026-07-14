'use client';

import React, { useMemo, useEffect, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '@/lib/store';
import { APP_PAGES } from '@/config/permissions';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { logPageVisit } from '@/lib/activity-logger';

// Lazy-load Employee360Page for overlay
const Employee360Overlay = dynamic(() => import('@/components/pages/Employee360Page'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[60] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="animate-spin size-12 border-[3px] border-emerald-500/20 border-t-emerald-500 rounded-full" />
          <div className="absolute inset-0 animate-ping size-12 rounded-full bg-emerald-500/10" />
        </div>
        <p className="text-emerald-400/80 text-sm font-medium tracking-wide">جاري تحميل ملف الموظف...</p>
      </div>
    </div>
  ),
});

interface AppLayoutProps {
  children: React.ReactNode;
}

const pageVariants = {
  initial: { opacity: 0, y: 16, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -12, filter: 'blur(2px)' },
};

// ═══ Cinematic Overlay Animation Variants ═══
const backdropVariants = {
  hidden: { opacity: 0, backdropFilter: 'blur(0px)' },
  visible: {
    opacity: 1,
    backdropFilter: 'blur(12px)',
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  },
  exit: {
    opacity: 0,
    backdropFilter: 'blur(0px)',
    transition: { duration: 0.3, ease: [0.55, 0, 1, 0.45] as const },
  },
};

const panelVariants = {
  hidden: {
    opacity: 0,
    x: 120,
    scale: 0.92,
    rotateY: -8,
    filter: 'blur(8px) brightness(0.3)',
  },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    rotateY: 0,
    filter: 'blur(0px) brightness(1)',
    transition: {
      type: 'spring' as const,
      stiffness: 180,
      damping: 22,
      mass: 0.9,
      staggerChildren: 0.04,
      delayChildren: 0.08,
    },
  },
  exit: {
    opacity: 0,
    x: 100,
    scale: 0.94,
    rotateY: -6,
    filter: 'blur(4px) brightness(0.5)',
    transition: {
      duration: 0.35,
      ease: [0.55, 0, 1, 0.45] as const,
    },
  },
} as const;

export function AppLayout({ children }: AppLayoutProps) {
  const { currentPage, sidebarOpen, setCurrentPage, toggleSidebar, sidebarCollapsed, toggleSidebarCollapse } =
    useAppStore();
  const employee360Open = useAppStore((s) => s.employee360Open);
  const employee360Id = useAppStore((s) => s.employee360Id);
  const closeEmployee360 = useAppStore((s) => s.closeEmployee360);
  const isMobile = useIsMobile();
  const { refreshUser } = useAuth();
  const { canViewPage } = usePermissions();

  // Permission-gated navigation: only navigate if user has access
  const safeNavigate = useCallback((page: string) => {
    // 'home' is always accessible
    if (page === 'home' || canViewPage(page)) {
      setCurrentPage(page);
    }
  }, [canViewPage, setCurrentPage]);

  // Refresh permissions on every page navigation
  useEffect(() => {
    refreshUser();
    logPageVisit(currentPage);
  }, [currentPage, refreshUser]);

  // Close overlay on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && employee360Open) {
        closeEmployee360();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [employee360Open, closeEmployee360]);

  const currentPageConfig = useMemo(
    () => APP_PAGES.find((p) => p.id === currentPage) || APP_PAGES[0],
    [currentPage]
  );

  // Sidebar margin: driven by CSS data attributes so the value is
  // consistent between SSR (isMobile=false) and first client paint.
  // On screens < lg the sidebar is an overlay — CSS sets margin to 0.
  const sidebarMargin = sidebarCollapsed ? 72 : 288;

  return (
    <div className="min-h-screen bg-slate-950" dir="rtl">
      {/* Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={safeNavigate}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />

      {/* Main content area — CSS transition on margin, no motion (prevents CLS).
          On mobile (<lg) the sidebar is an overlay so margin is 0 via CSS. */}
      <div
        className="lg:block"
        style={{
          marginRight: isMobile ? 0 : sidebarMargin,
          transition: 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div className="main-content-bg min-h-screen">
          <Header
            title={currentPageConfig.title}
            onMenuToggle={toggleSidebar}
            onToggleSidebarCollapse={toggleSidebarCollapse}
            sidebarCollapsed={sidebarCollapsed}
          />

          <main className="p-4 md:p-6 min-h-[calc(100vh-4rem)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPage}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{
                  duration: 0.3,
                  ease: [0.4, 0, 0.2, 1] as const,
                  filter: { duration: 0.25 },
                }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          Employee 360 Overlay — Cinematic slide-in with 3D perspective
          ══════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {employee360Open && employee360Id && (
          <>
            {/* Cinematic Backdrop */}
            <motion.div
              key="e360-backdrop"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed inset-0 z-[55] bg-gradient-to-b from-black/60 via-slate-950/70 to-black/60"
              onClick={closeEmployee360}
            />
            {/* Cinematic Panel with perspective */}
            <motion.div
              key="e360-panel"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{ perspective: 1200, transformStyle: 'preserve-3d' }}
              className="fixed inset-y-0 right-0 z-[60] w-full lg:w-[85%] xl:w-[80%] bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 shadow-2xl shadow-black/80 border-l border-emerald-500/10 overflow-y-auto"
              dir="rtl"
            >
              {/* Subtle top glow accent line */}
              <div className="absolute top-0 right-0 left-0 h-[2px] bg-gradient-to-l from-transparent via-emerald-500/60 to-transparent" />
              <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
                <Employee360Overlay
                  employeeId={employee360Id}
                  onClose={closeEmployee360}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
