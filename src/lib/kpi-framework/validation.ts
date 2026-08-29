// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — Pure Validation Rules (Phase 1)
//
//  Pure, deterministic, unit-testable rules. No database access.
//
//  Key business rules enforced here:
//    • A COMPLETE scheme (meant to represent the company KPI) must
//      have ACTIVE component weights totaling EXACTLY 100.
//      Scheme validity ≠ component availability: an unavailable
//      component does NOT invalidate the weights, and an invalid
//      total prevents ACTIVATION (never silently re-normalized).
//    • Effective windows are inclusive `YYYY-MM-DD` day keys; a
//      scheme applies to a period (`YYYY-MM`) when the window
//      overlaps ANY day of that month.
//    • Overlapping ACTIVE schemes that could BOTH resolve for the
//      same population/window are a hard conflict — callers fail
//      safely instead of picking an arbitrary scheme.
//    • RTDB safety: nothing containing `undefined` ever reaches a
//      write — stripUndefinedForRtdb is the single normalizer.
// ══════════════════════════════════════════════════════════════

import type {
  KpiScheme,
  KpiSchemeComponent,
  KpiComponentCalculationType,
  KpiComponentOwner,
  KpiComponentStatus,
} from './types';

/** Reusable validation result (same shape as lib/db-validation). */
export interface SchemeValidationResult {
  valid: boolean;
  error?: string;
  details?: string[];
}

const VALID_OWNERS: readonly KpiComponentOwner[] = [
  'quality', 'management', 'hr', 'sales', 'other',
];
const VALID_CALCULATION_TYPES: readonly KpiComponentCalculationType[] = [
  'quality_engine', 'none', 'manual',
];
const VALID_COMPONENT_STATUSES: readonly KpiComponentStatus[] = ['ACTIVE', 'INACTIVE'];

/** Floating-point tolerance for the 100% weight total. */
const WEIGHT_TOTAL_EPSILON = 1e-9;

// ─────────────────────────────────────────────────────────────
//  Date keys (YYYY-MM-DD)
// ─────────────────────────────────────────────────────────────

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when the value is a well-formed, real calendar `YYYY-MM-DD` day key. */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(DATE_KEY_PATTERN);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Validate an effective window (inclusive bounds, `to` must be after `from`). */
export function validateEffectiveWindow(
  effectiveFrom: unknown,
  effectiveTo: unknown,
): SchemeValidationResult {
  if (!isValidDateKey(effectiveFrom)) {
    return { valid: false, error: 'تاريخ بداية السريان غير صحيح (YYYY-MM-DD مطلوب)' };
  }
  if (effectiveTo !== null && effectiveTo !== undefined && effectiveTo !== '') {
    if (!isValidDateKey(effectiveTo)) {
      return { valid: false, error: 'تاريخ نهاية السريان غير صحيح (YYYY-MM-DD مطلوب)' };
    }
    if ((effectiveTo as string) <= (effectiveFrom as string)) {
      return { valid: false, error: 'تاريخ نهاية السريان يجب أن يكون بعد تاريخ البداية' };
    }
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────
//  Period coverage (scheme ↔ YYYY-MM)
// ─────────────────────────────────────────────────────────────

/** First/last day keys of a validated `YYYY-MM` month. */
export function monthDayRange(period: string): { start: string; end: string } {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Does the scheme's effective window overlap ANY day of the period?
 * A future scheme can therefore never affect historical periods, and
 * an expired scheme stops resolving the day after its `effectiveTo`.
 */
export function schemeCoversPeriod(scheme: KpiScheme, period: string): boolean {
  if (!isValidDateKey(scheme.effectiveFrom)) return false;
  const { start, end } = monthDayRange(period);
  if (scheme.effectiveFrom > end) return false;
  if (scheme.effectiveTo && scheme.effectiveTo < start) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
//  Component & weight validation
// ─────────────────────────────────────────────────────────────

/** Validate the component list of a scheme (shape, enums, weights). */
export function validateSchemeComponents(
  components: unknown,
): SchemeValidationResult {
  if (!Array.isArray(components) || components.length === 0) {
    return { valid: false, error: 'يجب أن يحتوي النظام على مكون واحد على الأقل' };
  }

  const seenIds = new Set<string>();
  const details: string[] = [];

  for (let i = 0; i < components.length; i++) {
    const raw = components[i] as Record<string, unknown>;
    const label = `المكوّن #${i + 1}`;

    const componentId = typeof raw.componentId === 'string' ? raw.componentId.trim() : '';
    if (!componentId) {
      return { valid: false, error: `${label}: معرّف المكوّن مطلوب` };
    }
    if (seenIds.has(componentId)) {
      return { valid: false, error: `${label}: معرّف المكوّن "${componentId}" مكرر` };
    }
    seenIds.add(componentId);

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) {
      return { valid: false, error: `${label} (${componentId}): اسم المكوّن مطلوب` };
    }

    const weight = raw.weight;
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) {
      return { valid: false, error: `${label} (${componentId}): الوزن يجب أن يكون رقماً بين 0 و 100` };
    }

    if (!VALID_OWNERS.includes(raw.owner as KpiComponentOwner)) {
      return { valid: false, error: `${label} (${componentId}): مالك المكوّن غير مدعوم` };
    }
    if (!VALID_CALCULATION_TYPES.includes(raw.calculationType as KpiComponentCalculationType)) {
      return { valid: false, error: `${label} (${componentId}): نوع الحساب غير مدعوم` };
    }
    if (
      raw.status !== undefined &&
      !VALID_COMPONENT_STATUSES.includes(raw.status as KpiComponentStatus)
    ) {
      return { valid: false, error: `${label} (${componentId}): حالة المكوّن غير مدعومة` };
    }

    if (
      raw.configuration !== undefined &&
      raw.configuration !== null &&
      (typeof raw.configuration !== 'object' || Array.isArray(raw.configuration))
    ) {
      return { valid: false, error: `${label} (${componentId}): إعدادات المكوّن يجب أن تكون كائناً` };
    }

    if (weight === 0) {
      details.push(`${componentId}: وزن صفر — لن يساهم في النتيجة`);
    }
  }

  return { valid: true, details: details.length > 0 ? details : undefined };
}

/** Σ weights of the ACTIVE components (the weights that will aggregate). */
export function activeComponentsWeightTotal(components: KpiSchemeComponent[]): number {
  return components
    .filter((c) => c.status === 'ACTIVE')
    .reduce((sum, c) => sum + c.weight, 0);
}

/**
 * THE 100% RULE. A complete company scheme must have ACTIVE component
 * weights totaling exactly 100 (15 + 15 + 10 + 60 = 100 ✓ /
 * 20 + 20 + 10 + 60 = 110 ✗). Prevents activation of an invalid
 * complete scheme — weights are never silently re-normalized.
 */
export function validateSchemeWeightTotal(
  components: KpiSchemeComponent[],
): SchemeValidationResult {
  const total = activeComponentsWeightTotal(components);
  if (Math.abs(total - 100) > WEIGHT_TOTAL_EPSILON) {
    return {
      valid: false,
      error: `مجموع أوزان المكوّنات النشطة يجب أن يساوي 100% بالضبط (الحالي: ${roundTo2(total, 2)}%)`,
    };
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────
//  Overlap (fail-safe, no silent arbitrary choice)
// ─────────────────────────────────────────────────────────────

/** True when two `YYYY-MM-DD` windows overlap (inclusive bounds). */
function windowsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

/** Departments two schemes could BOTH claim (empty = disjoint/one unrestricted). */
function sharedDepartments(a: KpiScheme, b: KpiScheme): string[] {
  const aDepts = a.applicableDepartments;
  const bDepts = b.applicableDepartments;
  if (!aDepts && !bDepts) return ['*']; // both unrestricted
  if (!aDepts || !bDepts) return aDepts ?? bDepts ?? []; // one unrestricted claims all
  return aDepts.filter((d) => bDepts.includes(d));
}

/**
 * Find ACTIVE schemes that would conflict with `candidate` if it were
 * activated: same resolution level (both default, or both claiming a
 * shared department) over an overlapping effective window. An
 * empty result means activation is safe.
 */
export function findConflictingActiveSchemes(
  candidate: KpiScheme,
  allSchemes: ReadonlyArray<KpiScheme>,
): KpiScheme[] {
  return allSchemes.filter((other) => {
    if (other.id === candidate.id) return false;
    if (other.status !== 'ACTIVE') return false;
    if (!windowsOverlap(
      candidate.effectiveFrom,
      candidate.effectiveTo,
      other.effectiveFrom,
      other.effectiveTo,
    )) {
      return false;
    }
    if (candidate.isDefault && other.isDefault) return true;
    return sharedDepartments(candidate, other).length > 0;
  });
}

// ─────────────────────────────────────────────────────────────
//  Full scheme input validation
// ─────────────────────────────────────────────────────────────

/**
 * Validate a full scheme input (create/update). Weight TOTAL is NOT
 * required here — drafts may be incomplete; the total is enforced at
 * ACTIVATION time only (validateSchemeWeightTotal).
 */
export function validateSchemeInput(input: {
  name: unknown;
  description?: unknown;
  effectiveFrom: unknown;
  effectiveTo?: unknown;
  applicableDepartments?: unknown;
  components: unknown;
}): SchemeValidationResult {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { valid: false, error: 'اسم نظام مؤشرات الأداء مطلوب' };
  }
  if (name.length > 120) {
    return { valid: false, error: 'اسم نظام مؤشرات الأداء طويل جداً (الحد 120 حرفاً)' };
  }
  if (
    input.description !== undefined &&
    input.description !== null &&
    typeof input.description !== 'string'
  ) {
    return { valid: false, error: 'الوصف يجب أن يكون نصاً' };
  }

  const windowCheck = validateEffectiveWindow(input.effectiveFrom, input.effectiveTo);
  if (!windowCheck.valid) return windowCheck;

  if (
    input.applicableDepartments !== undefined &&
    input.applicableDepartments !== null
  ) {
    if (
      !Array.isArray(input.applicableDepartments) ||
      input.applicableDepartments.some((d) => typeof d !== 'string' || !d.trim())
    ) {
      return { valid: false, error: 'الأقسام المطبّقة يجب أن تكون قائمة أسماء أقسام صحيحة' };
    }
  }

  return validateSchemeComponents(input.components);
}

// ─────────────────────────────────────────────────────────────
//  Firebase RTDB safety
// ─────────────────────────────────────────────────────────────

/**
 * Deeply strip `undefined` values so nothing illegal ever reaches
 * RTDB (RTDB rejects/ignores undefined; nulls remove keys, which is
 * the intended "absent" semantics for optional fields).
 */
export function stripUndefinedForRtdb<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefinedForRtdb(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[key] = stripUndefinedForRtdb(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Round to 2 decimals (optional digits for diagnostics) — the framework's rounding rule. */
export function roundTo2(value: number, digits: number = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
