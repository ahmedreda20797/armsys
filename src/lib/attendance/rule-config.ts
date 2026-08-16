// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — policy configuration
//
//  • DEFAULT_ATTENDANCE_POLICY — the verified legacy rule values
//    (audit §4) expressed as an AttendancePolicyConfig.
//  • resolveAttendancePolicy() — overlays amounts from the existing
//    `deductionRules` collection (keys late15/late30/late60/absence/
//    singleFingerprint) onto the defaults. Replaces the legacy
//    write-on-read `syncRulesToCanonical()` behavior: reading a
//    report no longer writes policy config (Milestone 2 §27).
//  • ensureDeductionRulesSeeded() — idempotent one-time seed for
//    empty environments. Creates MISSING canonical rules only; it
//    never overwrites existing values.
// ══════════════════════════════════════════════════════════════

import { findFirst, createRecord, getAll } from '@/lib/db';
import type { AttendancePolicyConfig } from './types';

/** Canonical deduction-rule rows (labels/amounts verbatim from the legacy routes). */
export const CANONICAL_DEDUCTION_RULES: { key: string; label: string; amount: number; unit: string }[] = [
  { key: 'late15',            label: 'تأخير من 16 إلى 30 دقيقة', amount: 0.25, unit: 'days' },
  { key: 'late30',            label: 'تأخير من 31 إلى 60 دقيقة', amount: 0.5,  unit: 'days' },
  { key: 'late60',            label: 'تأخير 61 دقيقة فأكثر',     amount: 1,    unit: 'days' },
  { key: 'absence',           label: 'غياب',                      amount: 1,    unit: 'days' },
  { key: 'singleFingerprint', label: 'بصمة واحدة فقط (دخول أو خروج بدون الأخرى)', amount: 0.5, unit: 'days' },
];

/**
 * Default policy — the verified legacy values. The late-tier bounds,
 * grace, allowance, weekend policy, and excuse rules were never
 * DB-configurable in the legacy engine; they become first-class
 * config here with their legacy values as defaults.
 */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicyConfig = {
  graceMinutes: 15,
  late15Threshold: 30,
  late30Threshold: 60,
  late15DeductionDays: 0.25,
  late30DeductionDays: 0.5,
  late60DeductionDays: 1,
  absenceDeductionDays: 1,
  singleFingerprintDeductionDays: 0.5,
  freeAbsenceAllowance: 4,
  excuse: {
    normalApprovedDeductionDays: 1,
    exemptApprovedDeductionDays: 0,
    rejectedDeductionDays: 2,
    pendingDeductionDays: 1,
    structuredCategoryField: 'category',
    medicalPatterns: [
      'طبي', 'طبى', 'مريض', 'مرضي', 'مرضى', 'مرضية', 'مستشفى', 'مستشفي',
      'عيادة', 'عملية جراحية', 'تقرير طبي', 'طبيب', 'دكتور',
      'medical', 'sick', 'hospital', 'clinic', 'illness', 'surgery', 'doctor',
    ],
    accidentPatterns: [
      'حادث', 'حوادث', 'طارئ', 'طوارئ', 'إسعاف', 'اسعاف', 'كسر',
      'accident', 'emergency', 'ambulance', 'fracture',
    ],
  },
  weekendPolicy: { mode: 'all-days-count' },
};

/**
 * Minimal shape resolveAttendancePolicy needs from `deductionRules`
 * rows. Keys are optional because rows arrive from the schemaless RTDB
 * table as `Record<string, any>`; missing/invalid keys fall back to
 * the canonical defaults.
 */
export interface DeductionRuleLike {
  key?: string;
  amount?: number;
}

/**
 * Resolve the effective policy: default config overlaid with amounts
 * from the `deductionRules` collection.
 *
 * Compatibility notes (documented behavior change, Milestone 2 §27):
 *   • Historically the report routes FORCE-OVERWROTE the collection to
 *     the canonical amounts on every run, so DB edits were cosmetic.
 *     Existing deployments therefore already hold canonical values and
 *     resolve to identical numbers.
 *   • Now: a row present with a finite numeric amount wins (including
 *     an intentional 0); a missing/invalid row falls back to the
 *     canonical default. Amounts edited through /api/deduction-rules
 *     take effect — that API's purpose — without any write-on-read.
 */
export function resolveAttendancePolicy(deductionRules: DeductionRuleLike[]): AttendancePolicyConfig {
  const byKey = new Map<string, number | undefined>(
    deductionRules
      .filter((rule) => typeof rule.key === 'string' && rule.key.length > 0)
      .map((rule) => [rule.key as string, rule.amount]),
  );
  const amount = (key: string, fallback: number): number => {
    const value = byKey.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };

  return {
    ...DEFAULT_ATTENDANCE_POLICY,
    late15DeductionDays: amount('late15', DEFAULT_ATTENDANCE_POLICY.late15DeductionDays),
    late30DeductionDays: amount('late30', DEFAULT_ATTENDANCE_POLICY.late30DeductionDays),
    late60DeductionDays: amount('late60', DEFAULT_ATTENDANCE_POLICY.late60DeductionDays),
    absenceDeductionDays: amount('absence', DEFAULT_ATTENDANCE_POLICY.absenceDeductionDays),
    singleFingerprintDeductionDays: amount('singleFingerprint', DEFAULT_ATTENDANCE_POLICY.singleFingerprintDeductionDays),
  };
}

/**
 * Idempotent seed: create the canonical deduction-rule rows that are
 * MISSING from the collection. Never updates or deletes existing
 * rows — an admin's customized amounts are preserved.
 *
 * Invoked explicitly (POST /api/deduction-rules/seed) instead of from
 * the report read path, eliminating the write-on-read side effect.
 */
export async function ensureDeductionRulesSeeded(): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const canonical of CANONICAL_DEDUCTION_RULES) {
    const row = await findFirst('deductionRules', { key: canonical.key });
    if (row) {
      existing++;
      continue;
    }
    await createRecord('deductionRules', { ...canonical });
    created++;
  }

  // Warm the table cache so the first report after seeding reads it.
  await getAll('deductionRules').catch(() => []);

  return { created, existing };
}
