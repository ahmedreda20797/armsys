'use client';

import { useAppStore } from '@/lib/store';
import { APP_PAGES } from '@/config/permissions';
import { Construction } from 'lucide-react';

/**
 * Placeholder for Quality KPI pages.
 *
 * These pages are wired into the router (Milestone 7) so the navigation
 * and permission system is fully functional. Milestone 8 replaces each
 * with the full implementation.
 */
export function QualityKpiPlaceholder() {
  const currentPage = useAppStore((s) => s.currentPage);
  const config = APP_PAGES.find((p) => p.id === currentPage);

  return (
    <div dir="rtl" className="flex flex-col items-center justify-center py-24">
      <div className="w-20 h-20 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-6">
        <Construction className="w-10 h-10 text-blue-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-200 mb-2">
        {config?.title || 'صفحة مؤشرات الجودة'}
      </h2>
      <p className="text-slate-400 text-center max-w-md">
        هذه الصفحة جزء من محرك مؤشرات الأداء. يتم تطوير الواجهة الكاملة في المرحلة التالية.
      </p>
    </div>
  );
}
