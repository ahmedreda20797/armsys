// src/components/connect/MessageThread.tsx
// ══════════════════════════════════════════════════════════════
//  Connect UI — message history for the active conversation
//
//  Message grouping (same sender within MESSAGE_GROUP_WINDOW_MS),
//  date separators, pinned banner, "load older" pagination, jump-to-
//  message for search results / deep links, auto-mark-read on view,
//  and typing indicators. RTL-first.
// ══════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Loader2, MessagesSquare, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MESSAGE_GROUP_WINDOW_MS } from '@/lib/connect/constants';
import type {
  ConversationMemberView,
  ConversationView,
  MessageView,
} from '@/lib/connect/types';
import { MessageBubble } from './MessageBubble';

export interface MessageThreadProps {
  conversation: ConversationView | null;
  members: ConversationMemberView[];
  messages: MessageView[];
  isLoading: boolean;
  hasOlder: boolean;
  myUserId: string;
  typingUserIds: string[];
  pinnedMessageIds: string[];
  pinnedExcerpts: { messageId: string; senderName: string | null; excerpt: string | null }[];
  /** Message id to scroll to + highlight (deep link / search jump). */
  jumpToMessageId: string | null;
  onLoadOlder: () => void;
  isLoadingOlder: boolean;
  onReply: (message: MessageView) => void;
  onEdit: (message: MessageView) => void;
  onDelete: (message: MessageView) => void;
  onTogglePin: (message: MessageView, pinned: boolean) => void;
  /** Fired when the thread is open and the newest message changes (§SPEC-10 read-on-view). */
  onMessagesViewed: (lastMessageId: string) => void;
}

function sameDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(ms: number): string {
  const today = new Date();
  const d = new Date(ms);
  if (sameDay(ms, today.getTime())) return 'اليوم';
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (sameDay(ms, yesterday.getTime())) return 'أمس';
  return d.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function MessageThread({
  conversation,
  members,
  messages,
  isLoading,
  hasOlder,
  myUserId,
  typingUserIds,
  pinnedMessageIds,
  pinnedExcerpts,
  jumpToMessageId,
  onLoadOlder,
  isLoadingOlder,
  onReply,
  onEdit,
  onDelete,
  onTogglePin,
  onMessagesViewed,
}: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  const lastSeenMessageIdRef = useRef<string | null>(null);

  const activeMemberCount = members.length;
  const readByMap = useMemo(() => {
    // member.hasRead reflects "read cursor ≥ conversation.lastMessageId"
    // — the group indicator for the newest message.
    const readers = members.filter((m) => m.userId !== myUserId && m.hasRead);
    return readers.length;
  }, [members, myUserId]);

  // ── Auto-scroll: follow the newest message when near the bottom ──
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 220;
    if (lastMessageId !== lastSeenMessageIdRef.current) {
      lastSeenMessageIdRef.current = lastMessageId;
      if (nearBottom || messages.length <= 5) {
        bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
      // When scrolled up, the onScroll handler already owns the
      // jump-button visibility (no setState in the effect body).
    }
  }, [lastMessageId, messages.length]);

  // ── Jump-to-message (search result / notification deep link) ──
  // The parent owns jumpToMessageId and clears it after 3s; the
  // highlight derives directly from it (no local setState-in-effect).
  useEffect(() => {
    if (!jumpToMessageId) return;
    const el = document.getElementById(`connect-msg-${jumpToMessageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [jumpToMessageId]);

  // ── Mark read on open / on new messages (cursor = newest rendered) ──
  useEffect(() => {
    if (lastMessageId) onMessagesViewed(lastMessageId);
  }, [lastMessageId, onMessagesViewed]);

  const canManage = conversation?.myRole === 'owner' || conversation?.myRole === 'admin';
  const isDirect = conversation?.type === 'direct';

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-4">
          <MessagesSquare className="w-8 h-8 text-slate-500" />
        </div>
        <h3 className="text-lg font-bold text-slate-300 mb-1">اختر محادثة</h3>
        <p className="text-sm text-slate-500">اختر محادثة من القائمة أو أنشئ محادثة جديدة</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 relative">
      {/* Pinned banner */}
      {pinnedMessageIds.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 flex items-center gap-2 overflow-x-auto">
          <Pin className="w-4 h-4 text-amber-400 shrink-0" />
          {pinnedExcerpts.slice(0, 3).map((p) => (
            <button
              key={p.messageId}
              onClick={() => {
                const el = document.getElementById(`connect-msg-${p.messageId}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="text-xs text-slate-300 hover:text-emerald-400 truncate max-w-[240px]"
              title={p.excerpt ?? ''}
            >
              {p.senderName ? `${p.senderName}: ` : ''}{p.excerpt ?? 'رسالة'}
            </button>
          ))}
          {pinnedMessageIds.length > 3 && (
            <Badge variant="outline" className="border-slate-600 text-slate-400 shrink-0">
              +{pinnedMessageIds.length - 3}
            </Badge>
          )}
        </div>
      )}

      {/* Messages scroll area */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setShowJumpButton(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
        }}
        className="flex-1 overflow-y-auto py-3 min-h-0"
        role="log"
        aria-label="سجل الرسائل"
      >
        {isLoading && messages.length === 0 ? (
          <div className="space-y-4 px-6 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`flex ${i % 2 ? 'justify-start' : 'justify-end'}`}>
                <div className="h-12 rounded-2xl bg-slate-800/50 animate-pulse" style={{ width: `${40 + i * 8}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            {hasOlder && (
              <div className="flex justify-center py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLoadOlder}
                  disabled={isLoadingOlder}
                  className="text-slate-400 hover:text-slate-200"
                >
                  {isLoadingOlder ? <Loader2 className="w-4 h-4 animate-spin ml-1.5" /> : null}
                  عرض الرسائل الأقدم
                </Button>
              </div>
            )}

            {messages.map((message, index) => {
              const prev = index > 0 ? messages[index - 1] : null;
              const isFirstOfGroup = !prev
                || prev.senderUserId !== message.senderUserId
                || message.createdAtMs - prev.createdAtMs > MESSAGE_GROUP_WINDOW_MS
                || !sameDay(prev.createdAtMs, message.createdAtMs);
              const showDaySeparator = !prev || !sameDay(prev.createdAtMs, message.createdAtMs);

              return (
                <div key={message.id}>
                  {showDaySeparator && (
                    <div className="flex justify-center my-3">
                      <span className="text-[11px] text-slate-500 bg-slate-800/60 rounded-full px-3 py-1">
                        {dayLabel(message.createdAtMs)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    isOwn={message.senderUserId === myUserId || message.senderUserId === '__me__'}
                    isFirstOfGroup={isFirstOfGroup}
                    showSender={conversation.type !== 'direct'}
                    senderName={message.senderName}
                    pending={message.id.startsWith('pending:')}
                    readByCount={readByMap}
                    totalOtherMembers={Math.max(0, activeMemberCount - 1)}
                    canPin={isDirect || canManage}
                    isPinned={pinnedMessageIds.includes(message.id)}
                    canDelete={
                      message.senderUserId === myUserId
                      || message.senderUserId === '__me__'
                      || (!isDirect && canManage)
                    }
                    canEdit={message.senderUserId === myUserId || message.senderUserId === '__me__'}
                    onReply={onReply}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onTogglePin={onTogglePin}
                    highlight={jumpToMessageId === message.id}
                  />
                </div>
              );
            })}

            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-4">
                  <MessagesSquare className="w-7 h-7 text-slate-500" />
                </div>
                <p className="text-sm font-semibold text-slate-300 mb-1">لا توجد رسائل بعد</p>
                <p className="text-xs text-slate-500">اكتب أول رسالة لبدء المحادثة</p>
              </div>
            )}

            {/* Typing indicator */}
            {typingUserIds.length > 0 && (
              <div className="flex items-center gap-2 px-6 py-2 text-xs text-slate-400">
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '240ms' }} />
                </span>
                {typingUserIds.length === 1
                  ? `${members.find((m) => m.userId === typingUserIds[0])?.name ?? 'أحدهم'} يكتب...`
                  : `${typingUserIds.length} أعضاء يكتبون...`}
              </div>
            )}

            <div ref={bottomAnchorRef} />
          </>
        )}
      </div>

      {/* Jump-to-latest */}
      {showJumpButton && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-24 left-4 rounded-full h-9 w-9 p-0 border-slate-600 bg-slate-800/90 text-slate-200 hover:bg-slate-700"
          aria-label="الانتقال لأحدث رسالة"
        >
          <ArrowDown className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
