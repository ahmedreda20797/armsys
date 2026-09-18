'use client';

// ══════════════════════════════════════════════════════════════
//  ProfilePage — §USER-PROFILE the full self-service profile.
//
//  DATA CONTRACT: every field comes from the AUTHORITATIVE chains —
//  the user record, the position template, the LINKED EMPLOYEE (org
//  tree resolves department/team), and the org nodes the user
//  MANAGES (managerUserId) with their member directory. Nothing is
//  duplicated client-side; /api/profile assembles it self-scoped.
//
//  PHOTO: the crop dialog lets the user pick the file, set the ZOOM
//  (الحجم داخل الإيقونة) and drag to reposition, then the square is
//  rendered on a canvas and uploaded — the server re-encodes to a
//  256×256 WebP avatar. On success the auth session refreshes so the
//  Header avatar updates everywhere at once.
// ══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, Building2, CalendarDays, Camera, Check, IdCard, Loader2,
  Mail, Pencil, Phone, RotateCcw, Save, Trash2, UserCircle, Users, ZoomIn,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/api-fetch';
import { EMPLOYEE_STATUS_LABELS_AR, type EmployeeStatus } from '@/lib/organization';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── shape of /api/profile (self-scoped) ─────────────────────────

interface ProfileTeamMember {
  id: string; name: string; code: string | null;
  position: string | null; department: string | null; team: string | null;
  /** Canonical managed group this (deduplicated) member belongs to. */
  nodeId: string;
  /** True only when attached directly to a node this user manages. */
  isDirect: boolean;
}
interface ProfileManagedTeam {
  id: string; name: string; type: string; typeLabel: string;
  directCount: number; memberCount: number;
}
interface ProfileData {
  user: {
    id: string; name: string; email: string; role: string; rank: string | null;
    photoURL: string | null; jobTitle: string | null; mobile: string | null;
    responsibilities: string | null; positionTitle: string | null;
    linkedEmployeeId: string | null; createdAt: string | null;
  };
  employee: {
    id: string; name: string; code: string | null; department: string | null;
    team: string | null; position: string | null; mobile: string | null;
    hireDate: string | null; status: EmployeeStatus; orgNodeName: string | null;
  } | null;
  managedTeams: ProfileManagedTeam[];
  teamMembers: ProfileTeamMember[];
}

const ROLE_LABELS_AR: Record<string, string> = {
  admin: 'مدير النظام', hr: 'موارد بشرية', manager: 'مدير', quality: 'جودة', user: 'موظف',
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
};

function InfoRow({ icon, label, value, ltr }: {
  icon: React.ReactNode; label: string; value: string | null | undefined; ltr?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="text-slate-500 shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-slate-500">{label}</p>
        <p
          className={cn('text-xs font-medium text-slate-200 break-words', ltr && 'text-right')}
          dir={ltr ? 'ltr' : undefined}
        >
          {value?.trim() ? value : '—'}
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  PhotoCropDialog — pick → zoom (الحجم داخل الإيقونة) → drag → upload
// ══════════════════════════════════════════════════════════════

const CANVAS_PX = 512;   // internal render size (2× the CSS preview)
const VIEW_PX = 240;     // on-screen square

function PhotoCropDialog({
  open,
  onOpenChange,
  imageSrc,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageSrc: string | null;
  onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [uploading, setUploading] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const drawCanvas = useCallback((
    img: HTMLImageElement, z: number, off: { x: number; y: number },
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    // Cover base scale — the image always fills the square at zoom 1.
    const cover = Math.max(CANVAS_PX / img.naturalWidth, CANVAS_PX / img.naturalHeight);
    const scale = cover * z;
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    // Clamp the pan so the square is never uncovered.
    const maxX = Math.max(0, (drawW - CANVAS_PX) / 2);
    const maxY = Math.max(0, (drawH - CANVAS_PX) / 2);
    const cx = Math.min(maxX, Math.max(-maxX, off.x));
    const cy = Math.min(maxY, Math.max(-maxY, off.y));
    ctx.drawImage(img, (CANVAS_PX - drawW) / 2 + cx, (CANVAS_PX - drawH) / 2 + cy, drawW, drawH);
  }, []);

  // Load the picked file into an <img> once it changes.
  useEffect(() => {
    if (!imageSrc) { imgRef.current = null; return; }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      drawCanvas(img, 1, { x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc, drawCanvas]);

  const handleZoom = useCallback((next: number) => {
    setZoom(next);
    if (imgRef.current) drawCanvas(imgRef.current, next, offset);
  }, [drawCanvas, offset]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  }, [offset]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !imgRef.current) return;
    // Screen px → canvas px (the canvas renders 2× its CSS box).
    const ratio = CANVAS_PX / VIEW_PX;
    const dx = (e.clientX - drag.startX) * ratio;
    const dy = (e.clientY - drag.startY) * ratio;
    const next = { x: drag.baseX + dx, y: drag.baseY + dy };
    setOffset(next);
    drawCanvas(imgRef.current, zoom, next);
  }, [drawCanvas, zoom]);

  const handlePointerUp = useCallback(() => { dragRef.current = null; }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    if (imgRef.current) drawCanvas(imgRef.current, 1, { x: 0, y: 0 });
  }, [drawCanvas]);

  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    setUploading(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('canvas export failed');
      const form = new FormData();
      form.append('file', new File([blob], 'avatar.png', { type: 'image/png' }));
      const res = await authFetch('/api/profile/photo', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'تعذر رفع الصورة');
      }
      toast.success('تم تحديث الصورة الشخصية');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error)?.message || 'تعذر رفع الصورة');
    } finally {
      setUploading(false);
    }
  }, [onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700/60 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold text-slate-100">ضبط الصورة الشخصية</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div
            className="relative rounded-full overflow-hidden ring-2 ring-brand-500/40 shadow-lg shadow-black/40"
            style={{ width: VIEW_PX, height: VIEW_PX }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_PX}
              height={CANVAS_PX}
              className="touch-none cursor-grab active:cursor-grabbing"
              style={{ width: VIEW_PX, height: VIEW_PX }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>

          {/* Zoom — حجم الصورة داخل الإيقونة */}
          <div className="w-full space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1"><ZoomIn className="size-3.5" /> حجم الصورة</span>
              <span className="font-mono tabular-nums">{Math.round(zoom * 100)}%</span>
            </div>
            <Slider
              value={[zoom]}
              onValueChange={(v) => handleZoom(v[0] ?? 1)}
              min={1}
              max={3}
              step={0.05}
              aria-label="حجم الصورة"
              disabled={!imageSrc}
            />
          </div>

          <p className="text-[10px] text-slate-500 text-center leading-relaxed">
            اسحب الصورة لتحديد موضعها، واستخدم المؤشر لضبط حجمها داخل الإطار الدائري.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} disabled={!imageSrc}
            className="gap-1.5 border-slate-700/60 text-slate-300 hover:text-white">
            <RotateCcw className="size-3.5" /> إعادة ضبط
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => void handleSave()} disabled={!imageSrc || uploading}
            className="gap-1.5 bg-brand-600 hover:bg-brand-700 text-white">
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            حفظ الصورة
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════
//  ProfilePage
// ══════════════════════════════════════════════════════════════

export default function ProfilePage() {
  const { refreshUser } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ProfileData>({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await authFetch('/api/profile');
      if (!res.ok) throw new Error('تعذر تحميل الملف الشخصي');
      return res.json() as Promise<ProfileData>;
    },
    staleTime: 60_000,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const nameDirty = name.trim() !== (data?.user.name ?? '') && name.trim().length > 0;

  useEffect(() => {
    // Sync the editable name when the profile loads / changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-system sync (server data)
    setName(data?.user.name ?? '');
  }, [data?.user.name]);

  const handleFilePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('الملف يجب أن يكون صورة');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('حجم الصورة يتجاوز 4 ميجابايت');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(typeof reader.result === 'string' ? reader.result : null);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePhotoSaved = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['profile'] });
    void refreshUser();
  }, [qc, refreshUser]);

  const handlePhotoRemove = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await authFetch('/api/profile/photo', { method: 'DELETE' });
      if (!res.ok) throw new Error('تعذر حذف الصورة');
      toast.success('تمت إزالة الصورة الشخصية');
      handlePhotoSaved();
    } catch (err) {
      toast.error((err as Error)?.message || 'تعذر حذف الصورة');
    } finally {
      setDeleting(false);
    }
  }, [handlePhotoSaved]);

  const handleSaveName = useCallback(async () => {
    if (!nameDirty) return;
    setSavingName(true);
    try {
      const res = await authFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'تعذر حفظ الاسم');
      }
      toast.success('تم حفظ الاسم');
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void refreshUser();
    } catch (err) {
      toast.error((err as Error)?.message || 'تعذر حفظ الاسم');
    } finally {
      setSavingName(false);
    }
  }, [name, nameDirty, qc, refreshUser]);

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <PageIdentity
          pageId="profile"
          icon={<UserCircle className="size-5" />}
          description="بيانات حسابك وصورتك الشخصية وفريقك"
        />
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="flex items-center justify-center py-16 gap-2 text-slate-400 text-sm">
            <Loader2 className="size-4 animate-spin" /> جارٍ تحميل الملف الشخصي...
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, employee, managedTeams, teamMembers } = data;

  // ONE canonical collection (§PROFILE-TEAM): every group, every
  // per-team count and the headline derive from teamMembers — the
  // exact rows rendered below can never disagree with any number.
  const groups = managedTeams.map((team) => ({
    team,
    members: teamMembers.filter((m) => m.nodeId === team.id),
  }));
  const totalDirect = teamMembers.filter((m) => m.isDirect).length;
  // System Owner/Admin keeps the deep-red identity accent; every
  // other role gets the same gradient construction in graphite.
  const isSystemOwner = user.role === 'admin';

  return (
    <div className="space-y-5">
      <PageIdentity
        pageId="profile"
        icon={<UserCircle className="size-5" />}
        description="بيانات حسابك وصورتك الشخصية وفريقك"
      />

      {/* ═══ Hero — identity + photo controls ═══ */}
      <Card className="relative bg-slate-800/30 border-slate-700/40 overflow-hidden">
        {/* Full-header accent — the role tint owns the WHOLE hero
            height (top edge → bottom boundary), not a short strip.
            Same gradient language/direction as before; content
            layout below is untouched. */}
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 bg-linear-to-l to-transparent',
            isSystemOwner
              ? 'from-brand-600/30 via-brand-700/15'
              : 'from-stone-500/25 via-stone-600/10',
          )}
        />
        <CardContent className="relative mt-12 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* Photo + camera affordance */}
            <div className="relative shrink-0 mx-auto sm:mx-0">
              <UserAvatar
                name={user.name}
                src={user.photoURL}
                className="size-24 text-2xl ring-4 ring-slate-900"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="تغيير الصورة الشخصية"
                title="تغيير الصورة الشخصية"
                className="absolute bottom-0 left-0 size-8 grid place-items-center rounded-full bg-brand-600 text-white shadow-lg shadow-black/40 ring-2 ring-slate-900 transition-transform hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Camera className="size-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFilePicked}
              />
            </div>

            <div className="min-w-0 flex-1 text-center sm:text-right">
              <h2 className="text-lg font-bold text-white truncate">{user.name}</h2>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 mt-1">
                <Badge variant="outline" className="border-brand-500/30 bg-brand-500/10 text-brand-300 text-[10px]">
                  {user.rank || ROLE_LABELS_AR[user.role] || user.role}
                </Badge>
                {user.positionTitle && (
                  <Badge variant="outline" className="border-slate-600/40 bg-slate-800/60 text-slate-300 text-[10px]">
                    {user.positionTitle}
                  </Badge>
                )}
                {employee?.department && (
                  <Badge variant="outline" className="border-slate-600/40 bg-slate-800/60 text-slate-300 text-[10px]">
                    {employee.department}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5" dir="ltr">{user.email}</p>
            </div>

            <div className="flex items-center justify-center gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}
                className="gap-1.5 border-slate-700/60 text-slate-300 hover:text-white h-8 text-[11px]">
                <Camera className="size-3.5" /> تغيير الصورة
              </Button>
              {user.photoURL && (
                <Button size="sm" variant="outline" onClick={() => void handlePhotoRemove()} disabled={deleting}
                  className="gap-1.5 border-red-500/20 text-red-400 hover:bg-red-500/10 h-8 text-[11px]">
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} إزالة
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ Account + job info ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <BadgeCheck className="size-4 text-brand-400" /> معلومات الحساب
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-slate-800/60">
            <InfoRow icon={<Mail className="size-3.5" />} label="البريد الإلكتروني" value={user.email} ltr />
            <InfoRow icon={<BadgeCheck className="size-3.5" />} label="الدور" value={ROLE_LABELS_AR[user.role] ?? user.role} />
            <InfoRow icon={<IdCard className="size-3.5" />} label="الرتبة" value={user.rank} />
            <InfoRow icon={<CalendarDays className="size-3.5" />} label="تاريخ الانضمام" value={fmtDate(user.createdAt)} />
            {/* Self-editable display name */}
            <div className="pt-3 space-y-1.5">
              <Label htmlFor="profile-name" className="text-slate-300 text-xs">الاسم المعروض</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-slate-800/60 border-slate-700/60 text-white h-9 text-sm"
                />
                <Button size="sm" onClick={() => void handleSaveName()} disabled={savingName || !nameDirty}
                  className="h-9 px-4 gap-1.5 bg-brand-600 hover:bg-brand-700 text-white">
                  {savingName ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  حفظ
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <Building2 className="size-4 text-cyan-400" /> المعلومات الوظيفية
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-slate-800/60">
            <InfoRow icon={<Building2 className="size-3.5" />} label="المسمى الوظيفي (الحساب)" value={user.jobTitle} />
            <InfoRow icon={<BadgeCheck className="size-3.5" />} label="قالب الوظيفة" value={user.positionTitle} />
            <InfoRow icon={<Phone className="size-3.5" />} label="رقم الجوال" value={user.mobile} ltr />
            <InfoRow icon={<Pencil className="size-3.5" />} label="المهام والمسؤوليات" value={user.responsibilities} />
          </CardContent>
        </Card>
      </div>

      {/* ═══ Linked employee record — the authoritative identity chain ═══ */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <IdCard className="size-4 text-emerald-400" /> بيانات الموظف المرتبط بالحساب
          </CardTitle>
        </CardHeader>
        <CardContent>
          {employee ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
              <InfoRow icon={<IdCard className="size-3.5" />} label="اسم الموظف" value={employee.name} />
              <InfoRow icon={<IdCard className="size-3.5" />} label="الكود" value={employee.code} />
              <InfoRow icon={<Building2 className="size-3.5" />} label="القسم" value={employee.department} />
              <InfoRow icon={<Users className="size-3.5" />} label="الفريق" value={employee.team ?? employee.orgNodeName} />
              <InfoRow icon={<BadgeCheck className="size-3.5" />} label="الوظيفة" value={employee.position} />
              <InfoRow icon={<Phone className="size-3.5" />} label="الجوال" value={employee.mobile} ltr />
              <InfoRow icon={<CalendarDays className="size-3.5" />} label="تاريخ التعيين" value={fmtDate(employee.hireDate)} />
              <div className="flex items-start gap-2.5 py-1.5">
                <span className="text-slate-500 shrink-0 mt-0.5"><BadgeCheck className="size-3.5" /></span>
                <div>
                  <p className="text-[10px] text-slate-500">حالة الموظف</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      'mt-0.5 text-[10px]',
                      employee.status === 'active'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                    )}
                  >
                    {EMPLOYEE_STATUS_LABELS_AR[employee.status] ?? employee.status}
                  </Badge>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-2 leading-relaxed">
              لا يوجد موظف مرتبط بهذا الحساب بعد — يتم الربط من مركز التحكم، وبعده ستظهر هنا
              بيانات الموظف الرسمية (الكود، القسم، الفريق، الوظيفة، تاريخ التعيين) تلقائياً من سجل الموظف.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ═══ Managed teams — الفريق/القسم المسؤول عنه المستخدم ═══ */}
      {managedTeams.length > 0 && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <Users className="size-4 text-violet-400" />
              الفريق المسؤول عنه ({teamMembers.length} موظف · {totalDirect} مباشر)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {groups.map(({ team, members }) => {
              const teamDirect = members.filter((m) => m.isDirect).length;
              return (
                <div key={team.id} className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-200">{team.name}</span>
                    <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-300 text-[10px]">
                      {team.typeLabel}
                    </Badge>
                    <span className="text-[10px] text-slate-500">
                      {members.length} موظف · {teamDirect} مباشر
                    </span>
                  </div>
                  {members.length === 0 ? (
                    <p className="text-[10px] text-slate-500 py-1">لا يوجد موظفون في هذه العقدة</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-slate-800/60 bg-slate-900/40 hover:bg-slate-800/40 transition-colors"
                        >
                          <UserAvatar name={member.name} className="size-8 text-[10px]" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold text-slate-200 truncate">{member.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {[member.position, member.department].filter(Boolean).join(' · ') || '—'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <PhotoCropDialog
        open={cropOpen}
        onOpenChange={setCropOpen}
        imageSrc={imageSrc}
        onSaved={handlePhotoSaved}
      />
    </div>
  );
}
