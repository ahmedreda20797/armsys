// src/components/pages/ConnectPage.tsx
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect — PAGE SHIM (1.0.1 floating redesign)
//
//  Connect's actual interface is the FLOATING overlay owned by
//  ConnectFloatingRoot (mounted once in AppLayout): far-left
//  launcher + emerging panel + floating conversation windows. This
//  page shim exists for the navigation paths that still target the
//  'connect' page id — notification deep links
//  (navParams.conversationId / messageId) and browser-history
//  restores — and converts each visit into ONE overlay open. Connect
//  is overlayOnly in APP_PAGES (no sidebar entry; §CONNECT-FLOATING).
//
//  §NO-DUPLICATE-SUBSCRIPTIONS: the page mounts NO Connect queries.
//  All polling lives in the floating root, so navigating between
//  QNALYS pages never double-polls the conversation list.
// ══════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect } from 'react';
import { MessagesSquare, PanelLeftOpen } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { Button } from '@/components/ui/button';
import { useConnectFloatingStore } from '@/components/connect/floating/connect-floating-store';

export default function ConnectPage() {
  // ── Identity registration (existing header conventions) ──
  const setPageIdentity = useAppStore((s) => s.setPageIdentity);
  useEffect(() => {
    setPageIdentity({
      pageId: 'connect',
      value: {
        title: 'تواصل',
        description: 'المحادثات الداخلية للفريق — لوحة التواصل العائمة',
        icon: <MessagesSquare className="w-5 h-5" />,
      },
    });
  }, [setPageIdentity]);

  // ── Deep links (notifications: navParams.conversationId/messageId) — derived
  // from the page-remount convention: the page remounts on navigation,
  // so the deep link initializes the open action directly.
  const navParams = useAppStore((s) => s.navParams);
  const deepLinkConversationId = (navParams?.conversationId as string | undefined) || null;
  const deepLinkMessageId = (navParams?.messageId as string | undefined) || null;

  useEffect(() => {
    useConnectFloatingStore.getState().openWithConversation(deepLinkConversationId, deepLinkMessageId);
    // One open per page visit (the page remounts per navigation).
  }, [deepLinkConversationId, deepLinkMessageId]);

  // §RECOVERY — the page is a LIVE CONTROL, never a dead end: opening
  // (or re-opening) the overlay works from here even if the user
  // closed the panel after landing.
  const panelOpen = useConnectFloatingStore((s) => s.panelOpen);
  const openPanel = useConnectFloatingStore((s) => s.openPanel);
  const handleOpen = useCallback(() => openPanel(), [openPanel]);

  // The real interface is the overlay; the page area stays passive
  // apart from the explicit open control.
  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[calc(100vh-64px)]" data-page="connect">
      <PageHeaderBar
        icon={<MessagesSquare className="w-5 h-5" />}
        title="تواصل"
      />
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 border-t border-slate-800">
        <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-4">
          <MessagesSquare className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-300 mb-1">
          {panelOpen ? 'لوحة التواصل مفتوحة' : 'لوحة التواصل'}
        </h3>
        <p className="text-sm text-slate-500 max-w-md mb-4">
          المحادثات تعمل في لوحة عائمة على يسار الشاشة أثناء تصفح أي صفحة — استخدم زر التواصل في الطرف الأيسر.
        </p>
        <Button
          onClick={handleOpen}
          className="bg-emerald-600 hover:bg-emerald-500 text-white"
          aria-label="فتح لوحة التواصل"
        >
          <PanelLeftOpen className="w-4 h-4 ml-2" />
          {panelOpen ? 'اللوحة معروضة على اليسار' : 'فتح لوحة التواصل'}
        </Button>
      </div>
    </div>
  );
}
