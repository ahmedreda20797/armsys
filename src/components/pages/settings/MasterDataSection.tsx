'use client';

// ═══════════════════════════════════════════════════════════════
//  MasterDataSection — Settings → Master Data & System Lists.
//
//  The domain registry UI. Two-pane layout: configurable domains on
//  one side, the focused workspace of the selected domain on the
//  other. Domains declared 'planned' in the registry show an
//  informational slot (never a fake management screen) — their
//  workspaces mount on this same framework once their canonical
//  source/consumer lands.
//
//  This section owns NO data. Each available domain renders its own
//  workspace component over the domain's existing canonical API.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Tags, Plane, Briefcase, MessageSquare, FileText, ClipboardList,
  ChevronLeft, ChevronRight, Lock,
} from 'lucide-react';
import { MASTER_DATA_DOMAINS, type MasterDataDomain } from '@/lib/master-data/registry';
import { usePermissions } from '@/hooks/usePermissions';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { SectionUnderPreparation } from '@/components/pages/settings/SectionUnderPreparation';
import type { MasterDataSimpleDomain } from '@/types/master-data';

// Lazy workspaces — each management UI ships only when its domain opens.
const ObservationCategoriesWorkspace = dynamic(
  () => import('@/components/pages/settings/ObservationCategoriesWorkspace'),
  { ssr: false, loading: () => <WorkspaceSkeleton /> },
);
const SimpleMasterDataWorkspace = dynamic(
  () => import('@/components/pages/settings/SimpleMasterDataWorkspace'),
  { ssr: false, loading: () => <WorkspaceSkeleton /> },
);

function WorkspaceSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-8 w-64 rounded-lg bg-slate-800/50" />
      <div className="h-40 rounded-xl bg-slate-800/30" />
    </div>
  );
}

const DOMAIN_ICONS: Record<MasterDataDomain['icon'], React.ReactNode> = {
  tags: <Tags className="size-4" />,
  plane: <Plane className="size-4" />,
  briefcase: <Briefcase className="size-4" />,
  'message-square': <MessageSquare className="size-4" />,
  'file-text': <FileText className="size-4" />,
  'clipboard-list': <ClipboardList className="size-4" />,
};

export default function MasterDataSection({ initialDomain }: { initialDomain?: string }) {
  const { locale } = useLanguage();
  // §MASTER-DATA — domain access uses the canonical permission check
  // (admin bypass + permission-key resolution). NOT sidebar
  // visibility: overlayOnly permission pages never appear there.
  const { canViewPage } = usePermissions();

  const firstAvailable = MASTER_DATA_DOMAINS.find(
    (d) => d.status === 'available' && (!d.permissionPageId || canViewPage(d.permissionPageId as never)),
  );
  const [selectedId, setSelectedId] = useState<string>(
    initialDomain ?? firstAvailable?.id ?? MASTER_DATA_DOMAINS[0].id,
  );

  const selected = MASTER_DATA_DOMAINS.find((d) => d.id === selectedId) ?? firstAvailable ?? MASTER_DATA_DOMAINS[0];

  const domainTitle = (d: MasterDataDomain) => (locale === 'en' ? d.titleEn : d.titleAr);
  const domainDescription = (d: MasterDataDomain) => (locale === 'en' ? d.descriptionEn : d.descriptionAr);

  const domainAccessible = (d: MasterDataDomain) =>
    d.status !== 'available' || !d.permissionPageId || canViewPage(d.permissionPageId as never);

  return (
    <div className="space-y-3">
      {/* Domain list */}
      <div className="space-y-1.5">
        {MASTER_DATA_DOMAINS.map((domain) => {
          const accessible = domainAccessible(domain);
          const isSelected = domain.id === selected.id;
          return (
            <button
              key={domain.id}
              type="button"
              onClick={() => accessible && setSelectedId(domain.id)}
              disabled={!accessible}
              className={cn(
                'w-full flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-start transition-all',
                isSelected
                  ? 'bg-brand-500/10 border-brand-500/40'
                  : 'bg-slate-800/20 border-slate-700/40 hover:bg-slate-800/40',
                !accessible && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span className={cn(
                'flex items-center justify-center size-8 rounded-lg border shrink-0',
                isSelected
                  ? 'bg-brand-500/15 border-brand-500/30 text-brand-300'
                  : 'bg-slate-800/60 border-slate-700/50 text-slate-400',
              )}>
                {DOMAIN_ICONS[domain.icon]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn('text-sm font-bold truncate', isSelected ? 'text-brand-200' : 'text-slate-200')}>
                    {domainTitle(domain)}
                  </span>
                  {domain.status === 'planned' && (
                    <span className="shrink-0 rounded-full border border-slate-600/50 bg-slate-800/60 px-2 py-px text-[10px] text-slate-400">
                      {translateUIText('قيد التهيئة', locale)}
                    </span>
                  )}
                  {!accessible && <Lock className="size-3 text-slate-500 shrink-0" />}
                </span>
                <span className="block text-[11px] text-slate-500 truncate">{domainDescription(domain)}</span>
              </span>
              {accessible && (isSelected
                ? (locale === 'ar' ? <ChevronLeft className="size-4 text-brand-300 shrink-0" /> : <ChevronRight className="size-4 text-brand-300 shrink-0" />)
                : (locale === 'ar' ? <ChevronLeft className="size-4 text-slate-600 shrink-0" /> : <ChevronRight className="size-4 text-slate-600 shrink-0" />))}
            </button>
          );
        })}
      </div>

      {/* Selected domain workspace */}
      {selected.status === 'available' && domainAccessible(selected) ? (
        selected.workspace === 'observationCategories'
          ? <ObservationCategoriesWorkspace />
          : selected.workspace === 'simpleList'
            ? <SimpleMasterDataWorkspace domainId={selected.id as MasterDataSimpleDomain} />
            : null
      ) : selected.status === 'available' ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-slate-700/40 bg-slate-800/20 px-4 py-3 text-xs text-slate-400">
          <Lock className="size-4 shrink-0 mt-0.5" />
          <p>
            {translateUIText('هذه القائمة محمية بصلاحيات مالك النظام — لا تملك صلاحية الوصول إليها.', locale)}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* §SETTINGS-READINESS — the canonical under-preparation slot. */}
          <SectionUnderPreparation />
          <p className="px-1 text-[11px] leading-relaxed text-slate-500">
            <T>هذا النطاق محجوز على إطار البيانات المرجعية — يُفعّل عند اكتمال مصدره الحالي في النظام. النمط نفسه (إضافة، تعديل، تعطيل، ترتيب) سيُطبق دون تطوير جديد.</T>
          </p>
        </div>
      )}
    </div>
  );
}
