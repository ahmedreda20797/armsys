'use client';

// ═══════════════════════════════════════════════════════════════
//  SettingsPage — §20 the professional settings structure.
//
//  TWO LEVELS:
//    A. Quick Settings (THIS page): profile information + personal
//       preferences — language, theme. Every user has access.
//    B. Full/System Settings: user administration, permissions and
//       org configuration remain in مركز التحكم (controlPanel) —
//       user preferences NEVER mix with global system settings.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Languages, Moon, Sun, Monitor, UserCog, Settings2, Loader2, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { authFetch } from '@/lib/api-fetch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Locale } from '@/lib/i18n/dictionary';

export default function SettingsPage() {
  const { user } = useAuth();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { locale, setLocale, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    // One-time hydration flags — state must flip after SSR completes;
    // no render-safe alternative exists for mount-only flags.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical one-time hydration guard
    setMounted(true);
  }, []);

  useEffect(() => {
    // Sync the editable name when the session user changes (login swap).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-system sync (auth session)
    setName(user?.name ?? '');
  }, [user?.name]);

  const saveProfileName = async () => {
    if (!name.trim() || name.trim() === user?.name) return;
    setSavingName(true);
    try {
      const res = await authFetch(`/api/dashboard/users/${user?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        toast.success(t('settings.saved'));
      } else {
        toast.error(t('settings.saveFailed'));
      }
    } catch {
      toast.error(t('settings.saveFailed'));
    } finally {
      setSavingName(false);
    }
  };

  const localeOptions: Array<{ value: Locale; native: string }> = [
    { value: 'ar', native: 'العربية' },
    { value: 'en', native: 'English' },
  ];

  return (
    <div className="space-y-5">
      <PageIdentity
        pageId="settings"
        icon={<Settings2 className="size-5" />}
        iconClassName="bg-slate-500/15 border-slate-500/30 text-slate-300"
        description={t('settings.description')}
      />

      {/* ── A. Quick settings ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profile */}
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <UserCog className="size-4 text-brand-400" />
              {t('settings.profile')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <UserAvatar name={user?.name} src={user?.photoURL} className="size-12 text-base" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
              </div>
              <Badge variant="outline" className="shrink-0 border-brand-500/30 bg-brand-500/10 text-brand-300 text-[10px]">
                {user?.rank || user?.role}
              </Badge>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-name" className="text-slate-300 text-xs">{t('settings.name')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="settings-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-slate-800/60 border-slate-700/60 text-white h-9 text-sm"
                />
                <Button
                  size="sm"
                  onClick={() => void saveProfileName()}
                  disabled={savingName || !name.trim() || name.trim() === user?.name}
                  className="h-9 px-4 gap-1.5 bg-brand-600 hover:bg-brand-700 text-white"
                >
                  {savingName ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  {t('action.save')}
                </Button>
              </div>
              <p className="text-[10px] text-slate-500">{t('settings.email')}: <span dir="ltr">{user?.email}</span></p>
            </div>
          </CardContent>
        </Card>

        {/* Appearance + language */}
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <Monitor className="size-4 text-cyan-400" />
              {t('settings.appearance')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Language */}
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                <Languages className="size-3.5 text-slate-400" />
                {t('settings.language')}
              </p>
              <div className="flex items-center gap-2">
                {localeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLocale(opt.value)}
                    aria-pressed={mounted && locale === opt.value}
                    className={cn(
                      'px-4 py-2 rounded-xl border text-xs font-semibold transition-all',
                      mounted && locale === opt.value
                        ? 'bg-brand-500/20 border-brand-500/50 text-brand-200 ring-1 ring-brand-500/40'
                        : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200',
                    )}
                  >
                    {opt.native}
                  </button>
                ))}
              </div>
            </div>

            {/* Theme */}
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                {mounted && theme === 'light' ? <Sun className="size-3.5 text-amber-400" /> : <Moon className="size-3.5 text-slate-400" />}
                {t('settings.theme')}
              </p>
              <div className="flex items-center gap-2">
                {([
                  { v: 'dark', label: t('settings.theme.dark'), icon: Moon },
                  { v: 'light', label: t('settings.theme.light'), icon: Sun },
                  { v: 'system', label: t('settings.theme.system'), icon: Monitor },
                ]).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setTheme(opt.v)}
                    aria-pressed={mounted && theme === opt.v}
                    className={cn(
                      'flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all',
                      mounted && theme === opt.v
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200 ring-1 ring-cyan-500/30'
                        : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200',
                    )}
                  >
                    <opt.icon className="size-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── B. Full system settings (admin) ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-200">{t('settings.systemLink')}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{t('settings.systemHint')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-slate-600/60 text-slate-300 hover:bg-slate-800"
            onClick={() => navigateTo('controlPanel')}
          >
            {t('settings.quick')} → {t('settings.systemLink')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
