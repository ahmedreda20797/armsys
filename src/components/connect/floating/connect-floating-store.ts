// src/components/connect/floating/connect-floating-store.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect — FLOATING OVERLAY STATE (domain-isolated)
//
//  A dedicated zustand store for the floating Connect experience so
//  the shared app store (lib/store) is untouched. The overlay mounts
//  ONCE inside AppLayout and survives page navigation; this store is
//  its single source of truth:
//    • panelOpen          — the conversation panel (emerges from the
//                           far-left launcher)
//    • activeConversation — the open conversation window id (the
//                           window is a SEPARATE overlay: closing the
//                           panel never closes the conversation)
//    • drafts             — per-conversation unsent composer text,
//                           preserved across conversation switches
//                           and panel/window close (§SPEC: no lost
//                           drafts without multi-window complexity)
//
//  Deep links (notifications → navParams.conversationId) and the
//  Connect page shim call openWithConversation() — ONE entry point
//  that opens the panel AND the conversation, so every navigation
//  path converges on the same overlay instance (no duplicate
//  subscriptions — the floating root owns ALL Connect queries).
// ══════════════════════════════════════════════════════════════

import { create } from 'zustand';

interface ConnectFloatingState {
  panelOpen: boolean;
  activeConversationId: string | null;
  /** Conversation window visible (distinct from panel visibility). */
  windowOpen: boolean;
  /** Deep-link jump target (notification navParams.messageId) — read
   *  once by the window on mount, then cleared. */
  pendingJumpMessageId: string | null;
  /** Per-conversation unsent composer drafts (conversationId → text). */
  drafts: Record<string, string>;
  /** Launcher→panel opening; true from click until the panel closes. */
  openPanel: () => void;
  closePanel: () => void;
  /** Open (or focus) one conversation window; optionally opens the panel. */
  openConversation: (conversationId: string, options?: { openPanel?: boolean }) => void;
  /** Close the conversation window only (panel state untouched). */
  closeConversation: () => void;
  /** Hide the window but KEEP the active conversation (minimize). */
  minimizeConversation: () => void;
  /** Notification/page-shim entry: panel + conversation (+jump) together. */
  openWithConversation: (conversationId: string | null, messageId?: string | null) => void;
  /** Full reset (logout / cache identity change). */
  reset: () => void;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
}

export const useConnectFloatingStore = create<ConnectFloatingState>((set, get) => ({
  panelOpen: false,
  activeConversationId: null,
  windowOpen: false,
  pendingJumpMessageId: null,
  drafts: {},

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),

  openConversation: (conversationId, options) => set({
    activeConversationId: conversationId,
    windowOpen: true,
    ...(options?.openPanel ? { panelOpen: true } : {}),
  }),

  closeConversation: () => set({ windowOpen: false, activeConversationId: null }),

  minimizeConversation: () => set({ windowOpen: false }),

  openWithConversation: (conversationId, messageId) => {
    set({ pendingJumpMessageId: messageId ?? null });
    if (conversationId) {
      get().openConversation(conversationId, { openPanel: true });
    } else {
      get().openPanel();
    }
  },

  reset: () => set({ panelOpen: false, activeConversationId: null, windowOpen: false, drafts: {}, pendingJumpMessageId: null }),

  setDraft: (conversationId, text) => set((state) => ({
    drafts: { ...state.drafts, [conversationId]: text },
  })),
  clearDraft: (conversationId) => set((state) => {
    if (!(conversationId in state.drafts)) return state;
    const next = { ...state.drafts };
    delete next[conversationId];
    return { drafts: next };
  }),
}));
