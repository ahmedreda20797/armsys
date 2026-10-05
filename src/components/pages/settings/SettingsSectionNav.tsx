'use client';

// ═══════════════════════════════════════════════════════════════
//  SettingsSectionNav — §SETTINGS-CENTER the compact internal
//  section navigation of the Settings workspace.
//
//  Replaces the always-visible section rail that consumed a large
//  portion of the screen. ONE compact trigger row (current section +
//  sections toggle) stays in flow; the labeled section list opens on
//  demand and never navigates the user out of Settings:
//    • Desktop (lg+): a collapsible panel anchored below the trigger
//      (overlay — the content area keeps its width and height).
//    • Mobile / tablet (<lg): an internal Settings DRAWER anchored to
//      the inline-start edge (mirrors the Qnalys sidebar drawer
//      contract), closed after every section selection.
//
//  §SETTINGS-SECTIONS — this component owns NO section state: the
//  active section lives in store.navParams.section (the canonical
//  surface) and reaches it through props. Selection history, the
//  fail-safe sanitizer and Back/Forward integration stay exactly
//  where they were (SettingsPage + qnalys-history).
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ListTree, X } from 'lucide-react';
import { useIsDesktop } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';

export interface SettingsSectionNavItem {
  id: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
  underPreparation?: boolean;
}

export function SettingsSectionNav({
  sections,
  activeId,
  onSelect,
}: {
  sections: SettingsSectionNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const { dir } = useLanguage();
  const isDesktop = useIsDesktop();
  const [panelOpen, setPanelOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  // ESC closes whichever surface is open (panel on desktop, drawer on
  // mobile) — the standard Qnalys overlay contract.
  useEffect(() => {
    if (!panelOpen && !drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelOpen(false);
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, drawerOpen]);

  const toggle = useCallback(() => {
    // Exactly ONE surface owns the toggle per viewport: the inline
    // panel at lg+, the drawer below it. Closing both first means a
    // mid-session viewport change can never leave a stale surface.
    if (isDesktop) {
      setDrawerOpen(false);
      setPanelOpen((v) => !v);
    } else {
      setPanelOpen(false);
      setDrawerOpen((v) => !v);
    }
  }, [isDesktop]);

  const select = useCallback((id: string) => {
    onSelect(id);
    // Mobile drawer closes after selection (§10). The desktop panel
    // stays open — it is a persistent collapsible nav, not a menu.
    setDrawerOpen(false);
  }, [onSelect]);

  if (!active) return null;

  // ── The labeled section list — ONE rendering shared by both
  //    surfaces (desktop panel + mobile drawer). ──
  const sectionList = (
    <nav aria-label="أقسام الإعدادات" className="flex flex-col gap-0.5">
      {sections.map(({ id, title, description, icon, underPreparation }) => {
        const isActive = id === activeId;
        return (
          <button
            key={id}
            type="button"
            onClick={() => select(id)}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-all',
              isActive
                ? 'bg-brand-500/10 border-brand-500/40 text-brand-200'
                : 'border-transparent bg-transparent text-slate-400 hover:bg-slate-800/40 hover:text-slate-200',
              underPreparation && !isActive && 'text-slate-500',
            )}
          >
            <span className={cn(
              'flex items-center justify-center size-7 rounded-lg border shrink-0',
              isActive ? 'bg-brand-500/15 border-brand-500/30 text-brand-300' : 'bg-slate-800/50 border-slate-700/50',
            )}>
              {icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="block whitespace-nowrap text-xs font-bold">{title}</span>
                {underPreparation && (
                  <span className="shrink-0 rounded-full border border-slate-600/50 bg-slate-800/60 px-1.5 py-px text-[9px] text-slate-400">
                    <T>قيد التهيئة</T>
                  </span>
                )}
              </span>
              {description && (
                <span className="block text-[10px] text-slate-500 truncate">{description}</span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="relative">
      {/* ── Compact trigger row — the ONLY always-visible chrome ── */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700/40 bg-slate-800/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/15 text-brand-300">
            {active.icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-slate-200">{active.title}</span>
            <span className="hidden text-[10px] text-slate-500 sm:block">
              <T>الإعدادات</T>
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={panelOpen || drawerOpen}
          aria-haspopup="menu"
          aria-label="أقسام الإعدادات"
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
            panelOpen || drawerOpen
              ? 'border-brand-500/40 bg-brand-500/10 text-brand-200'
              : 'border-slate-700/50 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white',
          )}
        >
          <ListTree className="size-3.5" />
          <T>الأقسام</T>
        </button>
      </div>

      {/* ── Desktop (lg+): collapsible panel anchored below the
          trigger — an overlay, so the content area never shifts ── */}
      {/* §ANIM-MOUNT — instant unmount on close, enter animation only
          (the §EMPLOYEE360-CLOSE doctrine): an AnimatePresence exit was
          observed to finish animating WITHOUT unmounting when a section
          switch re-rendered the component mid-exit, leaving an invisible
          pointer-blocking layer over the content. No exit wait — the
          overlay can never outlive its open state. */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-20 hidden lg:block"
          onClick={() => setPanelOpen(false)}
          aria-hidden="true"
        />
      )}
      {panelOpen && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
          className="absolute top-full mt-2 z-30 hidden lg:block w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-900/95 shadow-2xl shadow-black/40 backdrop-blur-xl p-2"
        >
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <T>أقسام الإعدادات</T>
          </p>
          <div className="arm-scroll max-h-[min(60vh,26rem)] overflow-y-auto">
            {sectionList}
          </div>
        </motion.div>
      )}

      {/* ── Mobile / tablet (<lg): the internal Settings drawer ──
          §ANIM-MOUNT — same instant-unmount doctrine as the panel. */}
      {drawerOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.18 } }}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      {drawerOpen && (
        <motion.aside
          initial={{ x: dir === 'rtl' ? '100%' : '-100%' }}
          animate={{ x: 0, transition: { duration: 0.24, ease: [0.4, 0, 0.2, 1] } }}
          className="fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw] shadow-2xl lg:hidden"
          aria-label="أقسام الإعدادات"
        >
          <div className="flex h-full flex-col bg-slate-900 text-white">
            <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
              <p className="text-xs font-bold text-slate-200">
                <T>أقسام الإعدادات</T>
              </p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="إغلاق"
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="arm-scroll flex-1 overflow-y-auto p-2">
              {sectionList}
            </div>
          </div>
        </motion.aside>
      )}
    </div>
  );
}
