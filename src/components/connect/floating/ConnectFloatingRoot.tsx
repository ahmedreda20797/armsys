// src/components/connect/floating/ConnectFloatingRoot.tsx
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect — FLOATING OVERLAY ROOT (mounted ONCE in AppLayout)
//
//  Spatial contract (§spec 7):
//    RIGHT  — the EXISTING QNALYS sidebar (untouched, still owned by
//             AppLayout)
//    CENTER — the existing page content (width never reduced — this
//             overlay is fixed-position and participates in NO layout)
//    FAR LEFT — the Connect launcher + its emerging panel + the
//             floating conversation window
//
//  The root owns ALL Connect queries for the session (list for the
//  unread badge; messages/sync/details inside the window), so
//  navigating between QNALYS pages never mounts duplicate polling
//  subscriptions. Everything unmounts cleanly (listeners/timers via
//  React Query + framer-motion lifecycle).
// ══════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Loader2, MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobileViewport } from '@/hooks/use-mobile';
import { useConnectConversations, useOpenDirectConversation } from '@/hooks/use-connect';
import { useConnectFloatingStore } from './connect-floating-store';
import { overlayMotionStyle, CONNECT_PANEL_ORIGIN } from './connect-animations';
import { ConnectPanel } from './ConnectPanel';
import { ConversationWindow } from './ConversationWindow';
import { NewConversationDialog } from '@/components/connect/NewConversationDialog';

export function ConnectFloatingRoot() {
  const { user } = useAuth();
  const { canViewPage } = usePermissions();
  const myUserId = user?.id ?? '';
  const enabled = Boolean(user) && canViewPage('connect');

  // ── The ONE conversation-list subscription for the whole session ──
  // Powers the launcher badge; the panel renders from the same cache.
  const conversationsQuery = useConnectConversations(false, enabled);
  const conversations = conversationsQuery.data ?? [];

  const panelOpen = useConnectFloatingStore((s) => s.panelOpen);
  const windowOpen = useConnectFloatingStore((s) => s.windowOpen);
  const activeConversationId = useConnectFloatingStore((s) => s.activeConversationId);
  const drafts = useConnectFloatingStore((s) => s.drafts);
  const openPanel = useConnectFloatingStore((s) => s.openPanel);
  const closePanel = useConnectFloatingStore((s) => s.closePanel);
  const openConversation = useConnectFloatingStore((s) => s.openConversation);
  const closeConversation = useConnectFloatingStore((s) => s.closeConversation);
  const minimizeConversation = useConnectFloatingStore((s) => s.minimizeConversation);
  const setDraft = useConnectFloatingStore((s) => s.setDraft);
  const clearDraft = useConnectFloatingStore((s) => s.clearDraft);

  const reducedMotion = useReducedMotion() ?? false;
  const isMobile = useIsMobileViewport();

  // §RECOVERY — CRITICAL GEOMETRY IS INLINE, never utility-dependent.
  // In the failing deployment the launcher's Tailwind utilities
  // (bottom-5 / z-[45]) were absent from the served stylesheet, so the
  // fixed element fell back to its static flow position at the very
  // END of the document — rendered but effectively invisible. Inline
  // styles apply regardless of stylesheet generation/HMR state.
  //
  // §RESPONSIVE — viewport-adaptive sizing (dvh/dvw + clamp +
  // safe-area insets), not one fixed size for every device:
  //   • launcher — bottom-left with safe-area insets;
  //   • panel (desktop/laptop/tablet) — width clamp(300px, 26vw, 380px)
  //     scales down on laptops; height capped at 640px so large
  //     desktops keep page context visible; on mobile it becomes a
  //     near-full-screen sheet above the launcher (still closable from
  //     both the header ✕ and the launcher itself);
  //   • conversation window — beside the panel on desktop, near-full
  //     screen on mobile; dvh so the virtual keyboard never hides the
  //     composer.
  const PANEL_COLUMN = 'clamp(300px, 26vw, 380px)';
  const launcherStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 'calc(1rem + env(safe-area-inset-bottom))',
    left: 'calc(0.75rem + env(safe-area-inset-left))',
    zIndex: 45,
  };
  const panelGeometry: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 'calc(0.5rem + env(safe-area-inset-top))',
        left: 'calc(0.5rem + env(safe-area-inset-left))',
        right: 'calc(0.5rem + env(safe-area-inset-right))',
        bottom: 'calc(4.75rem + env(safe-area-inset-bottom))',
        zIndex: 45,
        transformOrigin: CONNECT_PANEL_ORIGIN,
      }
    : {
        position: 'fixed',
        left: 'calc(0.75rem + env(safe-area-inset-left))',
        bottom: 'calc(5.25rem + env(safe-area-inset-bottom))',
        width: PANEL_COLUMN,
        height: 'clamp(380px, calc(100dvh - 8rem - env(safe-area-inset-bottom)), 640px)',
        maxHeight: 'calc(100dvh - 6.25rem)',
        zIndex: 45,
        transformOrigin: CONNECT_PANEL_ORIGIN,
      };
  const windowGeometry: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 'calc(0.5rem + env(safe-area-inset-top))',
        right: 'calc(0.5rem + env(safe-area-inset-right))',
        bottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
        left: 'calc(0.5rem + env(safe-area-inset-left))',
        zIndex: 46,
        transformOrigin: CONNECT_PANEL_ORIGIN,
      }
    : {
        position: 'fixed',
        bottom: 'calc(1rem + env(safe-area-inset-bottom))',
        left: `calc(0.75rem + env(safe-area-inset-left) + ${PANEL_COLUMN} + 0.75rem)`,
        width: 'clamp(340px, 30vw, 420px)',
        height: 'clamp(380px, calc(100dvh - 3rem - env(safe-area-inset-bottom)), 620px)',
        zIndex: 46,
        transformOrigin: CONNECT_PANEL_ORIGIN,
      };
  // §RECOVERY — declarative CSS-transition motion (see
  // connect-animations.ts): the end state is styled at commit time,
  // never dependent on animation frames.
  const panelMotion = overlayMotionStyle(panelOpen, reducedMotion, 'panel');
  const windowMotion = overlayMotionStyle(windowOpen, reducedMotion, 'window');

  // Keyboard support — closing the panel returns focus to the launcher
  // (DOM side effect only; no render-state writes).
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasPanelOpen = useRef(false);
  useEffect(() => {
    if (wasPanelOpen.current && !panelOpen) launcherRef.current?.focus();
    wasPanelOpen.current = panelOpen;
  }, [panelOpen]);

  // §RESPONSIVE (mobile) — no body scroll behind the open overlay.
  // DOM side effect; UNLOCK happens only when the overlay fully closes
  // — unlocking on an isMobile flip would re-show the scrollbar, change
  // innerWidth at the breakpoint edge, and oscillate the lock forever.
  const overlayActive = panelOpen || windowOpen;
  const bodyLockEngagedRef = useRef(false);
  useEffect(() => {
    if (overlayActive && isMobile && !bodyLockEngagedRef.current) {
      bodyLockEngagedRef.current = true;
      document.body.style.overflow = 'hidden';
    }
    if (!overlayActive && bodyLockEngagedRef.current) {
      bodyLockEngagedRef.current = false;
      document.body.style.overflow = '';
    }
  }, [overlayActive, isMobile]);
  useEffect(() => () => {
    // Unmount (logout/cache reset) — always restore.
    if (bodyLockEngagedRef.current) {
      bodyLockEngagedRef.current = false;
      document.body.style.overflow = '';
    }
  }, []);

  // ── Select-to-open-or-create (the ONLY direct-chat entry) ──
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const openDirect = useOpenDirectConversation((message) => toast.error(message));
  const handlePickAccount = useCallback(async (otherUserId: string) => {
    try {
      const conversationId = await openDirect.openDirect(otherUserId);
      openConversation(conversationId, { openPanel: true });
    } catch {
      // error toast already surfaced by the hook (Arabic message)
    }
  }, [openDirect, openConversation]);

  const handleSelectConversation = useCallback((conversationId: string) => {
    openConversation(conversationId, { openPanel: true });
  }, [openConversation]);

  // Launcher unread badge (bounded server counts; ٩٩+ above the cap).
  const totalUnread = useMemo(
    () => conversations.filter((c) => !c.archivedAt).reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations],
  );
  const unreadLabel = totalUnread > 99 ? '٩٩+' : totalUnread > 0 ? String(totalUnread) : null;

  if (!enabled) return null;

  return (
    <>
      {/* ── Floating launcher — FAR LEFT edge, fixed, zero layout width ──
          §RECOVERY — a PLAIN fixed element (no entrance-animation
          dependency) with INLINE geometry: the launcher must ALWAYS be
          pinned at the viewport's bottom-left corner regardless of
          stylesheet generation state. */}
      <div style={launcherStyle}>
        <button
          ref={launcherRef}
          onClick={() => (panelOpen ? closePanel() : openPanel())}
          aria-label={panelOpen ? 'إغلاق لوحة التواصل' : 'فتح التواصل — المحادثات الداخلية'}
          aria-expanded={panelOpen}
          aria-haspopup="dialog"
          title="تواصل"
          data-testid="connect-launcher"
          className={`relative flex items-center justify-center rounded-full border shadow-lg shadow-black/40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
            panelOpen
              ? 'bg-emerald-600 border-emerald-500/60 text-white'
              : 'bg-slate-800/90 backdrop-blur border-slate-600/70 text-emerald-400 hover:bg-slate-700/90 hover:border-emerald-500/40'
          }`}
          style={{ width: 52, height: 52 }}
        >
          {openDirect.pendingUserId ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <MessagesSquare style={{ width: 22, height: 22 }} />
          )}
          {unreadLabel && !panelOpen && (
            <span
              className="absolute -top-1 -right-1 min-w-[1.35rem] h-5 px-1 rounded-full bg-emerald-500 border-2 border-slate-950 text-white text-[10px] font-bold flex items-center justify-center"
              aria-hidden="true"
            >
              {unreadLabel}
            </span>
          )}
        </button>
      </div>

      {/* ── Panel — EMERGES FROM THE LAUNCHER (origin at the button corner) ──
          Always mounted, declaratively styled open/closed (§RECOVERY):
          the close transition reverses toward the launcher; a closed
          panel is visibility-hidden + pointer-events-none, so it can
          never intercept page interactions. */}
      <div
        style={{ ...panelGeometry, ...panelMotion }}
        data-testid="connect-panel"
        role="dialog"
        aria-label="لوحة المحادثات — تواصل"
        aria-hidden={!panelOpen}
        onKeyDown={(e) => { if (e.key === 'Escape' && panelOpen) closePanel(); }}
      >
        <ConnectPanel
          conversations={conversations}
          isLoading={conversationsQuery.isLoading}
          activeId={activeConversationId}
          myUserId={myUserId}
          pendingAccountId={openDirect.pendingUserId}
          onSelectConversation={handleSelectConversation}
          onPickAccount={handlePickAccount}
          onClose={closePanel}
          onNewGroup={() => setGroupDialogOpen(true)}
        />
      </div>

      {/* ── Conversation window — independent floating overlay ──
          Same declarative motion (§RECOVERY). Geometry inline +
          responsive via the app's canonical useIsMobile hook. The
          window stays mounted while a conversation is active so the
          close/minimize transition can play; its polling is gated on
          `windowOpen` inside ConversationWindow. */}
      {activeConversationId && (
        <div
          style={{ ...windowGeometry, ...windowMotion }}
          data-testid="connect-conversation-window"
          role="dialog"
          aria-label="نافذة المحادثة"
          aria-hidden={!windowOpen}
          onKeyDown={(e) => { if (e.key === 'Escape' && windowOpen) minimizeConversation(); }}
        >
          <ConversationWindow
            conversationId={activeConversationId}
            open={windowOpen}
            myUserId={myUserId}
            draft={drafts[activeConversationId] ?? ''}
            onDraftChange={(text) => setDraft(activeConversationId, text)}
            onClearDraft={() => clearDraft(activeConversationId)}
            onMinimize={() => minimizeConversation()}
            onClose={closeConversation}
          />
        </div>
      )}

      {/* ── Group/department creation keeps its existing dialog workflow ── */}
      <NewConversationDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        onCreated={(conversationId) => openConversation(conversationId, { openPanel: true })}
      />
    </>
  );
}
