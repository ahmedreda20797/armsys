// src/components/connect/MessageComposer.tsx
// ══════════════════════════════════════════════════════════════
//  Connect UI — message composer
//
//  Enter = send / Shift+Enter = newline, reply banner, edit mode,
//  @mention picker (members only — the server re-filters), internal
//  record link picker (existence-validated server-side), typing ping
//  with client-side throttle. Attachments are explicitly NOT offered
//  in 1.0 (storage unavailable — no fake controls, §SPEC-15).
// ══════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerUpLeft, Link2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initialsOf } from './ConversationList';
import type { ConversationMemberView, MessageReference, MessageView } from '@/lib/connect/types';

const TYPING_PING_INTERVAL_MS = 3_500;

export interface MessageComposerProps {
  members: ConversationMemberView[];
  myUserId: string;
  replyTo: MessageView | null;
  editing: MessageView | null;
  /** §DRAFTS — prefill on mount (floating window restores the unsent
   *  text of this conversation; the parent keeps it per conversation). */
  initialBody?: string;
  /** Draft persistence hook — called only during NORMAL composition
   *  (edit sessions prefill and never overwrite the stored draft). */
  onBodyChange?: (body: string) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSend: (input: { body: string; clientKey: string; replyToId: string | null; mentions: string[] | null }) => void;
  onEditSave: (messageId: string, body: string) => void;
  onTyping: () => void;
  disabled?: boolean;
}

const RECORD_LINKS: { type: MessageReference['type']; label: string }[] = [
  { type: 'employee', label: 'موظف' },
  { type: 'orgNode', label: 'جهة تنظيمية' },
  { type: 'capaCase', label: 'حالة كابا' },
  { type: 'complaint', label: 'شكوى عميل' },
  { type: 'followUp', label: 'متابعة يومية' },
  { type: 'requests', label: 'طلب' },
];

export function MessageComposer({
  members,
  myUserId,
  replyTo,
  editing,
  initialBody,
  onBodyChange,
  onCancelReply,
  onCancelEdit,
  onSend,
  onEditSave,
  onTyping,
  disabled = false,
}: MessageComposerProps) {
  // §DERIVED-STATE — edit mode prefills the body via component
  // remounting: the parent keys this composer by the editing message
  // id, so the initial state below is fresh per edit session (no
  // setState-in-effect). initialBody restores a stored draft on mount.
  const [body, setBody] = useState(editing?.body ?? initialBody ?? '');
  const [references, setReferences] = useState<MessageReference[]>([]);
  const [linksOpen, setLinksOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentRef = useRef(0);

  // Focus the composer when entering edit mode (DOM side-effect only).
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  // Auto-grow.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [body]);

  const otherMembers = useMemo(
    () => members.filter((m) => m.userId !== myUserId),
    [members, myUserId],
  );

  // §MENTIONS — suggestions appear while the user is mid-mention
  // (composer only offers members; the server re-filters anyway).
  const mentionSuggestions = useMemo(() => {
    if (!body.trimEnd().endsWith('@')) return [];
    return otherMembers.filter((m) => !body.includes(`@${m.name ?? ''}`)).slice(0, 6);
  }, [body, otherMembers]);

  const handleTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current >= TYPING_PING_INTERVAL_MS) {
      lastTypingSentRef.current = now;
      onTyping();
    }
  };

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed || disabled) return;
    if (editing) {
      onEditSave(editing.id, trimmed);
      setBody('');
      return;
    }
    onSend({
      body: trimmed,
      // §IDEMPOTENCY — clientKey per attempt; retries of the SAME
      // logical message reuse it (the mutation retry path keeps vars).
      clientKey: `ck${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      replyToId: replyTo?.id ?? null,
      mentions: collectMentions(trimmed),
    });
    setBody('');
    setReferences([]);
    lastTypingSentRef.current = 0;
  };

  /** Mentions typed as @name — resolved against the member roster. */
  const collectMentions = (text: string): string[] | null => {
    const mentioned: string[] = [];
    for (const m of otherMembers) {
      const name = m.name ?? '';
      if (name && text.includes(`@${name}`)) mentioned.push(m.userId);
    }
    return mentioned.length > 0 ? mentioned : null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      if (editing) onCancelEdit();
      if (replyTo) onCancelReply();
    }
  };

  const insertMention = (member: ConversationMemberView) => {
    const name = member.name ?? '';
    setBody((prev) => `${prev.trimEnd()}${prev.trimEnd() && !prev.trimEnd().endsWith('@') ? ' @' : prev.trimEnd().endsWith('@') ? '' : '@'}${name} `);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t border-slate-800 bg-slate-900/50 px-3 py-2.5 space-y-2">
      {/* Mention suggestions (inline — RTL friendly, touch friendly) */}
      {mentionSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-800/70 border border-slate-700 p-2">
          {mentionSuggestions.map((m) => (
            <button
              key={m.userId}
              onClick={() => insertMention(m)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/70 hover:bg-slate-600 px-2.5 py-1 text-xs text-slate-200"
            >
              <Avatar className="h-5 w-5">
                <AvatarFallback className="bg-slate-600 text-[9px] text-slate-200">{initialsOf(m.name)}</AvatarFallback>
              </Avatar>
              {m.name ?? 'مستخدم'}
            </button>
          ))}
        </div>
      )}

      {/* Reply / edit banners */}
      {replyTo && !editing && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/70 border-r-2 border-emerald-500 px-3 py-1.5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-emerald-400">رد على {replyTo.senderName ?? 'مستخدم'}</p>
            <p className="text-xs text-slate-400 truncate">{replyTo.body}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400" onClick={onCancelReply} aria-label="إلغاء الرد">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
      {editing && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 border-r-2 border-amber-500 px-3 py-1.5">
          <p className="text-[11px] font-semibold text-amber-400">تعديل الرسالة</p>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-400" onClick={() => { onCancelEdit(); setBody(''); }} aria-label="إلغاء التعديل">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Attached record links */}
      {references.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {references.map((ref) => (
            <span key={`${ref.type}-${ref.id}`} className="inline-flex items-center gap-1 rounded-md bg-slate-800 border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300">
              <Link2 className="w-3 h-3" />
              <span>{RECORD_LINKS.find((r) => r.type === ref.type)?.label ?? ref.type}: {ref.id}</span>
              <button
                onClick={() => setReferences((prev) => prev.filter((r) => !(r.type === ref.type && r.id === ref.id)))}
                className="text-slate-500 hover:text-slate-300"
                aria-label="إزالة الارتباط"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Record links picker */}
        <Popover open={linksOpen} onOpenChange={setLinksOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0 text-slate-400 hover:text-slate-200 shrink-0"
              disabled={disabled}
              aria-label="ربط سجل داخلي"
              title="ربط سجل داخلي"
            >
              <Link2 className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-52 p-1.5 bg-slate-900 border-slate-700">
            <p className="px-2 py-1 text-[11px] text-slate-500">اربط سجلاً من النظام (أدخل المعرّف)</p>
            {RECORD_LINKS.map((link) => (
              <button
                key={link.type}
                onClick={() => {
                  const id = window.prompt(`معرّف ${link.label}:`);
                  if (id && id.trim()) {
                    setReferences((prev) => [...prev, { type: link.type, id: id.trim(), title: null }]);
                  }
                  setLinksOpen(false);
                }}
                className="w-full text-right px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200"
              >
                {link.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (!editing) onBodyChange?.(e.target.value);
            handleTyping();
          }}
          onKeyDown={onKeyDown}
          placeholder="اكتب رسالة... (Enter للإرسال، Shift+Enter لسطر جديد)"
          disabled={disabled}
          rows={1}
          className="min-h-[38px] max-h-40 resize-none bg-slate-800/60 border-slate-700 text-slate-200 placeholder:text-slate-500 text-sm"
        />

        <Button
          onClick={submit}
          disabled={disabled || !body.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 text-white h-9 w-9 p-0 shrink-0"
          aria-label={editing ? 'حفظ التعديل' : 'إرسال'}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
