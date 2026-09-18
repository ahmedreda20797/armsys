// ══════════════════════════════════════════════════════════════
//  Employee identity resolution (Qnlys milestone §6)
//
//  ROOT CAUSE of duplicated risk profiles: risk/aggregation views
//  group by the RTDB push key of arm_erp/employees, and nothing
//  enforces uniqueness of `code`/name — so the SAME human can exist
//  as two records (re-import, name variant) and every factor table
//  (attendance, deductions, follow-ups, complaints, CAPA) keys its
//  counts to whichever record id the event carried. One person then
//  appears as TWO risk rows with wildly different scores.
//
//  THE FIX — one canonical identity per human:
//    key = code:<normalized code>  when a code exists
//        = name:<normalized name>  otherwise
//  Factor maps aggregate under the identity key; exactly ONE risk
//  row is emitted per identity (the PRIMARY record — active status
//  first, then earliest createdAt, then id for determinism).
//
//  Pure functions — unit-testable, no Firebase access.
// ══════════════════════════════════════════════════════════════

import { normalizeForSearch } from '@/lib/search/search-normalize';

export interface IdentityEmployee {
  id: string;
  code?: string | null;
  name: string;
  createdAt?: string | null;
  status?: string | null;
}

/**
 * Canonical identity key for one employee record. Code-based keys
 * win (a code is the operational identity); the Arabic-normalized
 * name is the fallback for legacy records without a code.
 */
export function employeeIdentityKey(emp: Pick<IdentityEmployee, 'code' | 'name'>): string {
  const code = typeof emp.code === 'string' ? emp.code.trim() : '';
  if (code.length > 0) return `code:${code.toLowerCase()}`;
  return `name:${normalizeForSearch(emp.name)}`;
}

/** Which duplicate record represents the identity: active first, then the OLDEST record (createdAt asc), then id. */
function comparePrimary(a: IdentityEmployee, b: IdentityEmployee): number {
  const aActive = a.status === 'active' || !a.status ? 0 : 1;
  const bActive = b.status === 'active' || !b.status ? 0 : 1;
  if (aActive !== bActive) return aActive - bActive;
  const aCreated = a.createdAt ?? '';
  const bCreated = b.createdAt ?? '';
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export interface EmployeeIdentityIndex<T extends IdentityEmployee> {
  /** One record per identity (the primary). */
  primaries: T[];
  /** Every record id → its identity key. */
  identityOf: (recordId: string) => string | null;
  /** Duplicate (non-primary) record ids that were merged. */
  mergedIds: string[];
}

/**
 * Collapse employee records into ONE entry per human identity.
 * Aggregations must key factor maps by `identityOf(recordId)` and
 * iterate `primaries` — never the raw record list.
 */
export function dedupeEmployeesByIdentity<T extends IdentityEmployee>(
  employees: ReadonlyArray<T>,
): EmployeeIdentityIndex<T> {
  const byIdentity = new Map<string, T[]>();
  const idToIdentity = new Map<string, string>();
  for (const emp of employees) {
    const key = employeeIdentityKey(emp);
    const bucket = byIdentity.get(key);
    if (bucket) bucket.push(emp);
    else byIdentity.set(key, [emp]);
    idToIdentity.set(emp.id, key);
  }

  const primaries: T[] = [];
  const mergedIds: string[] = [];
  for (const [, bucket] of byIdentity) {
    const sorted = [...bucket].sort(comparePrimary);
    primaries.push(sorted[0]);
    for (const dup of sorted.slice(1)) mergedIds.push(dup.id);
  }
  primaries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    primaries,
    identityOf: (recordId: string) => idToIdentity.get(recordId) ?? null,
    mergedIds,
  };
}
