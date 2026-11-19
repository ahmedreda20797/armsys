// src/components/connect/ConversationList.tsx
// ══════════════════════════════════════════════════════════════
//  Connect UI — conversation list (desktop pane + mobile home)
//
//  Arabic-first RTL, bounded unread badges (99+ above the cap),
//  archive filter, local text filter, and the new-conversation
//  entry point. List data comes from useConnectConversations.
// ══════════════════════════════════════════════════════════════

'use client';

import { useMemo, useState } from 'react';
import { Archive, MessagesSquare, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { ConversationView } from '@/lib/connect/types';

// ─── Small presentational helpers ──────────────────────────────

export function initialsOf(name: string | null | undefined): string {
  if (!name) return '؟';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

export function formatRelativeTime(ms: number | null): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'الآن';
  if (diff < 3_600_000) return `قبل ${Math.floor(diff / 60_000)} د`;
  if (diff < 86_400_000) return `قبل ${Math.floor(diff / 3_600_000)} س`;
  if (diff < 7 * 86_400_000) return `قبل ${Math.floor(diff / 86_400_000)} ي`;
  return new Date(ms).toLocaleDateString('ar', { month: 'short', day: 'numeric' });
}

function ConversationAvatar({ conversation }: { conversation: ConversationView }) {
  if (conversation.type === 'direct') {
    return (
      <Avatar className="h-11 w-11 border border-slate-700">
        <AvatarFallback className="bg-slate-700/60 text-slate-200 text-sm font-bold">
          {initialsOf(conversation.displayTitle)}
        </AvatarFallback>
      </Avatar>
    );
  }
  return (
    <div className="h-11 w-11 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
      {conversation.type === 'department'
        ? <Users className="w-5 h-5 text-emerald-400" />
        : <MessagesSquare className="w-5 h-5 text-emerald-400" />}
    </div>
  );
}

function UnreadBadge({ count, truncated }: { count: number; truncated: boolean }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center justify-center min-w-[1.4rem] h-6 px-1.5 rounded-full bg-emerald-500 text-white text-xs font-bold">
      {truncated ? '٩٩+' : count > 99 ? '٩٩+' : count}
    </span>
  );
}

// ─── The list ──────────────────────────────────────────────────

export interface ConversationListProps {
  conversations: ConversationView[];
  isLoading: boolean;
  activeId: string | null;
  onSelect: (conversationId: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  archivedCount: number;
  onNewConversation: () => void;
}

export function ConversationList({
  conversations,
  isLoading,
  activeId,
  onSelect,
  showArchived,
  onToggleArchived,
  archivedCount,
  onNewConversation,
}: ConversationListProps) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const scoped = conversations.filter((c) => (showArchived ? Boolean(c.archivedAt) : !c.archivedAt));
    if (!q) return scoped;
    return scoped.filter((c) =>
      (c.displayTitle ?? '').toLowerCase().includes(q) ||
      (c.lastMessagePreview ?? '').toLowerCase().includes(q));
  }, [conversations, filter, showArchived]);

  return (
    <div className="flex flex-col h-full border-l border-slate-800 bg-slate-900/40">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-200">المحادثات</h2>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleArchived}
              title={showArchived ? 'عرض المحادثات النشطة' : 'عرض المحادثات المؤرشفة'}
              className={showArchived ? 'text-emerald-400' : 'text-slate-400'}
            >
              <Archive className="w-4 h-4" />
              {archivedCount > 0 && (
                <span className="text-xs mr-1">{archivedCount}</span>
              )}
            </Button>
            <Button size="sm" onClick={onNewConversation} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              محادثة جديدة
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="تصفية المحادثات..."
            className="pr-9 bg-slate-800/50 border-slate-700 text-slate-200 placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* List body */}
      <ScrollArea className="flex-1">
        {isLoading && conversations.length === 0 ? (
          <div className="p-3 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 rounded-full bg-slate-800/60" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3 bg-slate-800/60" />
                  <Skeleton className="h-3 w-1/2 bg-slate-800/40" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-4">
              <MessagesSquare className="w-7 h-7 text-slate-500" />
            </div>
            <p className="text-sm font-semibold text-slate-300 mb-1">
              {showArchived ? 'لا توجد محادثات مؤرشفة' : 'لا توجد محادثات بعد'}
            </p>
            <p className="text-xs text-slate-500 mb-4">ابدأ أول محادثة مع زملائك من النظام</p>
            {!showArchived && (
              <Button size="sm" variant="outline" onClick={onNewConversation} className="border-slate-600 text-slate-200">
                محادثة جديدة
              </Button>
            )}
          </div>
        ) : (
          <div className="py-2" role="list">
            {filtered.map((conversation) => (
              <button
                key={conversation.id}
                role="listitem"
                onClick={() => onSelect(conversation.id)}
                className={`w-full text-right flex items-center gap-3 px-4 py-3 transition-colors border-r-2 ${
                  activeId === conversation.id
                    ? 'bg-slate-800/70 border-emerald-500'
                    : 'border-transparent hover:bg-slate-800/40'
                }`}
              >
                <ConversationAvatar conversation={conversation} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${conversation.unreadCount > 0 ? 'font-bold text-slate-100' : 'font-medium text-slate-300'}`}>
                      {conversation.displayTitle}
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {formatRelativeTime(conversation.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="truncate text-xs text-slate-500">
                      {conversation.lastMessagePreview
                        ? conversation.lastMessagePreview
                        : conversation.type === 'direct' ? 'ابدأ المحادثة' : 'لا توجد رسائل بعد'}
                    </span>
                    <UnreadBadge count={conversation.unreadCount} truncated={conversation.unreadCountTruncated} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
