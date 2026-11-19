// src/components/connect/floating/ConnectPanel.tsx
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect — FLOATING CONVERSATION PANEL
//
//  Emerges from the far-left launcher (transformOrigin at the button
//  — see connect-animations.ts). Fixed positioning, zero layout
//  width. Two states driven by ONE search field:
//    • empty query  → the conversation list (compact rows)
//    • query ≥ 2    → ACCOUNT SEARCH results (the ONLY direct-chat
//                     entry workflow — selecting an account opens or
//                     creates THE direct conversation; no confirm
//                     dialog, no creation button)
//  Group/department creation keeps its existing dialog workflow.
// ══════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessagesSquare, Network, Search, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initialsOf, formatRelativeTime } from '@/components/connect/ConversationList';
import { useConnectAccountSearch } from '@/hooks/use-connect';
import { ACCOUNT_SEARCH_MIN } from '@/lib/connect/constants';
import type { ConversationView } from '@/lib/connect/types';

export interface ConnectPanelProps {
  conversations: ConversationView[];
  isLoading: boolean;
  activeId: string | null;
  myUserId: string;
  /** Resolving a picked account into a direct conversation (pending state). */
  pendingAccountId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onPickAccount: (userId: string) => void;
  onClose: () => void;
  onNewGroup: () => void;
}

/** 250ms debounce — keeps account search from firing per keystroke. */
function useDebouncedValue(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function ConnectPanel({
  conversations,
  isLoading,
  activeId,
  pendingAccountId,
  onSelectConversation,
  onPickAccount,
  onClose,
  onNewGroup,
}: ConnectPanelProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const searching = debouncedQuery.trim().length >= ACCOUNT_SEARCH_MIN;

  const activeConversations = useMemo(
    () => conversations.filter((c) => !c.archivedAt),
    [conversations],
  );
  const totalUnread = useMemo(
    () => activeConversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [activeConversations],
  );

  return (
    <div
      // The positioned wrapper (in ConnectFloatingRoot) owns the dialog
      // role, testid, aria, Escape handling AND the responsive size —
      // this card fills it (§RESPONSIVE).
      className="flex flex-col h-full overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/95 backdrop-blur-md shadow-2xl shadow-black/50"
      style={{
        // §RECOVERY — inline box fallbacks: the panel stays a visible,
        // bounded card even if utility classes lag the stylesheet.
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
    >
      {/* Header — identity + unread summary + close */}
      <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-3 border-b border-slate-800">
        <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
          <MessagesSquare className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-100 leading-tight">تواصل</p>
          <p className="text-[11px] text-slate-500 leading-tight">
            {totalUnread > 0 ? `${totalUnread} رسالة غير مقروءة` : 'المحادثات الداخلية للفريق'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-slate-400 hover:text-slate-200 shrink-0"
          onClick={onNewGroup}
          aria-label="إنشاء مجموعة جديدة"
          title="إنشاء مجموعة أو محادثة جهة"
        >
          <Users className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-slate-400 hover:text-slate-200 shrink-0"
          onClick={onClose}
          aria-label="إغلاق لوحة المحادثات"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Account search — the ONLY direct-conversation entry workflow */}
      <div className="px-3.5 py-2.5 border-b border-slate-800">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن حساب مستخدم لبدء محادثة..."
            aria-label="البحث في حسابات المستخدمين"
            className="pr-9 bg-slate-800/60 border-slate-700 text-slate-200 placeholder:text-slate-500 text-sm h-9"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              aria-label="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body — conversations OR account results */}
      {searching ? (
        <AccountSearchResults
          query={debouncedQuery.trim()}
          pendingAccountId={pendingAccountId}
          onPickAccount={onPickAccount}
        />
      ) : (
        <ConversationRows
          conversations={activeConversations}
          isLoading={isLoading}
          activeId={activeId}
          onSelect={onSelectConversation}
        />
      )}
    </div>
  );
}

// ─── Account search results ────────────────────────────────────

function AccountSearchResults({
  query,
  pendingAccountId,
  onPickAccount,
}: {
  query: string;
  pendingAccountId: string | null;
  onPickAccount: (userId: string) => void;
}) {
  const { data, isLoading, isError, error } = useConnectAccountSearch(query, true);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        <span className="text-xs text-slate-500 mr-2">جارٍ البحث في الحسابات...</span>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 px-6 text-center">
        <p className="text-sm text-amber-400 font-semibold mb-1">تعذر البحث</p>
        <p className="text-xs text-slate-500">{error instanceof Error ? error.message : 'حدث خطأ أثناء البحث — أعد المحاولة'}</p>
      </div>
    );
  }
  const accounts = data ?? [];
  if (accounts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 px-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-3">
          <Search className="w-5 h-5 text-slate-500" />
        </div>
        <p className="text-sm font-semibold text-slate-300 mb-1">لا توجد حسابات مطابقة</p>
        <p className="text-xs text-slate-500">جرّب اسماً أو بريداً مختلفاً</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto py-1.5" role="listbox" aria-label="نتائج البحث عن الحسابات">
      <p className="px-3.5 pb-1.5 pt-1 text-[10px] text-slate-500">اختر حساباً لفتح المحادثة المباشرة أو إنشائها</p>
      {accounts.map((account) => (
        <button
          key={account.id}
          role="option"
          aria-selected="false"
          disabled={pendingAccountId === account.id}
          onClick={() => onPickAccount(account.id)}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-right transition-colors hover:bg-slate-800/60 disabled:opacity-60"
        >
          <Avatar className="h-9 w-9 border border-slate-700">
            {account.photoUrl && (
              <AvatarImage src={account.photoUrl} alt={account.name ?? 'صورة المستخدم'} />
            )}
            <AvatarFallback className="bg-slate-700/60 text-slate-200 text-xs font-bold">
              {initialsOf(account.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 truncate">{account.name ?? 'مستخدم'}</p>
            {pendingAccountId === account.id && (
              <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin inline" /> جارٍ فتح المحادثة...
              </p>
            )}
          </div>
          <MessagesSquare className="w-4 h-4 text-slate-500 shrink-0" />
        </button>
      ))}
    </div>
  );
}

// ─── Conversation rows ─────────────────────────────────────────

function ConversationRows({
  conversations,
  isLoading,
  activeId,
  onSelect,
}: {
  conversations: ConversationView[];
  isLoading: boolean;
  activeId: string | null;
  onSelect: (conversationId: string) => void;
}) {
  if (isLoading && conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
        <span className="text-xs text-slate-500 mr-2">جارٍ تحميل المحادثات...</span>
      </div>
    );
  }
  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 px-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-3">
          <Network className="w-5 h-5 text-slate-500" />
        </div>
        <p className="text-sm font-semibold text-slate-300 mb-1">لا توجد محادثات بعد</p>
        <p className="text-xs text-slate-500">ابحث عن حساب مستخدم في الأعلى لبدء أول محادثة</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto py-1.5" role="list">
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeId;
        return (
          <button
            key={conversation.id}
            role="listitem"
            onClick={() => onSelect(conversation.id)}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-right transition-colors border-r-2 ${
              isActive
                ? 'bg-slate-800/80 border-emerald-500'
                : 'border-transparent hover:bg-slate-800/40'
            }`}
          >
            {/* Avatar — direct: the other participant's existing profile
                picture (canonical photoURL); groups keep the icon. */}
            {conversation.type === 'direct' ? (
              <Avatar className="h-9 w-9 border border-slate-700 shrink-0">
                {conversation.avatarUrl && (
                  <AvatarImage src={conversation.avatarUrl} alt={conversation.displayTitle} />
                )}
                <AvatarFallback className="bg-slate-700/60 text-slate-200 text-xs font-bold">
                  {initialsOf(conversation.displayTitle)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="h-9 w-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                {conversation.type === 'department'
                  ? <Network className="w-4 h-4 text-emerald-400" />
                  : <Users className="w-4 h-4 text-emerald-400" />}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-[13px] ${conversation.unreadCount > 0 ? 'font-bold text-slate-100' : 'font-medium text-slate-300'}`}>
                  {conversation.displayTitle}
                </span>
                <span className="text-[10px] text-slate-500 shrink-0">
                  {formatRelativeTime(conversation.lastMessageAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="truncate text-[11px] text-slate-500">
                  {conversation.lastMessagePreview
                    ?? (conversation.type === 'direct' ? 'ابدأ المحادثة' : 'لا توجد رسائل بعد')}
                </span>
                {conversation.unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold shrink-0">
                    {conversation.unreadCountTruncated || conversation.unreadCount > 99 ? '٩٩+' : conversation.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
