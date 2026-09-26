'use client';

// ══════════════════════════════════════════════════════════════
//  LoadingOverlay — §BRAND loading sequence (§LOADING-V3)
//
//  The logo IS the loading indicator — and the ONLY element: the Q
//  breathes, the nlys letters rise/settle individually then carry a
//  traveling crest, and a restrained red signal sweeps the mark
//  (QnlysBrandReveal mode="loading"). No progress bar, no spinner,
//  no «جاري التحميل» text — one living brand element over the scoped
//  QnlysAtmosphere layer. GPU-only animation; honors
//  prefers-reduced-motion via shared CSS.
// ══════════════════════════════════════════════════════════════

import { memo } from 'react';
import { motion } from 'framer-motion';
import { QnlysBrandReveal } from '@/components/brand/QnlysBrandReveal';
import { QnlysAtmosphere } from '@/components/brand/QnlysAtmosphere';
import { useLanguage } from '@/lib/i18n/language-context';

export const LoadingOverlay = memo(function LoadingOverlay() {
  const { t } = useLanguage();
  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      aria-busy="true"
      aria-label={t('loading.aria')}
    >
      {/* Scoped data-intelligence layer (grid, signal curves, points) */}
      <QnlysAtmosphere />

      {/* The living lockup: breathing halo behind, Q + letters in front */}
      <div className="relative flex items-center justify-center">
        <div className="qnlys-loading-halo absolute -inset-14 rounded-full blur-3xl" />
        <div className="relative">
          <QnlysBrandReveal size={190} mode="loading" />
        </div>
      </div>
    </motion.div>
  );
});
