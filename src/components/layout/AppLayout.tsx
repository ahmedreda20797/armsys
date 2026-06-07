'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '@/lib/store';
import { APP_PAGES } from '@/config/permissions';
import { useIsMobile } from '@/hooks/use-mobile';

interface AppLayoutProps {
  children: React.ReactNode;
}

const pageVariants = {
  initial: { opacity: 0, y: 16, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -12, filter: 'blur(2px)' },
};

export function AppLayout({ children }: AppLayoutProps) {
  const { currentPage, sidebarOpen, setCurrentPage, toggleSidebar, sidebarCollapsed, toggleSidebarCollapse } =
    useAppStore();
  const isMobile = useIsMobile();

  const currentPageConfig = useMemo(
    () => APP_PAGES.find((p) => p.id === currentPage) || APP_PAGES[0],
    [currentPage]
  );

  // Desktop margin adjusts based on collapsed state
  const sidebarMargin = isMobile ? 0 : sidebarCollapsed ? 72 : 288;

  return (
    <div className="min-h-screen bg-slate-950" dir="rtl">
      {/* Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />

      {/* Main content area - animated margin */}
      <motion.div
        className="transition-none"
        animate={{ marginRight: sidebarMargin }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] as const }}
      >
        <div className="main-content-bg min-h-screen">
        <Header
          title={currentPageConfig.nameAr}
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
      </motion.div>
    </div>
  );
}
