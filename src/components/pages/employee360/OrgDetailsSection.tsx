'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Organization context + Employee details (rebuild)
//
//  Organization context is the canonical tree's own chain. Employee
//  details use progressive disclosure: the header carries identity,
//  this section holds employment/account specifics behind a toggle.
//  Field-level redaction already happened server-side — restricted
//  fields never reached this component.
// ══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { ChevronDown, Network } from 'lucide-react';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { navigateToEmployeeProfile } from '@/lib/employee-360/navigation';
import { SectionShell, EmptyState } from '@/components/pages/employee360/ui';
import { EmployeeDocumentsSection } from '@/components/pages/employee360/EmployeeDocumentsSection';
import type { Employee360Data } from '@/lib/employee-360/client-types';

export function OrganizationSection({ organization, employeeId }: {
  organization: NonNullable<Employee360Data['organization']>;
  employeeId: string;
}) {
  return (
    <SectionShell
      title={<T>السياق التنظيمي</T>}
      icon={<Network className="size-4 text-brand-500" />}
      actions={
        <button
          type="button"
          onClick={() => navigateToEmployeeProfile(employeeId)}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          <T>الملف في قاعدة الموظفين</T>
        </button>
      }
    >
      {organization.chain.length === 0 && !organization.manager ? (
        <EmptyState text={<T>الموظف غير مرتبط بعقدة في الهيكل التنظيمي</T>} />
      ) : (
        <div className="space-y-3">
          {/* Chain — root → employee node */}
          {organization.chain.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {organization.chain.map((node, i) => (
                <span key={node.id} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted-foreground/50">›</span>}
                  <span className={`rounded-md border px-2 py-1 ${
                    i === organization.chain.length - 1
                      ? 'border-brand-500/30 bg-brand-500/5 font-semibold text-foreground'
                      : 'border-border/60 bg-muted/30 text-muted-foreground'
                  }`}>
                    {node.name}
                    <span className="ms-1 text-[9px] opacity-60">{node.type}</span>
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {organization.department && (
              <span className="text-muted-foreground"><T>الإدارة:</T> <span className="font-medium text-foreground">{organization.department}</span></span>
            )}
            {organization.team && (
              <span className="text-muted-foreground"><T>الفريق:</T> <span className="font-medium text-foreground">{organization.team}</span></span>
            )}
            {organization.manager && (
              <span className="text-muted-foreground"><T>المدير المباشر:</T> <span className="font-medium text-foreground">{organization.manager.name}</span></span>
            )}
            {organization.reportingLine.length > 1 && (
              <span className="text-muted-foreground">
                <T>خط الإبلاغ:</T>{' '}
                {organization.reportingLine.slice(1).map((m) => m.name).join('، ')}
              </span>
            )}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

/* ═══ Employee details — progressive disclosure ═══ */

export function EmployeeDetailsSection({ employee }: {
  employee: NonNullable<Employee360Data['employee']>;
}) {
  const [open, setOpen] = useState(false);

  const rows: Array<{ label: React.ReactNode; value: React.ReactNode; ltr?: boolean }> = [
    { label: <T>الاسم</T>, value: employee.name },
    { label: <T>الكود</T>, value: employee.code ?? '—', ltr: true },
    { label: <T>المسمى الوظيفي</T>, value: employee.position ?? '—' },
    { label: <T>الإدارة (نص السجل)</T>, value: employee.department ?? '—' },
    { label: <T>تاريخ التعيين</T>, value: employee.hireDate ?? '—', ltr: true },
    { label: <T>المدة الخدمية</T>, value: employee.tenureYears !== null ? <>{employee.tenureYears} <T>سنة</T></> : '—' },
    { label: <T>الوردية</T>, value: employee.shiftStart && employee.shiftEnd ? `${employee.shiftStart} - ${employee.shiftEnd}` : '—', ltr: true },
    { label: <T>الحالة</T>, value: STATUS_LABELS[employee.status] ?? employee.status },
    { label: <T>الهاتف</T>, value: employee.mobile ?? '—', ltr: true },
    { label: <T>الإقامة</T>, value: employee.residence ?? '—' },
    { label: <T>عقدة الهيكل</T>, value: employee.orgNodeId ? <span dir="ltr" className="font-mono text-xs">{employee.orgNodeId}</span> : '—' },
  ];

  return (
    <section className="rounded-2xl border border-border/60 bg-card/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-start"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-foreground"><T>تفاصيل الموظف والمستندات</T></span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-5 border-t border-border/50 px-5 py-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b border-border/30 pb-2">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="text-sm font-medium text-foreground" dir={row.ltr ? 'ltr' : undefined}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <EmployeeDocumentsSection employeeId={employee.id} />
        </div>
      )}
    </section>
  );
}

const STATUS_LABELS: Record<string, string> = {
  active: 'نشط', inactive: 'غير نشط', archived: 'مؤرشف', unknown: 'غير محدد',
};
