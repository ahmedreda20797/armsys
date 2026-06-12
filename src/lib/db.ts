import { createId } from '@paralleldrive/cuid2';
import { getAdminDb } from './firebase-server';
// firebase-admin v14: get/set/update/remove are methods on Reference objects, not standalone exports

// ═══════════════════════════════════════════════════
//  Firebase RTDB Database Layer
// ═══════════════════════════════════════════════════

function rtdbRef(path: string) {
  return getAdminDb().ref(path);
}

// ═══════════════════════════════════════════════════
//  In-Memory Cache with TTL (Optimized)
// ═══════════════════════════════════════════════════

const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();

// TTL tiers — rarely-changing data gets longer cache life
const TTL = {
  DEFAULT: 5_000,       // 5s — frequently changing data (attendance, requests)
  MEDIUM: 15_000,      // 15s — moderate change rate (employees, quality)
  LONG: 30_000,        // 30s — rarely changing (rules, biometrics)
  STATIC: 60_000,      // 60s — almost never changes (deduction rules)
} as const;

function getCached(table: string): any[] | null {
  const entry = cache.get(table);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(table);
    return null;
  }
  return entry.data;
}

function setCache(table: string, data: any[], ttl: number = TTL.DEFAULT): void {
  cache.set(table, { data, timestamp: Date.now(), ttl });
}

/** Invalidate cache for a specific table (call after writes) */
export function invalidateCache(table?: string): void {
  if (table) {
    cache.delete(table);
  } else {
    cache.clear();
  }
}

/** Get current cache stats (for debugging/monitoring) */
export function getCacheStats(): { size: number; tables: string[] } {
  return {
    size: cache.size,
    tables: Array.from(cache.keys()),
  };
}

export async function getAll<T = Record<string, any>>(table: string, ttl?: number): Promise<T[]> {
  const cached = getCached(table);
  if (cached) return cached as T[];

  const snapshot = await rtdbRef(`arm_erp/${table}`).get();
  if (!snapshot.exists()) return [];
  const data = snapshot.val();
  const result: T[] = Object.entries(data).map(
    ([id, val]) => ({ id, ...(val as Record<string, any>) } as unknown as T)
  );
  setCache(table, result, ttl);
  return result;
}

/** Get multiple tables in a single parallel batch — avoids N separate sequential reads */
export async function getAllBatch(tables: string[]): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>();
  const uncachedTables: string[] = [];

  for (const table of tables) {
    const cached = getCached(table);
    if (cached) {
      result.set(table, cached);
    } else {
      uncachedTables.push(table);
    }
  }

  if (uncachedTables.length > 0) {
    const results = await Promise.all(
      uncachedTables.map(async (table) => {
        const snapshot = await rtdbRef(`arm_erp/${table}`).get();
        if (!snapshot.exists()) return { table, data: [] };
        const data = snapshot.val();
        const parsed: any[] = Object.entries(data).map(
          ([id, val]) => ({ id, ...(val as Record<string, any>) })
        );
        setCache(table, parsed);
        return { table, data: parsed };
      })
    );
    for (const { table, data } of results) {
      result.set(table, data);
    }
  }

  return result;
}

export async function getById<T = Record<string, any>>(table: string, id: string): Promise<T | null> {
  const snapshot = await rtdbRef(`arm_erp/${table}/${id}`).get();
  if (!snapshot.exists()) return null;
  return { id, ...(snapshot.val() as Record<string, any>) } as unknown as T;
}

export async function findWhere<T = Record<string, any>>(table: string, filters: Record<string, any>): Promise<T[]> {
  const all = await getAll<any>(table);
  return all.filter((r) => Object.entries(filters).every(([key, value]) => r[key] === value)) as T[];
}

export async function findWhereContains<T = Record<string, any>>(table: string, field: string, substring: string): Promise<T[]> {
  const all = await getAll<any>(table);
  return all.filter((r) => typeof r[field] === 'string' && r[field].includes(substring)) as T[];
}

export async function findWhereIn<T = Record<string, any>>(table: string, field: string, values: any[]): Promise<T[]> {
  const all = await getAll<any>(table);
  const valueSet = new Set(values.map((v) => String(v)));
  return all.filter((r) => valueSet.has(String(r[field]))) as T[];
}

export async function findFirst<T = Record<string, any>>(table: string, filters: Record<string, any>): Promise<T | null> {
  const results = await findWhere<T>(table, filters);
  return results.length > 0 ? results[0] : null;
}

export async function createRecord<T = Record<string, any>>(table: string, data: Record<string, any>): Promise<T> {
  const id = createId();
  const now = new Date().toISOString();
  const record = { ...data, id, createdAt: now, updatedAt: now };
  await rtdbRef(`arm_erp/${table}/${id}`).set(record);
  invalidateCache(table);
  return record as unknown as T;
}

export async function createRecordWithId<T = Record<string, any>>(table: string, id: string, data: Record<string, any>): Promise<T> {
  const now = new Date().toISOString();
  const record = { ...data, id, createdAt: now, updatedAt: now };
  await rtdbRef(`arm_erp/${table}/${id}`).set(record);
  invalidateCache(table);
  return record as unknown as T;
}

export async function updateRecord(table: string, id: string, data: Record<string, any>): Promise<Record<string, any> | null> {
  const updates = { ...data, updatedAt: new Date().toISOString() };
  await rtdbRef(`arm_erp/${table}/${id}`).update(updates);
  invalidateCache(table);
  return getById(table, id);
}

export async function deleteRecord(table: string, id: string): Promise<void> {
  await rtdbRef(`arm_erp/${table}/${id}`).remove();
  invalidateCache(table);
}

export async function deleteWhere(table: string, filters: Record<string, any>): Promise<number> {
  const all = await getAll<any>(table);
  const toDelete = all.filter((r) => Object.entries(filters).every(([key, value]) => r[key] === value));
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map((record) => rtdbRef(`arm_erp/${table}/${record.id}`).remove()));
  }
  invalidateCache(table);
  return toDelete.length;
}

export async function deleteByIds(table: string, ids: string[]): Promise<number> {
  await Promise.all(ids.map((id) => rtdbRef(`arm_erp/${table}/${id}`).remove()));
  invalidateCache(table);
  return ids.length;
}

// ═══════════════════════════════════════════════════
//  Optimized Count Functions (use cached data)
// ═══════════════════════════════════════════════════

export async function count(table: string): Promise<number> {
  return (await getAll(table)).length;
}

export async function countWhere(table: string, filters: Record<string, any>): Promise<number> {
  const all = await getAll<any>(table);
  return all.filter((r) => Object.entries(filters).every(([key, value]) => r[key] === value)).length;
}

export async function countWhereIn(table: string, field: string, values: any[]): Promise<number> {
  const all = await getAll<any>(table);
  const valueSet = new Set(values.map((v) => String(v)));
  return all.filter((r) => valueSet.has(String(r[field]))).length;
}

// ═══════════════════════════════════════════════════
//  Efficient countByEmployeeId — single-pass count
//  Returns a Map<employeeId, count> without loading
//  the entire table into a new array each time
// ═══════════════════════════════════════════════════

export async function countByEmployeeId(tables: string[], employeeIds: string[]): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  
  const batch = await getAllBatch(tables);
  
  for (const table of tables) {
    const records = batch.get(table) || [];
    const countMap = new Map<string, number>();
    
    for (const r of records) {
      if (r.employeeId) {
        countMap.set(r.employeeId, (countMap.get(r.employeeId) || 0) + 1);
      }
    }
    
    result.set(table, countMap);
  }
  
  return result;
}

export async function groupByCount(table: string, field: string, whereFilters?: Record<string, any>): Promise<{ value: string | null; count: number }[]> {
  let all = await getAll<any>(table);
  if (whereFilters) all = all.filter((r) => Object.entries(whereFilters).every(([key, value]) => r[key] === value));
  const groupMap = new Map<string, number>();
  for (const r of all) { const val = String(r[field] ?? 'null'); groupMap.set(val, (groupMap.get(val) || 0) + 1); }
  return Array.from(groupMap.entries()).map(([value, count]) => ({ value: value === 'null' ? null : value, count })).sort((a, b) => b.count - a.count);
}

// ═══════════════════════════════════════════════════
//  Employee helpers (with longer cache)
// ═══════════════════════════════════════════════════

export async function getEmployeeMap(): Promise<Map<string, { id: string; name: string; department: string | null; position: string | null; shiftStart: string | null }>> {
  const employees = await getAll('employees', TTL.MEDIUM);
  return new Map(employees.map((e: any) => [e.id, { id: e.id, name: e.name, department: e.department || null, position: e.position || null, shiftStart: e.shiftStart || null }]));
}

export async function withEmployee<T extends { employeeId: string }>(records: T[], selectFields?: string[]): Promise<(T & { employeeName: string; employeeDepartment: string | null })[]> {
  const empMap = await getEmployeeMap();
  return records.map((r) => { const emp = empMap.get(r.employeeId); return { ...r, employeeName: emp?.name || 'غير معروف', employeeDepartment: emp?.department || null }; });
}

export async function withEmployeeFull<T extends { employeeId: string }>(records: T[]): Promise<(T & { employee: { id: string; name: string; department: string | null; shiftStart: string | null } })[]> {
  const empMap = await getEmployeeMap();
  return records.map((r) => { const emp = empMap.get(r.employeeId); return { ...r, employee: emp ? { id: emp.id, name: emp.name, department: emp.department, shiftStart: emp.shiftStart } : { id: '', name: 'غير معروف', department: null, shiftStart: null } }; });
}

// ═══════════════════════════════════════════════════
//  withRelatedCounts — Optimized: opt-in via includeCounts
//  Now uses batch loading instead of individual getAll calls
// ═══════════════════════════════════════════════════

export async function withRelatedCounts<T extends { id: string }>(
  employeeRecords: T[],
  options?: { batchData?: Map<string, any[]> }
): Promise<(T & { _count: { attendance: number; requests: number; qualityDeductions: number; biometrics: number; travelDeals: number } })[]> {
  // Use pre-fetched batch data if available (from home stats endpoint), otherwise fetch
  const tables = ['attendance', 'requests', 'qualityDeductions', 'biometrics', 'travelDeals'];
  let batch: Map<string, any[]>;
  
  if (options?.batchData) {
    batch = options.batchData;
  } else {
    batch = await getAllBatch(tables);
  }
  
  const countByEmpId = (records: any[], empId: string) => {
    let count = 0;
    for (const r of records) {
      if (r.employeeId === empId) count++;
    }
    return count;
  };
  
  const attendance = batch.get('attendance') || [];
  const requests = batch.get('requests') || [];
  const qualityDeductions = batch.get('qualityDeductions') || [];
  const biometrics = batch.get('biometrics') || [];
  const travelDeals = batch.get('travelDeals') || [];
  
  return employeeRecords.map((emp) => ({
    ...emp,
    _count: {
      attendance: countByEmpId(attendance, emp.id),
      requests: countByEmpId(requests, emp.id),
      qualityDeductions: countByEmpId(qualityDeductions, emp.id),
      biometrics: countByEmpId(biometrics, emp.id),
      travelDeals: countByEmpId(travelDeals, emp.id),
    },
  }));
}

export function sortByDateField<T extends Record<string, any>>(records: T[], field: string, direction: 'asc' | 'desc' = 'desc'): T[] {
  return [...records].sort((a, b) => { const dateA = a[field] ? new Date(a[field]).getTime() : 0; const dateB = b[field] ? new Date(b[field]).getTime() : 0; return direction === 'desc' ? dateB - dateA : dateA - dateB; });
}

export function sortByField<T extends Record<string, any>>(records: T[], field: string, direction: 'asc' | 'desc' = 'asc'): T[] {
  return [...records].sort((a, b) => { if (a[field] < b[field]) return direction === 'asc' ? -1 : 1; if (a[field] > b[field]) return direction === 'asc' ? 1 : -1; return 0; });
}

// Re-export TTL for use in API routes
export { TTL };
