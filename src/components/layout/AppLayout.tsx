'use client';

import React, { useEffect, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '@/lib/store';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useTheme } from 'next-themes';
import { logPageVisit } from '@/lib/activity-logger';
import { PrintReportHost } from '@/components/print/PrintReportDocument';

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
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

// §EMPLOYEE360-COMPOSITION — fast, restrained entrance: slide + fade,
// no 3D rotation/blur theatrics (premium ≠ slow).
const panelVariants = {
  hidden: { opacity: 0, x: 60 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 260, damping: 28 },
  },
  exit: { opacity: 0, x: 60, transition: { duration: 0.2 } },
} as const;

export function AppLayout({ children }: AppLayoutProps) {
  // Field selectors — the shell must not re-render on every store
  // write (a selectorless useAppStore() re-renders it — and with it
  // the whole page tree — on each write, e.g. header registrations).
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const employee360Open = useAppStore((s) => s.employee360Open);
  const employee360Id = useAppStore((s) => s.employee360Id);
  const closeEmployee360 = useAppStore((s) => s.closeEmployee360);
  const { refreshUser } = useAuth();
  const { canViewPage } = usePermissions();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Permission-gated navigation: only navigate if user has access.
  // 'home' + 'profile' are always accessible (self-scoped surfaces).
  const safeNavigate = useCallback((page: string) => {
    if (page === 'home' || page === 'profile' || canViewPage(page)) {
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

  return (
    <div className="min-h-screen bg-slate-950" data-print-hide>
      {/* ═══ §SIDEBAR-V2 LAYOUT ARCHITECTURE ═══
          FLEX SIBLINGS, not overlapping fixed layers:
            [Sidebar — in-flow sticky column when pinned]
            [Main column — Header + page content]
          The pinned sidebar is a real layout participant, so the
          content ALWAYS responds to its width and the header can
          never cover it. Overlay modes (unpinned drawer, mobile,
          hover preview) render fixed ABOVE the header by the
          z-contract: header z-30 < overlay sidebar z-40/50. The
          Sidebar owns all of its modes internally. */}
      <div className="flex min-h-screen">
        <Sidebar
          currentPage={currentPage}
          onNavigate={safeNavigate}
          isOpen={sidebarOpen}
          onToggle={toggleSidebar}
        />

        {/* Main content column — flex-1 min-w-0 so wide tables inside
            pages shrink instead of forcing horizontal overflow. */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="main-content-bg flex-1 flex flex-col">
            {/* §7: the header carries brand chrome only — search,
                notifications, account. Page identity lives in the page
                content (PageHeaderBar/PageIdentity). */}
            <Header />

            <main className="p-4 md:p-6 flex-1">
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

            {/* ═══ Global Application Footer — subtle, centered, brand-aligned ═══ */}
            <footer
              className="flex flex-col items-center justify-center gap-0.5 px-4 py-3 text-[10px] text-slate-500 transition-colors"
              aria-hidden="true"
            >
              {/* Official Qnlys wordmark — uses the complete lockup asset.
                  Dark: silver on charcoal; Light: charcoal on paper. */}
              <img
                src={mounted && resolvedTheme === 'light' ? '/qnlys-print.svg' : '/qnlys.svg'}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-5 w-auto max-w-[160px] object-contain opacity-60 hover:opacity-90 transition-opacity select-none"
              />
              <p className="text-center whitespace-nowrap">
                © 2026 Qnlys
              </p>
            </footer>
          </div>
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
            {/* Cinematic Panel — §EMPLOYEE360-COMPOSITION: the panel hugs
                the content (no wide empty background strip on desktop),
                anchored to the right edge. */}
            <motion.div
              key="e360-panel"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed inset-y-0 right-0 z-[60] w-full lg:w-[88%] xl:w-[76%] 2xl:w-[68%] bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 shadow-2xl shadow-black/80 border-l border-emerald-500/10 overflow-y-auto"
             
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

      {/* §PRINT — dedicated print/PDF host: mounts ONCE for the whole
          app; report tabs push a clean A4 model into it. */}
      <PrintReportHost />
    </div>
  );
}
