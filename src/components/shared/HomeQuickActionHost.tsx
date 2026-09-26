'use client';

// ══════════════════════════════════════════════════════════════
//  HomeQuickActionHost — Unified inline action surface
//
//  Every Quick Action opens the SAME inline form pattern:
//    • CAPAInlineForm           → '@/components/shared/inline-forms'
//    • EmployeeInlineForm       → '@/components/shared/inline-forms'
//    • ObservationInlineForm    → '@/components/shared/inline-forms'
//    • ComplaintInlineForm      → '@/components/shared/inline-forms'
//    • FollowUpInlineForm       → '@/components/shared/inline-forms'
//    • RequestInlineForm        → '@/components/shared/inline-forms'
//
//  All branches render in the SAME visual context (no modal, no
//  overlay, no navigation) — CAPA used to mount a Dialog-based
//  CAPAQuickCreate which was inconsistent with the rest. The new
//  CAPAInlineForm matches the others byte-for-byte.
//
//  When the user clicks a Quick Action chip on HomePage:
//    1. The host opens the matching REAL form inline (no nav).
//    2. On save, the host invalidates the relevant TanStack query
//       keys so the HomePage widgets refresh from the same source
//       of truth (no second data path).
//    3. The user remains on HomePage — they keep their context.
// ══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDomains, type MutationDomain } from '@/lib/cache/invalidation';
import { AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import {
  CAPAInlineForm,
  EmployeeInlineForm,
  ObservationInlineForm,
  ComplaintInlineForm,
  FollowUpInlineForm,
  RequestInlineForm,
} from '@/components/shared/inline-forms';
import { InlineFormPanel } from '@/components/shared/InlineFormPanel';
import { useEmployees, useDashboardUsers } from '@/hooks/use-queries';
import { useObservationCategories } from '@/hooks/use-kpi-queries';

export type HomeQuickActionId =
  | 'employees'
  | 'observations'
  | 'capa'
  | 'complaints'
  | 'followUps'
  | 'requests';

export const HOME_QUICK_ACTIONS: { id: HomeQuickActionId; label: string; iconName: 'users' | 'observations' | 'capa' | 'complaints' | 'followUps' | 'requests' }[] = [
  { id: 'employees', label: 'إضافة موظف', iconName: 'users' },
  { id: 'observations', label: 'ملاحظة جودة', iconName: 'observations' },
  { id: 'capa', label: 'إنشاء CAPA', iconName: 'capa' },
  { id: 'complaints', label: 'إضافة شكوى', iconName: 'complaints' },
  { id: 'followUps', label: 'متابعة جديدة', iconName: 'followUps' },
  { id: 'requests', label: 'طلب جديد', iconName: 'requests' },
];

export interface HomeQuickActionHostProps {
  activeAction: HomeQuickActionId | null;
  onClose: () => void;
}

export function HomeQuickActionHost({ activeAction, onClose }: HomeQuickActionHostProps) {
  if (!activeAction) return null;
  return (
    <AnimatePresence>
      <InlineFormPanel
        key={activeAction}
        tone="violet"
        icon={<Plus className="size-3.5 text-brand-400" />}
        title={HOME_QUICK_ACTIONS.find((a) => a.id === activeAction)?.label ?? 'إجراء سريع'}
        onClose={onClose}
      >
        <QuickActionBody id={activeAction} onClose={onClose} />
      </InlineFormPanel>
    </AnimatePresence>
  );
}

// ── Body switcher — each branch mounts a REAL create form ──
function QuickActionBody({ id, onClose }: { id: HomeQuickActionId; onClose: () => void }) {
  const qc = useQueryClient();
  // The inline forms themselves run the canonical domain invalidations
  // on success (§CACHE); this close handler only marks the affected
  // domains stale once more (no-op refetch when nothing is mounted).
  const closeAndInvalidate = (domains: readonly MutationDomain[]) => () => {
    invalidateDomains(qc, domains);
    onClose();
  };

  switch (id) {
    case 'capa':
      return <CapaInline onClose={onClose} />;
    case 'observations':
      return <ObservationsInline onClose={closeAndInvalidate(['qualityObservations'])} />;
    case 'complaints':
      return <ComplaintsInline onClose={closeAndInvalidate(['complaints'])} />;
    case 'employees':
      return <EmployeesInline onClose={closeAndInvalidate(['employees'])} />;
    case 'followUps':
      return <FollowUpsInline onClose={closeAndInvalidate(['followUps'])} />;
    case 'requests':
      return <RequestsInline onClose={closeAndInvalidate(['requests'])} />;
  }
}

// ── shared hooks/data for the body branches ──
// All picker inputs flow through the canonical cache (§24): several
// quick actions request the SAME users/categories datasets — one
// request, one cache entry, many consumers.
function useCapaInputs() {
  const { data: employees } = useEmployees();
  const { data: users } = useDashboardUsers('basic');
  return {
    employees: (employees ?? []) as never[],
    systemUsers: (users ?? []) as { id: string; name: string; email?: string; role?: string }[],
  };
}

function useSystemUsers(): { id: string; name: string; email?: string; role?: string }[] {
  const { data: users } = useDashboardUsers('basic');
  return (users ?? []) as { id: string; name: string; email?: string; role?: string }[];
}

function useQuickActionCategories(): Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }> {
  // Same endpoint the KPI suite uses — reuse ITS cached query instead
  // of a second raw fetch (also regains the 401 token-refresh retry).
  const { data } = useObservationCategories();
  return (data ?? []) as Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }>;
}

// ── Inline form branches — ALL use the same inline pattern ──
function CapaInline({ onClose }: { onClose: () => void }) {
  const { employees, systemUsers } = useCapaInputs();
  return (
    <CAPAInlineForm
      onClose={onClose}
      onCreated={onClose}
      employees={employees as never}
      systemUsers={systemUsers}
    />
  );
}

function ObservationsInline({ onClose }: { onClose: () => void }) {
  const { data: employees = [] } = useEmployees();
  const categories = useQuickActionCategories();
  return (
    <ObservationInlineForm
      onClose={onClose}
      employees={employees as never}
      categories={categories}
      onCreated={onClose}
    />
  );
}

function ComplaintsInline({ onClose }: { onClose: () => void }) {
  const { data: employees = [] } = useEmployees();
  const systemUsers = useSystemUsers();
  return (
    <ComplaintInlineForm
      onClose={onClose}
      employees={employees as never}
      systemUsers={systemUsers}
      onCreated={onClose}
    />
  );
}

function EmployeesInline({ onClose }: { onClose: () => void }) {
  const { data: employees = [] } = useEmployees();
  return (
    <EmployeeInlineForm
      onClose={onClose}
      employees={employees as never}
      onCreated={onClose}
    />
  );
}

function FollowUpsInline({ onClose }: { onClose: () => void }) {
  const { data: employees = [] } = useEmployees();
  const systemUsers = useSystemUsers();
  return (
    <FollowUpInlineForm
      onClose={onClose}
      employees={employees as never}
      systemUsers={systemUsers}
      onCreated={onClose}
    />
  );
}

function RequestsInline({ onClose }: { onClose: () => void }) {
  const { data: employees = [] } = useEmployees();
  return (
    <RequestInlineForm
      onClose={onClose}
      employees={employees as never}
      onCreated={onClose}
    />
  );
}
