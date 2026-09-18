'use client';

// ══════════════════════════════════════════════════════════════
//  PageIdentity — §7 unified page identity for pages that render
//  their own header WITHOUT the full PageHeaderBar action bar
//  (dashboards, reports, settings). §HEADER-V3: the identity
//  (icon · title · description, description from the APP_PAGES
//  registry when not passed explicitly) is REGISTERED INTO the
//  global app Header's compact PAGE-IDENTITY zone; in-page this
//  component renders only the optional trailing actions row.
// ══════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { APP_PAGES, localizedPageDescription, localizedPageLabel } from '@/config/permissions';
import { useLanguage } from '@/lib/i18n/language-context';
import { usePageIdentity } from '@/hooks/use-page-header';

export function pageDescriptionFor(pageId: string): string | undefined {
  return APP_PAGES.find((p) => p.id === pageId)?.description;
}

export function PageIdentity({
  pageId,
  icon,
  title,
  description,
  actions,
  className,
}: {
  /** Registry page id — used for the title/description fallbacks. */
  pageId?: string;
  icon?: React.ReactNode;
  /** Legacy tile styling (the icon now lives in the Header's neutral tile). */
  iconClassName?: string;
  title?: string;
  description?: React.ReactNode;
  /** Optional trailing actions row (refresh, exports...). */
  actions?: React.ReactNode;
  className?: string;
}) {
  const { locale } = useLanguage();
  const config = pageId ? APP_PAGES.find((p) => p.id === pageId) : undefined;
  // §I18N-BILINGUAL — explicit props win (dynamic page text); the
  // registry lookup is locale-resolved for both locales.
  const resolvedTitle =
    title ?? (pageId ? localizedPageLabel(pageId, locale) : (config?.title || ''));
  const resolvedDescription =
    description !== undefined
      ? description
      : pageId
        ? localizedPageDescription(pageId, locale) ?? config?.description
        : config?.description;

  // §HEADER-V3 — identity moves INTO the global Header; no in-page
  // repetition of the same large title.
  usePageIdentity({ title: resolvedTitle, description: resolvedDescription, icon });

  if (!actions) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-center justify-end gap-2 flex-wrap', className)}
    >
      {actions}
    </motion.div>
  );
}
