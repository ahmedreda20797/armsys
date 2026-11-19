// src/components/connect/ConversationDetails.tsx
// ══════════════════════════════════════════════════════════════
//  Connect UI — conversation details & administration
//
//  Members roster with roles, add/remove (owner/admin), role changes
//  (owner), ownership transfer, group meta edit, leave, per-user
//  archive/mute. In-conversation search lives in the thread header.
// ══════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { ArrowLeftRight, Bell, BellOff, Crown, LogOut, Shield, ShieldOff, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useDashboardUsers } from '@/hooks/use-queries';
import { useConversationMutation } from '@/hooks/use-connect';
import { initialsOf } from './ConversationList';
import type { ConversationView } from '@/lib/connect/types';

type DetailsData = ConversationView & { members: import('@/lib/connect/types').ConversationMemberView[] };

export interface ConversationDetailsProps {
  conversationId: string | null;
  details: DetailsData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  myUserId: string;
  isArchived: boolean;
  onArchiveToggle: (archived: boolean) => void;
  onMuteToggle: (muted: boolean) => void;
  isMuted: boolean;
}

function roleBadge(role: string) {
  if (role === 'owner') return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">المالك</Badge>;
  if (role === 'admin') return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">مشرف</Badge>;
  return <Badge variant="outline" className="border-slate-600 text-slate-400">عضو</Badge>;
}

export function ConversationDetails({
  conversationId,
  details,
  open,
  onOpenChange,
  myUserId,
  isArchived,
  onArchiveToggle,
  onMuteToggle,
  isMuted,
}: ConversationDetailsProps) {
  const { data: systemUsers } = useDashboardUsers('full', open);
  const mutations = useConversationMutation(conversationId ?? '');
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState<string | null>(null);

  const isDirect = details?.type === 'direct';
  const isOwner = details?.myRole === 'owner';
  const isAdmin = isOwner || details?.myRole === 'admin';
  const canManageMembers = !isDirect && isAdmin;

  const activeMembers = details?.members ?? [];
  const candidateUsers = (systemUsers ?? [])
    .filter((u: { id: string }) => !activeMembers.some((m) => m.userId === u.id))
    .filter((u: { name?: string }) => !memberSearch.trim() || (u.name ?? '').toLowerCase().includes(memberSearch.trim().toLowerCase()))
    .slice(0, 8);

  const handleAddMember = (userId: string) => {
    mutations.addMembers.mutate([userId], {
      onSuccess: () => toast.success('تمت إضافة العضو'),
      onError: (err) => toast.error(err.message || 'تعذر إضافة العضو'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Users className="w-5 h-5 text-emerald-400" />
            بيانات المحادثة
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {isDirect ? 'محادثة مباشرة' : details?.type === 'department' ? 'محادثة جهة تنظيمية' : 'مجموعة'} · {activeMembers.length} عضو
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
          {/* Group meta (groups only) */}
          {!isDirect && details && (
            <div className="space-y-2 mb-4">
              {editingMeta ? (
                <div className="space-y-2">
                  <div>
                    <Label className="text-slate-400 text-xs">اسم المجموعة</Label>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="bg-slate-800/60 border-slate-700 text-slate-200 mt-1"
                      maxLength={120}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-500 text-white"
                      onClick={() => {
                        const title = editTitle.trim();
                        if (!title) return;
                        mutations.patch.mutate(
                          { title },
                          {
                            onSuccess: () => { toast.success('تم تحديث الاسم'); setEditingMeta(false); },
                            onError: (err) => toast.error(err.message || 'تعذر التحديث'),
                          },
                        );
                      }}
                    >
                      حفظ
                    </Button>
                    <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => setEditingMeta(false)}>
                      إلغاء
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                  <div>
                    <p className="text-xs text-slate-500">الاسم</p>
                    <p className="text-sm font-semibold text-slate-200">{details.displayTitle}</p>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-400"
                      onClick={() => { setEditTitle(details.displayTitle); setEditingMeta(true); }}
                    >
                      تعديل الاسم
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Per-user state */}
          <div className="space-y-2 mb-4 rounded-lg bg-slate-800/50 px-3 py-2">
            <label className="flex items-center justify-between py-1 cursor-pointer">
              <span className="flex items-center gap-2 text-sm text-slate-300"><BellOff className="w-4 h-4" /> كتم الإشعارات</span>
              <Switch checked={isMuted} onCheckedChange={onMuteToggle} />
            </label>
            <label className="flex items-center justify-between py-1 cursor-pointer">
              <span className="flex items-center gap-2 text-sm text-slate-300"><ArrowLeftRight className="w-4 h-4" /> أرشفة المحادثة</span>
              <Switch checked={isArchived} onCheckedChange={onArchiveToggle} />
            </label>
          </div>

          {/* Members */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-300">الأعضاء ({activeMembers.length})</p>
            {canManageMembers && activeMembers.length < 100 && (
              <Button variant="ghost" size="sm" className="text-emerald-400" onClick={() => setShowAddMember((v) => !v)}>
                <UserPlus className="w-4 h-4 ml-1" /> إضافة
              </Button>
            )}
          </div>

          {showAddMember && canManageMembers && (
            <div className="mb-3 space-y-1.5 rounded-lg border border-slate-700 bg-slate-800/40 p-2">
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="ابحث عن مستخدم لإضافته..."
                className="bg-slate-800/60 border-slate-700 text-slate-200 text-sm"
              />
              {candidateUsers.map((u: { id: string; name?: string; email?: string }) => (
                <button
                  key={u.id}
                  onClick={() => handleAddMember(u.id)}
                  disabled={mutations.addMembers.isPending}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-700/50 text-right"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-slate-700 text-[10px] text-slate-200">{initialsOf(u.name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-slate-200 flex-1">{u.name ?? u.id}</span>
                  <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
                </button>
              ))}
              {candidateUsers.length === 0 && (
                <p className="text-xs text-slate-500 px-2 py-1">لا يوجد مستخدمون مطابقون</p>
              )}
            </div>
          )}

          <div className="space-y-1">
            {activeMembers.map((m) => {
              const isSelf = m.userId === myUserId;
              const memberIsOwner = m.role === 'owner';
              return (
                <div key={m.userId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-800/60">
                  <Avatar className="h-8 w-8 border border-slate-700">
                    {m.photoUrl && <AvatarImage src={m.photoUrl} alt={m.name ?? 'صورة العضو'} />}
                    <AvatarFallback className="bg-slate-700 text-xs text-slate-200">{initialsOf(m.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">
                      {m.name ?? 'مستخدم'}
                      {isSelf && <span className="text-slate-500"> (أنت)</span>}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{m.email ?? ''}</p>
                  </div>
                  {roleBadge(m.role)}

                  {canManageMembers && !isSelf && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-500" aria-label="خيارات العضو">
                          ⋯
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700 text-slate-200">
                        {isOwner && m.role !== 'owner' && (
                          <>
                            <DropdownMenuItem
                              onClick={() => mutations.changeRole.mutate(
                                { memberId: m.userId, role: m.role === 'admin' ? 'member' : 'admin' },
                                { onSuccess: () => toast.success('تم تحديث الدور'), onError: (e) => toast.error(e.message) },
                              )}
                            >
                              {m.role === 'admin'
                                ? <><ShieldOff className="w-4 h-4 ml-2" /> إزالة الإشراف</>
                                : <><Shield className="w-4 h-4 ml-2" /> تعيين مشرفاً</>}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setConfirmTransfer(m.userId)}
                            >
                              <Crown className="w-4 h-4 ml-2" /> نقل الملكية
                            </DropdownMenuItem>
                          </>
                        )}
                        {!memberIsOwner && (
                          <DropdownMenuItem onClick={() => setConfirmRemove(m.userId)} className="text-red-400 focus:text-red-300">
                            <Trash2 className="w-4 h-4 ml-2" /> إزالة من المجموعة
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Leave */}
        <div className="pt-3 border-t border-slate-800">
          <Button
            variant="outline"
            className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => setConfirmLeave(true)}
          >
            <LogOut className="w-4 h-4 ml-2" />
            مغادرة المحادثة
          </Button>
        </div>
      </DialogContent>

      {/* Confirmations */}
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="مغادرة المحادثة"
        description={isOwner && activeMembers.length > 1
          ? 'أنت مالك المجموعة — انقل الملكية لعضو آخر قبل المغادرة.'
          : 'هل تريد مغادرة هذه المحادثة؟ ستفقد الوصول إليها.'}
        confirmLabel="مغادرة"
        onConfirm={() => {
          mutations.leave.mutate(undefined, {
            onSuccess: () => { toast.success('تمت مغادرة المحادثة'); onOpenChange(false); window.location.hash = ''; },
            onError: (err) => toast.error(err.message || 'تعذرت المغادرة'),
          });
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmRemove)}
        onOpenChange={(v) => { if (!v) setConfirmRemove(null); }}
        title="إزالة عضو"
        description="سيفقد العضو الوصول إلى المحادثة فوراً. هل تريد المتابعة؟"
        confirmLabel="إزالة"
        onConfirm={() => {
          if (!confirmRemove) return;
          mutations.removeMember.mutate(confirmRemove, {
            onSuccess: () => { toast.success('تمت إزالة العضو'); setConfirmRemove(null); },
            onError: (err) => toast.error(err.message || 'تعذرت الإزالة'),
          });
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmTransfer)}
        onOpenChange={(v) => { if (!v) setConfirmTransfer(null); }}
        title="نقل ملكية المجموعة"
        description="سيصبح العضو مالكاً وسيتحول دورك إلى مشرف. هل تريد المتابعة؟"
        confirmLabel="نقل الملكية"
        onConfirm={() => {
          if (!confirmTransfer) return;
          mutations.patch.mutate(
            { transferOwnershipTo: confirmTransfer },
            { onSuccess: () => { toast.success('تم نقل الملكية'); setConfirmTransfer(null); }, onError: (err) => toast.error(err.message || 'تعذر النقل') },
          );
        }}
      />
    </Dialog>
  );
}
