// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — day-level policy
//
//  The single canonical evaluation of one employee-day, extracted
//  from the previously duplicated logic in /api/reports/generate and
//  /api/reports/employee-detail (Phase 2 Milestone 1 audit §4).
//
//  Pure function: AttendanceDayInput + AttendancePolicyConfig →
//  deterministic DayEvaluation. No Firebase, no React, no HTTP, no
//  globals, no clock reads.
//
//  Documented precedence (audit §11 — preserved unless changed by a
//  Milestone 2 locked decision):
//    P1  attendance record linked to a request (approvedRequestId)
//          → excuse rules (Decision D / R9)
//    P1b attendance.status === 'approved'        → exempt
//    P2  approved request (any type)             → exempt
//    P3  biometric check-in                      → present/late (+ single fingerprint)
//    P4  biometric check-out only                → present + single fingerprint
//    P5  attendance record fallback
//    P6  request-only state (rejected/pending)
//    P7  no records                              → absence
// ══════════════════════════════════════════════════════════════

import type {
  AttendanceDayInput,
  AttendancePolicyConfig,
  DayEvaluation,
  DeductionWaiverType,
  ExcuseCategory,
  LateTier,
  RequestInput,
} from './types';
import { legacyDateDayName } from './dates';

// ─── Time helpers (legacy semantics) ──────────────────────────

/**
 * Minutes past `shiftStart` for a "HH:MM"-shaped check-in string.
 * Legacy tolerance: single-digit hours and trailing seconds parse
 * (only the first two components are used); any non-numeric
 * component yields 0 rather than an error.
 */
export function minutesLateVsShift(checkIn: string | null, shiftStart: string | null): number {
  if (!checkIn || !shiftStart) return 0;
  const [cH, cM] = checkIn.split(':').map(Number);
  const [sH, sM] = shiftStart.split(':').map(Number);
  if (isNaN(cH) || isNaN(cM) || isNaN(sH) || isNaN(sM)) return 0;
  return Math.max(0, (cH * 60 + cM) - (sH * 60 + sM));
}

/** Resolve the late tier + deduction for a lateness minute total. */
export function resolveLateTier(
  minutesLate: number,
  config: AttendancePolicyConfig,
): { tier: LateTier; deductionDays: number } {
  if (minutesLate <= config.graceMinutes) return { tier: null, deductionDays: 0 };
  if (minutesLate <= config.late15Threshold) {
    return { tier: 'late15', deductionDays: config.late15DeductionDays };
  }
  if (minutesLate <= config.late30Threshold) {
    return { tier: 'late30', deductionDays: config.late30DeductionDays };
  }
  return { tier: 'late60', deductionDays: config.late60DeductionDays };
}

function isWaived(waivers: DeductionWaiverType[], type: 'late' | 'absence'): boolean {
  return waivers.includes(type) || waivers.includes('all');
}

// ─── Excuse classification (Decision D / §6) ──────────────────

/**
 * Classify an excuse request into normal / medical / accident.
 *
 * Resolution order:
 *   1. Structured category field (config.excuse.structuredCategoryField)
 *      when the request record carries one — the future-proof path.
 *      Recognized values: 'medical' | 'accident' | 'emergency'
 *      (case-insensitive); anything else falls through as normal.
 *   2. Config-driven keyword mapping over the free-text `reason`
 *      (case-insensitive substring). This is the documented interim
 *      mapping — the current Request model has no structured
 *      category field, and Milestone 2 explicitly forbids inventing
 *      a database migration (§6).
 *   3. Otherwise: 'normal'.
 */
export function classifyExcuse(request: RequestInput, config: AttendancePolicyConfig): ExcuseCategory {
  const field = config.excuse.structuredCategoryField;
  if (field) {
    const raw = (request as unknown as Record<string, unknown>)[field];
    if (typeof raw === 'string' && raw.trim() !== '') {
      const value = raw.trim().toLowerCase();
      if (value === 'medical') return 'medical';
      if (value === 'accident' || value === 'emergency') return 'accident';
    }
  }

  const reason = (request.reason ?? '').toLowerCase();
  if (reason) {
    const matches = (patterns: string[]) =>
      patterns.some((p) => p.toLowerCase().length > 0 && reason.includes(p.toLowerCase()));
    if (matches(config.excuse.medicalPatterns)) return 'medical';
    if (matches(config.excuse.accidentPatterns)) return 'accident';
  }

  return 'normal';
}

// ─── Day evaluation ───────────────────────────────────────────

function baseEvaluation(input: AttendanceDayInput): DayEvaluation {
  return {
    date: input.date,
    dayName: legacyDateDayName(input.date),
    status: 'present',
    ruleApplied: 'no-record',
    excuseCategory: null,
    lateTier: null,
    minutesLate: 0,
    lateDeductionDays: 0,
    absenceDeductionDays: 0,
    singleFingerprintDeductionDays: 0,
    deductionDays: 0,
    waived: input.waivers.length > 0,
    waivedTypes: [...input.waivers],
    autoFree: false,
    unaccounted: false,
    pendingFinalization: false,
  };
}

/** Evaluate one employee-day against the canonical policy. */
export function evaluateDay(input: AttendanceDayInput, config: AttendancePolicyConfig): DayEvaluation {
  const evaluation = baseEvaluation(input);
  const { biometric, attendance, request, shiftStart } = input;
  const waiveLate = isWaived(input.waivers, 'late');
  const waiveAbsence = isWaived(input.waivers, 'absence');

  // ── P1: attendance linked to a request (excuse workflow) — Decision D ──
  // The request-approval flow auto-creates attendance records with
  // approvedRequestId for excuse requests; the engine re-derives the
  // final deduction from the request state (never from free-text notes).
  if (attendance && attendance.approvedRequestId) {
    if (request && request.status === 'approved') {
      const category = request.type === 'excuse'
        ? classifyExcuse(request, config)
        : 'normal';
      const deduction = category === 'normal'
        ? config.excuse.normalApprovedDeductionDays
        : config.excuse.exemptApprovedDeductionDays;
      evaluation.status = 'absent';
      evaluation.ruleApplied = category === 'normal' ? 'excuse-approved' : 'excuse-approved-exempt';
      evaluation.excuseCategory = category;
      evaluation.absenceDeductionDays = deduction;
    } else if (request && request.status === 'rejected') {
      evaluation.status = 'absent';
      evaluation.ruleApplied = 'excuse-rejected';
      evaluation.excuseCategory = request.type === 'excuse' ? classifyExcuse(request, config) : null;
      evaluation.absenceDeductionDays = config.excuse.rejectedDeductionDays;
    } else {
      // Pending — or the linked request record no longer exists
      // (deleted request leaves an orphan attendance record).
      // Provisional legacy-compatible outcome: absent + standard
      // pending deduction, flagged unfinalized (never silently
      // converted into an approved/rejected result — Decision D).
      evaluation.status = 'absent';
      evaluation.ruleApplied = request ? 'excuse-pending' : 'excuse-unknown';
      evaluation.absenceDeductionDays = config.excuse.pendingDeductionDays;
      evaluation.unaccounted = true;
      evaluation.pendingFinalization = Boolean(request && request.status === 'pending');
    }
    evaluation.deductionDays =
      evaluation.lateDeductionDays + evaluation.absenceDeductionDays + evaluation.singleFingerprintDeductionDays;
    return evaluation;
  }

  // ── P1b: approved attendance status → exempt ──
  if (attendance && attendance.status === 'approved') {
    evaluation.status = 'exempt';
    evaluation.ruleApplied = 'attendance-approved';
    return evaluation;
  }

  // ── P2: approved request → exempt from ALL deductions ──
  // Applies even when biometric/attendance data exists (legacy priority).
  if (request && request.status === 'approved') {
    evaluation.status = 'exempt';
    evaluation.ruleApplied = 'request-approved';
    return evaluation;
  }

  // ── P3: biometric check-in ──
  const bioCheckIn = biometric?.checkIn || null;
  const bioCheckOut = biometric?.checkOut || null;

  if (bioCheckIn) {
    const minutes = minutesLateVsShift(bioCheckIn, shiftStart);
    evaluation.minutesLate = minutes;
    if (minutes > config.graceMinutes) {
      evaluation.status = 'late';
      const { tier, deductionDays } = resolveLateTier(minutes, config);
      evaluation.lateTier = tier;
      if (!waiveLate) evaluation.lateDeductionDays = deductionDays;
    } else {
      evaluation.status = 'present';
    }
    if (!bioCheckOut && !waiveAbsence) {
      evaluation.singleFingerprintDeductionDays = config.singleFingerprintDeductionDays;
    }
    evaluation.ruleApplied = 'biometric-checkin';
    evaluation.deductionDays =
      evaluation.lateDeductionDays + evaluation.absenceDeductionDays + evaluation.singleFingerprintDeductionDays;
    return evaluation;
  }

  // ── P4: biometric check-out without check-in ──
  if (biometric && !bioCheckIn && bioCheckOut) {
    evaluation.status = 'present';
    evaluation.ruleApplied = 'biometric-checkout-only';
    if (!waiveAbsence) {
      evaluation.singleFingerprintDeductionDays = config.singleFingerprintDeductionDays;
    }
    evaluation.deductionDays = evaluation.singleFingerprintDeductionDays;
    return evaluation;
  }

  // ── P5: attendance record fallback ──
  if (attendance) {
    const attCheckIn = attendance.checkIn || null;
    const attMinutesLate = attendance.minutesLate || 0;

    if (attCheckIn) {
      const recomputed = minutesLateVsShift(attCheckIn, shiftStart);
      const effectiveMinutes = Math.max(recomputed, attMinutesLate);
      evaluation.minutesLate = effectiveMinutes;
      if (effectiveMinutes > config.graceMinutes) {
        evaluation.status = 'late';
        const { tier, deductionDays } = resolveLateTier(effectiveMinutes, config);
        evaluation.lateTier = tier;
        if (!waiveLate) evaluation.lateDeductionDays = deductionDays;
      } else {
        evaluation.status = 'present';
      }
      evaluation.ruleApplied = 'attendance-checkin';
      evaluation.deductionDays = evaluation.lateDeductionDays;
      return evaluation;
    }

    if (attendance.status === 'absent') {
      evaluation.status = 'absent';
      evaluation.ruleApplied = 'attendance-absent';
      if (waiveAbsence) {
        evaluation.absenceDeductionDays = 0;
      } else if (request && request.status === 'rejected') {
        evaluation.absenceDeductionDays = config.excuse.rejectedDeductionDays;
      } else {
        evaluation.absenceDeductionDays = config.absenceDeductionDays;
      }
      evaluation.deductionDays = evaluation.absenceDeductionDays;
      return evaluation;
    }

    if (attendance.status === 'present') {
      evaluation.status = 'present';
      evaluation.ruleApplied = 'attendance-present';
      return evaluation;
    }

    if (attendance.status === 'late' || attMinutesLate > 0) {
      evaluation.status = 'late';
      evaluation.minutesLate = attMinutesLate;
      evaluation.ruleApplied = 'attendance-late';
      const { tier, deductionDays } = resolveLateTier(attMinutesLate, config);
      evaluation.lateTier = tier;
      if (!waiveLate) evaluation.lateDeductionDays = deductionDays;
      evaluation.deductionDays = evaluation.lateDeductionDays;
      return evaluation;
    }
    // Unknown status without check-in → fall through to P6/P7 (legacy).
  }

  // ── P6: request-only state ──
  if (request) {
    if (request.status === 'approved') {
      // Normally caught by P2; kept defensively (legacy did the same).
      evaluation.status = 'exempt';
      evaluation.ruleApplied = 'request-approved';
      return evaluation;
    }
    if (request.status === 'rejected') {
      evaluation.status = 'absent';
      evaluation.ruleApplied = 'request-rejected';
      evaluation.absenceDeductionDays = waiveAbsence ? 0 : config.excuse.rejectedDeductionDays;
      evaluation.deductionDays = evaluation.absenceDeductionDays;
      return evaluation;
    }
    // Pending: provisional absence, flagged unfinalized (Decision D).
    evaluation.status = 'absent';
    evaluation.ruleApplied = 'request-pending';
    evaluation.absenceDeductionDays = waiveAbsence ? 0 : config.excuse.pendingDeductionDays;
    evaluation.unaccounted = true;
    evaluation.pendingFinalization = true;
    evaluation.deductionDays = evaluation.absenceDeductionDays;
    return evaluation;
  }

  // ── P7: no records at all ──
  evaluation.status = 'absent';
  evaluation.ruleApplied = 'no-record';
  evaluation.absenceDeductionDays = waiveAbsence ? 0 : config.absenceDeductionDays;
  evaluation.unaccounted = true;
  evaluation.deductionDays = evaluation.absenceDeductionDays;
  return evaluation;
}
