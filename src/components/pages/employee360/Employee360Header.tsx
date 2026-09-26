'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Executive Identity Header (rebuild)
//
//  WHO is this employee + WHERE do they belong. Organization data is
//  the canonical tree's own chain (root → employee node) — labels are
//  never reconstructed from free-text strings. Lifecycle + account
//  status come from the stored record's canonical vocabulary.
// ══════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import {
  Archive, Briefcase, Building2, ChevronLeft, Hash, Phone, Timer, UserCheck, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { navigateToEmployeeProfile } from '@/lib/employee-360/navigation';
import type { Employee360Data } from '@/lib/employee-360/client-types';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: 'نشط', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  inactive: { label: 'غير نشط', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  archived: { label: 'مؤرشف', cls: 'bg-muted/60 text-muted-foreground border-border' },
  unknown: { label: 'غير محدد', cls: 'bg-muted/60 text-muted-foreground border-border' },
};

export function Employee360Header({ employee, organization }: {
  employee: NonNullable<Employee360Data['employee']>;
  organization: Employee360Data['organization'];
}) {
  const { locale } = useLanguage();
  const status = STATUS_BADGE[employee.status] ?? STATUS_BADGE.unknown;
  const chain = organization?.chain ?? [];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      className="overflow-hidden rounded-2xl border border-border/60 bg-card"
    >
      <div className="h-1 w-full bg-linear-to-l from-brand-600 via-brand-500/60 to-transparent" />
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
        {/* Avatar + identity */}
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="relative shrink-0">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-brand-800 text-2xl font-bold text-white shadow-lg shadow-brand-600/20">
              {employee.name.charAt(0)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">{employee.name}</h2>
              <Badge variant="outline" className={`rounded-lg text-[11px] ${status.cls}`}>
                {translateUIText(status.label, locale)}
              </Badge>
              {employee.status === 'archived' && employee.archivedAt && (
                <span className="text-[11px] text-muted-foreground">
                  {translateUIText('أُرشف في', locale)} {new Date(employee.archivedAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-EG')}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {employee.position && (
                <span className="inline-flex items-center gap-1.5">
                  <Briefcase className="size-3.5" />
                  <span className="text-foreground">{employee.position}</span>
                </span>
              )}
              {employee.code && (
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="size-3.5" />
                  <span className="font-mono text-foreground" dir="ltr">{employee.code}</span>
                </span>
              )}
              {employee.hireDate && (
                <span className="inline-flex items-center gap-1.5">
                  <T>التحاق:</T>
                  <span className="text-foreground" dir="ltr">{employee.hireDate}</span>
                  {employee.tenureYears !== null && (
                    <span className="text-muted-foreground">· {employee.tenureYears} <T>سنة</T></span>
                  )}
                </span>
              )}
              {employee.shiftStart && employee.shiftEnd && (
                <span className="inline-flex items-center gap-1.5">
                  <Timer className="size-3.5" />
                  <span className="text-foreground" dir="ltr">{employee.shiftStart} - {employee.shiftEnd}</span>
                </span>
              )}
              {employee.mobile && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" />
                  <span className="text-foreground" dir="ltr">{employee.mobile}</span>
                </span>
              )}
              {employee.residence && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3.5" />
                  <span className="text-foreground">{employee.residence}</span>
                </span>
              )}
            </div>

            {/* Org chain breadcrumb — canonical tree order root → node */}
            {chain.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label={translateUIText('الهيكل التنظيمي', locale)}>
                {chain.map((node, i) => (
                  <span key={node.id} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronLeft className="size-3 opacity-50 rtl:rotate-180" />}
                    <span className={i === chain.length - 1 ? 'font-semibold text-foreground' : ''}>{node.name}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {organization?.department && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3.5" />
                  {organization.department}
                </span>
              )}
              {organization?.team && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5" />
                  {organization.team}
                </span>
              )}
              {organization?.manager && (
                <span className="inline-flex items-center gap-1.5">
                  <UserCheck className="size-3.5" />
                  <T>المدير:</T>
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={() => navigateToEmployeeProfile(organization.manager!.id)}
                  >
                    {organization.manager.name}
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-border text-xs"
            onClick={() => navigateToEmployeeProfile(employee.id)}
          >
            <Archive className="ms-1 hidden" />
            <T>فتح في قاعدة الموظفين</T>
          </Button>
        </div>
      </div>
    </motion.section>
  );
}
