// ══════════════════════════════════════════════════════════════
//  Comparison assembly — PURE projection of the insights payload
//
//  §18 Performance Comparison: employee ↔ employee, employee ↔ team,
//  team ↔ team, team ↔ department, department ↔ department. Every
//  dimension comes verbatim from the canonical payload — missing
//  data renders null (the UI shows '—'), NEVER 0. No new
//  calculations are invented here: per-employee facts are the
//  builder's, per-unit facts are the builder's unit aggregation.
// ══════════════════════════════════════════════════════════════

import type {
  KpiInsightsReport,
  UnitInsights,
} from '@/lib/kpi-reporting';

export type ComparisonEntityKind = 'employee' | 'team' | 'department';

export interface ComparisonEntity {
  kind: ComparisonEntityKind;
  /** employee id, or the unit's canonical label key. */
  id: string;
  label: string;
}

export type ComparisonValueKind = 'pct' | 'points' | 'count' | 'text';

export interface ComparisonDimensionValue {
  /** null = dimension not available for this entity (never 0). */
  value: number | string | null;
  kind: ComparisonValueKind;
  /** Optional secondary text (e.g. "متاح 6 من 8 موظفين"). */
  note?: string | null;
}

export interface ComparisonDimension {
  key: string;
  label: [string, string];
  kind: ComparisonValueKind;
  values: Array<ComparisonDimensionValue | null>;
}

/** The value-bearing quality statuses — the canonical completeness set. */
function unitByKey(units: ReadonlyArray<UnitInsights>, key: string): UnitInsights | null {
  return units.find((u) => u.key === key) ?? null;
}

function employeeEntityFacts(report: KpiInsightsReport, employeeId: string) {
  const row = report.rows.find((r) => r.employeeId === employeeId) ?? null;
  const facts = report.employeeFacts[employeeId] ?? null;
  return { row, facts };
}

function qualityValue(entity: ComparisonEntity, report: KpiInsightsReport): ComparisonDimensionValue | null {
  if (entity.kind === 'employee') {
    const { row, facts } = employeeEntityFacts(report, entity.id);
    if (!row || !row.quality || row.quality.rawScore === null) return null;
    return {
      value: row.quality.rawScore,
      kind: 'pct',
      note: facts && facts.observationsApproved > 0
        ? `${facts.observationsApproved}`
        : null,
    };
  }
  const unit = unitByKey(
    entity.kind === 'team' ? report.teamUnits : report.departmentUnits,
    entity.id,
  );
  if (!unit) return null;
  return {
    value: unit.avgQuality,
    kind: 'pct',
    note: `${unit.employeeCount}`,
  };
}

function changeValue(entity: ComparisonEntity, report: KpiInsightsReport): ComparisonDimensionValue | null {
  if (entity.kind === 'employee') {
    const { facts } = employeeEntityFacts(report, entity.id);
    if (!facts) return null;
    return { value: facts.deltaPoints, kind: 'points' };
  }
  const unit = unitByKey(
    entity.kind === 'team' ? report.teamUnits : report.departmentUnits,
    entity.id,
  );
  if (!unit) return null;
  return { value: unit.deltaPoints, kind: 'points' };
}

function observationsValue(entity: ComparisonEntity, report: KpiInsightsReport): ComparisonDimensionValue | null {
  if (entity.kind === 'employee') {
    const { facts } = employeeEntityFacts(report, entity.id);
    if (!facts) return null;
    return { value: facts.observationsApproved, kind: 'count' };
  }
  const unit = unitByKey(
    entity.kind === 'team' ? report.teamUnits : report.departmentUnits,
    entity.id,
  );
  if (!unit) return null;
  return { value: unit.observationsApproved, kind: 'count' };
}

function repeatedValue(entity: ComparisonEntity, report: KpiInsightsReport): ComparisonDimensionValue | null {
  if (entity.kind === 'employee') {
    const { facts } = employeeEntityFacts(report, entity.id);
    if (!facts) return null;
    return { value: facts.repeatedIssues, kind: 'count' };
  }
  const unit = unitByKey(
    entity.kind === 'team' ? report.teamUnits : report.departmentUnits,
    entity.id,
  );
  if (!unit) return null;
  return { value: unit.repeatedIssues, kind: 'count' };
}

function highCriticalValue(entity: ComparisonEntity, report: KpiInsightsReport): ComparisonDimensionValue | null {
  if (entity.kind === 'employee') {
    const { facts } = employeeEntityFacts(report, entity.id);
    if (!facts) return null;
    return { value: facts.highCritical, kind: 'count' };
  }
  const unit = unitByKey(
    entity.kind === 'team' ? report.teamUnits : report.departmentUnits,
    entity.id,
  );
  if (!unit) return null;
  return { value: unit.highCritical, kind: 'count' };
}

/**
 * Evaluation completeness: employees carry their evaluation status
 * (data, never fabricated); units carry how many employees carry a
 * value-bearing result out of the unit's employees.
 */
function completenessValue(entity: ComparisonEntity, report: KpiInsightsReport): ComparisonDimensionValue | null {
  if (entity.kind === 'employee') {
    const { row } = employeeEntityFacts(report, entity.id);
    if (!row) return null;
    return { value: row.rowStatus, kind: 'text' };
  }
  const unit = unitByKey(
    entity.kind === 'team' ? report.teamUnits : report.departmentUnits,
    entity.id,
  );
  if (!unit) return null;
  const withResult = report.rows.filter(
    (r) => unit.employeeIds.includes(r.employeeId) && r.quality !== null,
  ).length;
  return { value: `${withResult}/${unit.employeeCount}`, kind: 'text' };
}

/**
 * Build the comparison grid. Entities may MIX kinds (employee vs
 * team, team vs department…). Only dimensions with canonical data
 * for at least one entity are returned — nothing is fabricated.
 */
export function buildComparisonGrid(
  report: KpiInsightsReport,
  entities: ReadonlyArray<ComparisonEntity>,
): ComparisonDimension[] {
  if (entities.length < 2) return [];
  const dimensions: Array<Omit<ComparisonDimension, 'values'>> = [
    { key: 'quality', label: ['نسبة الجودة', 'Quality Percentage'], kind: 'pct' },
    { key: 'change', label: ['التغير عن الفترة السابقة', 'Change vs previous period'], kind: 'points' },
    { key: 'observations', label: ['الملاحظات المعتمدة', 'Approved observations'], kind: 'count' },
    { key: 'repeated', label: ['مشكلات متكررة', 'Repeated issues'], kind: 'count' },
    { key: 'highCritical', label: ['مرتفعة/حرجة', 'High/Critical'], kind: 'count' },
    { key: 'completeness', label: ['حالة التقييم', 'Evaluation Status'], kind: 'text' },
  ];
  return dimensions.map((dimension) => ({
    ...dimension,
    values: entities.map((entity) => {
      switch (dimension.key) {
        case 'quality': return qualityValue(entity, report);
        case 'change': return changeValue(entity, report);
        case 'observations': return observationsValue(entity, report);
        case 'repeated': return repeatedValue(entity, report);
        case 'highCritical': return highCriticalValue(entity, report);
        case 'completeness': return completenessValue(entity, report);
        default: return null;
      }
    }),
  }));
}

/** Enumerate every comparable entity in the payload (for the picker). */
export function comparableEntities(report: KpiInsightsReport): ReadonlyArray<ComparisonEntity> {
  const employees: ComparisonEntity[] = report.rows.map((r) => ({
    kind: 'employee',
    id: r.employeeId,
    label: r.employeeName,
  }));
  const teams: ComparisonEntity[] = report.teamUnits.map((u) => ({
    kind: 'team',
    id: u.key,
    label: u.label,
  }));
  const departments: ComparisonEntity[] = report.departmentUnits.map((u) => ({
    kind: 'department',
    id: u.key,
    label: u.label,
  }));
  return [...employees, ...teams, ...departments];
}
