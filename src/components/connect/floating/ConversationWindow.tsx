// src/components/connect/floating/ConversationWindow.tsx
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect — FLOATING CONVERSATION WINDOW
//
//  An independent overlay window for ONE conversation. It never
//  replaces the underlying QNALYS page and never reduces its width
//  (fixed positioning, zero layout participation). Desktop: a compact
//  card beside the panel; mobile: a near-full-screen sheet with back
//  navigation.
//
//  All message behavior is the EXISTING tested stack — use-connect
//  hooks (sync, optimistic send, read-on-view, typing) + MessageThread
//  + MessageComposer + ConversationDetails. No messaging logic is
//  duplicated here.
//
//  Drafts: the composer text persists per conversation in the
//  floating store across switches, minimize and close.
// ══════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Info, Loader2, Minus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf } from '@/components/connect/ConversationList';
import { useConnectFloatingStore } from './connect-floating-store';
import { MessageThread } from '@/components/connect/MessageThread';
import { MessageComposer } from '@/components/connect/MessageComposer';
import { ConversationDetails } from '@/components/connect/ConversationDetails';
import {
  useConnectConversations,
  useConnectMessages,
  useConnectSync,
  useConversationDetails,
  useConversationMutation,
  useConversationSearch,
  useDeleteMessage,
  useEditMessage,
  useLoadOlderMessages,
  useMarkRead,
  useSendMessage,
  useTogglePin,
  useTypingPing,
} from '@/hooks/use-connect';
import type { MessageView } from '@/lib/connect/types';

export interface ConversationWindowProps {
  conversationId: string;
  /** §RECOVERY — the positioned wrapper is always mounted (close
   *  transition); `open=false` gates ALL polling and read-marking. */
  open: boolean;
  myUserId: string;
  draft: string;
  onDraftChange: (text: string) => void;
  onClearDraft: () => void;
  /** Mobile back / desktop minimize (state kept, window hides). */
  onMinimize: () => void;
  /** Full close (draft kept for reopen). */
  onClose: () => void;
}

export function ConversationWindow({
  conversationId,
  open,
  myUserId,
  draft,
  onDraftChange,
  onClearDraft,
  onMinimize,
  onClose,
}: ConversationWindowProps) {
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [editing, setEditing] = useState<MessageView | null>(null);
  // §DERIVED-STATE — the window remounts per conversation (root key),
  // so the deep-link jump target initializes from the store's pending
  // value at first render. The store CLEAR happens in a post-mount
  // effect — a render-phase store write re-renders another component
  // mid-render (React render-phase update violation).
  const pendingJump = useConnectFloatingStore((s) => s.pendingJumpMessageId);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(pendingJump);
  useEffect(() => {
    if (pendingJump) {
      useConnectFloatingStore.setState({ pendingJumpMessageId: null });
    }
    // One clear per window mount (the jump target was already captured).
  }, []);

  // ── Data layer (same hooks the page used — one instance per window) ──
  // §RECOVERY — every subscription is gated on `open`: a minimized or
  // transitioning window polls NOTHING.
  const conversationsQuery = useConnectConversations(false, true);
  const listConversation = useMemo(
    () => (conversationsQuery.data ?? []).find((c) => c.id === conversationId) ?? null,
    [conversationsQuery.data, conversationId],
  );

  const messagesQuery = useConnectMessages(conversationId, open);
  const messagesCache = messagesQuery.data;
  const messages = messagesCache?.messages ?? [];

  const syncQuery = useConnectSync(conversationId, open && !searchOpen);
  const typing = (syncQuery.data?.typing ?? []).filter((t) => t.userId !== myUserId && t.until > Date.now());
  const pinnedMessageIds = syncQuery.data?.pinnedMessageIds ?? [];

  const detailsQuery = useConversationDetails(conversationId, open);
  const details = detailsQuery.data ?? null;

  const loadOlder = useLoadOlderMessages(conversationId);
  const markRead = useMarkRead(conversationId);
  // §LOOP-GUARD — mutate is the ONLY referentially stable piece of the
  // mutation result; depending on the whole object churned the
  // handleMessagesViewed identity every render, re-firing MessageThread's
  // read-marking effect in a synchronous loop (maximum update depth).
  const { mutate: markReadMutate } = markRead;
  const send = useSendMessage(conversationId);
  const edit = useEditMessage(conversationId);
  const deleteMsg = useDeleteMessage(conversationId, 'tombstone');
  const togglePin = useTogglePin(conversationId);
  const typingPing = useTypingPing(conversationId);
  const conversationMutations = useConversationMutation(conversationId);
  const searchQueryData = useConversationSearch(conversationId, searchText);

  // Display identity: details (authoritative) with a list fallback so a
  // just-created conversation renders instantly while details load.
  const title = details?.displayTitle ?? listConversation?.displayTitle ?? 'محادثة';
  const subtitle = details
    ? (details.type === 'direct'
        ? 'محادثة مباشرة'
        : `${details.memberCount} عضو${details.type === 'department' ? ' · جهة تنظيمية' : ''}`)
    : (listConversation
        ? (listConversation.type === 'direct' ? 'محادثة مباشرة' : `${listConversation.memberCount} عضو`)
        : 'جارٍ التحميل...');
  const isArchived = Boolean(listConversation?.archivedAt);
  // §AVATAR-SOURCE — the other participant's existing profile picture
  // (details join; list avatarUrl as fallback while details load).
  const headerAvatarUrl = details?.type === 'direct'
    ? (details.members.find((m) => m.userId !== myUserId)?.photoUrl ?? details.avatarUrl ?? null)
    : (details?.avatarUrl ?? listConversation?.avatarUrl ?? null);
  const headerIsDirect = (details?.type ?? listConversation?.type) === 'direct';

  // ── Read on view (§SPEC-10) — never while the window is hidden ──
  // §LOOP-GUARD — stable deps + per-target dedupe: repeated effect
  // fires with the same newest id are no-ops even while the list
  // refetch is still in flight.
  const lastReadRequestedRef = useRef<string | null>(null);
  const handleMessagesViewed = useCallback((lastMessageId: string) => {
    if (!open) return;
    if (lastReadRequestedRef.current === lastMessageId) return;
    const conv = listConversation;
    if (conv && conv.lastReadMessageId === lastMessageId) {
      lastReadRequestedRef.current = lastMessageId;
      return;
    }
    lastReadRequestedRef.current = lastMessageId;
    markReadMutate(lastMessageId);
  }, [open, listConversation, markReadMutate]);

  const handleTyping = useCallback(() => {
    typingPing.mutate();
  }, [typingPing]);

  const handleSend = (input: { body: string; clientKey: string; replyToId: string | null; mentions: string[] | null }) => {
    send.mutate(input, {
      onError: (err) => toast.error(err.message || 'تعذر إرسال الرسالة — أعد المحاولة'),
    });
    onClearDraft();
    setReplyTo(null);
  };

  const handleEditSave = (messageId: string, body: string) => {
    edit.mutate(
      { messageId, body },
      {
        onSuccess: () => { toast.success('تم تعديل الرسالة'); setEditing(null); },
        onError: (err) => toast.error(err.message || 'تعذر التعديل'),
      },
    );
  };

  const handleDelete = (message: MessageView) => {
    deleteMsg.mutate(
      { messageId: message.id },
      { onError: (err) => toast.error(err.message || 'تعذر حذف الرسالة') },
    );
  };

  const handleTogglePin = (message: MessageView, pinned: boolean) => {
    togglePin.mutate(
      { messageId: message.id, pinned },
      {
        onSuccess: () => toast.success(pinned ? 'تم تثبيت الرسالة' : 'تم إلغاء التثبيت'),
        onError: (err) => toast.error(err.message || 'تعذر التثبيت'),
      },
    );
  };

  const handleArchiveToggle = (archived: boolean) => {
    conversationMutations.patch.mutate(
      { archived },
      { onError: (err) => toast.error(err.message || 'تعذر التحديث') },
    );
  };

  const handleMuteToggle = (muted: boolean) => {
    conversationMutations.patch.mutate(
      { mutedUntil: muted ? Date.now() + 8 * 3_600_000 : null },
      { onError: (err) => toast.error(err.message || 'تعذر التحديث') },
    );
  };

  // Pinned banner excerpts — derived from loaded messages (no fetches).
  const pinnedExcerpts = useMemo(
    () => pinnedMessageIds.map((messageId) => {
      const message = messages.find((m) => m.id === messageId);
      return {
        messageId,
        senderName: message?.senderName ?? null,
        excerpt: message?.body ? message.body.slice(0, 80) : message?.deletedAt ? 'تم حذف هذه الرسالة' : null,
      };
    }),
    [pinnedMessageIds, messages],
  );

  // Escape closes overlays only when focus is INSIDE this window —
  // a page-level dialog keeps its own Escape behavior untouched.
  // (Plain Escape → minimize is handled by the positioned wrapper;
  // here only the inner search/details surfaces are dismissed.)
  const handleWindowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (searchOpen) { setSearchOpen(false); setSearchText(''); return; }
    if (detailsOpen) { setDetailsOpen(false); setMobileDetailsOpen(false); }
  };

  return (
    <div
      // Fills the positioned motion wrapper (root owns placement:
      // near-full-screen on mobile, compact card beside the panel on
      // desktop). §RECOVERY — inline box fallbacks keep the window a
      // visible, bounded surface regardless of stylesheet state.
      className="flex flex-col overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/95 backdrop-blur-md shadow-2xl shadow-black/50"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: '1rem',
        border: '1px solid rgba(51, 65, 85, 0.7)',
        background: 'rgba(15, 23, 42, 0.95)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}
      onKeyDown={handleWindowKeyDown}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800 bg-slate-900/80 shrink-0">
        {/* Mobile back */}
        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden h-8 w-8 p-0 text-slate-300 shrink-0"
          onClick={onMinimize}
          aria-label="رجوع"
        >
          <ArrowRight className="w-4 h-4" />
        </Button>

        <Avatar className="h-8 w-8 border border-slate-700 shrink-0">
          {headerIsDirect && headerAvatarUrl && (
            <AvatarImage src={headerAvatarUrl} alt={title} />
          )}
          <AvatarFallback className="bg-slate-700/60 text-slate-200 text-[11px] font-bold">
            {initialsOf(title)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-200 truncate">{title}</p>
          <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>
        </div>

        {/* In-conversation search toggle */}
        <Button
          variant="ghost"
          size="sm"
          className={`h-8 w-8 p-0 shrink-0 ${searchOpen ? 'text-emerald-400' : 'text-slate-400'}`}
          onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchText(''); }}
          aria-label="بحث في المحادثة"
          title="بحث داخل هذه المحادثة"
        >
          <Search className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-slate-400 shrink-0"
          onClick={() => { setDetailsOpen(true); setMobileDetailsOpen(true); }}
          aria-label="بيانات المحادثة"
          title="بيانات المحادثة"
        >
          <Info className="w-4 h-4" />
        </Button>
        {/* Minimize (desktop) */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden sm:inline-flex h-8 w-8 p-0 text-slate-400 shrink-0"
          onClick={onMinimize}
          aria-label="تصغير المحادثة"
          title="تصغير"
        >
          <Minus className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-slate-400 shrink-0"
          onClick={onClose}
          aria-label="إغلاق المحادثة"
          title="إغلاق"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/40 space-y-1.5 shrink-0">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              autoFocus
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="ابحث في هذه المحادثة..."
              className="pr-9 bg-slate-800/50 border-slate-700 text-slate-200 text-sm"
            />
          </div>
          {searchText.trim().length >= 2 && (
            <WindowSearchResults
              isLoading={searchQueryData.isLoading}
              results={searchQueryData.data?.messages ?? []}
              partialCoverage={searchQueryData.data?.partialCoverage ?? false}
              onJump={(messageId) => { setJumpToMessageId(messageId); setSearchOpen(false); }}
            />
          )}
        </div>
      )}

      {/* Thread + composer (existing tested components) */}
      <MessageThread
        conversation={details ?? listConversation}
        members={details?.members ?? []}
        messages={messages}
        isLoading={messagesQuery.isLoading || syncQuery.isLoading}
        hasOlder={messagesCache?.hasOlder ?? false}
        myUserId={myUserId}
        typingUserIds={typing.map((t) => t.userId)}
        pinnedMessageIds={pinnedMessageIds}
        pinnedExcerpts={pinnedExcerpts}
        jumpToMessageId={jumpToMessageId}
        onLoadOlder={() => loadOlder.mutate()}
        isLoadingOlder={loadOlder.isPending}
        onReply={setReplyTo}
        onEdit={setEditing}
        onDelete={handleDelete}
        onTogglePin={handleTogglePin}
        onMessagesViewed={handleMessagesViewed}
      />

      {!isArchived ? (
        <MessageComposer
          // §DERIVED-STATE — keyed by the edit session (edit prefills via
          // remount); the window itself is keyed per conversation by the
          // root, so switching conversations restores the stored draft
          // through initialBody.
          key={editing?.id ?? 'composer'}
          members={details?.members ?? []}
          myUserId={myUserId}
          replyTo={replyTo}
          editing={editing}
          initialBody={draft}
          onBodyChange={onDraftChange}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSend={handleSend}
          onEditSave={handleEditSave}
          onTyping={handleTyping}
          disabled={send.isPending}
        />
      ) : (
        <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-3 text-center text-xs text-slate-500 shrink-0">
          هذه المحادثة مؤرشفة لديك — ألغِ الأرشفة من بيانات المحادثة لإرسال رسائل.
        </div>
      )}

      {/* Details dialog (existing component) */}
      <ConversationDetails
        conversationId={conversationId}
        details={details}
        open={detailsOpen || mobileDetailsOpen}
        onOpenChange={(v) => { setDetailsOpen(v); setMobileDetailsOpen(v); }}
        myUserId={myUserId}
        isArchived={isArchived}
        isMuted={Boolean(listConversation?.mutedUntil && listConversation.mutedUntil > Date.now())}
        onArchiveToggle={handleArchiveToggle}
        onMuteToggle={handleMuteToggle}
      />

      {syncQuery.isFetching && !syncQuery.data && (
        <div className="absolute bottom-16 left-3 flex items-center gap-2 rounded-full bg-slate-800/90 border border-slate-700 px-3 py-1.5 text-xs text-slate-300">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> مزامنة...
        </div>
      )}
    </div>
  );
}

// ─── Search results dropdown content ───────────────────────────

function WindowSearchResults({ isLoading, results, partialCoverage, onJump }: {
  isLoading: boolean;
  results: MessageView[];
  partialCoverage: boolean;
  onJump: (messageId: string) => void;
}) {
  if (isLoading) {
    return (
      <p className="text-xs text-slate-500 px-1 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ البحث...
      </p>
    );
  }
  if (results.length === 0) {
    return <p className="text-xs text-slate-500 px-1">لا توجد نتائج مطابقة في هذه المحادثة</p>;
  }
  return (
    <div className="space-y-1 max-h-40 overflow-y-auto">
      {partialCoverage && (
        <p className="text-[10px] text-slate-500 px-1">تم البحث في أحدث 400 رسالة فقط</p>
      )}
      {results.map((m) => (
        <button
          key={m.id}
          onClick={() => onJump(m.id)}
          className="w-full text-right rounded-lg px-2.5 py-1.5 hover:bg-slate-800/70"
        >
          <p className="text-xs font-semibold text-emerald-400">{m.senderName ?? 'مستخدم'}</p>
          <p className="text-xs text-slate-300 line-clamp-1">{m.body}</p>
        </button>
      ))}
    </div>
  );
}
