// ══════════════════════════════════════════════════════════════
//  Tool: getEmployeeProfile (Phase 6.4, spec §12/§9)
//
//  MINIMAL identity + performance context for one IN-SCOPE employee:
//  identifier, department, position, status, period + KPI headline
//  facts from the EXISTING Performance Intelligence dataset (no
//  second data path, §2/§9). Scope is enforced by the runtime BEFORE
//  this body runs (fail-closed); the dataset itself is the same
//  verified dataset the analytics routes serve.
//
//  DELIBERATELY EXCLUDED (data minimization, §9): phone, email,
//  salary, address, national id, credentials, unrelated records.
// ══════════════════════════════════════════════════════════════

import { getEmployeePerformanceDataset } from '@/lib/performance-intelligence';
import { monthKeyOf } from '@/lib/kpi-reporting/period-basis';
import type { AIToolDefinition } from '../types';

interface ProfileArgs {
  employeeId: string;
  month?: string;
}

function validateArgs(args: unknown): { ok: true; value: ProfileArgs } | { ok: false; error: string } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: 'معاملات غير صالحة' };
  }
  const { employeeId, month } = args as Record<string, unknown>;
  if (typeof employeeId !== 'string' || !employeeId.trim()) {
    return { ok: false, error: 'employeeId مطلوب' };
  }
  if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
    return { ok: false, error: 'صيغة الشهر يجب أن تكون YYYY-MM' };
  }
  return { ok: true, value: { employeeId: employeeId.trim(), month } };
}

export interface EmployeeProfileResult {
  employeeId: string;
  employeeName: string | null;
  department: string | null;
  position: string | null;
  employmentStatus: string | null;
  eligibleForPeriod: boolean | null;
  monthKey: string;
  kpiHeadline: Record<string, number | string | null> | null;
  notes: string[];
}

export const getEmployeeProfileTool: AIToolDefinition<ProfileArgs, EmployeeProfileResult | null> = {
  name: 'getEmployeeProfile',
  category: 'READ_ONLY',
  description: 'ملخص تعريفي مُصغّر لموظف داخل نطاق صلاحيات المستخدم (بدون بيانات اتصال أو رواتب)',
  requiredPermission: { pageId: 'employees', action: 'view' },
  validateArgs,
  execute: async (args) => {
    const monthKey = args.month ?? monthKeyOf(new Date());
    const dataset = await getEmployeePerformanceDataset({
      employeeId: args.employeeId,
      monthKey,
    });
    if (!dataset) return null; // unknown id → null (anti-enumeration)

    const emp = dataset.employee;
    const kpi = dataset.kpi;

    // Minimal projection — only fields the AI may legitimately see.
    const result: EmployeeProfileResult = {
      employeeId: args.employeeId,
      employeeName: emp.employeeName ?? null,
      department: emp.department ?? null,
      position: emp.position ?? null,
      employmentStatus: emp.employmentStatus ?? null,
      eligibleForPeriod: emp.eligibleForPeriod ?? null,
      monthKey,
      kpiHeadline: null,
      notes: ['ملخص مُصغّر — الاسم/الإدارة/المسمى فقط + مؤشرات الفترة، بدون أي بيانات اتصال أو تعويضات.'],
    };

    if (kpi) {
      result.kpiHeadline = {
        outcomeStatus: kpi.outcomeStatus ?? null,
        weightedTotal: kpi.weightedTotal ?? null,
        availableWeight: kpi.availableWeight ?? null,
        overallStatus: kpi.overallStatus ?? null,
        schemeName: kpi.scheme?.schemeName ?? null,
      };
    }
    return result;
  },
};
