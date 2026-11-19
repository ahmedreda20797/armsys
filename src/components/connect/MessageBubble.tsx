// src/components/connect/MessageBubble.tsx
// ══════════════════════════════════════════════════════════════
//  Connect UI — one message bubble
//
//  Tombstone rendering ("تم حذف هذه الرسالة"), reply previews,
//  mention highlights, internal record links, edit markers, group
//  read indicators, and the touch-friendly action menu. RTL-safe.
// ══════════════════════════════════════════════════════════════

'use client';

import React from 'react';
import { Check, CheckCheck, MoreVertical, Pencil, Pin, PinOff, Reply, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initialsOf } from './ConversationList';
import type { ConversationView, MessageView } from '@/lib/connect/types';

const REFERENCE_LABELS: Record<string, string> = {
  employee: 'موظف',
  orgNode: 'جهة تنظيمية',
  capaCase: 'حالة كابا',
  complaint: 'شكوى عميل',
  followUp: 'متابعة',
  requests: 'طلب',
};

export interface MessageBubbleProps {
  message: MessageView;
  isOwn: boolean;
  isFirstOfGroup: boolean;
  showSender: boolean;
  senderName: string | null;
  pending?: boolean;
  /** Group indicator: members who read up to this message. */
  readByCount: number;
  totalOtherMembers: number;
  canPin: boolean;
  isPinned: boolean;
  canDelete: boolean;
  canEdit: boolean;
  onReply: (message: MessageView) => void;
  onEdit: (message: MessageView) => void;
  onDelete: (message: MessageView) => void;
  onTogglePin: (message: MessageView, pinned: boolean) => void;
  highlight?: boolean;
}

export function MessageBubble({
  message,
  isOwn,
  isFirstOfGroup,
  showSender,
  senderName,
  pending = false,
  readByCount,
  totalOtherMembers,
  canPin,
  isPinned,
  canDelete,
  canEdit,
  onReply,
  onEdit,
  onDelete,
  onTogglePin,
  highlight = false,
}: MessageBubbleProps) {
  const deleted = Boolean(message.deletedAt);

  return (
    <div
      id={`connect-msg-${message.id}`}
      className={`flex gap-2 px-3 ${isFirstOfGroup ? 'mt-3' : 'mt-0.5'} ${isOwn ? 'flex-row-reverse' : 'flex-row'} ${highlight ? 'rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/40' : ''}`}
    >
      {/* Avatar column (others only) */}
      <div className="w-8 shrink-0">
        {!isOwn && isFirstOfGroup && (
          <Avatar className="h-8 w-8 border border-slate-700">
            <AvatarFallback className="bg-slate-700/60 text-slate-300 text-xs">
              {initialsOf(senderName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[78%] sm:max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {showSender && !isOwn && (
          <span className="text-[11px] font-semibold text-slate-400 mb-0.5 px-1">
            {senderName ?? 'مستخدم'}
          </span>
        )}

        <div
          className={`rounded-2xl px-3.5 py-2 shadow-sm ${
            isOwn
              ? 'bg-emerald-600 text-white rounded-br-md'
              : 'bg-slate-800 text-slate-200 rounded-bl-md'
          } ${pending ? 'opacity-60' : ''}`}
        >
          {/* Reply preview */}
          {message.replyPreview && !deleted && (
            <div className={`mb-1.5 rounded-lg px-2.5 py-1.5 text-xs border-r-2 ${
              isOwn ? 'bg-emerald-700/50 border-emerald-300 text-emerald-50' : 'bg-slate-700/50 border-emerald-500 text-slate-300'
            }`}>
              <span className="block font-semibold">{message.replyPreview.senderName ?? 'مستخدم'}</span>
              <span className="line-clamp-2">{message.replyPreview.excerpt}</span>
            </div>
          )}

          {/* Body */}
          {deleted ? (
            <p className={`text-sm italic ${isOwn ? 'text-emerald-100/80' : 'text-slate-400'}`}>
              تم حذف هذه الرسالة
            </p>
          ) : (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {message.body}
                {message.editedAt && (
                  <span className={`text-[10px] mr-1.5 ${isOwn ? 'text-emerald-200/80' : 'text-slate-500'}`}>
                    (معدّلة)
                  </span>
                )}
              </p>

              {/* Internal record links */}
              {message.references && message.references.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {message.references.map((ref) => (
                    <span
                      key={`${ref.type}-${ref.id}`}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-900/40 border border-slate-600/50 px-2 py-0.5 text-[11px]"
                    >
                      <span className="font-semibold">{REFERENCE_LABELS[ref.type] ?? 'سجل'}</span>
                      {ref.title && <span className="opacity-80">· {ref.title}</span>}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Meta row: time + read indicator + actions */}
        <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-[10px] text-slate-500">
            {new Date(message.createdAtMs).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
          </span>

          {isOwn && !pending && (
            totalOtherMembers > 0 && readByCount >= totalOtherMembers ? (
              <CheckCheck className="w-3.5 h-3.5 text-emerald-400" aria-label="تمت القراءة" />
            ) : (
              <Check className="w-3.5 h-3.5 text-slate-500" aria-label="تم الإرسال" />
            )
          )}
          {isOwn && pending && <span className="text-[10px] text-slate-500">جارٍ الإرسال…</span>}

          {isPinned && <Pin className="w-3 h-3 text-amber-400" aria-label="مثبتة" />}

          {/* Actions menu (touch-friendly; also keyboard accessible) */}
          {!deleted && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-slate-500 hover:text-slate-300"
                  aria-label="خيارات الرسالة"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isOwn ? 'start' : 'end'} className="bg-slate-900 border-slate-700 text-slate-200">
                <DropdownMenuItem onClick={() => onReply(message)}>
                  <Reply className="w-4 h-4 ml-2" /> رد
                </DropdownMenuItem>
                {canEdit && (
                  <DropdownMenuItem onClick={() => onEdit(message)}>
                    <Pencil className="w-4 h-4 ml-2" /> تعديل
                  </DropdownMenuItem>
                )}
                {canPin && (
                  <DropdownMenuItem onClick={() => onTogglePin(message, !isPinned)}>
                    {isPinned
                      ? <><PinOff className="w-4 h-4 ml-2" /> إلغاء التثبيت</>
                      : <><Pin className="w-4 h-4 ml-2" /> تثبيت</>}
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem onClick={() => onDelete(message)} className="text-red-400 focus:text-red-300">
                    <Trash2 className="w-4 h-4 ml-2" /> حذف
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isOwn && !deleted && totalOtherMembers > 0 && readByCount > 0 && readByCount < totalOtherMembers && (
            <span className="text-[10px] text-slate-500">قرأها {readByCount} من {totalOtherMembers}</span>
          )}
        </div>
      </div>
    </div>
  );
}
