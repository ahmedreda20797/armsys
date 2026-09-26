'use client';

// ═══════════════════════════════════════════════════════════════
//  SettingsPage — §20 the professional settings structure.
//
//  TWO LEVELS:
//    A. Quick Settings (THIS page): personal preferences — language,
//       theme. Every user has access. (Identity/profile management is
//       the Profile page's job — the redundant profile card that used
//       to live here was removed §SETTINGS-PROFILE-CARD; the global
//       header avatar keeps the canonical profile image.)
//    B. Full/System Settings: user administration, permissions and
//       org configuration remain in مركز التحكم (controlPanel) —
//       user preferences NEVER mix with global system settings.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Languages, Moon, Sun, Monitor, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';
import type { Locale } from '@/lib/i18n/dictionary';

export default function SettingsPage() {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { locale, setLocale, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One-time hydration flags — state must flip after SSR completes;
    // no render-safe alternative exists for mount-only flags.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical one-time hydration guard
    setMounted(true);
  }, []);

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
