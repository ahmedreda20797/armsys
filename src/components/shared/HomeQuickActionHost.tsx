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
import { useEmployees } from '@/hooks/use-queries';
import { authFetch } from '@/lib/api-fetch';

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
  const closeAndInvalidate = (keys: string[][]) => () => {
    keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    onClose();
  };

  switch (id) {
    case 'capa':
      return <CapaInline onClose={onClose} />;
    case 'observations':
      return <ObservationsInline onClose={closeAndInvalidate([['observations'], ['quality'], ['home-stats']])} />;
    case 'complaints':
      return <ComplaintsInline onClose={closeAndInvalidate([['complaints'], ['home-stats']])} />;
    case 'employees':
      return <EmployeesInline onClose={closeAndInvalidate([['employees'], ['home-stats']])} />;
    case 'followUps':
      return <FollowUpsInline onClose={closeAndInvalidate([['followUps'], ['home-stats']])} />;
    case 'requests':
      return <RequestsInline onClose={closeAndInvalidate([['requests'], ['home-stats']])} />;
  }
}

// ── shared hooks/data for the body branches ──
function useCapaInputs() {
  const { data: employees } = useEmployees();
  const [usersList, setUsersList] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/dashboard/users?basic=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        setUsersList(
          (list as { id: string; name: string; email?: string; role?: string }[]).map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
          })),
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return { employees: (employees ?? []) as never[], systemUsers: usersList };
}

function useSystemUsers(): { id: string; name: string; email?: string; role?: string }[] {
  const [usersList, setUsersList] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/dashboard/users?basic=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        setUsersList((list as { id: string; name: string; email?: string; role?: string }[]) ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return usersList;
}

function useObservationCategories(): Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }> {
  const [cats, setCats] = useState<Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/observation-categories', {
      headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        setCats((list as Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }>) ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return cats;
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
  const categories = useObservationCategories();
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
