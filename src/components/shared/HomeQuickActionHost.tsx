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
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus } from 'lucide-react';
import {
  CAPAInlineForm,
  EmployeeInlineForm,
  ObservationInlineForm,
  ComplaintInlineForm,
  FollowUpInlineForm,
  RequestInlineForm,
} from '@/components/shared/inline-forms';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEmployees } from '@/hooks/use-queries';

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
      <motion.div
        key={activeAction}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className="rounded-2xl border border-violet-500/30 bg-slate-900/60 backdrop-blur-md shadow-2xl shadow-violet-900/20"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-700/50">
          <p className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <Plus className="size-3.5 text-violet-400" />
            {HOME_QUICK_ACTIONS.find((a) => a.id === activeAction)?.label ?? 'إجراء سريع'}
          </p>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs text-slate-400 hover:text-white">
            <X className="size-3.5 ml-1" />
            إغلاق
          </Button>
        </div>
        <div className="p-4">
          <QuickActionBody id={activeAction} onClose={onClose} />
        </div>
      </motion.div>
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
    fetch('/api/dashboard/users?limit=200', {
      headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` },
    })
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
    fetch('/api/dashboard/users?limit=200', {
      headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` },
    })
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
